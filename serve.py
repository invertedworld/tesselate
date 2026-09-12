#!/usr/bin/env python3
"""Serve the table for development, telling the browser not to cache.

`python3 -m http.server` sends no Cache-Control at all, which lets a
browser apply its own heuristic freshness and go on serving an old
src/app.js long after it has changed — so an edit appears to do nothing.
"""

import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'Tesselate on http://localhost:{port}/  (nothing cached)')
    http.server.test(HandlerClass=NoCache, port=port, bind='127.0.0.1')
