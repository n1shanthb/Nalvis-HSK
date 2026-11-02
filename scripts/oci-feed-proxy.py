"""Demo HTTP edge for the existing read-only keeper feed; no signing/config routes."""
import hmac
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("FEED_PROXY_TOKEN", "")
if len(TOKEN) < 32:
    raise RuntimeError("A dedicated feed proxy token is required")


def allowed_target(target):
    url = urllib.parse.urlsplit(target)
    if url.scheme or url.netloc or url.fragment:
        return False
    if not re.fullmatch(r"/feed/(state|stats|watches|actions|journal|policy)", url.path) and not re.fullmatch(r"/feed/(prompts|evidence|states|receipts)/0x[0-9a-fA-F]{64}", url.path):
        return False
    query = urllib.parse.parse_qs(url.query, keep_blank_values=True)
    if set(query) - {"limit", "after"} or any(len(v) != 1 for v in query.values()):
        return False
    if "limit" in query and (not re.fullmatch(r"[1-9][0-9]*", query["limit"][0]) or int(query["limit"][0]) > 200):
        return False
    if "after" in query and not re.fullmatch(r"0x[0-9a-fA-F]{64}", query["after"][0]):
        return False
    return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log request headers or the relay token.

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def reject_method(self):
        self.reply(405, b'{"error":"GET only"}')

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = reject_method

    def do_GET(self):
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.reply(401, b'{"error":"Unauthorized"}')
        if not allowed_target(self.path):
            return self.reply(400, b'{"error":"Feed path or query denied"}')
        try:
            # Fixed upstream; no caller headers, credentials or destination are forwarded.
            response = urllib.request.urlopen("http://127.0.0.1:8787" + self.path, timeout=6)
            with response:
                body = response.read(4_000_001)
                if len(body) > 4_000_000:
                    raise ValueError("Response too large")
                json.loads(body)
                self.reply(response.status, body)
        except urllib.error.HTTPError as error:
            self.reply(error.code, b'{"error":"Keeper feed unavailable"}')
        except Exception:
            self.reply(502, b'{"error":"Keeper feed unavailable"}')


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", 8788), Handler)
    server.daemon_threads = True
    server.serve_forever()
