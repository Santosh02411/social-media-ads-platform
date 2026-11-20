"""
Unified Social Media Ads Platform — app.py
Flask backend with polling-based real-time updates and scheduler.
"""

import os
import json
import uuid
import logging
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

from api.facebook_connector import FacebookConnector
from api.instagram_connector import InstagramConnector
from api.twitter_connector import TwitterConnector
from api.linkedin_connector import LinkedInConnector
from api.tiktok_connector import TikTokConnector
from api.pinterest_connector import PinterestConnector
from api.scheduler import AdScheduler


load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "adsync-dev-secret-change-me")
app.config["UPLOAD_FOLDER"] = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "mp4", "mov", "avi", "mp3", "wav", "ogg", "webm"}

# ── Platform registry ──────────────────────────────────────────────────────────
platform_connectors = {
    "facebook":  FacebookConnector,
    "instagram": InstagramConnector,
    "twitter":   TwitterConnector,
    "linkedin":  LinkedInConnector,
    "tiktok":    TikTokConnector,
    "pinterest": PinterestConnector,
}

active_connections: dict = {}
post_history: list = []
realtime_events: list = []   # Simple polling queue


# ── Real-time event helpers ────────────────────────────────────────────────────
def push_event(event_type: str, data: dict):
    realtime_events.append({"type": event_type, "data": data, "id": str(uuid.uuid4())})
    if len(realtime_events) > 200:
        realtime_events.pop(0)


# ── Scheduler ─────────────────────────────────────────────────────────────────
def _execute_post(content: dict, platforms: list) -> dict:
    results = {}
    for pid in platforms:
        if pid not in active_connections:
            results[pid] = {"success": False, "error": "Not connected"}
            continue
        try:
            results[pid] = active_connections[pid].post_ad(content)
        except Exception as e:
            results[pid] = {"success": False, "error": str(e)}
    push_event("scheduled_post_complete", {"results": results})
    return results


scheduler = AdScheduler(post_callback=_execute_post)
scheduler.start()


# ── Helpers ────────────────────────────────────────────────────────────────────
def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_media_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[1].lower()
    if ext in {"mp4", "mov", "avi", "webm"}: return "video"
    if ext in {"mp3", "wav", "ogg"}:         return "audio"
    return "image"


# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


# ── Real-time polling ──────────────────────────────────────────────────────────
@app.route("/api/events")
def get_events():
    since_id = request.args.get("since")
    if since_id:
        found = False
        new_events = []
        for evt in realtime_events:
            if found:
                new_events.append(evt)
            if evt["id"] == since_id:
                found = True
        return jsonify({"events": new_events})
    return jsonify({"events": realtime_events[-30:]})


# ── Platforms ──────────────────────────────────────────────────────────────────
@app.route("/api/platforms")
def get_platforms():
    result = []
    for pid, cls in platform_connectors.items():
        conn = active_connections.get(pid)
        result.append({
            "id":                   pid,
            "name":                 cls.PLATFORM_NAME,
            "icon":                 cls.ICON,
            "color":                cls.COLOR,
            "connected":            bool(conn and conn.is_connected()),
            "account_info":         conn.get_account_info() if conn else {},
            "supported_types":      cls.SUPPORTED_CONTENT_TYPES,
            "required_credentials": cls.REQUIRED_CREDENTIALS,
        })
    return jsonify({"platforms": result})


@app.route("/api/connect", methods=["POST"])
def connect_platform():
    data = request.json or {}
    pid = data.get("platform")
    creds = data.get("credentials", {})

    if pid not in platform_connectors:
        return jsonify({"success": False, "error": "Unknown platform"}), 400

    try:
        connector = platform_connectors[pid](creds)
        result = connector.connect()
        if result["success"]:
            active_connections[pid] = connector
            push_event("platform_status", {"platform": pid, "connected": True, "account_info": result.get("account_info", {})})
        return jsonify(result), 200 if result["success"] else 400
    except Exception as e:
        logger.exception(f"Connect {pid}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/disconnect", methods=["POST"])
def disconnect_platform():
    data = request.json or {}
    pid = data.get("platform")
    if pid in active_connections:
        try:
            active_connections[pid].disconnect()
        except Exception:
            pass
        del active_connections[pid]
    push_event("platform_status", {"platform": pid, "connected": False})
    return jsonify({"success": True})


@app.route("/api/test-connection", methods=["POST"])
def test_connection():
    data = request.json or {}
    pid = data.get("platform")
    creds = data.get("credentials", {})
    if pid not in platform_connectors:
        return jsonify({"success": False, "error": "Unknown platform"}), 400
    try:
        return jsonify(platform_connectors[pid](creds).validate_credentials())
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── Media upload ───────────────────────────────────────────────────────────────
@app.route("/api/upload", methods=["POST"])
def upload_media():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"success": False, "error": "Empty filename"}), 400
    if not allowed_file(file.filename):
        return jsonify({"success": False, "error": "File type not allowed"}), 400

    filename = f"{uuid.uuid4()}_{secure_filename(file.filename)}"
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)
    return jsonify({
        "success":    True,
        "filename":   filename,
        "filepath":   f"/static/uploads/{filename}",
        "media_type": get_media_type(filename),
        "size":       os.path.getsize(filepath),
    })


