"""
Base connector class for all social media platforms.
All platform connectors inherit from this.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any


class BaseConnector(ABC):
    """Abstract base class for social media platform connectors."""

    PLATFORM_NAME = "Unknown Platform"
    ICON = "📱"
    COLOR = "#333333"
    SUPPORTED_CONTENT_TYPES = ["text"]
    REQUIRED_CREDENTIALS = []

    def __init__(self, credentials: Dict[str, Any]):
        self.credentials = credentials
        self._connected = False
        self._account_info = {}

    @abstractmethod
    def connect(self) -> Dict[str, Any]:
        """
        Establish connection to the platform.
        Returns: {'success': bool, 'account_info': dict, 'error': str}
        """
        pass

    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from the platform."""
        pass

    @abstractmethod
    def post_ad(self, content: Dict[str, Any]) -> Dict[str, Any]:
        """
        Post an ad to the platform.
        content: {
            'text': str,
            'media_url': str (optional),
            'media_type': str (image/video/audio),
            'link': str (optional),
            'hashtags': list (optional),
            'ad_title': str (optional),
            'call_to_action': str (optional),
        }
        Returns: {'success': bool, 'post_id': str, 'post_url': str, 'error': str}
        """
        pass

    @abstractmethod
    def validate_credentials(self) -> Dict[str, Any]:
        """
        Validate credentials without establishing full connection.
        Returns: {'success': bool, 'error': str}
        """
        pass

    def is_connected(self) -> bool:
        return self._connected

    def get_account_info(self) -> Dict[str, Any]:
        return self._account_info

    def _build_post_text(self, content: Dict[str, Any]) -> str:
        """Helper to build post text with hashtags."""
        text = content.get('text', '')
        hashtags = content.get('hashtags', [])
        if hashtags:
            hashtag_str = ' '.join([f'#{tag.strip("#")}' for tag in hashtags])
            text = f"{text}\n\n{hashtag_str}"
        return text
