"""
Pinterest Connector — Pinterest API v5
Supports: image (multipart binary upload), video (multipart binary upload), link pins.

Required credentials:
- access_token: Pinterest OAuth2 Access Token (boards:read, pins:write scopes)
- board_id: Target Board ID
"""

import os, mimetypes, requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


class PinterestConnector(BaseConnector):
    PLATFORM_NAME = "Pinterest"
    ICON = "pinterest"
    COLOR = "#E60023"
    SUPPORTED_CONTENT_TYPES = ["image", "video", "link"]
    REQUIRED_CREDENTIALS = [
        {"key": "access_token", "label": "Access Token", "type": "password",
         "help": "OAuth2 access token with boards:read and pins:write scopes"},
        {"key": "board_id", "label": "Board ID", "type": "text",
         "help": "Target board ID — from your board URL or GET /boards"},
    ]

    API_BASE = "https://api.pinterest.com/v5"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.access_token = credentials.get("access_token", "")
        self.board_id     = credentials.get("board_id", "")

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}", "Content-Type": "application/json"}

    def validate_credentials(self) -> Dict[str, Any]:
        if not self.access_token or not self.board_id:
            return {"success": False, "error": "Access Token and Board ID are required"}
        try:
            resp = requests.get(f"{self.API_BASE}/user_account", headers=self._headers(), timeout=10)
            if resp.status_code == 401:
                return {"success": False, "error": "Invalid or expired access token"}
            if resp.status_code != 200:
                return {"success": False, "error": f"API error: {resp.status_code}"}
            user = resp.json()
            board_resp = requests.get(f"{self.API_BASE}/boards/{self.board_id}",
                                      headers=self._headers(), timeout=10)
            if board_resp.status_code != 200:
                return {"success": False, "error": f"Board ID not found: {self.board_id}"}
            board = board_resp.json()
            return {"success": True, "account_info": {
                "name": user.get("username", ""),
                "board_name": board.get("name", ""),
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
            return {"success": False, "error": "Not connected to Pinterest"}
        try:
            media_url  = content.get("media_url", "")
            media_type = content.get("media_type", "text")
            description = self._build_post_text(content)
            ad_title   = content.get("ad_title", "")
            link       = content.get("link", "")
            cta        = content.get("call_to_action", "")
            if cta: description += f"\n\n{cta}"

            if media_type == "audio":
                return {"success": False, "error": "Pinterest does not support audio-only pins. Upload an image or video."}

            if media_type == "video" and media_url:
                return self._create_video_pin(ad_title, description, link, media_url)
            elif media_url:
                return self._create_image_pin(ad_title, description, link, media_url)
            else:
                return {"success": False, "error": "Pinterest requires an image or video"}
        except Exception as e:
            logger.error(f"Pinterest post error: {e}")
            return {"success": False, "error": str(e)}

    def _create_image_pin(self, title, description, link, media_url) -> Dict[str, Any]:
        local = _local_path(media_url)

        if os.path.exists(local):
            # Upload image as multipart binary
            media_id = self._upload_media_binary(local, "image")
            if not media_id:
                return {"success": False, "error": "Image upload to Pinterest failed"}
            pin_data = {
                "board_id": self.board_id,
                "title": (title or "")[:100],
                "description": description[:500],
                "media_source": {"source_type": "media_id", "media_id": media_id},
            }
        else:
            pin_data = {
                "board_id": self.board_id,
                "title": (title or "")[:100],
                "description": description[:500],
                "media_source": {"source_type": "image_url", "url": media_url},
            }

        if link: pin_data["link"] = link

        resp = requests.post(f"{self.API_BASE}/pins", headers=self._headers(),
                             json=pin_data, timeout=30)
        data = resp.json()
        if resp.status_code not in (200, 201):
            return {"success": False, "error": data.get("message", f"Pin failed: {resp.status_code}")}
        pin_id = data.get("id", "")
        return {"success": True, "post_id": pin_id,
                "post_url": f"https://www.pinterest.com/pin/{pin_id}/"}

    def _create_video_pin(self, title, description, link, media_url) -> Dict[str, Any]:
        local = _local_path(media_url)
        if not os.path.exists(local):
            return {"success": False, "error": f"Video file not found: {local}"}

        media_id = self._upload_media_binary(local, "video")
        if not media_id:
            return {"success": False, "error": "Video upload to Pinterest failed"}

        pin_data = {
            "board_id": self.board_id,
            "title": (title or "")[:100],
            "description": description[:500],
            "media_source": {"source_type": "video_id", "media_id": media_id},
        }
        if link: pin_data["link"] = link

        resp = requests.post(f"{self.API_BASE}/pins", headers=self._headers(),
                             json=pin_data, timeout=30)
        data = resp.json()
        if resp.status_code not in (200, 201):
            return {"success": False, "error": data.get("message", "Video pin failed")}
        pin_id = data.get("id", "")
        return {"success": True, "post_id": pin_id,
                "post_url": f"https://www.pinterest.com/pin/{pin_id}/"}

    def _upload_media_binary(self, local_path: str, media_type: str) -> str:
        """Register upload slot → upload binary file → return media_id."""
        try:
            # 1. Register
            reg_resp = requests.post(
                f"{self.API_BASE}/media",
                headers=self._headers(),
                json={"media_type": "video" if media_type == "video" else "image"},
                timeout=30,
            )
            if reg_resp.status_code not in (200, 201):
                logger.warning(f"Pinterest register failed: {reg_resp.text}")
                return None

            reg_data   = reg_resp.json()
            media_id   = reg_data.get("media_id", "")
            upload_url = reg_data.get("upload_url", "")
            upload_params = reg_data.get("upload_parameters", {})

            if not upload_url:
                return None

            # 2. Upload
            mime, _ = mimetypes.guess_type(local_path)
            mime = mime or ("video/mp4" if media_type == "video" else "image/jpeg")

            with open(local_path, "rb") as f:
                file_bytes = f.read()

            # Pinterest uses multipart/form-data with upload_parameters fields
            fields = {k: (None, v) for k, v in upload_params.items()}
            fields["file"] = (os.path.basename(local_path), file_bytes, mime)

            up_resp = requests.post(upload_url, files=fields, timeout=180)
            if up_resp.status_code not in (200, 201, 204):
                logger.warning(f"Pinterest upload failed: {up_resp.status_code} {up_resp.text[:200]}")
                return None

            return media_id
        except Exception as e:
            logger.warning(f"Pinterest _upload_media_binary: {e}")
            return None
