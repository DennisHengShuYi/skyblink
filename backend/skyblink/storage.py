"""Where built views live on disk. Featured views (shipped in the image) win over the cache."""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

from .config import CACHE_DIR, FEATURED_DIR

KEY_RE = re.compile(r"[0-9a-f]{12}-D[1-6]")
FILE_RE = re.compile(r"(?:visit|flags|stack)_\d{1,4}\.png|deep\.png|cube\.bin")


def valid_key(key: str) -> bool:
    return bool(KEY_RE.fullmatch(key))


def valid_file(name: str) -> bool:
    return bool(FILE_RE.fullmatch(name))


def atomic_write(path: Path, data: bytes) -> None:
    """Write via a unique temp file + rename so readers never see a half-written file."""
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def view_dir(key: str, root: Path | None = None) -> Path:
    if not valid_key(key):
        raise ValueError("bad view key")
    pos, det = key.split("-")
    d = (root or CACHE_DIR) / pos / det
    d.mkdir(parents=True, exist_ok=True)
    return d


def find_view(key: str) -> Path | None:
    """Directory holding a finished view, or None."""
    if not valid_key(key):
        return None
    pos, det = key.split("-")
    for root in (FEATURED_DIR, CACHE_DIR):
        d = root / pos / det
        if (d / "manifest.json").exists():
            return d
    return None


def load_manifest(key: str) -> dict | None:
    d = find_view(key)
    return json.loads((d / "manifest.json").read_text(encoding="utf-8")) if d else None


def sibling_views(key: str) -> list[Path]:
    """All finished detector views at the same position and fov (for spectra)."""
    if not valid_key(key):
        return []
    pos = key.split("-")[0]
    found: dict[str, Path] = {}
    for root in (CACHE_DIR, FEATURED_DIR):  # featured last so it wins
        for d in (root / pos).glob("D[1-6]"):
            if (d / "manifest.json").exists():  # manifest is written last, so the view is complete
                found[d.name] = d
    return [found[k] for k in sorted(found)]
