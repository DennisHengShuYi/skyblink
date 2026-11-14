"""In-process background build queue (one container, no external queue needed)."""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

from . import storage
from .builder import build_view
from .config import MAX_CONCURRENT_BUILDS, MAX_PENDING_BUILDS
from .imaging import view_key

log = logging.getLogger(__name__)


class QueueFull(Exception):
    """Too many builds are already queued or running."""


@dataclass(frozen=True)
class JobState:
    key: str
    status: str  # queued | running | done | error
    progress: float = 0.0
    message: str = ""
    error: str | None = None


class JobRegistry:
    def __init__(self, workers: int = MAX_CONCURRENT_BUILDS) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="build")
        self._lock = threading.Lock()
        self._jobs: dict[str, JobState] = {}

    def _set(self, key: str, **changes) -> None:
        with self._lock:
            self._jobs[key] = replace(self._jobs[key], **changes)

    def get(self, key: str) -> JobState | None:
        if storage.find_view(key):
            return JobState(key=key, status="done", progress=1.0, message="Ready")
        with self._lock:
            return self._jobs.get(key)

    def submit(self, ra: float, dec: float, fov: float, det: str) -> JobState:
        """Queue a build. Raises QueueFull when too many builds are already waiting."""
        key = view_key(ra, dec, fov, det)
        if storage.find_view(key):
            return JobState(key=key, status="done", progress=1.0, message="Ready")
        with self._lock:  # check-and-insert must be atomic so one key never builds twice
            existing = self._jobs.get(key)
            if existing and existing.status in ("queued", "running"):
                return existing
            active = sum(1 for j in self._jobs.values() if j.status in ("queued", "running"))
            if active >= MAX_PENDING_BUILDS:
                raise QueueFull()
            state = JobState(key=key, status="queued", message="Waiting for a free builder")
            self._jobs[key] = state
        self._pool.submit(self._run, key, ra, dec, fov, det)
        return state

    def _run(self, key: str, ra: float, dec: float, fov: float, det: str) -> None:
        self._set(key, status="running", message="Starting")
        try:
            build_view(ra, dec, fov, det, lambda p, m: self._set(key, progress=p, message=m))
            self._set(key, status="done", progress=1.0, message="Ready")
        except LookupError as exc:
            self._set(key, status="error", error=str(exc), message=str(exc))
        except Exception:  # report, never crash the worker
            log.exception("build %s failed", key)
            msg = "Build failed: the NASA archive may be busy. Try again in a minute."
            self._set(key, status="error", error=msg, message=msg)
