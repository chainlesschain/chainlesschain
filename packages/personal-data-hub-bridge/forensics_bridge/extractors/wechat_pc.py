"""WeChat 4.x (Weixin.exe) desktop local-DB decryptor + collector.

Personal data recovery for the user's OWN WeChat data on their OWN machine —
the same capability the project already ships for Android WeChat (frida key
extraction) and WeChat 3.x PC, extended to the 4.0 rewrite.

WeChat 4.0 facts (verified end-to-end against a real install):
  - DBs live under  ~/Documents/xwechat_files/<wxid>_<n>/db_storage/
        message/message_*.db   — per-conversation message tables Msg_<md5(user)>
        contact/contact.db     — contacts
  - Encryption = SQLCipher 4 (AES-256-CBC, page 4096, HMAC-SHA512,
    PBKDF2-HMAC-SHA512). WCDB uses a RAW 32-byte key (no passphrase KDF).
  - The 32-byte key is cached in Weixin.exe memory as the ASCII string
        x'<64 hex key><32 hex salt>'
    where the 16-byte salt == the first 16 bytes of each DB file. We anchor
    the memory scan on a DB's own salt, so the match is self-validating, and
    confirm the recovered key by a per-page HMAC-SHA512 check.
  - message_content is plaintext for text messages (local_type=1) and
    zstd-compressed for some system/media messages (best-effort; needs the
    optional `zstandard` dep — text messages need nothing beyond stdlib +
    `cryptography`).

Methods:
    wechat_v4.find_account   → locate xwechat_files account dir(s)
    wechat_v4.extract_key    → recover the SQLCipher key from Weixin.exe memory
    wechat_v4.collect        → discover → key → decrypt → parse messages/contacts

Windows-only (memory scan via ReadProcessMemory). On other platforms the
methods raise PLATFORM_UNSUPPORTED.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    from ..dispatcher import IpcError, register
except ImportError:  # allow standalone `python wechat_pc.py` execution
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
RESERVE = 16 + 64  # IV(16) + HMAC-SHA512(64), already a multiple of 16
HMAC_KDF_ITER = 2  # SQLCipher4 fast HMAC-subkey derivation
# SQLCipher derives the HMAC subkey at the encryption-key length (32), NOT the
# SHA-512 digest length — verified against a real WeChat 4.0 DB (dklen=64 fails
# the per-page HMAC, dklen=32 passes).
HMAC_DKLEN = 32


# ─── SQLCipher 4 decryption (raw key) ──────────────────────────────────────

def _derive_hmac_key(enc_key: bytes, salt: bytes) -> bytes:
    mac_salt = bytes(b ^ 0x3A for b in salt)
    return hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, HMAC_KDF_ITER, dklen=HMAC_DKLEN)


def _aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    # Imported lazily so `find_account` works even without `cryptography`.
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return dec.update(data) + dec.finalize()


def verify_key(raw_db_head: bytes, enc_key: bytes) -> bool:
    """Return True if enc_key decrypts page 1 with a valid HMAC."""
    if len(raw_db_head) < PAGE or len(enc_key) != 32:
        return False
    salt = raw_db_head[:16]
    hmac_key = _derive_hmac_key(enc_key, salt)
    body = raw_db_head[16:PAGE]
    content = body[: len(body) - RESERVE]
    reserve = body[len(body) - RESERVE :]
    iv = reserve[:16]
    stored = reserve[16 : 16 + 64]
    h = hmac.new(hmac_key, content + iv + (1).to_bytes(4, "little"), hashlib.sha512).digest()
    return hmac.compare_digest(h, stored)


def decrypt_db_to_file(raw_db: bytes, enc_key: bytes, out_path: str) -> Dict[str, Any]:
    """Decrypt a full SQLCipher-4 DB into a plaintext SQLite file."""
    salt = raw_db[:16]
    hmac_key = _derive_hmac_key(enc_key, salt)
    npages = len(raw_db) // PAGE
    out = bytearray()
    out += b"SQLite format 3\x00"
    hmac_fail = 0
    for i in range(npages):
        page = raw_db[i * PAGE : (i + 1) * PAGE]
        off = 16 if i == 0 else 0
        body = page[off:]
        content = body[: len(body) - RESERVE]
        reserve = body[len(body) - RESERVE :]
        iv = reserve[:16]
        stored = reserve[16 : 16 + 64]
        h = hmac.new(hmac_key, content + iv + (i + 1).to_bytes(4, "little"), hashlib.sha512).digest()
        if not hmac.compare_digest(h, stored):
            hmac_fail += 1
        out += _aes_cbc_decrypt(enc_key, iv, content)
        out += b"\x00" * RESERVE  # keep the reserve area (header byte 20 = 80)
    with open(out_path, "wb") as f:
        f.write(out)
    return {"pages": npages, "hmacFailures": hmac_fail, "out": out_path}


# ─── discovery ─────────────────────────────────────────────────────────────

def _xwechat_root() -> Path:
    return Path.home() / "Documents" / "xwechat_files"


def find_accounts() -> List[Dict[str, Any]]:
    root = _xwechat_root()
    accounts: List[Dict[str, Any]] = []
    if not root.is_dir():
        return accounts
    for child in sorted(root.iterdir()):
        if not child.is_dir() or not child.name.startswith("wxid_"):
            continue
        storage = child / "db_storage"
        if not storage.is_dir():
            continue
        msg_dir = storage / "message"
        message_dbs = sorted(str(p) for p in msg_dir.glob("message_*.db")) if msg_dir.is_dir() else []
        # 公众号 messages live in biz_message_*.db (SAME Msg_<md5> schema).
        biz_dbs = sorted(str(p) for p in msg_dir.glob("biz_message_*.db")) if msg_dir.is_dir() else []
        contact_db = storage / "contact" / "contact.db"
        sns_db = storage / "sns" / "sns.db"           # 朋友圈
        favorite_db = storage / "favorite" / "favorite.db"  # 收藏
        accounts.append({
            "id": child.name.rsplit("_", 1)[0],
            "root": str(child),
            "messageDbs": message_dbs,
            "bizDbs": biz_dbs,
            "contactDb": str(contact_db) if contact_db.exists() else None,
            "snsDb": str(sns_db) if sns_db.exists() else None,
            "favoriteDb": str(favorite_db) if favorite_db.exists() else None,
        })
    return accounts


# ─── key extraction from Weixin.exe memory (Windows) ───────────────────────

def _largest_weixin_pid() -> Optional[int]:
    import subprocess
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-Process Weixin -ErrorAction SilentlyContinue | "
             "Sort-Object WorkingSet64 -Descending | "
             "Select-Object -First 1 -ExpandProperty Id"],
            capture_output=True, text=True, timeout=15,
        )
        s = out.stdout.strip()
        return int(s) if s else None
    except Exception:
        return None


_HEXSET = frozenset(b"0123456789abcdefABCDEF")


def _scan_regions(pid):
    """Yield the raw bytes of each readable committed region of `pid`.

    Windows-only. Opens the process once, walks the address space via
    VirtualQueryEx, reads each readable committed region (<=256 MiB).
    """
    if sys.platform != "win32":
        raise IpcError("PLATFORM_UNSUPPORTED", "key extraction is Windows-only")
    import ctypes
    import ctypes.wintypes as wt

    class MBI(ctypes.Structure):
        _fields_ = [
            ("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
            ("AllocationProtect", wt.DWORD), ("RegionSize", ctypes.c_size_t),
            ("State", wt.DWORD), ("Protect", wt.DWORD), ("Type", wt.DWORD),
        ]

    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x0400 | 0x0010, False, pid)  # QUERY_INFORMATION | VM_READ
    if not h:
        raise IpcError("EXTRACT_PERMISSION_DENIED",
                       f"OpenProcess({pid}) failed (err={ctypes.get_last_error()})")
    mbi = MBI()
    addr = 0
    readable = {0x02, 0x04, 0x20, 0x40}
    try:
        while addr < 0x7FFFFFFFFFFF:
            if not k.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
                break
            base = mbi.BaseAddress or 0
            size = mbi.RegionSize
            if (mbi.State == 0x1000 and (mbi.Protect & 0xFF) in readable
                    and not (mbi.Protect & 0x100) and 0 < size <= 256 * 1024 * 1024):
                buf = ctypes.create_string_buffer(size)
                n = ctypes.c_size_t(0)
                if k.ReadProcessMemory(h, ctypes.c_void_p(base), buf, size, ctypes.byref(n)) and n.value:
                    yield buf.raw[: n.value]
            addr = base + size
            if size == 0:
                break
    finally:
        k.CloseHandle(h)


def extract_keys_for_salts(salts_hex, pid=None):
    """One memory pass → {salt_hex: key_hex} for the requested DB salts.

    WeChat 4.0 uses a PER-DB key: each DB has its own random salt AND its own
    32-byte key, both cached in memory as the 64+32 hex run `<key><salt>`. We
    anchor on each DB's own salt and read the 64 hex chars immediately before
    it. One scan resolves every DB's key (verified self-consistently by the
    caller via verify_key).
    """
    targets = {s.lower().encode("ascii") for s in salts_hex}
    if not targets:
        return {}
    if pid is None:
        pid = _largest_weixin_pid()
    if not pid:
        raise IpcError("APP_NOT_RUNNING", "Weixin.exe is not running — open WeChat and log in first")
    found = {}
    for data in _scan_regions(pid):
        if not targets:
            break
        for salt_b in list(targets):
            idx = 0
            while True:
                j = data.find(salt_b, idx)
                if j < 0:
                    break
                if j >= 64:
                    keyhex = data[j - 64:j]
                    if all(c in _HEXSET for c in keyhex):
                        found[salt_b.decode()] = keyhex.decode("ascii").lower()
                        targets.discard(salt_b)
                        break
                idx = j + 1
    return found


def extract_key_from_memory(db_salt: bytes, pid: Optional[int] = None) -> Optional[str]:
    """Scan Weixin.exe memory for the key anchored by db_salt. Returns hex or None."""
    return extract_keys_for_salts([db_salt.hex()], pid).get(db_salt.hex().lower())


# ─── message parsing (decrypted plaintext) ─────────────────────────────────

def _strip_group_prefix(content: str) -> Tuple[Optional[str], str]:
    """Group msgs are stored as 'wxid_xxx:\\n<text>'. Split sender + text."""
    idx = content.find(":\n")
    if 0 < idx < 80 and (content[:idx].startswith("wxid_") or content[:idx].endswith("@chatroom")):
        return content[:idx], content[idx + 2 :]
    return None, content


_ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"

import re as _re2

_RE_APP_TITLE = _re2.compile(r"<title>(.*?)</title>", _re2.DOTALL)
_RE_APP_DES = _re2.compile(r"<des>(.*?)</des>", _re2.DOTALL)
_RE_APP_URL = _re2.compile(r"<url>(.*?)</url>", _re2.DOTALL)
_RE_SYS_CONTENT = _re2.compile(r"<content>(.*?)</content>", _re2.DOTALL)

# base local_type → human label for non-text messages
_BASE_LABELS = {
    3: "图片", 34: "语音", 42: "名片", 43: "视频", 47: "表情",
    48: "位置", 50: "通话", 62: "小视频", 2000: "转账", 2001: "红包",
}
# appmsg (type 49) subtype → label (subtype = local_type >> 32)
_APPMSG_SUBLABELS = {
    5: "链接", 6: "文件", 8: "表情", 17: "实时位置", 19: "合并转发",
    21: "运动", 33: "小程序", 36: "小程序", 40: "收藏转发", 51: "视频号",
    57: "引用", 63: "视频号直播", 2000: "转账", 2001: "红包",
}


def _humanize_message(local_type, content):
    """Turn a non-text WeChat message into readable text + structured hints.

    Returns (text, base_type, app_subtype, url). WeChat 4.0 packs the appmsg
    subtype into the high 32 bits of local_type: base = lt & 0xffffffff,
    subtype = lt >> 32.
    """
    base = local_type & 0xFFFFFFFF if isinstance(local_type, int) else local_type
    sub = (local_type >> 32) if isinstance(local_type, int) else None
    s = content if isinstance(content, str) else ""
    if base == 49:
        title = _xml_first(_RE_APP_TITLE, s)
        des = _xml_first(_RE_APP_DES, s)
        url = _xml_first(_RE_APP_URL, s)
        label = _APPMSG_SUBLABELS.get(sub, "应用消息")
        body = title or des or ""
        text = f"[{label}] {body}".strip() if body else f"[{label}]"
        return text, base, sub, url
    if base == 10000:
        c = _xml_first(_RE_SYS_CONTENT, s)
        return (c or "[系统消息]"), base, None, None
    label = _BASE_LABELS.get(base)
    if label:
        return f"[{label}]", base, None, None
    return None, base, None, None


def _zstd_decompressor():
    try:
        import zstandard
        return zstandard.ZstdDecompressor()
    except Exception:
        return None


def _display_name(name_map, wxid):
    if name_map and wxid:
        entry = name_map.get(wxid)
        if entry and entry.get("displayName"):
            return entry["displayName"]
    return wxid


def parse_plaintext_message_db(plain_path: str, limit: int = 50000, name_map: Optional[Dict[str, Any]] = None, source: str = "chat") -> Dict[str, Any]:
    import sqlite3
    con = sqlite3.connect(plain_path)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    dctx = _zstd_decompressor()
    # rowid -> user_name (sender / conversation identities)
    id2name: Dict[int, str] = {}
    name_by_md5: Dict[str, str] = {}
    try:
        cur.execute("SELECT rowid, user_name FROM Name2Id")
        for rid, uname in cur.fetchall():
            if uname:
                id2name[rid] = uname
                name_by_md5[hashlib.md5(uname.encode()).hexdigest()] = uname
    except sqlite3.Error:
        pass

    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'")
    msg_tables = [r[0] for r in cur.fetchall()]
    messages: List[Dict[str, Any]] = []
    compressed_decoded = 0
    compressed_failed = 0
    for t in msg_tables:
        if len(messages) >= limit:
            break
        conv = name_by_md5.get(t[len("Msg_"):])
        try:
            cur.execute(
                f"SELECT local_id, server_id, local_type, real_sender_id, create_time, "
                f"message_content, WCDB_CT_message_content FROM '{t}' ORDER BY create_time DESC"
            )
        except sqlite3.Error:
            continue
        for row in cur.fetchall():
            if len(messages) >= limit:
                break
            local_id, server_id, mtype, sender_id, ctime, content, ct_marker = row
            # Resolve the content body to a string (plain TEXT col, or zstd BLOB).
            body = None
            if isinstance(content, str):
                body = content
            elif isinstance(content, (bytes, bytearray)):
                if content[:4] == _ZSTD_MAGIC:
                    if dctx is None:
                        compressed_failed += 1
                        continue
                    try:
                        body = dctx.decompress(content).decode("utf-8", "replace")
                        compressed_decoded += 1
                    except Exception:
                        compressed_failed += 1
                        continue
                # else: non-zstd binary → body stays None
            # Strip the "wxid:\n" group prefix that precedes ALL message kinds
            # in group chats, then interpret by type.
            if body is not None:
                _sender_in_text, body = _strip_group_prefix(body)
            base = mtype & 0xFFFFFFFF if isinstance(mtype, int) else mtype
            app_sub = (mtype >> 32) if isinstance(mtype, int) and mtype > 0xFFFFFFFF else None
            app_url = None
            raw_content = None
            if base == 1:
                text = body  # plain text
            else:
                text, base, app_sub, app_url = _humanize_message(mtype, body or "")
                raw_content = body  # keep the XML for downstream richer parsing
            sender = id2name.get(sender_id) if sender_id else None
            msg = {
                "conversation": conv,
                "conversationName": _display_name(name_map, conv),
                "sender": sender,
                "senderName": _display_name(name_map, sender),
                "senderId": sender_id,
                "type": base,            # normalized base type (not the composite)
                "appType": app_sub,      # appmsg subtype for type 49
                "appUrl": app_url,       # link/article url for type 49
                "createTime": ctime,     # seconds
                "text": text,
                "rawContent": raw_content,
                "source": source,        # chat | biz
                "originalId": f"wechat-pc:{conv or t}:{server_id or local_id}",
            }
            messages.append(msg)
    con.close()
    return {
        "messageTables": len(msg_tables),
        "messageCount": len(messages),
        "compressedDecoded": compressed_decoded,
        "compressedFailed": compressed_failed,
        "messages": messages,
    }


def parse_contact_db(plain_path: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Read contact.db → (name_map, contacts).

    name_map: wxid -> {nickname, remark, alias, displayName}
              (displayName priority: remark > nick_name > alias > wxid)
    contacts: list of {wxid, nickname, remark, alias, type}
    """
    import sqlite3
    name_map: Dict[str, Any] = {}
    contacts: List[Dict[str, Any]] = []
    con = sqlite3.connect(plain_path)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    try:
        cur.execute(
            "SELECT username, alias, remark, nick_name, local_type FROM contact"
        )
    except sqlite3.Error:
        con.close()
        return name_map, contacts
    for uname, alias, remark, nick, ltype in cur.fetchall():
        if not uname:
            continue
        alias = alias or None
        remark = remark or None
        nick = nick or None
        display = remark or nick or alias or uname
        name_map[uname] = {
            "nickname": nick,
            "remark": remark,
            "alias": alias,
            "displayName": display,
        }
        contacts.append({
            "wxid": uname,
            "nickname": nick,
            "remark": remark,
            "alias": alias,
            "type": ltype if isinstance(ltype, int) else None,
        })
    con.close()
    return name_map, contacts


