"""
SignalingServer WebRTC 信令逻辑测试（先前零覆盖）。

src/p2p/signaling_server.py 负责 P2P 社交的节点注册/注销、消息转发与广播、
WebRTC offer/answer/ice 路由——但没有任何测试。这里用假 WebSocket（记录 send_json
与 close）覆盖：注册/替换/注销的副作用与广播、send_to_peer 失败时自动注销、
forward_message 目标不在线的错误回执、handle_message 的类型路由与坏 JSON 处理、
get_stats 统计。纯内存对象，不起真实 WebSocket/网络。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.p2p.signaling_server import SignalingServer  # noqa: E402


class FakeWS:
    """假 WebSocket：记录 send_json 的消息；可设为发送即失败。"""

    def __init__(self, fail=False):
        self.sent = []
        self.closed = False
        self._fail = fail

    async def send_json(self, message):
        if self._fail:
            raise RuntimeError("connection dead")
        self.sent.append(message)

    async def close(self):
        self.closed = True

    def types(self):
        return [m.get("type") for m in self.sent]


def server():
    return SignalingServer()


# --------------------------------------------------------------------------- #
# register / unregister
# --------------------------------------------------------------------------- #
class TestRegister:
    @pytest.mark.asyncio
    async def test_first_peer_gets_success_and_peer_list(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a, {"nick": "alice"})
        assert "A" in s.peers
        assert s.peer_metadata["A"] == {"nick": "alice"}
        assert s.subscriptions["A"] == set()
        # 自己收到 register:success 与 peer:list（无他人，故无 peer:online 给自己）
        assert "register:success" in a.types()
        assert "peer:list" in a.types()

    @pytest.mark.asyncio
    async def test_second_peer_notifies_existing_peer_online(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        a.sent.clear()
        await s.register_peer("B", b)
        # A 收到 B 上线广播
        assert "peer:online" in a.types()
        online = next(m for m in a.sent if m["type"] == "peer:online")
        assert online["peerId"] == "B"
        # B 的 peer:list 应含 A
        plist = next(m for m in b.sent if m["type"] == "peer:list")
        assert any(p["peerId"] == "A" for p in plist["peers"])

    @pytest.mark.asyncio
    async def test_reregister_closes_old_connection(self):
        s = server()
        old, new = FakeWS(), FakeWS()
        await s.register_peer("A", old)
        await s.register_peer("A", new)
        assert old.closed is True
        assert s.peers["A"] is new

    @pytest.mark.asyncio
    async def test_metadata_defaults_to_empty_dict(self):
        s = server()
        await s.register_peer("A", FakeWS(), None)
        assert s.peer_metadata["A"] == {}


class TestUnregister:
    @pytest.mark.asyncio
    async def test_removes_state_and_broadcasts_offline(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        b.sent.clear()
        await s.unregister_peer("A")
        assert "A" not in s.peers
        assert "A" not in s.peer_metadata
        assert "A" not in s.subscriptions
        assert "peer:offline" in b.types()

    @pytest.mark.asyncio
    async def test_unknown_peer_is_noop(self):
        s = server()
        await s.unregister_peer("ghost")  # 不抛异常
        assert s.peers == {}


# --------------------------------------------------------------------------- #
# send_to_peer / broadcast
# --------------------------------------------------------------------------- #
class TestSendAndBroadcast:
    @pytest.mark.asyncio
    async def test_send_to_online_peer_returns_true(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a)
        ok = await s.send_to_peer("A", {"type": "ping"})
        assert ok is True
        assert {"type": "ping"} in a.sent

    @pytest.mark.asyncio
    async def test_send_to_offline_peer_returns_false(self):
        s = server()
        assert await s.send_to_peer("nope", {"type": "x"}) is False

    @pytest.mark.asyncio
    async def test_send_failure_unregisters_peer(self):
        s = server()
        dead = FakeWS(fail=True)
        # 直接放入 peers，绕过 register（register 自身会触发 send 失败）
        s.peers["D"] = dead
        s.peer_metadata["D"] = {}
        s.subscriptions["D"] = set()
        ok = await s.send_to_peer("D", {"type": "x"})
        assert ok is False
        assert "D" not in s.peers  # 发送失败 → 自动注销

    @pytest.mark.asyncio
    async def test_broadcast_except_skips_sender(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        a.sent.clear(); b.sent.clear()
        await s.broadcast_except("A", {"type": "news"})
        assert {"type": "news"} not in a.sent
        assert {"type": "news"} in b.sent

    @pytest.mark.asyncio
    async def test_send_peer_list_excludes_self(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a, {"n": 1})
        await s.register_peer("B", b, {"n": 2})
        a.sent.clear()
        await s.send_peer_list("A")
        plist = next(m for m in a.sent if m["type"] == "peer:list")
        ids = [p["peerId"] for p in plist["peers"]]
        assert "A" not in ids
        assert "B" in ids


# --------------------------------------------------------------------------- #
# forward_message
# --------------------------------------------------------------------------- #
class TestForward:
    @pytest.mark.asyncio
    async def test_forwards_and_tags_sender(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        b.sent.clear()
        ok = await s.forward_message("A", "B", {"type": "offer", "sdp": "x"})
        assert ok is True
        fwd = b.sent[-1]
        assert fwd["from"] == "A"
        assert fwd["sdp"] == "x"

    @pytest.mark.asyncio
    async def test_target_offline_sends_error_to_sender(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a)
        a.sent.clear()
        ok = await s.forward_message("A", "GONE", {"type": "offer"})
        assert ok is False
        err = a.sent[-1]
        assert err["type"] == "error"
        assert err["code"] == "PEER_OFFLINE"
        assert err["targetPeerId"] == "GONE"


# --------------------------------------------------------------------------- #
# handle_message — 类型路由
# --------------------------------------------------------------------------- #
class TestHandleMessage:
    @pytest.mark.asyncio
    async def test_heartbeat_gets_ack(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a)
        a.sent.clear()
        await s.handle_message("A", '{"type":"heartbeat"}')
        assert "heartbeat:ack" in a.types()

    @pytest.mark.asyncio
    async def test_offer_with_target_is_forwarded(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        b.sent.clear()
        await s.handle_message("A", '{"type":"offer","to":"B","sdp":"s"}')
        assert any(m.get("type") == "offer" and m.get("from") == "A" for m in b.sent)

    @pytest.mark.asyncio
    async def test_offer_without_target_does_not_forward(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        b.sent.clear()
        await s.handle_message("A", '{"type":"offer"}')  # 无 to
        assert b.sent == []

    @pytest.mark.asyncio
    async def test_get_peers_returns_list(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a)
        a.sent.clear()
        await s.handle_message("A", '{"type":"get-peers"}')
        assert "peer:list" in a.types()

    @pytest.mark.asyncio
    async def test_invalid_json_returns_error(self):
        s = server()
        a = FakeWS()
        await s.register_peer("A", a)
        a.sent.clear()
        await s.handle_message("A", "{not json}")
        err = a.sent[-1]
        assert err["type"] == "error"
        assert err["code"] == "INVALID_JSON"

    @pytest.mark.asyncio
    async def test_custom_message_with_target_forwarded(self):
        s = server()
        a, b = FakeWS(), FakeWS()
        await s.register_peer("A", a)
        await s.register_peer("B", b)
        b.sent.clear()
        await s.handle_message("A", '{"type":"chat","to":"B","text":"hi"}')
        assert any(m.get("text") == "hi" and m.get("from") == "A" for m in b.sent)


# --------------------------------------------------------------------------- #
# get_stats
# --------------------------------------------------------------------------- #
class TestStats:
    @pytest.mark.asyncio
    async def test_reports_online_count_and_peer_entries(self):
        s = server()
        await s.register_peer("A", FakeWS(), {"k": "v"})
        await s.register_peer("B", FakeWS())
        stats = s.get_stats()
        assert stats["online_peers"] == 2
        ids = [p["peer_id"] for p in stats["peers"]]
        assert set(ids) == {"A", "B"}
        a_entry = next(p for p in stats["peers"] if p["peer_id"] == "A")
        assert a_entry["metadata"] == {"k": "v"}
        assert a_entry["subscriptions"] == 0
