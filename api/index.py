"""Vercel Python entry point: exposes the stateless SkyBlink API as `app`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink.serverless import app  # noqa: E402,F401