import re as _re

_RE_CONTENT_DESC = _re.compile(r"<contentDesc>(.*?)</contentDesc>", _re.DOTALL)
_RE_CREATE_TIME = _re.compile(r"<createTime>(\d+)</createTime>")
_RE_FAV_TITLE = _re.compile(r"<title>(.*?)</title>", _re.DOTALL)
_RE_FAV_DESC = _re.compile(r"<desc>(.*?)</desc>", _re.DOTALL)


def _xml_first(rx, s):
    if not isinstance(s, str):
        return None
    m = rx.search(s)
    return m.group(1).strip() if m else None


def parse_sns_db(plain_path: str, name_map: Optional[Dict[str, Any]] = None, limit: int = 20000) -> List[Dict[str, Any]]:
    """朋友圈 — SnsTimeLine rows → moments [{poster, posterName, text, createTime, rawXml, originalId}].

    Content is a <SnsDataItem><TimelineObject> XML; we pull <contentDesc>
    (post text) + <createTime> best-effort, preserving the raw XML.
    """
    import sqlite3
    moments: List[Dict[str, Any]] = []
    con = sqlite3.connect(plain_path)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    try:
        cur.execute("SELECT tid, user_name, content FROM SnsTimeLine")
    except sqlite3.Error:
        con.close()
        return moments
    for tid, user_name, content in cur.fetchall():
        if len(moments) >= limit:
            break
        text = _xml_first(_RE_CONTENT_DESC, content)
        ct = _xml_first(_RE_CREATE_TIME, content)
        moments.append({
            "poster": user_name,
            "posterName": _display_name(name_map, user_name),
            "text": text,
            "createTime": int(ct) if ct and ct.isdigit() else None,
            "rawXml": content if isinstance(content, str) else None,
            "originalId": f"wechat-pc:sns:{tid}",
        })
    con.close()
    return moments


