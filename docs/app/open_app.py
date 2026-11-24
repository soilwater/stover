"""
Start the Stover app locally: serves this folder on http://localhost and opens it in the browser.
Stop with Ctrl+C.

    python open_app.py
"""
import functools
import http.server
import os
import socket
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json"}

    def log_message(self, *args):
        pass


def free_port(start=8800):
    for port in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("no free port")


if __name__ == "__main__":
    port = free_port()
    url = f"http://localhost:{port}/index.html"
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=HERE))
    print(f"Stover app running at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
