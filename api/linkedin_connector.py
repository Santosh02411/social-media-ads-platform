"""
LinkedIn Connector — LinkedIn API v2
Supports: text, image (binary upload), video (binary upload), audio (as video), link/article

Required credentials:
- access_token: LinkedIn OAuth 2.0 Access Token (w_member_social scope)
- person_urn: urn:li:person:XXXX or urn:li:organization:XXXX
"""

import os, mimetypes, requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


class LinkedInConnector(BaseConnector):
    PLATFORM_NAME = "LinkedIn"
    ICON = "linkedin"
    COLOR = "#0A66C2"
    SUPPORTED_CONTENT_TYPES = ["text", "image", "video", "audio", "link"]
    REQUIRED_CREDENTIALS = [
        {"key": "access_token", "label": "Access Token", "type": "password",
         "help": "OAuth 2.0 Access Token with w_member_social scope"},
        {"key": "person_urn", "label": "Person/Organization URN", "type": "text",
         "help": "e.g. urn:li:person:ABC123 or urn:li:organization:123"},
    ]

    API_BASE = "https://api.linkedin.com/v2"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.access_token = credentials.get("access_token", "")
        self.person_urn   = credentials.get("person_urn", "")

    def _headers(self, content_type="application/json") -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": content_type,
            "X-Restli-Protocol-Version": "2.0.0",
            "LinkedIn-Version": "202401",
        }

    def validate_credentials(self) -> Dict[str, Any]:
        if not self.access_token or not self.person_urn:
            return {"success": False, "error": "Access Token and Person URN are required"}
        try:
            resp = requests.get(f"{self.API_BASE}/userinfo", headers=self._headers(), timeout=10)
            if resp.status_code == 401:
                return {"success": False, "error": "Invalid or expired access token"}
            if resp.status_code != 200:
                return {"success": False, "error": f"API error: {resp.status_code}"}
            data = resp.json()
            return {"success": True, "account_info": {
                "name": data.get("name", ""),
                "email": data.get("email", ""),
                "id": data.get("sub", ""),
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
            return {"success": False, "error": "Not connected to LinkedIn"}
        try:
            media_url  = content.get("media_url", "")
            media_type = content.get("media_type", "text")
            commentary = self._build_post_text(content)
            ad_title   = content.get("ad_title", "")
            cta        = content.get("call_to_action", "")
            link       = content.get("link", "")

            if ad_title:   commentary = f"📢 {ad_title}\n\n{commentary}"
            if cta:        commentary += f"\n\n👉 {cta}"
            if link:       commentary += f"\n\n🔗 {link}"

            if media_type == "image" and media_url:
                return self._post_with_media(commentary, media_url, "IMAGE", "feedshare-image")
            elif media_type in ("video", "audio") and media_url:
                return self._post_with_media(commentary, media_url, "VIDEO", "feedshare-video")
            else:
                return self._post_text(commentary, link)
        except Exception as e:
            logger.error(f"LinkedIn post error: {e}")
            return {"success": False, "error": str(e)}

    def _post_text(self, commentary: str, link: str = "") -> Dict[str, Any]:
        share_category = "NONE"
        media_arr = []
        if link:
            share_category = "ARTICLE"
            media_arr = [{"status": "READY", "originalUrl": link}]

        post_data = {
            "author": self.person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": commentary},
                    "shareMediaCategory": share_category,
                    **({"media": media_arr} if media_arr else {}),
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        resp = requests.post(f"{self.API_BASE}/ugcPosts", json=post_data,
                             headers=self._headers(), timeout=30)
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"Post failed: {resp.text}"}
        post_id = resp.headers.get("x-restli-id", resp.json().get("id", ""))
        return {"success": True, "post_id": post_id,
                "post_url": f"https://www.linkedin.com/feed/update/{post_id}/"}

    def _post_with_media(self, commentary: str, media_url: str,
                          media_category: str, recipe: str) -> Dict[str, Any]:
        """Register upload → upload bytes → create UGC post."""
        local = _local_path(media_url)
        if not os.path.exists(local):
            return {"success": False, "error": f"Media file not found: {local}"}

        # 1. Register upload
        reg_resp = requests.post(
            f"{self.API_BASE}/assets?action=registerUpload",
            json={
                "registerUploadRequest": {
                    "recipes": [f"urn:li:digitalmediaRecipe:{recipe}"],
                    "owner": self.person_urn,
                    "serviceRelationships": [{
                        "relationshipType": "OWNER",
                        "identifier": "urn:li:userGeneratedContent",
                    }],
                }
            },
            headers=self._headers(),
            timeout=30,
        )
        if reg_resp.status_code not in (200, 201):
            return {"success": False, "error": f"Media registration failed: {reg_resp.text}"}

        reg_data   = reg_resp.json().get("value", {})
        upload_url = (reg_data.get("uploadMechanism", {})
                      .get("com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest", {})
                      .get("uploadUrl", ""))
        asset = reg_data.get("asset", "")

        if not upload_url or not asset:
            return {"success": False, "error": "Failed to get LinkedIn upload URL"}

        # 2. Upload bytes
        mime, _ = mimetypes.guess_type(local)
        mime = mime or ("video/mp4" if media_category == "VIDEO" else "image/jpeg")
        with open(local, "rb") as f:
            media_bytes = f.read()

        up_resp = requests.put(
            upload_url, data=media_bytes,
            headers={"Authorization": f"Bearer {self.access_token}",
                     "Content-Type": mime},
            timeout=180,
        )
        if up_resp.status_code not in (200, 201):
            return {"success": False, "error": f"Media upload failed: {up_resp.status_code}"}

        # 3. Create post
        post_data = {
            "author": self.person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": commentary},
                    "shareMediaCategory": media_category,
                    "media": [{
                        "status": "READY",
                        "description": {"text": "Ad media"},
                        "media": asset,
                        "title": {"text": "Advertisement"},
                    }],
                }
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        resp = requests.post(f"{self.API_BASE}/ugcPosts", json=post_data,
                             headers=self._headers(), timeout=30)
        if resp.status_code not in (200, 201):
            return {"success": False, "error": f"Post with media failed: {resp.text}"}
        post_id = resp.headers.get("x-restli-id", "")
        return {"success": True, "post_id": post_id,
                "post_url": f"https://www.linkedin.com/feed/update/{post_id}/"}