# ── Post ad ────────────────────────────────────────────────────────────────────
@app.route("/api/post", methods=["POST"])
def post_ad():
    data = request.json or {}
    content          = data.get("content", {})
    target_platforms = data.get("platforms") or list(active_connections.keys())

    if not target_platforms:
        return jsonify({"success": False, "error": "No platforms connected"}), 400

    post_id = str(uuid.uuid4())
    results = {}
    overall_success = False

    for pid in target_platforms:
        if pid not in active_connections:
            results[pid] = {"success": False, "error": "Not connected"}
            push_event("posting_status", {"post_id": post_id, "platform": pid, "status": "failed", "error": "Not connected"})
            continue

        push_event("posting_status", {"post_id": post_id, "platform": pid, "status": "posting"})
        try:
            result = active_connections[pid].post_ad(content)
            results[pid] = result
            if result.get("success"):
                overall_success = True
                push_event("posting_status", {"post_id": post_id, "platform": pid, "status": "success", "post_url": result.get("post_url", "")})
            else:
                push_event("posting_status", {"post_id": post_id, "platform": pid, "status": "failed", "error": result.get("error", "Unknown")})
        except Exception as e:
            results[pid] = {"success": False, "error": str(e)}
            push_event("posting_status", {"post_id": post_id, "platform": pid, "status": "failed", "error": str(e)})
            logger.exception(f"Post to {pid}")

    # Save history
    post_history.append({
        "id": post_id,
        "timestamp": datetime.utcnow().isoformat(),
        "content": content,
        "platforms": target_platforms,
        "results": results,
        "overall_success": overall_success,
    })
    if len(post_history) > 100:
        post_history.pop(0)

    return jsonify({"success": overall_success, "post_id": post_id, "results": results})


# ── Scheduler ──────────────────────────────────────────────────────────────────
@app.route("/api/schedule", methods=["POST"])
def schedule_post():
    data = request.json or {}
    content          = data.get("content", {})
    target_platforms = data.get("platforms") or list(active_connections.keys())
    scheduled_at_str = data.get("scheduled_at", "")  # ISO 8601

    if not scheduled_at_str:
        return jsonify({"success": False, "error": "scheduled_at is required"}), 400

    try:
        scheduled_at = datetime.fromisoformat(scheduled_at_str)
        if scheduled_at.tzinfo is None:
            scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    except ValueError:
        return jsonify({"success": False, "error": "Invalid scheduled_at format. Use ISO 8601."}), 400

    if scheduled_at.timestamp() <= datetime.now(timezone.utc).timestamp():
        return jsonify({"success": False, "error": "scheduled_at must be in the future"}), 400

    sid = scheduler.schedule(content, target_platforms, scheduled_at)
    return jsonify({"success": True, "schedule_id": sid, "scheduled_at": scheduled_at.isoformat()})


@app.route("/api/schedule", methods=["GET"])
def get_scheduled():
    return jsonify({"scheduled": scheduler.get_all()})


@app.route("/api/schedule/<schedule_id>", methods=["DELETE"])
def cancel_scheduled(schedule_id):
    ok = scheduler.cancel(schedule_id)
    return jsonify({"success": ok, "error": None if ok else "Not found or already executed"})


# ── History & stats ────────────────────────────────────────────────────────────
@app.route("/api/history")
def get_history():
    return jsonify({"history": list(reversed(post_history[-30:]))})


@app.route("/api/stats")
def get_stats():
    total = len(post_history)
    succeeded = sum(1 for p in post_history if p["overall_success"])
    per_platform = {}
    for pid in platform_connectors:
        sent = sum(1 for p in post_history if pid in p.get("platforms", []))
        ok   = sum(1 for p in post_history if p.get("results", {}).get(pid, {}).get("success"))
        per_platform[pid] = {"sent": sent, "succeeded": ok}
    return jsonify({
        "total_posts": total,
        "successful":  succeeded,
        "failed":      total - succeeded,
        "per_platform": per_platform,
        "scheduled_pending": len(scheduler.get_scheduled()),
    })


# ── Static uploads ─────────────────────────────────────────────────────────────
@app.route("/static/uploads/<filename>")
def serve_upload(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    print("\n" + "═" * 55)
    print("  ⚡  AdSync — Unified Social Media Ads Platform")
    print("  🌐  http://localhost:5000")
    print("  🔧  Platforms: Facebook, Instagram, Twitter/X,")
    print("                 LinkedIn, TikTok, Pinterest")
    print("═" * 55 + "\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
