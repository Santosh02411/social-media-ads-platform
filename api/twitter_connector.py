"""
Twitter/X Connector — Twitter API v2 with OAuth 1.0a (built-in, no extra libs).
Supports: text, image (multipart upload), video (chunked upload), audio (as tweet_gif/video).

Required credentials: api_key, api_secret, access_token, access_token_secret
"""

import hmac, hashlib, time, uuid, base64, urllib.parse, os, mimetypes
import requests, logging
from typing import Dict, Any
from api import BaseConnector

logger = logging.getLogger(__name__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _local_path(media_url: str) -> str:
    return os.path.join(BASE_DIR, media_url.lstrip("/"))


def _oauth1_sign(method, url, params, api_key, api_secret, access_token, access_token_secret):
    oauth_params = {
        "oauth_consumer_key": api_key,
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": access_token,
        "oauth_version": "1.0",
    }
    all_params = {**params, **oauth_params}
    sorted_params = "&".join(
        f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}"
        for k, v in sorted(all_params.items())
    )
    base_string = "&".join([
        method.upper(),
        urllib.parse.quote(url, safe=""),
        urllib.parse.quote(sorted_params, safe=""),
    ])
    signing_key = f"{urllib.parse.quote(api_secret, safe='')}&{urllib.parse.quote(access_token_secret, safe='')}"
    signature = base64.b64encode(
        hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
    ).decode()
    oauth_params["oauth_signature"] = signature
    return "OAuth " + ", ".join(
        f'{urllib.parse.quote(k, safe="")}="{urllib.parse.quote(v, safe="")}"'
        for k, v in sorted(oauth_params.items())
    )


