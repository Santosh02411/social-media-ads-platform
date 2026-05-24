"""
TikTok Connector — TikTok Content Posting API v2
Supports: video (FILE_UPLOAD), image/photo mode (PULL_FROM_URL with public URL)
Audio: TikTok does not support audio-only posts.

Required credentials:
- access_token: OAuth 2.0 access token (video.upload + video.publish scopes)
- open_id: TikTok Open ID
"""

import os, mimetypes, requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


class TikTokConnector(BaseConnector):
    PLATFORM_NAME = "TikTok"
    ICON = "tiktok"
    COLOR = "#010101"
    SUPPORTED_CONTENT_TYPES = ["video", "image"]
    REQUIRED_CREDENTIALS = [
        {"key": "access_token", "label": "Access Token", "type": "password",
         "help": "OAuth 2.0 access token with video.upload and video.publish scopes"},
        {"key": "open_id", "label": "Open ID", "type": "text",
         "help": "Your TikTok Open ID — returned during OAuth flow as 'open_id'"},
    ]

    API_BASE = "https://open.tiktokapis.com/v2"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.access_token = credentials.get("access_token", "")
        self.open_id      = credentials.get("open_id", "")

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        }

    def validate_credentials(self) -> Dict[str, Any]:
        if not self.access_token or not self.open_id:
            return {"success": False, "error": "Access Token and Open ID are required"}
        try:
            resp = requests.post(
                f"{self.API_BASE}/user/info/",
                headers=self._headers(),
                json={"fields": ["open_id", "display_name", "follower_count"]},
                timeout=10,
            )
            data = resp.json()
            code = data.get("error", {}).get("code", "ok")
            if code not in ("ok", None, 0, ""):
                return {"success": False, "error": data.get("error", {}).get("message", "Invalid credentials")}
            user = data.get("data", {}).get("user", {})
            return {"success": True, "account_info": {
                "name": user.get("display_name", ""),
                "open_id": user.get("open_id", ""),
                "followers": user.get("follower_count", 0),
            }}
        except requests.RequestException as e:
            return {"success": False, "error": f"Network error: {e}"}

    def connect(self) -> Dict[str, Any]:
        result = self.validate_credentials()
        if result["success"]:
            self._connected = True
            self._account_info = result.get("account_info", {})
        return result

    def disconnect(self) -> None:
        self._connected = False
        self._account_info = {}

    def post_ad(self, content: Dict[str, Any]) -> Dict[str, Any]:
        if not self._connected:
            return {"success": False, "error": "Not connected to TikTok"}

        media_url  = content.get("media_url", "")
        media_type = content.get("media_type", "text")

        if media_type == "audio":
            return {"success": False, "error": "TikTok does not support audio-only posts. Upload a video instead."}

        if not media_url or media_type not in ("video", "image"):
            return {"success": False, "error": "TikTok requires a video or image file"}

        caption = self._build_post_text(content)
        ad_title = content.get("ad_title", "")
        cta      = content.get("call_to_action", "")
        if ad_title: caption = f"{ad_title}\n\n{caption}"
        if cta:      caption += f"\n\n{cta}"
        caption = caption[:2200]

        if media_type == "video":
            return self._post_video(caption, media_url)
        else:
            return self._post_photo(caption, media_url)

    def _post_video(self, caption: str, media_url: str) -> Dict[str, Any]:
        """FILE_UPLOAD for local files; PULL_FROM_URL for public URLs."""
        local = _local_path(media_url)

        if os.path.exists(local):
            file_size = os.path.getsize(local)
            mime, _   = mimetypes.guess_type(local)
            mime = mime or "video/mp4"

            # INIT
            init_resp = requests.post(
                f"{self.API_BASE}/post/publish/video/init/",
                headers=self._headers(),
                json={
                    "post_info": {
                        "title": caption,
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False,
                        "disable_comment": False,
                        "disable_stitch": False,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": file_size,
                        "chunk_size": file_size,
                        "total_chunk_count": 1,
                    },
                },
                timeout=30,
            )
            init_data = init_resp.json()
            code = init_data.get("error", {}).get("code", "ok")
            if code not in ("ok", None, 0, ""):
                return {"success": False, "error": init_data.get("error", {}).get("message", "Init failed")}

            upload_url = init_data.get("data", {}).get("upload_url", "")
            publish_id = init_data.get("data", {}).get("publish_id", "")

            if not upload_url:
                return {"success": False, "error": "No upload URL returned from TikTok"}

            # UPLOAD
            with open(local, "rb") as f:
                video_bytes = f.read()

            up_resp = requests.put(
                upload_url, data=video_bytes,
                headers={
                    "Content-Type": mime,
                    "Content-Range": f"bytes 0-{file_size - 1}/{file_size}",
                },
                timeout=300,
            )
            if up_resp.status_code not in (200, 201):
                return {"success": False, "error": f"TikTok video upload failed: {up_resp.status_code}"}

            return {"success": True, "post_id": publish_id, "post_url": "https://www.tiktok.com/"}

        else:
            # PULL_FROM_URL — for public video URLs
            init_resp = requests.post(
                f"{self.API_BASE}/post/publish/video/init/",
                headers=self._headers(),
                json={
                    "post_info": {
                        "title": caption,
                        "privacy_level": "PUBLIC_TO_EVERYONE",
                        "disable_duet": False, "disable_comment": False, "disable_stitch": False,
                    },
                    "source_info": {"source": "PULL_FROM_URL", "video_url": media_url},
                },
                timeout=30,
            )
            data = init_resp.json()
            code = data.get("error", {}).get("code", "ok")
            if code not in ("ok", None, 0, ""):
                return {"success": False, "error": data.get("error", {}).get("message", "Post failed")}
            return {"success": True, "post_id": data.get("data", {}).get("publish_id", ""),
                    "post_url": "https://www.tiktok.com/"}

    def _post_photo(self, caption: str, media_url: str) -> Dict[str, Any]:
        """Photo Mode — image must be a public URL (TikTok pulls it)."""
        # If local file, we need a public URL — use the server URL
        if not media_url.startswith("http"):
            media_url = f"http://localhost:5000{media_url}"

        resp = requests.post(
            f"{self.API_BASE}/post/publish/content/init/",
            headers=self._headers(),
            json={
                "post_info": {
                    "title": caption,
                    "privacy_level": "PUBLIC_TO_EVERYONE",
                    "disable_comment": False,
                    "auto_add_music": True,
                },
                "source_info": {
                    "source": "PULL_FROM_URL",
                    "photo_cover_index": 1,
                    "photo_images": [media_url],
                },
                "post_mode": "DIRECT_POST",
                "media_type": "PHOTO",
            },
            timeout=30,
        )
        data = resp.json()
        code = data.get("error", {}).get("code", "ok")
        if code not in ("ok", None, 0, ""):
            return {"success": False, "error": data.get("error", {}).get("message", "Photo post failed")}
        return {"success": True, "post_id": data.get("data", {}).get("publish_id", ""),
                "post_url": "https://www.tiktok.com/"}
