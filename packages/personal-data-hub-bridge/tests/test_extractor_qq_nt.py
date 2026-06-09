"""Deterministic round-trip tests for the QQ NT decryptor.

Builds a synthetic QQ-NT-shaped file (1024-byte preamble + SQLCipher pages)
with a known passphrase for each HMAC variant, then asserts decrypt_nt_msg
recovers the plaintext and auto-selects the right variant. No real QQ install
and no key extraction needed.
"""

from __future__ import annotations

import hashlib
import hmac
import os

import pytest

from forensics_bridge.extractors import qq_nt as qq

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    HAVE_CRYPTO = True
except Exception:  # pragma: no cover
    HAVE_CRYPTO = False

PAGE = qq.PAGE
PREAMBLE = qq.PREAMBLE


def _build_qq_file(passphrase: bytes, variant, n_data_pages: int = 2) -> tuple[bytes, bytes]:
    """Return (qq_file_bytes, expected_page1_plaintext_body)."""
    algo, ctor, digest, reserve = variant
    salt = os.urandom(16)
    enc_key, hmac_key = qq.derive_keys(passphrase, salt, ctor, qq.KEY_SZ)

    body = bytearray()
    expected_first_body = None
    for i in range(n_data_pages):
        plain_len = PAGE - (16 if i == 0 else 0) - reserve
        plain = os.urandom(plain_len)
        if i == 0:
            expected_first_body = plain
        iv = os.urandom(16)
        enc = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).encryptor()
        ct = enc.update(plain) + enc.finalize()
        h = hmac.new(hmac_key, ct + iv + (i + 1).to_bytes(4, "little"), ctor).digest()
        page = bytearray()
        if i == 0:
            page += salt
        page += ct + iv + h
        page += b"\x00" * (PAGE - len(page))  # pad reserve tail to full page
        assert len(page) == PAGE
        body += page

    preamble = b"SQLite header 3\x00" + b"QQ_NT DB" + b"\x00" * (PREAMBLE - 24)
    return bytes(preamble) + bytes(body), bytes(expected_first_body)


@pytest.mark.skipif(not HAVE_CRYPTO, reason="cryptography not installed")
@pytest.mark.parametrize("variant", qq.HMAC_VARIANTS, ids=lambda v: v[0])
def test_decrypt_roundtrip_each_hmac_variant(variant):
    passphrase = os.urandom(16)
    qq_file, expected_body = _build_qq_file(passphrase, variant)
    plaintext, used_variant = qq.decrypt_nt_msg(qq_file, passphrase)
    assert used_variant == variant[0]
    assert plaintext[:16] == b"SQLite format 3\x00"
    assert plaintext[16 : 16 + len(expected_body)] == expected_body


@pytest.mark.skipif(not HAVE_CRYPTO, reason="cryptography not installed")
def test_wrong_key_fails_verification():
    passphrase = os.urandom(16)
    qq_file, _ = _build_qq_file(passphrase, qq.HMAC_VARIANTS[0])
    with pytest.raises(qq.IpcError):
        qq.decrypt_nt_msg(qq_file, os.urandom(16))


