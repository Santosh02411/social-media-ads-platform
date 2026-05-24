"""
Facebook Ads Connector — Meta Graph API v19.0
Supports: text, image, video, audio posts to Facebook PAGES.

AUTO TOKEN EXCHANGE:
  If the provided token is a User Access Token (not a Page token),
  we automatically exchange it via /me/accounts to get the correct
  Page Access Token. This eliminates Error #200 caused by using
  a user token or posting to a group.

Required credentials:
- page_access_token : User OR Page Access Token
- page_id           : Facebook PAGE id (numeric)
"""

import os, mimetypes, requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GRAPH = "https://graph.facebook.com/v19.0"


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


def _exchange_for_page_token(user_token: str, page_id: str) -> Dict[str, Any]:
    """
    Exchange a User Access Token for the Page Access Token of the given page.
    Also validates that page_id is actually a Page (not a Group).
    Returns {"success": True, "page_token": "...", "page_name": "..."} or {"success": False, "error": "..."}
    """
    try:
        # 1. Get all pages the user manages
        resp = requests.get(
            f"{GRAPH}/me/accounts",
            params={"access_token": user_token, "fields": "id,name,access_token,category"},
            timeout=15,
        )
        data = resp.json()

        if "error" in data:
            err_msg = data["error"].get("message", "Unknown error")
            err_code = data["error"].get("code", 0)
            # If /me/accounts itself fails, token might already be a page token — try direct use
            if err_code in (190, 102):
                return {"success": False, "error": f"Invalid or expired token: {err_msg}"}
            # Token may already be a page token — just return it as-is
            return {"success": True, "page_token": user_token, "page_name": None, "direct": True}

        pages = data.get("data", [])
        if not pages:
            # No pages found — check if this is already a page token by testing directly
            test = requests.get(
                f"{GRAPH}/{page_id}",
                params={"access_token": user_token, "fields": "name,id"},
                timeout=10,
            ).json()
            if "error" not in test:
                return {"success": True, "page_token": user_token, "page_name": test.get("name"), "direct": True}
            return {
                "success": False,
                "error": (
                    "No Facebook Pages found for this token. "
                    "Make sure your token has pages_manage_posts + pages_read_engagement permissions, "
                    "and that you manage at least one Facebook Page."
                ),
            }

        # 2. Find the matching page
        matched = next((p for p in pages if str(p.get("id")) == str(page_id)), None)

        if matched is None:
            page_list = ", ".join(f"{p['name']} ({p['id']})" for p in pages[:5])
            return {
                "success": False,
                "error": (
                    f"Page ID {page_id} not found in your managed pages. "
                    f"Your accessible pages: {page_list}. "
                    "Make sure you entered the correct Page ID (not a Group ID)."
                ),
            }

        page_token = matched.get("access_token", user_token)
        page_name  = matched.get("name", "")
        logger.info(f"Exchanged token for page: {page_name} ({page_id})")
        return {"success": True, "page_token": page_token, "page_name": page_name}

    except requests.RequestException as e:
        return {"success": False, "error": f"Network error during token exchange: {e}"}


