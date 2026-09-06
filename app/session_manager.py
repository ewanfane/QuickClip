import asyncio
import random
import time
from typing import Dict, List, Optional
from fastapi import WebSocket
from app.models import Room, Clip

class SessionManager:
    def __init__(self):
        self._rooms: Dict[str, Room] = {}
        # code -> { peer_id: WebSocket }
        self._connections: Dict[str, Dict[str, WebSocket]] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_cleanup_worker(self):
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self):
        """Periodically checks and purges expired sessions (20 minute lifetime)."""
        while True:
            try:
                await asyncio.sleep(5)
                await self.purge_expired_rooms()
            except asyncio.CancelledError:
                break
            except Exception:
                pass

    async def purge_expired_rooms(self):
        expired_codes = [
            code for code, room in self._rooms.items()
            if room.is_expired
        ]
        for code in expired_codes:
            await self._expire_room(code)

    async def _expire_room(self, code: str):
        await self.broadcast(code, {
            "type": "session_expired",
            "message": "Session has expired after 20 minutes. All clipboard content has been wiped from server memory."
        })
        sockets = list(self._connections.get(code, {}).values())
        for ws in sockets:
            try:
                await ws.close(code=1000, reason="Session expired")
            except Exception:
                pass
        self._connections.pop(code, None)
        if code in self._rooms:
            room = self._rooms.pop(code)
            for clip in room.clips:
                clip.file_bytes = None
            room.clips.clear()

    def generate_code(self) -> str:
        for _ in range(1000):
            code = str(random.randint(10000, 99999))
            if code not in self._rooms:
                return code
        return str(random.randint(10000, 99999))

    def get_room(self, code: str) -> Optional[Room]:
        room = self._rooms.get(code)
        if room and room.is_expired:
            asyncio.create_task(self._expire_room(code))
            return None
        return room

    def get_or_create_room(self, code: Optional[str] = None) -> Room:
        if code and code in self._rooms:
            room = self._rooms[code]
            if not room.is_expired:
                return room
            else:
                asyncio.create_task(self._expire_room(code))

        if not code or len(code) != 5 or not code.isdigit():
            code = self.generate_code()

        new_room = Room(code=code)
        self._rooms[code] = new_room
        return new_room

    def add_clip(self, code: str, clip: Clip) -> Optional[Clip]:
        room = self.get_room(code)
        if not room:
            return None
        room.clips.insert(0, clip)
        return clip

    def delete_clip(self, code: str, clip_id: str) -> bool:
        room = self.get_room(code)
        if not room:
            return False
        initial_count = len(room.clips)
        room.clips = [c for c in room.clips if c.id != clip_id]
        return len(room.clips) < initial_count

    def clear_room_clips(self, code: str) -> bool:
        room = self.get_room(code)
        if not room:
            return False
        for clip in room.clips:
            clip.file_bytes = None
        room.clips.clear()
        return True

    async def burn_room(self, code: str):
        await self.broadcast(code, {
            "type": "room_burned",
            "message": "Session was immediately burned and wiped."
        })
        await self._expire_room(code)

    async def register_connection(self, code: str, peer_id: str, websocket: WebSocket):
        if code not in self._connections:
            self._connections[code] = {}
        self._connections[code][peer_id] = websocket
        
        # Broadcast updated peer count and peer list to all other peers in the room
        count = len(self._connections[code])
        peer_ids = list(self._connections[code].keys())
        for pid, ws in list(self._connections[code].items()):
            if pid != peer_id:
                try:
                    await ws.send_json({
                        "type": "peer_count",
                        "count": count,
                        "peers": peer_ids,
                        "new_peer": peer_id
                    })
                except Exception:
                    pass

    async def unregister_connection(self, code: str, peer_id: str):
        if code in self._connections and peer_id in self._connections[code]:
            self._connections[code].pop(peer_id, None)
            if not self._connections[code]:
                self._connections.pop(code, None)
            else:
                count = len(self._connections[code])
                peer_ids = list(self._connections[code].keys())
                for ws in list(self._connections[code].values()):
                    try:
                        await ws.send_json({
                            "type": "peer_count",
                            "count": count,
                            "peers": peer_ids,
                            "left_peer": peer_id
                        })
                    except Exception:
                        pass

    def get_peer_count(self, code: str) -> int:
        return len(self._connections.get(code, {}))

    def get_peer_ids(self, code: str) -> List[str]:
        return list(self._connections.get(code, {}).keys())

    async def send_to_peer(self, code: str, target_peer_id: str, message: dict) -> bool:
        """Direct targeted message to a specific peer (used for WebRTC signaling)."""
        room_conns = self._connections.get(code, {})
        ws = room_conns.get(target_peer_id)
        if ws:
            try:
                await ws.send_json(message)
                return True
            except Exception:
                pass
        return False

    async def broadcast(self, code: str, message: dict):
        sockets = list(self._connections.get(code, {}).values())
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception:
                pass

session_manager = SessionManager()
