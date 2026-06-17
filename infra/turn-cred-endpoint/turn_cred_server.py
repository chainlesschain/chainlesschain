#!/usr/bin/env python3
"""
FAMILY-67 / plan B — TURN credential endpoint (phone-to-phone path).

桌面端经 QR 配对时由 desktop-pair-handlers.js signIceCredentials 用 CC_TURN_SECRET 签发
TURN 凭证；纯手机↔手机好友聊天无桌面，故需一个服务端端点替手机签发同样的时效凭证
（**secret 只留服务端，绝不进 APK**，与项目"不在客户端硬编码 shared secret"约定一致）。

部署：47.111.5.128，监听 127.0.0.1:9002，nginx 在 signaling.chainlesschain.com 加
`location /turn-credentials { proxy_pass http://127.0.0.1:9002; }` 反代（复用已有 TLS）。

凭证算法（必须与 /opt/cc-turn/turnserver.conf 的 use-auth-secret / static-auth-secret 对齐）：
  username   = "<expiry-unix-ts>:<uid>"
  credential = base64(HMAC-SHA1(secret, username))

响应（WebRTC RTCConfiguration.iceServers 同形）：
  {"iceServers":[{urls:[stun...]},{urls:[turn...],username,credential}], "ttl":<sec>, "expiry":<ts>}

env：
  CC_TURN_SECRET   必填，= coturn static-auth-secret
  CC_TURN_HOST     默认 turn.chainlesschain.com
  CC_TURN_TTL      默认 86400 (24h)
  CC_TURN_PORT     默认 9002
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

TURN_SECRET = os.environ.get("CC_TURN_SECRET", "")
TURN_HOST = os.environ.get("CC_TURN_HOST", "turn.chainlesschain.com")
TURN_TTL = int(os.environ.get("CC_TURN_TTL", str(24 * 60 * 60)))
PORT = int(os.environ.get("CC_TURN_PORT", "9002"))

_UID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,128}$")


def sign(uid: str):
    expiry = int(time.time()) + TURN_TTL
    username = f"{expiry}:{uid}"
    cred = base64.b64encode(
        hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()
    ).decode()
    return {
        "iceServers": [
            {"urls": [f"stun:{TURN_HOST}:3478"]},
            {
                "urls": [
                    f"turn:{TURN_HOST}:3478?transport=udp",
                    f"turn:{TURN_HOST}:3478?transport=tcp",
                    f"turns:{TURN_HOST}:5349",
                ],
                "username": username,
                "credential": cred,
            },
        ],
        "ttl": TURN_TTL,
        "expiry": expiry,
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.rstrip("/") in ("/turn-credentials", "/ice"):
            if not TURN_SECRET:
                return self._send(500, {"error": "server misconfigured: CC_TURN_SECRET unset"})
            q = parse_qs(u.query)
            uid = (q.get("uid", [""])[0] or "anon").strip()
            if not _UID_RE.match(uid):
                uid = "anon"
            return self._send(200, sign(uid))
        if u.path == "/healthz":
            return self._send(200, {"ok": True, "host": TURN_HOST})
        return self._send(404, {"error": "not found"})

    def log_message(self, *a):  # quiet
        pass


if __name__ == "__main__":
    if not TURN_SECRET:
        print("WARN: CC_TURN_SECRET not set — endpoint will return 500 until configured")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"turn-cred endpoint on 127.0.0.1:{PORT} (host={TURN_HOST}, ttl={TURN_TTL}s)")
    srv.serve_forever()
