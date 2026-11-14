"""Tiny in-memory sliding-window rate limiter (single-process deployment)."""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import Request

MAX_TRACKED_CLIENTS = 10_000


class RateLimiter:
    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, client: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > MAX_TRACKED_CLIENTS:  # bound memory under address spraying
                self._hits.clear()
            q = self._hits.setdefault(client, deque())
            while q and now - q[0] > self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


def client_ip(request: Request) -> str:
    """Behind the Space's proxy, the last X-Forwarded-For hop is the one the proxy added.

    Earlier hops are client-supplied and could be forged to dodge the limit.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
