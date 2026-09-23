import asyncio
import os
import uuid
import base64
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import io

from app.models import Clip
from app.session_manager import session_manager
from app.rate_limiter import rate_limiter

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
MAX_STANDARD_UPLOAD_BYTES = 10 * 1024 * 1024  # Strict 10 MB standard server limit

@asynccontextmanager
async def lifespan(app: FastAPI):
    session_manager.start_cleanup_worker()
    yield

app = FastAPI(
    title="QuickClip",
    description="Instant Cross-Device Copy & Paste with WebRTC P2P Direct Transfer",
    version="2.2.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def detect_media_type(filename: str, mime: str, custom_type: Optional[str] = None) -> str:
    if custom_type in ("image", "video", "audio", "pdf", "code", "file"):
        return custom_type
    mime_lower = (mime or "").lower()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if mime_lower.startswith("image/") or ext in ("png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"):
        return "image"
    if mime_lower.startswith("video/") or ext in ("mp4", "webm", "ogg", "mov", "m4v", "mkv"):
        return "video"
    if mime_lower.startswith("audio/") or ext in ("mp3", "wav", "ogg", "m4a", "aac", "flac", "weba"):
        return "audio"
    if mime_lower == "application/pdf" or ext == "pdf":
        return "pdf"
    if ext in ("txt", "md", "json", "js", "py", "html", "css", "csv", "xml", "yaml", "yml", "sh", "sql", "c", "cpp", "ts"):
        return "code"
    return "file"

# Room API Routes
@app.post("/api/room")
async def create_or_join_room(request: Request, payload: Optional[dict] = None):
    code = None
    if payload and "code" in payload:
        candidate = str(payload["code"]).strip()
        if len(candidate) == 5 and candidate.isdigit():
            code = candidate

    # 1. Joining or connecting to a 5-digit room: instant, no bot challenge
    if code:
        room = session_manager.get_or_create_room(code)
        return {
            "success": True,
            "room": room.to_dict(),
            "peer_count": session_manager.get_peer_count(room.code)
        }

    # 2. Creating a random ephemeral room
    rate_limiter.check_room_creation(request)
    room = session_manager.get_or_create_room(None)
    return {
        "success": True,
        "room": room.to_dict(),
        "peer_count": session_manager.get_peer_count(room.code)
    }

@app.get("/api/room/{code}")
async def get_room(code: str):
    room = session_manager.get_room(code)
    if not room:
        raise HTTPException(status_code=404, detail="Session expired or not found")
    return {
        "success": True,
        "room": room.to_dict(),
        "peer_count": session_manager.get_peer_count(code)
    }

@app.post("/api/room/{code}/upload")
async def upload_file(
    request: Request,
    code: str,
    file: UploadFile = File(...),
    custom_type: Optional[str] = Form(None),
    file_name: Optional[str] = Form(None),
    mime_type: Optional[str] = Form(None)
):
    rate_limiter.check_upload(request)

    room = session_manager.get_room(code)
    if not room:
        raise HTTPException(status_code=404, detail="Session expired or not found")

    file_bytes = await file.read()
    
    # Enforce strict 10 MB standard transfer limit to protect server memory
    if len(file_bytes) > MAX_STANDARD_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File exceeds standard server limit (10 MB). Use P2P Direct Transfer between connected devices."
        )

    clip_id = uuid.uuid4().hex[:12]
    filename = file_name or file.filename or f"clip-{clip_id}"
    m_type = mime_type or file.content_type or "application/octet-stream"

    # If encrypted in QCE1 format and metadata was not explicitly provided in form, extract original metadata
    is_encrypted = file_bytes.startswith(b"QCE1")
    if is_encrypted and len(file_bytes) > 18:
        try:
            meta_len = (file_bytes[16] << 8) | file_bytes[17]
            if len(file_bytes) >= 18 + meta_len:
                meta = json.loads(file_bytes[18:18 + meta_len].decode("utf-8"))
                if not file_name and "name" in meta:
                    filename = meta["name"]
                if not mime_type and "type" in meta:
                    m_type = meta["type"]
        except Exception:
            pass

    clip_type = detect_media_type(filename, m_type, custom_type)
    
    # Generate preview data URL only for legacy unencrypted images (never for QCE1 encrypted files)
    content = None
    if clip_type == "image" and not is_encrypted and m_type.startswith("image/"):
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        content = f"data:{m_type};base64,{b64}"

    clip = Clip(
        id=clip_id,
        type=clip_type,
        content=content,
        file_name=filename,
        file_size=len(file_bytes),
        mime_type=m_type,
        download_url=f"/api/room/{code}/files/{clip_id}",
        file_bytes=file_bytes
    )

    session_manager.add_clip(code, clip)

    # Broadcast to room
    await session_manager.broadcast(code, {
        "type": "clip_added",
        "clip": clip.to_dict()
    })

    return {
        "success": True,
        "clip": clip.to_dict()
    }

