import time
from collections import defaultdict
from typing import Dict, List
from fastapi import Request, HTTPException

class IPRateLimiter:
    def __init__(self):
        # ip -> list of timestamps
        self._room_creations: Dict[str, List[float]] = defaultdict(list)
        self._uploads: Dict[str, List[float]] = defaultdict(list)

    def _clean(self, records: Dict[str, List[float]], window_seconds: float):
        now = time.time()
        cutoff = now - window_seconds
        for ip in list(records.keys()):
            records[ip] = [t for t in records[ip] if t > cutoff]
            if not records[ip]:
                records.pop(ip, None)

    def get_client_ip(self, request: Request) -> str:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        return request.client.host if request.client else "unknown"

    def check_room_creation(self, request: Request, max_per_10m: int = 15):
        client_ip = self.get_client_ip(request)
        now = time.time()
        self._clean(self._room_creations, 600)
        
        times = self._room_creations[client_ip]
        if len(times) >= max_per_10m:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Too many sessions created from this IP. Please wait a few minutes."
            )
        times.append(now)

    def check_upload(self, request: Request, max_per_minute: int = 40):
        client_ip = self.get_client_ip(request)
        now = time.time()
        self._clean(self._uploads, 60)
        
        times = self._uploads[client_ip]
        if len(times) >= max_per_minute:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Too many uploads. Please slow down."
            )
        times.append(now)

rate_limiter = IPRateLimiter()
