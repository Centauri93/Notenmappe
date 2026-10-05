#!/usr/bin/env python3
"""
Startet die Notenmappe lokal – ohne Node, ohne npm.

    python3 serve.py            # http://localhost:8000
    python3 serve.py 8080       # anderer Port

Danach im Browser http://localhost:8000 öffnen. localhost gilt als sicherer
Kontext, dadurch funktionieren Service Worker und PWA-Installation.
"""

import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Während der Entwicklung nichts zwischenspeichern. Manche Browser
        # halten JavaScript-Module trotz "no-store" fest, deshalb zusätzlich
        # "no-cache" (erzwingt Rückfrage) und die alten Felder für ältere Engines.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/"
        print(f"Notenmappe läuft auf {url}  (Beenden mit Strg+C)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer beendet.")
