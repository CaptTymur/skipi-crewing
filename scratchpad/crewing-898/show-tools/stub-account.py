#!/usr/bin/env python3
"""Loopback stub for the 3c owner show. Step ONE succeeds, step TWO fails.

Scenario is chosen per request path so one server serves both cases:
  /api/app/login                -> 200, a LoginResponse that passes validate()
  /api/app/crewing/bootstrap     -> depends on MODE file content:
      "unreachable" : close the socket without replying  -> post() send() fails
                      -> transport_unreachable -> workspace_unreachable
      "unavailable" : 503                                -> upstream_unavailable
                      -> workspace_unavailable
Nothing here is a product component: it exists to make the SECOND step fail while
the FIRST one has genuinely succeeded, which no closed port can do.
"""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODE_FILE = os.environ.get("STUB_MODE_FILE", "/tmp/stub-mode")
LOG = os.environ.get("STUB_LOG", "/tmp/stub.log")

def mode():
    try:
        return open(MODE_FILE).read().strip()
    except Exception:
        return "unreachable"

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, fmt, *a):
        with open(LOG, "a") as fh:
            fh.write("%s %s\n" % (self.log_date_time_string(), fmt % a))
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        with open(LOG, "a") as fh:
            fh.write("POST %s mode=%s\n" % (self.path, mode()))
        if self.path == "/api/app/login":
            body = json.dumps({"token": "stub-app-credential-3c",
                               "scope": "app_full",
                               "role": None,
                               "account_id": "stub-account-3c"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/app/crewing/bootstrap":
            if mode() == "success":
                import datetime
                exp = (datetime.datetime.now(datetime.timezone.utc)
                       + datetime.timedelta(minutes=10)).replace(microsecond=0).isoformat().replace("+00:00","Z")
                body = json.dumps({
                    "account_id": "stub-account-3c",
                    "connection": {
                        "server_url": "https://api.skipi.app",
                        "crewing_id": "stub-company",
                        "organization_id": None,
                        "bearer_token": "skn_stub-company-credential",
                        "scopes": ["vacancy:write","mailing:write","applications:read",
                                   "profile:write","pubkey:write"],
                        "expires_at": exp,
                    },
                    "entitlement": {"source": "approved_free", "expires_at": None},
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type","application/json")
                self.send_header("Content-Length",str(len(body)))
                self.end_headers(); self.wfile.write(body)
                return
            if mode() == "unavailable":
                body = json.dumps({"code": "upstream_unavailable"}).encode()
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                # Drop the connection with no reply: reqwest's send() fails and
                # post() maps that to transport_unreachable.
                try:
                    self.close_connection = True
                    self.wfile.close()
                except Exception:
                    pass
            return
        self.send_response(404); self.send_header("Content-Length","0"); self.end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1])
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