class TwitterConnector(BaseConnector):
    PLATFORM_NAME = "Twitter / X"
    ICON = "twitter"
    COLOR = "#000000"
    SUPPORTED_CONTENT_TYPES = ["text", "image", "video", "audio"]
    REQUIRED_CREDENTIALS = [
        {"key": "api_key",             "label": "API Key (Consumer Key)",    "type": "password",
         "help": "From Twitter Developer Portal → Your App → Keys and Tokens"},
        {"key": "api_secret",          "label": "API Secret",                "type": "password",
         "help": "From Twitter Developer Portal → Your App → Keys and Tokens"},
        {"key": "access_token",        "label": "Access Token",              "type": "password",
         "help": "Access Token with Read and Write permissions"},
        {"key": "access_token_secret", "label": "Access Token Secret",       "type": "password",
         "help": "Generated Access Token Secret"},
    ]

    API_V2     = "https://api.twitter.com/2"
    UPLOAD_API = "https://upload.twitter.com/1.1"

    def __init__(self, credentials: Dict[str, Any]):
        super().__init__(credentials)
        self.api_key              = credentials.get("api_key", "")
        self.api_secret           = credentials.get("api_secret", "")
        self.access_token         = credentials.get("access_token", "")
        self.access_token_secret  = credentials.get("access_token_secret", "")

    def _auth(self, method, url, params=None):
        return _oauth1_sign(
            method, url, params or {},
            self.api_key, self.api_secret,
            self.access_token, self.access_token_secret,
        )

    def validate_credentials(self) -> Dict[str, Any]:
        if not all([self.api_key, self.api_secret, self.access_token, self.access_token_secret]):
            return {"success": False, "error": "All four Twitter credentials are required"}
        try:
            url = f"{self.API_V2}/users/me"
            params = {"user.fields": "name,username,public_metrics"}
            resp = requests.get(url, params=params,
                                headers={"Authorization": self._auth("GET", url, params)}, timeout=10)
            data = resp.json()
            if resp.status_code != 200 or "errors" in data:
                return {"success": False, "error": data.get("detail", "Authentication failed")}
            user = data.get("data", {})
            return {"success": True, "account_info": {
                "name": user.get("name"),
                "username": user.get("username"),
                "followers": user.get("public_metrics", {}).get("followers_count", 0),
            }}
        except requests.RequestException as e:
            return {"success": False, "error": f"Network error: {e}"}

    def connect(self) -> Dict[str, Any]:
        result = self.validate_credentials()
        if result["success"]:
            self._connected = True
            self._account_info = result.get("account_info", {})
        return result

    def disconnect(self):
        self._connected = False
        self._account_info = {}

    def post_ad(self, content: Dict[str, Any]) -> Dict[str, Any]:
        if not self._connected:
            return {"success": False, "error": "Not connected to Twitter"}
        try:
            tweet_text = self._build_post_text(content)
            ad_title   = content.get("ad_title", "")
            cta        = content.get("call_to_action", "")
            link       = content.get("link", "")

            if ad_title:   tweet_text = f"📢 {ad_title}\n\n{tweet_text}"
            if cta:        tweet_text += f"\n👉 {cta}"
            if link:       tweet_text += f"\n{link}"
            if len(tweet_text) > 280:
                tweet_text = tweet_text[:277] + "..."

            payload = {"text": tweet_text}

            media_url  = content.get("media_url", "")
            media_type = content.get("media_type", "text")

            if media_url and media_type in ("image", "video", "audio"):
                media_id = self._upload_media(media_url, media_type)
                if media_id:
                    payload["media"] = {"media_ids": [media_id]}

            url = f"{self.API_V2}/tweets"
            resp = requests.post(
                url, json=payload,
                headers={"Authorization": self._auth("POST", url), "Content-Type": "application/json"},
                timeout=30,
            )
            data = resp.json()
            if resp.status_code not in (200, 201):
                return {"success": False, "error": data.get("detail", str(data.get("errors", "Tweet failed")))}
            tweet_id = data.get("data", {}).get("id", "")
            username = self._account_info.get("username", "")
            return {"success": True, "post_id": tweet_id,
                    "post_url": f"https://twitter.com/{username}/status/{tweet_id}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _upload_media(self, media_url: str, media_type: str) -> str:
        """Chunked upload to Twitter v1.1 media/upload.json"""
        local = _local_path(media_url)
        if os.path.exists(local):
            with open(local, "rb") as f:
                media_data = f.read()
            mime, _ = mimetypes.guess_type(local)
        else:
            r = requests.get(media_url, timeout=30)
            media_data = r.content
            mime = r.headers.get("Content-Type", "image/jpeg")

        # Map media type to Twitter categories
        if media_type == "video":
            mime = mime or "video/mp4"
            category = "tweet_video"
        elif media_type == "audio":
            mime = mime or "audio/mpeg"
            category = "tweet_video"   # Twitter wraps audio as video
        else:
            mime = mime or "image/jpeg"
            category = "tweet_image"

        url = f"{self.UPLOAD_API}/media/upload.json"

        # INIT
        init_data = {
            "command": "INIT",
            "total_bytes": len(media_data),
            "media_type": mime,
            "media_category": category,
        }
        init_resp = requests.post(
            url, data=init_data,
            headers={"Authorization": self._auth("POST", url, init_data)},
            timeout=30,
        )
        media_id = init_resp.json().get("media_id_string")
        if not media_id:
            logger.warning(f"Twitter INIT failed: {init_resp.text}")
            return None

        # APPEND (5 MB chunks)
        chunk_size = 5 * 1024 * 1024
        for i, offset in enumerate(range(0, len(media_data), chunk_size)):
            chunk = media_data[offset : offset + chunk_size]
            append_data = {"command": "APPEND", "media_id": media_id, "segment_index": i}
            requests.post(
                url, data=append_data, files={"media": chunk},
                headers={"Authorization": self._auth("POST", url, append_data)},
                timeout=60,
            )

        # FINALIZE
        fin_data = {"command": "FINALIZE", "media_id": media_id}
        fin_resp = requests.post(
            url, data=fin_data,
            headers={"Authorization": self._auth("POST", url, fin_data)},
            timeout=30,
        )

        # Wait for async processing (video/audio)
        processing = fin_resp.json().get("processing_info")
        if processing:
            for _ in range(20):
                state = processing.get("state")
                if state == "succeeded":
                    break
                if state == "failed":
                    logger.warning("Twitter media processing failed")
                    return None
                wait = processing.get("check_after_secs", 2)
                time.sleep(wait)
                status_data = {"command": "STATUS", "media_id": media_id}
                st_resp = requests.get(
                    url, params=status_data,
                    headers={"Authorization": self._auth("GET", url, status_data)},
                    timeout=15,
                )
                processing = st_resp.json().get("processing_info", {})

        return media_id
