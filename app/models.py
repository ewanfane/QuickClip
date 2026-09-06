from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
import time
import uuid

@dataclass
class Clip:
    id: str
    type: str  # 'text', 'image', 'file'
    content: Optional[str] = None  # Text content, or base64 preview for quick images
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    download_url: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    file_bytes: Optional[bytes] = None  # In-memory ephemeral file payload

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "content": self.content,
            "file_name": self.file_name,
            "file_size": self.file_size,
            "mime_type": self.mime_type,
            "download_url": self.download_url,
            "created_at": self.created_at,
        }

@dataclass
class Room:
    code: str
    created_at: float = field(default_factory=time.time)
    ttl_seconds: int = 1200  # 20 minutes
    clips: List[Clip] = field(default_factory=list)

    @property
    def expires_at(self) -> float:
        return self.created_at + self.ttl_seconds

    @property
    def remaining_seconds(self) -> int:
        remaining = int(self.expires_at - time.time())
        return max(0, remaining)

    @property
    def is_expired(self) -> bool:
        return self.remaining_seconds <= 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "remaining_seconds": self.remaining_seconds,
            "clips": [c.to_dict() for c in self.clips],
        }