@app.get("/api/room/{code}/files/{clip_id}")
async def download_file(code: str, clip_id: str):
    room = session_manager.get_room(code)
    if not room:
        raise HTTPException(status_code=404, detail="Session expired or not found")

    target_clip = next((c for c in room.clips if c.id == clip_id), None)
    if not target_clip or target_clip.file_bytes is None:
        raise HTTPException(status_code=404, detail="File expired or not found")

    return StreamingResponse(
        io.BytesIO(target_clip.file_bytes),
        media_type=target_clip.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{target_clip.file_name}"',
            "Cache-Control": "no-store, no-cache, must-revalidate"
        }
    )

@app.post("/api/room/{code}/burn")
async def burn_room(code: str):
    room = session_manager.get_room(code)
    if not room:
        return {"success": True, "message": "Room already purged"}
    await session_manager.burn_room(code)
    return {"success": True, "message": "Room burned and wiped"}

# WebSocket ASGI Connection Endpoint with WebRTC Signaling
@app.websocket("/ws/{code}")
async def websocket_endpoint(websocket: WebSocket, code: str):
    await websocket.accept()
    room = session_manager.get_or_create_room(code)
    peer_id = "p-" + uuid.uuid4().hex[:8]

    # Send initial state immediately with assigned peer_id and existing peers
    await websocket.send_json({
        "type": "init",
        "peer_id": peer_id,
        "room": room.to_dict(),
        "peer_count": session_manager.get_peer_count(code) + 1,
        "peers": session_manager.get_peer_ids(code) + [peer_id]
    })

    # Register and notify other peers
    await session_manager.register_connection(code, peer_id, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "add_text":
                text = (data.get("text") or "").strip()
                if text:
                    clip_id = uuid.uuid4().hex[:12]
                    clip = Clip(
                        id=clip_id,
                        type="text",
                        content=text,
                        file_name=None,
                        file_size=len(text.encode("utf-8")),
                        mime_type="text/plain"
                    )
                    session_manager.add_clip(code, clip)
                    await session_manager.broadcast(code, {
                        "type": "clip_added",
                        "clip": clip.to_dict()
                    })

            elif action == "delete_clip":
                clip_id = data.get("clip_id")
                if clip_id and session_manager.delete_clip(code, clip_id):
                    await session_manager.broadcast(code, {
                        "type": "clip_deleted",
                        "clip_id": clip_id
                    })

            elif action == "clear_all":
                if session_manager.clear_room_clips(code):
                    await session_manager.broadcast(code, {
                        "type": "room_cleared"
                    })

            elif action == "burn_session":
                await session_manager.burn_room(code)
                break

            # WebRTC P2P Signaling Relay
            elif action == "p2p_signal":
                target_peer_id = data.get("target_peer_id")
                signal = data.get("signal")
                if target_peer_id and signal:
                    await session_manager.send_to_peer(code, target_peer_id, {
                        "type": "p2p_signal",
                        "sender_peer_id": peer_id,
                        "signal": signal
                    })

            elif action == "ping":
                active_room = session_manager.get_room(code)
                rem = active_room.remaining_seconds if active_room else 0
                await websocket.send_json({
                    "type": "pong",
                    "remaining_seconds": rem,
                    "peer_count": session_manager.get_peer_count(code)
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await session_manager.unregister_connection(code, peer_id)

# Mount Static Assets & Frontend
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse(os.path.join(STATIC_DIR, "manifest.json"), media_type="application/manifest+json")

@app.get("/sw.js")
async def serve_sw():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={"Cache-Control": "no-cache"})

@app.get("/{catchall:path}")
async def catchall_redirect(catchall: str):
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), headers={"Cache-Control": "no-cache"})
