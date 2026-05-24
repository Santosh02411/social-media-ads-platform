"""
Instagram Ads Connector — Meta Graph API (Instagram Graph API)
Supports: image (multipart), video/reels (multipart)

Required credentials:
- access_token: Instagram User Access Token (instagram_content_publish scope)
- instagram_account_id: Instagram Business Account ID
"""

import os, mimetypes, time, requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


class InstagramConnector(BaseConnector):
    PLATFORM_NAME = "Instagram"
    ICON = "instagram"
    COLOR = "#E1306C"
    SUPPORTED_CONTENT_TYPES = ["image", "video", "reels"]
    REQUIRED_CREDENTIALS = [
        {"key": "access_token", "label": "Access Token", "type": "password",
         "help": "Instagram User Access Token with instagram_content_publish permission"},
        {"key": "instagram_account_id", "label": "Instagram Account ID", "type": "text",
         "help": "Your Instagram Business Account ID (from Meta Business Suite)"},
    ]

    GRAPH_API_BASE = "https://graph.facebook.com/v19.0"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.access_token = credentials.get("access_token", "")
        self.ig_account_id = credentials.get("instagram_account_id", "")

    def validate_credentials(self) -> Dict[str, Any]:
        if not self.access_token or not self.ig_account_id:
            return {"success": False, "error": "Access Token and Instagram Account ID are required"}
        try:
            resp = requests.get(
                f"{self.GRAPH_API_BASE}/{self.ig_account_id}",
                params={"access_token": self.access_token,
                        "fields": "id,name,username,followers_count"},
                timeout=10,
            )
            data = resp.json()
            if "error" in data:
                return {"success": False, "error": data["error"].get("message", "Invalid credentials")}
            return {"success": True, "account_info": {
                "name": data.get("name", ""),
                "username": data.get("username", ""),
                "followers": data.get("followers_count", 0),
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
            return {"success": False, "error": "Not connected to Instagram"}
        try:
            media_url  = content.get("media_url", "")
            media_type = content.get("media_type", "text")
            caption    = self._build_post_text(content)
            ad_title   = content.get("ad_title", "")
            cta        = content.get("call_to_action", "")

            if ad_title:
                caption = f"✨ {ad_title}\n\n{caption}"
            if cta:
                caption += f"\n\n👉 {cta}"

            if not media_url:
                return {"success": False, "error": "Instagram requires an image or video"}

            if media_type == "video":
                return self._post_video(caption, media_url)
            elif media_type == "audio":
                return {"success": False, "error": "Instagram does not support audio-only posts"}
            else:
                return self._post_image(caption, media_url)
        except Exception as e:
            logger.error(f"Instagram post error: {e}")
            return {"success": False, "error": str(e)}

    def _post_image(self, caption: str, media_url: str) -> Dict[str, Any]:
        """
        Instagram Graph API requires a publicly accessible URL for images.
        We upload the file to a temporary hosting or use the server URL.
        For local dev: the image must be accessible from Meta's servers.
        We use the image_url param with a public URL if available,
        otherwise upload as bytes via form-data to a container.
        """
        local = _local_path(media_url)

        if not os.path.exists(local):
            return {"success": False, "error": f"Image file not found: {local}"}

        # Instagram container API requires a public URL.
        # For local files served by Flask on localhost, Meta cannot reach them.
        # We pass the URL directly — works if server is publicly accessible.
        # For local dev, user must ngrok/deploy or provide a CDN URL.
        container_resp = requests.post(
            f"{self.GRAPH_API_BASE}/{self.ig_account_id}/media",
            data={
                "image_url": media_url if media_url.startswith("http") else f"http://localhost:5000{media_url}",
                "caption": caption,
                "access_token": self.access_token,
            },
            timeout=30,
        )
        container_data = container_resp.json()
        if "error" in container_data:
            return {"success": False, "error": container_data["error"].get("message", "Container creation failed")}

        creation_id = container_data.get("id")
        if not creation_id:
            return {"success": False, "error": "Failed to create media container"}

        # Poll until container is ready
        for _ in range(10):
            time.sleep(2)
            st = requests.get(
                f"{self.GRAPH_API_BASE}/{creation_id}",
                params={"fields": "status_code", "access_token": self.access_token},
                timeout=10,
            ).json().get("status_code", "")
            if st == "FINISHED":
                break
            if st == "ERROR":
                return {"success": False, "error": "Media container processing error"}

        pub = requests.post(
            f"{self.GRAPH_API_BASE}/{self.ig_account_id}/media_publish",
            data={"creation_id": creation_id, "access_token": self.access_token},
            timeout=30,
        ).json()

        if "error" in pub:
            return {"success": False, "error": pub["error"].get("message", "Publishing failed")}

        media_id = pub.get("id", "")
        return {"success": True, "post_id": media_id,
                "post_url": f"https://www.instagram.com/p/{media_id}/"}

    def _post_video(self, caption: str, media_url: str) -> Dict[str, Any]:
        local = _local_path(media_url)
        if not os.path.exists(local):
            return {"success": False, "error": f"Video file not found: {local}"}

        # Instagram Graph API also requires a public video_url for container creation
        video_public_url = media_url if media_url.startswith("http") else f"http://localhost:5000{media_url}"

        container_resp = requests.post(
            f"{self.GRAPH_API_BASE}/{self.ig_account_id}/media",
            data={
                "video_url": video_public_url,
                "caption": caption,
                "media_type": "REELS",
                "share_to_feed": "true",
                "access_token": self.access_token,
            },
            timeout=60,
        )
        container_data = container_resp.json()
        if "error" in container_data:
            return {"success": False, "error": container_data["error"].get("message", "Video container failed")}

        creation_id = container_data.get("id")
        if not creation_id:
            return {"success": False, "error": "Failed to create video container"}

        for _ in range(20):
            time.sleep(3)
            st = requests.get(
                f"{self.GRAPH_API_BASE}/{creation_id}",
                params={"fields": "status_code", "access_token": self.access_token},
                timeout=10,
            ).json().get("status_code", "")
            if st == "FINISHED":
                break
            if st == "ERROR":
                return {"success": False, "error": "Video processing failed on Instagram"}

        pub = requests.post(
            f"{self.GRAPH_API_BASE}/{self.ig_account_id}/media_publish",
            data={"creation_id": creation_id, "access_token": self.access_token},
            timeout=30,
        ).json()

        if "error" in pub:
            return {"success": False, "error": pub["error"].get("message", "Video publish failed")}

        media_id = pub.get("id", "")
        return {"success": True, "post_id": media_id,
                "post_url": f"https://www.instagram.com/reel/{media_id}/"}
