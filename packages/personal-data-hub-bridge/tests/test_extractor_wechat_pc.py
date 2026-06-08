"""Deterministic tests for the WeChat 4.x decryptor + message parser.

No real WeChat install and no process-memory scan are needed:
  - the crypto round-trip builds a synthetic SQLCipher-4 page with a known key
    and asserts verify_key / decrypt recover it;
  - the parser test builds a plaintext SQLite with the real 4.0 shape
    (Name2Id + Msg_<md5(user)> tables) and asserts sender/conversation
    resolution, group-prefix stripping, and zstd skipping.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
import tempfile

import pytest

from forensics_bridge.extractors import wechat_pc as wx

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    HAVE_CRYPTO = True
except Exception:  # pragma: no cover
    HAVE_CRYPTO = False

PAGE = wx.PAGE
RESERVE = wx.RESERVE


def _noop(*_a, **_k):
    pass


@pytest.mark.skipif(not HAVE_CRYPTO, reason="cryptography not installed")
def test_verify_key_and_decrypt_page_roundtrip():
    enc_key = os.urandom(32)
    salt = os.urandom(16)
    plaintext_body = os.urandom(PAGE - 16 - RESERVE)  # decrypted page-1 body
    iv = os.urandom(16)

    enc = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).encryptor()
    ciphertext = enc.update(plaintext_body) + enc.finalize()

    hmac_key = wx._derive_hmac_key(enc_key, salt)
    mac = hmac.new(hmac_key, ciphertext + iv + (1).to_bytes(4, "little"), hashlib.sha512).digest()
    page1 = salt + ciphertext + iv + mac
    assert len(page1) == PAGE

    # correct key verifies; wrong key does not
    assert wx.verify_key(page1, enc_key) is True
    assert wx.verify_key(page1, os.urandom(32)) is False

    # full decrypt reproduces the plaintext body after the standard header
    out = os.path.join(tempfile.mkdtemp(prefix="wxrt_"), "out.db")
    rep = wx.decrypt_db_to_file(page1, enc_key, out)
    assert rep["hmacFailures"] == 0
    with open(out, "rb") as f:
        data = f.read()
    assert data[:16] == b"SQLite format 3\x00"
    assert data[16 : 16 + len(plaintext_body)] == plaintext_body


def test_parse_plaintext_resolves_sender_conversation_and_skips_zstd():
    friend = "wxid_friend001"
    table = "Msg_" + hashlib.md5(friend.encode()).hexdigest()
    path = os.path.join(tempfile.mkdtemp(prefix="wxparse_"), "plain.db")
    con = sqlite3.connect(path)
    cur = con.cursor()
    cur.execute("CREATE TABLE Name2Id (user_name TEXT, is_session INTEGER)")
    # rowids 1,2,3 (implicit)
    cur.execute("INSERT INTO Name2Id VALUES ('wxid_me', 0)")       # rowid 1
    cur.execute("INSERT INTO Name2Id VALUES (?, 1)", (friend,))     # rowid 2
    cur.execute("INSERT INTO Name2Id VALUES ('wxid_other', 0)")    # rowid 3
    cur.execute(
        f"CREATE TABLE '{table}' (local_id INTEGER, server_id INTEGER, local_type INTEGER, "
        f"real_sender_id INTEGER, create_time INTEGER, message_content, WCDB_CT_message_content INTEGER)"
    )
    cur.execute(f"INSERT INTO '{table}' VALUES (1, 1001, 1, 2, 1700000002, 'hi there', 0)")
    cur.execute(f"INSERT INTO '{table}' VALUES (2, 1002, 1, 3, 1700000001, 'wxid_other:\nhello group', 0)")
    # a real zstd-compressed body (marker != 0)
    try:
        import zstandard
        zblob = zstandard.ZstdCompressor().compress("compressed hi".encode("utf-8"))
    except Exception:
        zblob = b"\x28\xb5\x2f\xfd\x00invalid"  # no zstandard → counts as failed
    cur.execute(f"INSERT INTO '{table}' VALUES (3, 1003, 1, 2, 1700000003, ?, 4)", (zblob,))
    con.commit()
    con.close()

    # name_map resolves display names
    name_map = {friend: {"displayName": "Friend One", "remark": "Friend One"}}
    res = wx.parse_plaintext_message_db(path, name_map=name_map)
    assert res["messageTables"] == 1
    plain = next(m for m in res["messages"] if m["text"] == "hi there")
    assert plain["conversation"] == friend
    assert plain["sender"] == friend  # real_sender_id 2 -> Name2Id rowid 2
    assert plain["senderName"] == "Friend One"
    assert plain["conversationName"] == "Friend One"
    grp = next(m for m in res["messages"] if (m["text"] or "").endswith("hello group"))
    assert grp["text"] == "hello group"  # group prefix stripped

    try:
        import zstandard  # noqa: F401
        assert res["compressedDecoded"] == 1
        assert res["compressedFailed"] == 0
        zmsg = next(m for m in res["messages"] if m["text"] == "compressed hi")
        assert zmsg is not None
    except ImportError:
        assert res["compressedFailed"] == 1


def test_parse_contact_db_builds_name_map():
    path = os.path.join(tempfile.mkdtemp(prefix="wxcontact_"), "contact.db")
    con = sqlite3.connect(path)
    cur = con.cursor()
    cur.execute(
        "CREATE TABLE contact (id INTEGER, username TEXT, local_type INTEGER, alias TEXT, "
        "remark TEXT, nick_name TEXT)"
    )
    cur.execute("INSERT INTO contact (username, local_type, alias, remark, nick_name) "
                "VALUES ('wxid_a', 3, 'aliasA', '备注A', '昵称A')")  # remark wins
    cur.execute("INSERT INTO contact (username, local_type, alias, remark, nick_name) "
                "VALUES ('wxid_b', 3, NULL, NULL, '昵称B')")          # nick wins
    cur.execute("INSERT INTO contact (username, local_type, alias, remark, nick_name) "
                "VALUES ('wxid_c', 3, 'aliasC', NULL, NULL)")          # alias wins
    con.commit()
    con.close()

    name_map, contacts = wx.parse_contact_db(path)
    assert name_map["wxid_a"]["displayName"] == "备注A"
    assert name_map["wxid_b"]["displayName"] == "昵称B"
    assert name_map["wxid_c"]["displayName"] == "aliasC"
    assert len(contacts) == 3
    by_wxid = {c["wxid"]: c for c in contacts}
    assert by_wxid["wxid_a"]["remark"] == "备注A"


def test_find_accounts_never_throws(monkeypatch, tmp_path):
    # Point HOME at an empty dir → no accounts, no exception.
    monkeypatch.setattr(wx.Path, "home", staticmethod(lambda: tmp_path))
    assert wx.find_accounts() == []


def test_registered_methods_present():
    from forensics_bridge.dispatcher import METHODS
    # importing the module registered the methods
    import forensics_bridge.extractors.wechat_pc  # noqa: F401
    for name in ("wechat_v4.find_account", "wechat_v4.extract_key", "wechat_v4.collect"):
        assert name in METHODS