def test_m_decrypt_key_routing(monkeypatch, tmp_path):
    # m_decrypt must accept the qq-win-db-key ASCII passphrase (e.g.
    # "5{sww#,6aq=)8=A@") via params.passphrase, and auto-route params.key:
    # even-length hex -> from_hex, otherwise ASCII. Capture the passphrase bytes
    # that reach decrypt_nt_msg (verified end-to-end on real data separately).
    captured = {}
    fake = tmp_path / "nt_msg.db"; fake.write_bytes(b"\x00" * (qq.PREAMBLE + qq.PAGE))
    def fake_decrypt(raw, passphrase):
        captured["pp"] = passphrase
        return (b"SQLite format 3\x00", "sha1")
    monkeypatch.setattr(qq, "decrypt_nt_msg", fake_decrypt)
    import sqlite3
    monkeypatch.setattr(sqlite3, "connect", lambda *_a, **_k: (_ for _ in ()).throw(sqlite3.Error("skip")))

    # ASCII passphrase
    try:
        qq.m_decrypt({"passphrase": "5{sww#,6aq=)8=A@", "db_path": str(fake)}, lambda *a: None, None)
    except Exception:
        pass
    assert captured["pp"] == b"5{sww#,6aq=)8=A@"

    # hex key -> decoded
    captured.clear()
    try:
        qq.m_decrypt({"key": "00ff10ab", "db_path": str(fake)}, lambda *a: None, None)
    except Exception:
        pass
    assert captured["pp"] == bytes.fromhex("00ff10ab")

    # non-hex string in `key` -> treated as ASCII passphrase
    captured.clear()
    try:
        qq.m_decrypt({"key": "#8abc@uJ", "db_path": str(fake)}, lambda *a: None, None)
    except Exception:
        pass
    assert captured["pp"] == b"#8abc@uJ"


def test_preamble_alignment_guard():
    # body not page-aligned after the 1024 preamble → BAD_LAYOUT
    bad = b"\x00" * (PREAMBLE + 100)
    with pytest.raises(qq.IpcError):
        qq.decrypt_nt_msg(bad, b"\x00" * 16)


def test_find_accounts_never_throws(monkeypatch, tmp_path):
    monkeypatch.setattr(qq.Path, "home", staticmethod(lambda: tmp_path))
    assert qq.find_accounts() == []


def test_registered():
    import forensics_bridge.extractors.qq_nt  # noqa: F401
    from forensics_bridge.dispatcher import METHODS
    assert "qq_nt.decrypt" in METHODS
    assert "qq_nt.find_account" in METHODS


def _pb_str_field(field_num, text):
    # protobuf wire-type 2 (length-delimited) string field
    key = (field_num << 3) | 2
    body = text.encode("utf-8")
    return bytes([key, len(body)]) + body


def test_extract_text_from_protobuf_body():
    # nested message containing the message text + a uid + the sender name
    inner = _pb_str_field(1, "u_abcDEF123") + _pb_str_field(2, "保持高贵的沉默。")
    blob = _pb_str_field(3, "疯子") + bytes([(5 << 3) | 2, len(inner)]) + inner
    text = qq._extract_text(blob, "疯子")
    assert text == "保持高贵的沉默。"          # longest non-uid, non-name string
    assert qq._extract_text(b"", "x") is None
    assert qq._extract_text(None, "x") is None


def test_parse_qq_messages_reads_both_tables(tmp_path):
    import sqlite3
    p = tmp_path / "nt.plain.db"
    con = sqlite3.connect(str(p)); cur = con.cursor()
    for table in ("c2c_msg_table", "group_msg_table"):
        cur.execute(
            f"CREATE TABLE `{table}` (`40050` INTEGER, `40030` INTEGER, `40033` INTEGER, "
            f"`40020` TEXT, `40093` TEXT, `40090` TEXT, `40040` INTEGER, `40800` BLOB, `40003` INTEGER)"
        )
    body = _pb_str_field(1, "u_peer") + _pb_str_field(2, "今天天气不错")
    cur.execute("INSERT INTO group_msg_table VALUES (1700000100, 38181604, 88966001, 'u_peer', '疯子', '', 0, ?, 7)", (body,))
    cur.execute("INSERT INTO c2c_msg_table VALUES (1700000000, 111, 222, 'u_x', '张三', '', 0, ?, 3)",
                (_pb_str_field(2, "在吗"),))
    con.commit(); con.close()
    msgs = qq.parse_qq_messages(str(p))
    assert len(msgs) == 2
    g = next(m for m in msgs if m["kind"] == "group")
    assert g["text"] == "今天天气不错"
    assert g["senderName"] == "疯子"
    assert g["peer"] == 88966001
    assert g["originalId"] == "qq-pc:group:88966001:7"
    c = next(m for m in msgs if m["kind"] == "c2c")
    assert c["text"] == "在吗"
