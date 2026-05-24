"""
Ad Scheduler
Allows scheduling posts for future delivery.
Uses a background thread with a simple in-memory queue.
In production, replace with Celery + Redis/RabbitMQ.
"""

import threading
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Callable

logger = logging.getLogger(__name__)


class AdScheduler:
    """Thread-based scheduler for delayed ad posting."""

    def __init__(self, post_callback: Callable):
        """
        post_callback: async function(content, platforms) -> results dict
        Called when a scheduled post is due.
        """
        self.post_callback = post_callback
        self.scheduled_posts: List[Dict] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread = None

    def start(self):
        """Start the scheduler background thread."""
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        logger.info("Ad scheduler started")

    def stop(self):
        self._running = False

    def schedule(self, content: Dict[str, Any], platforms: List[str], scheduled_at: datetime) -> str:
        """
        Schedule an ad post.
        scheduled_at: timezone-aware datetime (UTC).
        Returns: schedule_id
        """
        schedule_id = str(uuid.uuid4())
        entry = {
            "id": schedule_id,
            "content": content,
            "platforms": platforms,
            "scheduled_at": scheduled_at.isoformat(),
            "scheduled_ts": scheduled_at.timestamp(),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            self.scheduled_posts.append(entry)
        logger.info(f"Scheduled post {schedule_id} for {scheduled_at.isoformat()}")
        return schedule_id

    def cancel(self, schedule_id: str) -> bool:
        with self._lock:
            for post in self.scheduled_posts:
                if post["id"] == schedule_id and post["status"] == "pending":
                    post["status"] = "cancelled"
                    return True
        return False

    def get_scheduled(self) -> List[Dict]:
        with self._lock:
            return [p for p in self.scheduled_posts if p["status"] == "pending"]

    def get_all(self) -> List[Dict]:
        with self._lock:
            return list(reversed(self.scheduled_posts[-50:]))

    def _run_loop(self):
        import time
        while self._running:
            now = datetime.now(timezone.utc).timestamp()
            with self._lock:
                due = [p for p in self.scheduled_posts if p["status"] == "pending" and p["scheduled_ts"] <= now]

            for post in due:
                try:
                    logger.info(f"Executing scheduled post {post['id']}")
                    results = self.post_callback(post["content"], post["platforms"])
                    with self._lock:
                        post["status"] = "completed"
                        post["results"] = results
                        post["executed_at"] = datetime.now(timezone.utc).isoformat()
                except Exception as e:
                    logger.error(f"Scheduled post {post['id']} failed: {e}")
                    with self._lock:
                        post["status"] = "failed"
                        post["error"] = str(e)

            time.sleep(10)  # Check every 10 seconds