class FacebookConnector(BaseConnector):
    PLATFORM_NAME = "Facebook"
    ICON          = "facebook"
    COLOR         = "#1877F2"
    SUPPORTED_CONTENT_TYPES = ["text", "image", "video", "audio", "link"]
    REQUIRED_CREDENTIALS = [
        {
            "key":   "page_access_token",
            "label": "Access Token",
            "type":  "password",
            "help":  (
                "Paste your User Access Token or Page Access Token. "
                "Get it from: developers.facebook.com → Graph API Explorer → "
                "select your Page → generate token with pages_manage_posts + pages_read_engagement. "
                "We will automatically exchange it for the correct Page token."
            ),
        },
        {
            "key":   "page_id",
            "label": "Page ID",
            "type":  "text",
            "help":  (
                "Your Facebook PAGE numeric ID. "
                "Go to your Page → About → Page Transparency → Page ID. "
                "⚠️ Do NOT use a Group ID — that causes Error #200."
            ),
        },
    ]

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self._raw_token = credentials.get("page_access_token", "").strip()
        self.page_id    = credentials.get("page_id", "").strip()
        self.token      = self._raw_token  # may be replaced during connect()

    # ── Validate / Connect ────────────────────────────────────────────────────

    def validate_credentials(self) -> Dict[str, Any]:
        if not self._raw_token or not self.page_id:
            return {"success": False, "error": "Access Token and Page ID are both required."}

        # Auto-exchange token
        exchange = _exchange_for_page_token(self._raw_token, self.page_id)
        if not exchange["success"]:
            return {"success": False, "error": exchange["error"]}

        page_token = exchange["page_token"]
        page_name  = exchange.get("page_name")

        # If we got the token directly (already a page token), verify via Graph
        if page_name is None:
            verify = requests.get(
                f"{GRAPH}/{self.page_id}",
                params={"access_token": page_token, "fields": "name,id,fan_count"},
                timeout=10,
            ).json()
            if "error" in verify:
                code = verify["error"].get("code", 0)
                msg  = verify["error"].get("message", "Unknown error")
                if code == 200:
                    return {
                        "success": False,
                        "error": (
                            "Error #200: The ID you entered appears to be a Group ID, not a Page ID. "
                            "Go to your Facebook Page → About → Page Transparency → copy the Page ID."
                        ),
                    }
                return {"success": False, "error": msg}
            page_name = verify.get("name", "Unknown Page")

        return {
            "success":      True,
            "page_token":   page_token,
            "page_name":    page_name,
            "account_info": {"name": page_name, "id": self.page_id},
        }

    def connect(self) -> Dict[str, Any]:
        result = self.validate_credentials()
        if result["success"]:
            # Store the exchanged page token for posting
            self.token         = result.get("page_token", self._raw_token)
            self._connected    = True
            self._account_info = result.get("account_info", {})
            logger.info(f"Connected to Facebook Page: {self._account_info.get('name')} ({self.page_id})")
        return result

    def disconnect(self) -> None:
        self._connected    = False
        self._account_info = {}

    # ── Post dispatcher ───────────────────────────────────────────────────────

    def post_ad(self, content: Dict[str, Any]) -> Dict[str, Any]:
        if not self._connected:
            return {"success": False, "error": "Not connected to Facebook"}
        try:
            media_url  = content.get("media_url",  "")
            media_type = content.get("media_type", "text")
            body       = self._build_post_text(content)
            ad_title   = content.get("ad_title",       "")
            cta        = content.get("call_to_action", "")
            link       = content.get("link",           "")

            msg = body
            if ad_title: msg = f"📢 {ad_title}\n\n{msg}"
            if cta:      msg += f"\n\n👉 {cta}"
            if link:     msg += f"\n\n🔗 {link}"

            if   media_type == "image" and media_url: return self._post_photo(msg, media_url)
            elif media_type == "video" and media_url: return self._post_video(msg, media_url)
            elif media_type == "audio" and media_url: return self._post_video(msg, media_url, is_audio=True)
            else:                                     return self._post_text(msg, link)

        except Exception as e:
            logger.error(f"Facebook post_ad error: {e}")
            return {"success": False, "error": str(e)}

    # ── Text / Link ───────────────────────────────────────────────────────────

    def _post_text(self, message: str, link: str = "") -> Dict[str, Any]:
        payload = {"message": message, "access_token": self.token}
        if link:
            payload["link"] = link
        resp = requests.post(f"{GRAPH}/{self.page_id}/feed", data=payload, timeout=30)
        d = resp.json()
        if "error" in d:
            return {"success": False, "error": self._friendly_error(d["error"])}
        post_id = d.get("id", "")
        return {
            "success":  True,
            "post_id":  post_id,
            "post_url": f"https://www.facebook.com/{post_id.replace('_', '/posts/')}",
        }

    # ── Image ─────────────────────────────────────────────────────────────────

    def _post_photo(self, caption: str, media_url: str) -> Dict[str, Any]:
        local = _local_path(media_url)
        if not os.path.exists(local):
            return {"success": False, "error": f"Image file not found: {local}"}

        mime, _ = mimetypes.guess_type(local)
        mime = mime or "image/jpeg"

        with open(local, "rb") as fh:
            resp = requests.post(
                f"{GRAPH}/{self.page_id}/photos",
                data={"caption": caption, "published": "true", "access_token": self.token},
                files={"source": (os.path.basename(local), fh, mime)},
                timeout=120,
            )
        d = resp.json()
        if "error" in d:
            return {"success": False, "error": self._friendly_error(d["error"])}

        post_id = d.get("post_id", d.get("id", ""))
        return {
            "success":  True,
            "post_id":  post_id,
            "post_url": f"https://www.facebook.com/{self.page_id}/posts/",
        }

    # ── Video / Audio ─────────────────────────────────────────────────────────

    def _post_video(self, description: str, media_url: str, is_audio: bool = False) -> Dict[str, Any]:
        local = _local_path(media_url)
        if not os.path.exists(local):
            return {"success": False, "error": f"Media file not found: {local}"}

        if os.path.getsize(local) > 1_073_741_824:
            return {"success": False, "error": "File too large (>1 GB) — please compress first."}

        mime, _ = mimetypes.guess_type(local)
        mime = mime or ("audio/mpeg" if is_audio else "video/mp4")

        with open(local, "rb") as fh:
            resp = requests.post(
                f"{GRAPH}/{self.page_id}/videos",
                data={
                    "description":  description,
                    "title":        "Audio Ad" if is_audio else "Ad Video",
                    "published":    "true",
                    "access_token": self.token,
                },
                files={"source": (os.path.basename(local), fh, mime)},
                timeout=300,
            )
        d = resp.json()
        if "error" in d:
            return {"success": False, "error": self._friendly_error(d["error"])}

        video_id = d.get("id", "")
        return {
            "success":  True,
            "post_id":  video_id,
            "post_url": f"https://www.facebook.com/{self.page_id}/videos/",
        }

    # ── Error helper ──────────────────────────────────────────────────────────

    @staticmethod
    def _friendly_error(err: dict) -> str:
        code = err.get("code", 0)
        msg  = err.get("message", "Post failed")
        if code == 200:
            return (
                "Error #200: The Page ID appears to be a Group ID. "
                "Go to your Facebook Page → About → Page Transparency → copy the numeric Page ID, "
                "then reconnect."
            )
        if code == 190:
            return "Token expired or invalid. Please reconnect with a fresh token."
        if code == 100:
            return f"Invalid parameter: {msg}"
        return f"Facebook error #{code}: {msg}"
