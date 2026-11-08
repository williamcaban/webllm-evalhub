#!/usr/bin/env python3
"""Local proxy between the EvalHub collection designer UI (ui/) and the EvalHub MCP server.

Managed mode (recommended): credentials stay on your machine, never in the browser.

    ./evalhub-connect.sh -n my-namespace          # writes evalhub-chat.config.json (mode 600)
    python3 -I cors-proxy.py --config evalhub-chat.config.json
    open http://127.0.0.1:8787/

The proxy serves the page, serves /config.json (no secrets), and forwards /mcp to the upstream
with Authorization and X-Tenant injected from the config file. The file is re-read when it
changes, so re-running evalhub-connect.sh refreshes an expired token without a restart.
Requests with a foreign Origin or Host header are refused, so other local web pages cannot use it.

The page is the PatternFly app in ui/dist; build it once with: cd ui && npm install && npm run build

Plain CORS mode (no credentials held here): the page sends its own headers.

    python3 -I cors-proxy.py https://mcp-route.example.com/mcp --insecure

--insecure turns off TLS verification for the upstream hop; use it only for a lab Route whose
certificate does not match its host. Binds to loopback only.
"""
import argparse
import http.client
import json
import mimetypes
import ssl
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
UI_DIST = HERE / "ui" / "dist"
PASS_HEADERS = {"content-type", "accept", "mcp-session-id", "mcp-protocol-version", "mcp-method", "mcp-name"}
CORS_PASS_HEADERS = PASS_HEADERS | {"authorization", "x-tenant", "x-user"}


class ConfigError(Exception):
    pass


class Target:
    """Upstream URL plus credentials: fixed from the command line, or re-read from the config file."""

    def __init__(self, upstream, insecure, config):
        self.config_path = Path(config) if config else None
        self._fixed = {"upstream": upstream, "insecure": insecure, "tenant": "", "token": "", "expires_at": ""}
        self._mtime = None
        self._cached = None

    @property
    def managed(self):
        return self.config_path is not None

    def get(self):
        path = self.config_path
        if path is None:
            return self._fixed
        try:
            mtime = path.stat().st_mtime_ns
        except OSError as e:
            raise ConfigError(f"cannot read {path}: {e.strerror}. Run evalhub-connect.sh.") from e
        if mtime != self._mtime:
            try:
                data = json.loads(path.read_text())
                self._cached = {"upstream": data["upstream"], "insecure": bool(data.get("insecure")),
                                "tenant": data["tenant"], "token": data["token"],
                                "expires_at": data.get("expires_at", "")}
            except (ValueError, KeyError) as e:
                raise ConfigError(f"{path} is not a valid config ({e!r}). Re-run evalhub-connect.sh.") from e
            self._mtime = mtime
        return self._cached

    @staticmethod
    def expired(t):
        if not t["expires_at"]:
            return False
        return datetime.fromisoformat(t["expires_at"]) <= datetime.now(timezone.utc)


def static_file(path):
    """A built UI file for this URL path, or None. The app is a single page, so "/" is index.html."""
    root = UI_DIST.resolve()
    candidate = (root / (path.lstrip("/") or "index.html")).resolve()
    if candidate.is_file() and candidate.is_relative_to(root):  # is_relative_to blocks ../ escapes
        return candidate
    return None


def make_handler(target, port):
    local_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, body=b"", ctype="text/plain", extra=None):
            self.send_response(status)
            if not target.managed:
                self._cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin") or "*")
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers",
                             self.headers.get("Access-Control-Request-Headers") or "*")
            self.send_header("Access-Control-Expose-Headers", "Mcp-Session-Id")

        def _local_only(self):
            """Managed mode injects credentials, so refuse DNS-rebinding and cross-site callers."""
            if not target.managed:
                return True
            host, origin = self.headers.get("Host", ""), self.headers.get("Origin")
            if host not in local_hosts or (origin and origin != f"http://{host}"):
                self._send(403, b"proxy: foreign Host or Origin refused")
                return False
            return True

        def do_OPTIONS(self):
            if not self._local_only():
                return
            self._send(204)

        def do_GET(self):
            if not self._local_only():
                return
            path = urlsplit(self.path).path
            if file := static_file(path):
                ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                if ctype.startswith("text/") or ctype in {"application/javascript", "application/json"}:
                    ctype += "; charset=utf-8"
                return self._send(200, file.read_bytes(), ctype)
            if path in {"/", "/index.html"}:
                return self._send(404, b"proxy: the UI is not built. Run: cd ui && npm install && npm run build")
            if path == "/config.json" and target.managed:
                try:
                    t = target.get()
                except ConfigError as e:
                    return self._send(503, str(e).encode())
                body = {"mode": "proxy", "mcp_path": "/mcp", "tenant": t["tenant"],
                        "upstream_host": urlsplit(t["upstream"]).netloc, "expires_at": t["expires_at"],
                        "expired": Target.expired(t)}
                return self._send(200, json.dumps(body).encode(), "application/json")
            self._forward()

        def do_POST(self):
            if self._local_only():
                self._forward()

        do_DELETE = do_POST

        def _forward(self):
            try:
                t = target.get()
            except ConfigError as e:
                return self._send(503, str(e).encode())
            if target.managed and Target.expired(t):
                return self._send(401, f"proxy: token expired at {t['expires_at']}. Re-run evalhub-connect.sh.".encode())
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            allowed = PASS_HEADERS if target.managed else CORS_PASS_HEADERS
            headers = {k: v for k, v in self.headers.items() if k.lower() in allowed}
            if target.managed:
                headers["Authorization"] = "Bearer " + t["token"]
                headers["X-Tenant"] = t["tenant"]
            u = urlsplit(t["upstream"])
            path = (u.path or "/") + (f"?{u.query}" if u.query else "")
            try:
                if u.scheme == "https":
                    ctx = ssl._create_unverified_context() if t["insecure"] else ssl.create_default_context()
                    conn = http.client.HTTPSConnection(u.hostname, u.port, timeout=300, context=ctx)
                else:
                    conn = http.client.HTTPConnection(u.hostname, u.port, timeout=300)
                conn.request(self.command, path, body or None, headers)
                resp = conn.getresponse()
                data = resp.read()
                conn.close()
            except Exception as e:  # upstream unreachable, TLS failure, timeout
                return self._send(502, f"proxy: upstream error: {e}. Is the Route reachable?".encode())
            extra = {k: v for k in ("Mcp-Session-Id",) if (v := resp.getheader(k))}
            self._send(resp.status, data, resp.getheader("Content-Type") or "application/octet-stream", extra)

        def log_message(self, format, *args):  # one line per request, never headers or bodies
            print(f"{self.command} {self.path.split('?')[0]} -> {args[1] if len(args) > 1 else ''}", flush=True)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("upstream", nargs="?", help="full upstream MCP URL (plain CORS mode)")
    ap.add_argument("--config", help="config file written by evalhub-connect.sh (managed mode)")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification (plain CORS mode)")
    a = ap.parse_args()
    if bool(a.upstream) == bool(a.config):
        ap.error("give either an upstream URL or --config, not both")
    target = Target(a.upstream, a.insecure, a.config)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(target, a.port))
    if target.managed:
        print(f"Managed proxy on http://127.0.0.1:{a.port}/  (config: {a.config})", flush=True)
    else:
        print(f"CORS proxy on http://127.0.0.1:{a.port}  ->  {a.upstream}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