def parse_favorite_db(plain_path: str, limit: int = 20000) -> List[Dict[str, Any]]:
    """收藏 — fav_db_item rows → favorites [{type, updateTime, title, rawXml, originalId}]."""
    import sqlite3
    favs: List[Dict[str, Any]] = []
    con = sqlite3.connect(plain_path)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    try:
        cur.execute("SELECT local_id, server_id, type, update_time, content FROM fav_db_item")
    except sqlite3.Error:
        con.close()
        return favs
    for local_id, server_id, ftype, utime, content in cur.fetchall():
        if len(favs) >= limit:
            break
        title = _xml_first(_RE_FAV_TITLE, content) or _xml_first(_RE_FAV_DESC, content)
        favs.append({
            "type": ftype if isinstance(ftype, int) else None,
            "updateTime": utime if isinstance(utime, int) else None,
            "title": title,
            "rawXml": content if isinstance(content, str) else None,
            "originalId": f"wechat-pc:fav:{server_id or local_id}",
        })
    con.close()
    return favs


# ─── registered methods ────────────────────────────────────────────────────

@register("wechat_v4.find_account")
def m_find_account(params, _progress, _chunk):
    return {"accounts": find_accounts()}


@register("wechat_v4.extract_key")
def m_extract_key(params, _progress, _chunk):
    db_path = params.get("db_path")
    if not db_path:
        accts = find_accounts()
        if not accts or not accts[0]["messageDbs"]:
            raise IpcError("APP_NOT_INSTALLED", "no WeChat 4.x message DB found")
        db_path = accts[0]["messageDbs"][0]
    with open(db_path, "rb") as f:
        head = f.read(PAGE)
    salt = head[:16]
    key = extract_key_from_memory(salt, params.get("pid"))
    if not key:
        raise IpcError("KEY_NOT_FOUND", "key not found in Weixin.exe memory (is WeChat open + logged in?)")
    if not verify_key(head, bytes.fromhex(key)):
        raise IpcError("KEY_VERIFY_FAILED", "recovered key failed HMAC verification")
    return {"key": key, "dbPath": db_path, "salt": salt.hex()}


