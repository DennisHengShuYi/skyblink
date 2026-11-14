"""Serve the frontend folder for local testing: python mock/serve.py [port]

Same as `python -m http.server`, but forces the JavaScript MIME type. On Windows
the registry often maps .js to text/plain, and browsers refuse to run ES modules
served that way. Open http://127.0.0.1:8000/?mock=1 for the offline demo.
"""

import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
    }


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {ROOT} at http://127.0.0.1:{port}/?mock=1")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
