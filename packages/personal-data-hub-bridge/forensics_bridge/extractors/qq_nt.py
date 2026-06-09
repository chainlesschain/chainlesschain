"""QQ NT (desktop) nt_msg.db SQLCipher decryptor — personal data recovery.

Structurally verified against a real nt_msg.db on Windows:
  - The file begins with a 1024-byte PLAINTEXT preamble (ASCII magic
    "SQLite header 3\\0" + "QQ_NT DB" marker). The REAL SQLCipher database
    starts at byte 1024 — confirmed by (filesize - 1024) % 4096 == 0, with the
    random SQLCipher salt at bytes[1024:1040].
  - SQLCipher params (QQ NT): page 4096, kdf_iter = 4000, AES-256-CBC,
    PBKDF2-HMAC-SHA512 key derivation. The per-page HMAC algorithm changed
    from HMAC-SHA1 (pre 2024-12) to HMAC-SHA512 (2024-12+) — we try both and
    keep whichever validates.
  - The key is a 16-byte PASSPHRASE (not a raw key): SQLCipher derives the
    32-byte AES key via PBKDF2-HMAC-SHA512(passphrase, salt, kdf_iter).

KEY EXTRACTION IS NOT AUTOMATED HERE (unlike WeChat 4.0, whose key sits in
process memory as a salt-anchored string). QQ NT's key is read from the live
QQ.exe via a debugger breakpoint at nt_sqlite3_key_v2 (version-specific
offset) — see QQBackup/qq-win-db-key. Provide the recovered 16-byte key as
hex (params.key) and this module does the rest. Auto-extraction is a tracked
follow-up.

⚠️ The decrypt math is verified by a synthetic SQLCipher round-trip
(tests/test_extractor_qq_nt.py). End-to-end against a real nt_msg.db awaits a
recovered key + a running QQ NT (the message-table schema — numeric-obfuscated
columns + protobuf bodies — is decoded once a real plaintext sample exists).
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from ..dispatcher import IpcError, register
except ImportError:  # standalone execution
    def register(_name):  # type: ignore
        def deco(fn):
            return fn
        return deco

    class IpcError(Exception):  # type: ignore
        def __init__(self, code, message="", retryable=False):
            super().__init__(f"{code}: {message}")
            self.code = code
            self.message = message
            self.retryable = retryable


PAGE = 4096
PREAMBLE = 1024            # QQ NT plaintext preamble before the SQLCipher DB
KDF_ITER = 4000            # QQ NT main-key PBKDF2 iterations
FAST_KDF_ITER = 2          # SQLCipher HMAC-subkey derivation
KEY_SZ = 32

# (hmac_algo, hashlib_ctor, digest_size, reserve) — reserve = IV(16)+HMAC,
# rounded UP to a 16-byte multiple.
HMAC_VARIANTS = (
    ("sha512", hashlib.sha512, 64, 80),  # 16 + 64 = 80
    ("sha1", hashlib.sha1, 20, 48),      # 16 + 20 = 36 -> round up to 48
)


def derive_keys(passphrase: bytes, salt: bytes, hmac_ctor=None, hmac_dklen: int = KEY_SZ):
    # Main encryption key: PBKDF2-HMAC-SHA512(passphrase, salt, kdf_iter).
    enc_key = hashlib.pbkdf2_hmac("sha512", passphrase, salt, KDF_ITER, dklen=KEY_SZ)
    mac_salt = bytes(b ^ 0x3A for b in salt)
    # HMAC subkey: SQLCipher ALWAYS derives it with the cipher_kdf_algorithm
    # (PBKDF2-HMAC-SHA512), at the encryption-key length (32) — independent of
    # the per-page cipher_hmac_algorithm (which may be SHA1). Verified against a
    # real QQ NT nt_msg.db: subkey via SHA512 + per-page HMAC-SHA1 (reserve 48).
    hmac_key = hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, FAST_KDF_ITER, dklen=KEY_SZ)
    return enc_key, hmac_key


def _aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return dec.update(data) + dec.finalize()


def _try_variant(body: bytes, passphrase: bytes, variant) -> Optional[Tuple[bytes, str]]:
    """Decrypt `body` (SQLCipher region, salt at [:16]) with one HMAC variant.

    Returns (plaintext_bytes, variant_name) if the FIRST page HMAC validates,
    else None.
    """
    algo, ctor, digest, reserve = variant
    salt = body[:16]
    enc_key, hmac_key = derive_keys(passphrase, salt, ctor, KEY_SZ)
    npages = len(body) // PAGE
    if npages == 0:
        return None
    # validate page 1 only first (cheap)
    page1 = body[:PAGE]
    content = page1[16 : PAGE - reserve]
    iv = page1[PAGE - reserve : PAGE - reserve + 16]
    stored = page1[PAGE - reserve + 16 : PAGE - reserve + 16 + digest]
    h = hmac.new(hmac_key, content + iv + (1).to_bytes(4, "little"), ctor).digest()
    if not hmac.compare_digest(h, stored):
        return None
    # full decrypt
    out = bytearray(b"SQLite format 3\x00")
    for i in range(npages):
        page = body[i * PAGE : (i + 1) * PAGE]
        off = 16 if i == 0 else 0
        seg = page[off:]
        ct = seg[: len(seg) - reserve]
        iv_i = seg[len(seg) - reserve : len(seg) - reserve + 16]
        out += _aes_cbc_decrypt(enc_key, iv_i, ct)
        out += b"\x00" * reserve
    return bytes(out), algo


def decrypt_nt_msg(raw: bytes, passphrase: bytes) -> Tuple[bytes, str]:
    """Decrypt a full nt_msg.db. Returns (plaintext_bytes, hmac_variant)."""
    if len(raw) <= PREAMBLE:
        raise IpcError("DB_TOO_SMALL", "file shorter than the 1024-byte preamble")
    body = raw[PREAMBLE:]
    if len(body) % PAGE != 0:
        raise IpcError("BAD_LAYOUT", f"SQLCipher region not page-aligned (len={len(body)})")
    for variant in HMAC_VARIANTS:
        res = _try_variant(body, passphrase, variant)
        if res is not None:
            return res
    raise IpcError("KEY_VERIFY_FAILED",
                   "no HMAC variant validated — wrong key, or unsupported QQ NT build")


def _nt_db_dir() -> Optional[Path]:
    base = Path.home() / "Documents" / "Tencent Files"
    if not base.is_dir():
        return None
    for child in base.iterdir():
        if child.is_dir() and child.name.isdigit():
            nt_db = child / "nt_qq" / "nt_db"
            if (nt_db / "nt_msg.db").exists():
                return nt_db
    return None


def find_accounts() -> List[Dict[str, Any]]:
    nt_db = _nt_db_dir()
    if not nt_db:
        return []
    return [{
        "uin": nt_db.parent.parent.name,
        "ntDbDir": str(nt_db),
        "msgDb": str(nt_db / "nt_msg.db"),
    }]


# ─── message parsing (decrypted nt_msg.db) ─────────────────────────────────
#
# QQ NT message tables use numeric-obfuscated column names + a protobuf body.
# Verified against a real nt_msg.db:
#   40050 = send time (unix seconds)   40030 = sender uin
#   40033 = group code / c2c peer uin  40020 = peer uid (string "u_...")
#   40093 / 40090 = sender display name 40040 = msg type (0 = normal)
#   40800 = protobuf body (the text is a UTF-8 string element inside)

_MSG_COLS = ("40050", "40030", "40033", "40020", "40093", "40090", "40040", "40800", "40003")


def _varint(b, i):
    shift = 0
    res = 0
    while i < len(b):
        x = b[i]; i += 1
        res |= (x & 0x7F) << shift
        if not x & 0x80:
            return res, i
        shift += 7
        if shift > 63:
            return None, i
    return None, i


def _pb_collect_strings(buf, depth, acc):
    """Walk protobuf wire-format, collecting length-delimited fields that decode
    as printable UTF-8 (recursing into nested messages)."""
    if depth > 6:
        return
    i = 0
    n = len(buf)
    while i < n:
        key, i = _varint(buf, i)
        if key is None:
            break
        wt = key & 7
        if wt == 0:
            _, i = _varint(buf, i)
        elif wt == 2:
            ln, i = _varint(buf, i)
            if ln is None or ln < 0 or i + ln > n:
                break
            seg = buf[i:i + ln]; i += ln
            try:
                s = seg.decode("utf-8")
                # Accept only as a leaf string if EVERY char is printable or
                # ordinary whitespace. Nested protobuf messages decode with
                # control/tag bytes (e.g. \x0b, \x12) and are rejected here —
                # we still recurse into them below to reach their leaf strings.
                if s and all(c.isprintable() or c in "\t\n\r" for c in s):
                    acc.append(s)
            except Exception:
                pass
            if len(seg) >= 2:
                _pb_collect_strings(seg, depth + 1, acc)
        elif wt == 5:
            i += 4
        elif wt == 1:
            i += 8
        else:
            break


def _extract_text(blob, sender_name):
    """Pick the message text out of a QQ NT protobuf body (best-effort)."""
    if not isinstance(blob, (bytes, bytearray)):
        return None
    acc = []
    _pb_collect_strings(bytes(blob), 0, acc)
    cands = [
        s for s in acc
        if s and not s.startswith("u_") and s != sender_name and not s.isdigit()
        and any(ord(c) > 0x2E for c in s)
    ]
    return max(cands, key=len) if cands else None


def parse_qq_messages(plain_path, limit=50000):
    """Read c2c_msg_table + group_msg_table → readable messages."""
    import sqlite3
    con = sqlite3.connect(plain_path)
    con.text_factory = bytes
    cur = con.cursor()

    def _S(v):
        return v.decode("utf-8", "replace") if isinstance(v, (bytes, bytearray)) else v

    messages = []
    for table, kind in (("c2c_msg_table", "c2c"), ("group_msg_table", "group")):
        try:
            cur.execute(f"PRAGMA table_info('{table}')")
        except sqlite3.Error:
            continue
        have = {(r[1].decode() if isinstance(r[1], bytes) else r[1]) for r in cur.fetchall()}
        cols = [c for c in _MSG_COLS if c in have]
        if "40800" not in cols or "40050" not in cols:
            continue
        sel = ", ".join(f"`{c}`" for c in cols)
        try:
            cur.execute(f"SELECT {sel} FROM `{table}` ORDER BY `40050` DESC")
        except sqlite3.Error:
            continue
        idx = {c: i for i, c in enumerate(cols)}

        def g(row, c):
            return row[idx[c]] if c in idx else None

        for row in cur.fetchall():
            if len(messages) >= limit:
                break
            t = g(row, "40050")
            name = _S(g(row, "40093")) or _S(g(row, "40090"))
            text = _extract_text(g(row, "40800"), name)
            peer = g(row, "40033")
            msgid = g(row, "40003") or g(row, "40050")
            messages.append({
                "kind": kind,                       # c2c | group
                "peer": peer,                       # group code / c2c peer uin
                "peerUid": _S(g(row, "40020")),
                "senderUin": g(row, "40030"),
                "senderName": name,
                "type": g(row, "40040"),
                "createTime": t,                    # seconds
                "text": text,
                "originalId": f"qq-pc:{kind}:{peer}:{msgid}",
            })
    con.close()
    return messages


@register("qq_nt.find_account")
def m_find_account(params, _progress, _chunk):
    return {"accounts": find_accounts()}


@register("qq_nt.decrypt")
def m_decrypt(params, progress, _chunk):
    """Decrypt nt_msg.db with a provided key → plaintext SQLite + table inventory.

    Params:
        passphrase: the QQ NT key as the raw ASCII passphrase (qq-win-db-key
                    emits a 16-char string like "5{sww#,6aq=)8=A@").
        key:        alternatively the key as hex. If `key` is a valid even-length
                    hex string it's decoded from hex, otherwise treated as ASCII.
        db_path:    optional — defaults to the auto-discovered nt_msg.db.
        staging_dir:optional — where to write the plaintext db.
    """
    passphrase = _resolve_passphrase(params)

    db_path = params.get("db_path")
    if not db_path:
        accts = find_accounts()
        if not accts:
            raise IpcError("APP_NOT_INSTALLED", "no QQ NT nt_msg.db found")
        db_path = accts[0]["msgDb"]

    with open(db_path, "rb") as f:
        raw = f.read()
    plaintext, variant = decrypt_nt_msg(raw, passphrase)

    import tempfile
    staging = params.get("staging_dir") or tempfile.mkdtemp(prefix="qqnt_")
    Path(staging).mkdir(parents=True, exist_ok=True)
    out = os.path.join(staging, "nt_msg.plain.db")
    with open(out, "wb") as f:
        f.write(plaintext)

    # Inventory the tables so the message schema can be decoded from a real
    # sample (numeric-obfuscated columns + protobuf bodies — decoded next).
    import sqlite3
    con = sqlite3.connect(out)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = []
    for (name,) in cur.fetchall():
        try:
            cur.execute(f"SELECT COUNT(*) FROM '{name}'")
            cnt = cur.fetchone()[0]
        except sqlite3.Error:
            cnt = None
        tables.append({"name": name, "rows": cnt})
    con.close()
    return {"dbPath": db_path, "plain": out, "hmacVariant": variant, "tables": tables}


def _resolve_passphrase(params):
    """Resolve the QQ NT key from params.passphrase (ASCII) or params.key
    (even-length hex → from_hex, otherwise ASCII). Returns bytes or raises."""
    pp = params.get("passphrase")
    key_str = params.get("key")
    if isinstance(pp, str) and pp:
        return pp.encode("utf-8")
    if isinstance(key_str, str) and key_str:
        is_hex = len(key_str) % 2 == 0 and all(c in "0123456789abcdefABCDEF" for c in key_str)
        return bytes.fromhex(key_str) if is_hex else key_str.encode("utf-8")
    raise IpcError("KEY_REQUIRED",
                   "QQ NT key not provided — extract it with qq-win-db-key and pass params.passphrase (or params.key)")


@register("qq_nt.collect")
def m_collect(params, progress, _chunk):
    """Decrypt nt_msg.db + parse c2c/group messages into readable records.

    Params: passphrase | key (see _resolve_passphrase), db_path?, limit?
    Returns: { account, messageCount, c2c, group, messages: [...] }
    """
    import tempfile
    passphrase = _resolve_passphrase(params)
    limit = int(params.get("limit") or 200000)
    db_path = params.get("db_path")
    account = None
    if not db_path:
        accts = find_accounts()
        if not accts:
            raise IpcError("APP_NOT_INSTALLED", "no QQ NT nt_msg.db found")
        db_path = accts[0]["msgDb"]
        account = accts[0]["uin"]
    try:
        progress(phase="decrypt", db="nt_msg.db")
    except Exception:
        pass
    with open(db_path, "rb") as f:
        raw = f.read()
    plaintext, variant = decrypt_nt_msg(raw, passphrase)
    staging = params.get("staging_dir") or tempfile.mkdtemp(prefix="qqnt_")
    Path(staging).mkdir(parents=True, exist_ok=True)
    out = os.path.join(staging, "nt_msg.plain.db")
    with open(out, "wb") as f:
        f.write(plaintext)
    try:
        messages = parse_qq_messages(out, limit=limit)
    finally:
        try:
            os.remove(out)
        except OSError:
            pass
    c2c = sum(1 for m in messages if m["kind"] == "c2c")
    return {
        "account": account,
        "hmacVariant": variant,
        "messageCount": len(messages),
        "c2c": c2c,
        "group": len(messages) - c2c,
        "messages": messages,
    }


if __name__ == "__main__":
    import json
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "find"
    if cmd == "find":
        print(json.dumps(find_accounts(), ensure_ascii=False, indent=2))
    elif cmd == "decrypt" and len(sys.argv) > 2:
        print(json.dumps(m_decrypt({"key": sys.argv[2]}, lambda **k: None, None), ensure_ascii=False, indent=2))
    else:
        print("usage: qq_nt.py [find | decrypt <key-hex>]")