@register("wechat_v4.collect")
def m_collect(params, progress, _chunk):
    import tempfile
    # Default is effectively "everything" (越完整越好) — a real full history is
    # tens of thousands of messages. The cap only guards against runaway memory
    # on extreme accounts; callers can pass a smaller `limit` for a quick probe.
    limit = int(params.get("limit") or 1_000_000)
    accts = find_accounts()
    if not accts:
        raise IpcError("APP_NOT_INSTALLED", "no WeChat 4.x account found under xwechat_files")
    acct = accts[0]
    if not acct["messageDbs"]:
        raise IpcError("DB_NOT_FOUND", "account has no message_*.db")

    # WeChat 4.0 uses a PER-DB key. Collect the salt of EVERY DB we'll open
    # (chat + 公众号 biz + contact + 朋友圈 sns + 收藏 favorite) and resolve
    # them all in ONE memory scan.
    contact_db = acct.get("contactDb")
    biz_dbs = acct.get("bizDbs") or []
    sns_db = acct.get("snsDb")
    favorite_db = acct.get("favoriteDb")
    every_db = (
        list(acct["messageDbs"]) + list(biz_dbs)
        + ([contact_db] if contact_db else [])
        + ([sns_db] if sns_db else [])
        + ([favorite_db] if favorite_db else [])
    )
    salt_to_db = {}
    salts = []
    for dbp in every_db:
        try:
            with open(dbp, "rb") as f:
                s = f.read(16).hex().lower()
            salt_to_db[dbp] = s
            salts.append(s)
        except OSError:
            pass

    provided = params.get("key")
    if provided:
        # Back-compat single-key override (applies to all DBs of the account).
        keymap = {s: provided for s in salts}
    else:
        try:
            progress(phase="extract-keys", count=len(salts))
        except Exception:
            pass
        keymap = extract_keys_for_salts(salts, params.get("pid"))
        if not keymap:
            raise IpcError("KEY_NOT_FOUND", "no DB key found in Weixin.exe memory (is WeChat open + logged in?)")

    staging = params.get("staging_dir") or tempfile.mkdtemp(prefix="wxpc_")
    Path(staging).mkdir(parents=True, exist_ok=True)

    def _open_db(dbp):
        """Read+verify+decrypt one DB → plaintext path, or (None, reason)."""
        salt = salt_to_db.get(dbp)
        key = keymap.get(salt) if salt else None
        if not key:
            return None, "KEY_NOT_FOUND"
        with open(dbp, "rb") as f:
            raw = f.read()
        if not verify_key(raw[:PAGE], bytes.fromhex(key)):
            return None, "KEY_VERIFY_FAILED"
        plain = os.path.join(staging, os.path.basename(dbp) + ".plain")
        rep = decrypt_db_to_file(raw, bytes.fromhex(key), plain)
        return (plain, rep), None

    # ── contact.db first → name map + contacts (best-effort) ──
    name_map: Dict[str, Any] = {}
    contacts: List[Dict[str, Any]] = []
    if contact_db:
        try:
            progress(phase="decrypt", db=os.path.basename(contact_db))
        except Exception:
            pass
        opened, reason = _open_db(contact_db)
        if opened:
            cplain, _crep = opened
            try:
                name_map, contacts = parse_contact_db(cplain)
            finally:
                try:
                    os.remove(cplain)
                except OSError:
                    pass

    # ── chat + 公众号(biz) message DBs (same Msg_<md5> schema) ──
    all_messages: List[Dict[str, Any]] = []
    db_reports = []
    msg_sources = [(dbp, "chat") for dbp in acct["messageDbs"]] + [(dbp, "biz") for dbp in biz_dbs]
    for i, (dbp, src) in enumerate(msg_sources):
        if len(all_messages) >= limit:
            break
        try:
            progress(phase="decrypt", db=os.path.basename(dbp), index=i)
        except Exception:
            pass
        opened, reason = _open_db(dbp)
        if not opened:
            db_reports.append({"db": os.path.basename(dbp), "source": src, "error": reason})
            continue
        plain, rep = opened
        try:
            parsed = parse_plaintext_message_db(
                plain, limit=limit - len(all_messages), name_map=name_map, source=src
            )
        finally:
            try:
                os.remove(plain)
            except OSError:
                pass
        all_messages.extend(parsed["messages"])
        db_reports.append({
            "db": os.path.basename(dbp),
            "source": src,
            "messageTables": parsed["messageTables"],
            "messageCount": parsed["messageCount"],
            "compressedDecoded": parsed["compressedDecoded"],
            "compressedFailed": parsed["compressedFailed"],
            "hmacFailures": rep["hmacFailures"],
        })

    # ── 朋友圈 (sns) → map moments into the message stream (source="sns") ──
    # Independent of the chat message `limit` (朋友圈 is a small, distinct set
    # that shouldn't be starved by a large chat history).
    moment_count = 0
    if sns_db:
        opened, _r = _open_db(sns_db)
        if opened:
            splain, _srep = opened
            try:
                for m in parse_sns_db(splain, name_map=name_map):
                    all_messages.append({
                        "conversation": "sns:朋友圈",
                        "conversationName": "朋友圈",
                        "sender": m["poster"],
                        "senderName": m["posterName"],
                        "senderId": None,
                        "type": 1,
                        "createTime": m["createTime"],
                        "text": m["text"],
                        "source": "sns",
                        "originalId": m["originalId"],
                    })
                    moment_count += 1
            finally:
                try:
                    os.remove(splain)
                except OSError:
                    pass

    # ── 收藏 (favorite) → map into the message stream (source="favorite") ──
    favorite_count = 0
    if favorite_db:
        opened, _r = _open_db(favorite_db)
        if opened:
            fplain, _frep = opened
            try:
                for fav in parse_favorite_db(fplain):
                    all_messages.append({
                        "conversation": "favorite:收藏",
                        "conversationName": "收藏",
                        "sender": acct["id"],
                        "senderName": "我",
                        "senderId": None,
                        "type": fav["type"],
                        "createTime": fav["updateTime"],
                        "text": fav["title"],
                        "source": "favorite",
                        "originalId": fav["originalId"],
                    })
                    favorite_count += 1
            finally:
                try:
                    os.remove(fplain)
                except OSError:
                    pass

    return {
        "account": acct["id"],
        "messageCount": len(all_messages),
        "contactCount": len(contacts),
        "momentCount": moment_count,
        "favoriteCount": favorite_count,
        "dbs": db_reports,
        "contacts": contacts,
        "messages": all_messages,
    }


# ─── standalone CLI (verification without the IPC loop) ─────────────────────

if __name__ == "__main__":
    import json

    cmd = sys.argv[1] if len(sys.argv) > 1 else "find"
    if cmd == "find":
        print(json.dumps(find_accounts(), ensure_ascii=False, indent=2))
    elif cmd == "key":
        print(json.dumps(m_extract_key({}, None, None), ensure_ascii=False, indent=2))
    elif cmd == "collect":
        lim = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        res = m_collect({"limit": lim}, lambda **k: None, None)
        res_preview = {**res, "messages": res["messages"][:lim]}
        print(json.dumps(res_preview, ensure_ascii=False, indent=2))
    else:
        print("usage: wechat_pc.py [find|key|collect [limit]]")
