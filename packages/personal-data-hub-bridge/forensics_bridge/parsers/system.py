"""System data parsers — Android contacts / call log / sms / wifi.

Phase 4.5.2 (contacts) + 4.5.3 (call log / sms / wifi).

Upstream: C:/code/sjqz/src/mobile_forensics/parsers/system.py (~964 LOC, MIT).
Forked & slimmed: pure data extraction, no CLI / search / statistics methods.

Output: UnifiedSchema NormalizedBatch dict mirroring
docs/design/Adapter_System_Data.md §3.

ID conventions (per design doc Adapter_System_Data.md §3):
    person:system:android:<raw_contact_id>      — known contact
    person:system:android:unknown:<phone>       — caller/sender absent from contacts
    person:self                                  — the device owner (hub-owned singleton)
    event:system:call:<call_id>
    event:system:sms:<sms_id>
    place:wifi:<ssid>

Stable across re-ingest of the same device's databases. EntityResolver
(Phase 8) re-canonicalizes Persons via merge_by_phone.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from ..dispatcher import IpcError, register


ADAPTER_NAME = "system-data"
ADAPTER_VERSION = "0.1.0"
DEFAULT_CHUNK_SIZE = 200  # emit a chunk every N persons

SELF_PERSON_ID = "person:self"

# Android CallLog.Calls.TYPE values (frameworks/base/.../CallLog.java)
_CALL_TYPE_NAMES = {
    1: "incoming",
    2: "outgoing",
    3: "missed",
    4: "voicemail",
    5: "rejected",
    6: "blocked",
    7: "answered_externally",
}

# Android Telephony.Sms.MESSAGE_TYPE_*
_SMS_TYPE_NAMES = {
    0: "all",
    1: "received",
    2: "sent",
    3: "draft",
    4: "outbox",
    5: "failed",
    6: "queued",
}

# SMS channel-type heuristics (per Adapter_System_Data.md §3.3).
# Allows up to 8 non-digit characters between the keyword and the code so
# real-world templates like "验证码为 123456" / "code is 9876" / "校验码: 4321"
# all match.
_VERIFICATION_RE = re.compile(
    r"(?:验证码|verification\s*code|动态码|校验码|短信验证码|otp)[^0-9\n]{0,8}(\d{4,8})",
    re.IGNORECASE,
)
_SERVICE_SENDER_RE = re.compile(r"^(95\d{3,5}|10\d{3,4}|400-?\d{3,7}|106\d{6,9})$")


# ---------------------------------------------------------------------------
# DB locator
# ---------------------------------------------------------------------------

_CONTACTS_DB_CANDIDATES = (
    "contacts2.db",
    "contacts.db",
)

_SMS_DB_CANDIDATES = (
    "mmssms.db",
    "sms.db",
    "telephony.db",
)

_CALLLOG_DB_CANDIDATES = (
    "calllog.db",
    "contacts2.db",  # pre-Android-11 stores `calls` table inside contacts2.db
    "calls.db",
)


def _find_contacts_db(data_path: Path) -> Optional[Path]:
    """Locate contacts2.db given either a file path or a directory.

    Accepts:
      - Direct path to the .db file.
      - Directory containing the .db file (recursive search for known names).
    """
    if data_path.is_file():
        return data_path

    if not data_path.exists():
        return None

    # First pass: shallow check at top-level + standard android dirs.
    for name in _CONTACTS_DB_CANDIDATES:
        direct = data_path / name
        if direct.is_file():
            return direct
        # ADB-backup-style layout: <pkg>/databases/<name>
        for subdir in ("databases", "com.android.providers.contacts/databases"):
            cand = data_path / subdir / name
            if cand.is_file():
                return cand

    # Last resort: recursive glob.
    for name in _CONTACTS_DB_CANDIDATES:
        try:
            for hit in data_path.rglob(name):
                if hit.is_file():
                    return hit
        except OSError:
            continue
    return None


def _find_db_by_candidates(
    data_path: Path,
    candidates: Tuple[str, ...],
    package_dirs: Tuple[str, ...] = (),
) -> Optional[Path]:
    """Generic DB locator. Tries direct → candidate dirs → rglob in order."""
    if data_path.is_file():
        return data_path
    if not data_path.exists():
        return None
    # Direct match
    for name in candidates:
        cand = data_path / name
        if cand.is_file():
            return cand
        for pd in package_dirs:
            nested = data_path / pd / "databases" / name
            if nested.is_file():
                return nested
        deep = data_path / "databases" / name
        if deep.is_file():
            return deep
    # Recursive fallback
    for name in candidates:
        try:
            for hit in data_path.rglob(name):
                if hit.is_file():
                    return hit
        except OSError:
            continue
    return None


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _normalize_phone(raw: str) -> str:
    """Strip whitespace / dashes / leading + and country code 86.

    Used for both (a) contact-lookup keys and (b) ID slugs for unknown
    callers/senders. Conservative — never returns empty (falls back to raw).
    """
    if not raw:
        return raw
    cleaned = re.sub(r"[\s\-()]", "", raw)
    if cleaned.startswith("+86"):
        cleaned = cleaned[3:]
    elif cleaned.startswith("86") and len(cleaned) >= 13:
        cleaned = cleaned[2:]
    return cleaned or raw


def _ms_from_db_value(val: Any) -> Optional[int]:
    """Coerce a DB date field into an int ms epoch, or None if unparseable.

    Android stores call/sms dates in ms already, but some vendor forks use
    seconds. Heuristic: anything > 1e12 is already ms; otherwise scale.
    """
    if val is None:
        return None
    try:
        n = float(val)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return int(n) if n > 1e12 else int(n * 1000)


def _classify_sms_channel(body: str, sender: str) -> str:
    """Tag an SMS as verification / service / personal.

    Cheap heuristics — false positives are tolerable since this is a
    secondary label, not a primary discrimination boundary. See
    Adapter_System_Data.md §3.3 for the rationale.
    """
    if body and _VERIFICATION_RE.search(body):
        return "verification"
    if sender and _SERVICE_SENDER_RE.match(sender.strip()):
        return "service"
    return "personal"


# ---------------------------------------------------------------------------
# Low-level SQL extraction (forked from sjqz ContactsParser, simplified)
# ---------------------------------------------------------------------------


def _query_data_by_mimetype(
    conn: sqlite3.Connection, raw_contact_id: int, mimetype: str
) -> List[str]:
    """Return all data1 values for (raw_contact_id, mimetype) pairs."""
    try:
        cur = conn.execute(
            """
            SELECT data1 FROM data
            WHERE raw_contact_id = ? AND mimetype_id IN (
                SELECT _id FROM mimetypes WHERE mimetype = ?
            )
            """,
            (raw_contact_id, mimetype),
        )
        return [row[0] for row in cur if row[0]]
    except sqlite3.OperationalError:
        # Schema variant (very old Android / vendor fork); caller treats as empty.
        return []


def _query_single_data(
    conn: sqlite3.Connection, raw_contact_id: int, mimetype: str
) -> str:
    """Return the first data1 value for (raw_contact_id, mimetype), or empty."""
    vals = _query_data_by_mimetype(conn, raw_contact_id, mimetype)
    return vals[0] if vals else ""


def _iter_contacts(conn: sqlite3.Connection):
    """Yield (raw_contact_id, display_name, starred) tuples.

    Skips deleted rows. Compatible with the standard Android contacts2.db
    schema (`raw_contacts` table). Vendor forks not covered yet — we'd
    expose an INVALID_PARAMS error from the dispatcher rather than guessing.
    """
    sql = "SELECT _id, display_name, starred FROM raw_contacts WHERE deleted = 0"
    try:
        cur = conn.execute(sql)
    except sqlite3.OperationalError as exc:
        raise IpcError(
            "DB_FILE_CORRUPT",
            f"raw_contacts table missing or schema unsupported: {exc}",
        )
    for row in cur:
        raw_id, display_name, starred = row[0], row[1] or "", bool(row[2])
        if not display_name:
            continue  # Skip nameless contacts (no useful Person derived).
        yield int(raw_id), display_name, starred


# ---------------------------------------------------------------------------
# NormalizedBatch builder (Person)
# ---------------------------------------------------------------------------


def _build_person(
    raw_contact_id: int,
    display_name: str,
    starred: bool,
    phones: List[str],
    emails: List[str],
    organization: str,
    notes: str,
    photo_uri: str,
    captured_at_ms: int,
    device_serial: Optional[str],
) -> Dict[str, Any]:
    """Map sjqz Contact dataclass shape → UnifiedSchema Person dict."""
    identifiers: Dict[str, Any] = {}
    if phones:
        identifiers["phone"] = phones
    if emails:
        identifiers["email"] = emails

    extra: Dict[str, Any] = {"starred": starred}
    if organization:
        extra["organization"] = organization
    if photo_uri:
        extra["photoUri"] = photo_uri
    if device_serial:
        extra["deviceSerial"] = device_serial

    person: Dict[str, Any] = {
        "id": f"person:system:android:{raw_contact_id}",
        "type": "person",
        "subtype": "contact",
        "names": [display_name],
        "ingestedAt": captured_at_ms,
        "confidence": 1.0,
        "source": {
            "adapter": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
            "originalId": str(raw_contact_id),
            "capturedAt": captured_at_ms,
            "capturedBy": "sqlite",
        },
        "extra": extra,
    }
    if identifiers:
        person["identifiers"] = identifiers
    if notes:
        person["notes"] = notes
    return person


# ---------------------------------------------------------------------------
# IPC method: system.parse_contacts
# ---------------------------------------------------------------------------


@register("system.parse_contacts")
def parse_contacts(
    params: Dict[str, Any],
    emit_progress: Callable[[int, int, str], None],
    emit_chunk: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """Parse an Android contacts2.db into a NormalizedBatch stream of Persons.

    Params:
        data_path: str (required) — path to contacts2.db or a directory containing it.
        device_serial: str (optional) — ADB serial of the source device. When
            multiple devices feed the same vault, this disambiguates per
            Adapter_System_Data.md §3.1 (extra.deviceSerial).
        chunk_size: int (optional, default 200) — emit a chunk every N persons.
        since_watermark: ignored. Contacts are full-sync each time; dedup goes
            via (adapter, originalId). See OQ-SD2.

    Returns:
        {
          "status": "ok",
          "totalPersons": <int>,
          "watermark": null,
          "stats": { "with_phone": N, "with_email": N, "starred": N }
        }

    Raises IpcError:
        - INVALID_PARAMS: missing data_path / not a file or dir.
        - DB_FILE_CORRUPT: schema unsupported.
    """
    data_path_raw = params.get("data_path")
    if not isinstance(data_path_raw, str) or not data_path_raw:
        raise IpcError("INVALID_PARAMS", "params.data_path (string) is required")

    data_path = Path(data_path_raw)
    db_path = _find_contacts_db(data_path)
    if db_path is None:
        raise IpcError(
            "INVALID_PARAMS",
            f"contacts2.db not found at or under {data_path_raw}",
        )

    device_serial = params.get("device_serial") or None
    chunk_size = int(params.get("chunk_size") or DEFAULT_CHUNK_SIZE)
    if chunk_size < 1:
        chunk_size = DEFAULT_CHUNK_SIZE
    captured_at_ms = int(os.path.getmtime(db_path) * 1000) if db_path.exists() else int(
        time.time() * 1000
    )

    conn = sqlite3.connect(str(db_path))
    try:
        # First pass: count for progress reporting.
        try:
            total_cur = conn.execute(
                "SELECT COUNT(*) FROM raw_contacts WHERE deleted = 0 AND display_name IS NOT NULL AND display_name != ''"
            )
            total_estimate = int(total_cur.fetchone()[0])
        except sqlite3.OperationalError as exc:
            raise IpcError("DB_FILE_CORRUPT", f"cannot count contacts: {exc}")

        emit_progress(0, total_estimate, "scanning")

        buffer: List[Dict[str, Any]] = []
        total_persons = 0
        stats = {"with_phone": 0, "with_email": 0, "starred": 0}

        for raw_id, display_name, starred in _iter_contacts(conn):
            phones = _query_data_by_mimetype(
                conn, raw_id, "vnd.android.cursor.item/phone_v2"
            )
            emails = _query_data_by_mimetype(
                conn, raw_id, "vnd.android.cursor.item/email_v2"
            )
            organization = _query_single_data(
                conn, raw_id, "vnd.android.cursor.item/organization"
            )
            notes = _query_single_data(conn, raw_id, "vnd.android.cursor.item/note")
            photo_uri = _query_single_data(
                conn, raw_id, "vnd.android.cursor.item/photo"
            )

            person = _build_person(
                raw_contact_id=raw_id,
                display_name=display_name,
                starred=starred,
                phones=phones,
                emails=emails,
                organization=organization,
                notes=notes,
                photo_uri=photo_uri,
                captured_at_ms=captured_at_ms,
                device_serial=device_serial,
            )

            buffer.append(person)
            total_persons += 1
            if phones:
                stats["with_phone"] += 1
            if emails:
                stats["with_email"] += 1
            if starred:
                stats["starred"] += 1

            if len(buffer) >= chunk_size:
                emit_chunk({
                    "events": [],
                    "persons": buffer,
                    "places": [],
                    "items": [],
                })
                emit_progress(total_persons, total_estimate, "parsing")
                buffer = []

        if buffer:
            emit_chunk({
                "events": [],
                "persons": buffer,
                "places": [],
                "items": [],
            })

        emit_progress(total_persons, total_estimate or total_persons, "done")
        return {
            "status": "ok",
            "totalPersons": total_persons,
            "watermark": None,
            "stats": stats,
        }
    finally:
        conn.close()


# ===========================================================================
# Phase 4.5.3a — system.parse_calllog
# ===========================================================================


def _build_call_event(
    call_id: int,
    number: str,
    name: str,
    call_type: int,
    duration_s: int,
    occurred_at_ms: int,
    is_read: bool,
    captured_at_ms: int,
    device_serial: Optional[str],
    other_party_id: str,
) -> Dict[str, Any]:
    """Map sjqz CallLog dataclass shape → UnifiedSchema Event(subtype=call)."""
    type_name = _CALL_TYPE_NAMES.get(call_type, f"unknown:{call_type}")
    is_outgoing = call_type == 2
    actor = SELF_PERSON_ID if is_outgoing else other_party_id

    extra: Dict[str, Any] = {
        "callType": type_name,
        "callTypeCode": call_type,
        "isRead": is_read,
        "rawNumber": number,
    }
    if device_serial:
        extra["deviceSerial"] = device_serial

    event: Dict[str, Any] = {
        "id": f"event:system:call:{call_id}",
        "type": "event",
        "subtype": "call",
        "occurredAt": occurred_at_ms,
        "actor": actor,
        "participants": [other_party_id],
        "content": {},
        "ingestedAt": captured_at_ms,
        "confidence": 1.0,
        "source": {
            "adapter": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
            "originalId": str(call_id),
            "capturedAt": occurred_at_ms,
            "capturedBy": "sqlite",
        },
        "extra": extra,
    }
    if duration_s and duration_s > 0:
        event["durationMs"] = int(duration_s) * 1000
    if name:
        # `content` accepts text/title — using title preserves display name
        # without polluting the message-text channel (which CallLog never has).
        event["content"]["title"] = name
    return event


def _build_unknown_person(
    normalized_phone: str,
    display_name: str,
    captured_at_ms: int,
    device_serial: Optional[str],
) -> Dict[str, Any]:
    extra: Dict[str, Any] = {"unknownContact": True}
    if device_serial:
        extra["deviceSerial"] = device_serial
    return {
        "id": f"person:system:android:unknown:{normalized_phone}",
        "type": "person",
        "subtype": "unknown",
        "names": [display_name or normalized_phone],
        "identifiers": {"phone": [normalized_phone]},
        "ingestedAt": captured_at_ms,
        "confidence": 0.6,
        "source": {
            "adapter": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
            "originalId": f"unknown:{normalized_phone}",
            "capturedAt": captured_at_ms,
            "capturedBy": "sqlite",
        },
        "extra": extra,
    }


def _load_contact_phone_index(
    contacts_db_path: Optional[Path],
) -> Dict[str, int]:
    """Build {normalized_phone → raw_contact_id} from a contacts2.db if available.

    Used by parse_calllog / parse_sms to resolve actor/participant references
    to canonical contact Persons. Falls back to {} if contacts2.db is missing —
    parsers then emit unknown Persons exclusively.
    """
    if contacts_db_path is None or not contacts_db_path.exists():
        return {}
    conn = sqlite3.connect(str(contacts_db_path))
    index: Dict[str, int] = {}
    try:
        try:
            cur = conn.execute(
                """
                SELECT d.data1, d.raw_contact_id FROM data d
                JOIN mimetypes m ON m._id = d.mimetype_id
                WHERE m.mimetype = 'vnd.android.cursor.item/phone_v2'
                """
            )
            for raw, raw_contact_id in cur:
                if not raw:
                    continue
                index[_normalize_phone(raw)] = int(raw_contact_id)
        except sqlite3.OperationalError:
            pass
    finally:
        conn.close()
    return index


def _resolve_other_party(
    number: str,
    contact_phone_index: Dict[str, int],
    unknown_cache: Dict[str, Dict[str, Any]],
    captured_at_ms: int,
    device_serial: Optional[str],
    display_name: str = "",
) -> str:
    """Return a Person.id for the other party. Materializes unknowns as needed."""
    if not number:
        # Withheld/blocked number — single shared "unknown anonymous" Person.
        key = "anonymous"
        if key not in unknown_cache:
            unknown_cache[key] = _build_unknown_person(
                key, "未知号码", captured_at_ms, device_serial
            )
        return unknown_cache[key]["id"]
    normalized = _normalize_phone(number)
    contact_id = contact_phone_index.get(normalized)
    if contact_id is not None:
        return f"person:system:android:{contact_id}"
    if normalized not in unknown_cache:
        unknown_cache[normalized] = _build_unknown_person(
            normalized, display_name, captured_at_ms, device_serial
        )
    return unknown_cache[normalized]["id"]


@register("system.parse_calllog")
def parse_calllog(
    params: Dict[str, Any],
    emit_progress: Callable[[int, int, str], None],
    emit_chunk: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """Parse Android call log → Event(subtype=call) stream.

    Params:
        data_path: str (required) — calllog.db / contacts2.db / containing dir.
        contacts_db_path: str (optional) — separate contacts2.db for
            phone→Person resolution. If omitted, all callers become unknown Persons.
        device_serial: str (optional)
        chunk_size: int (optional, default 200)

    Returns:
        {
          "status": "ok",
          "totalEvents": N,
          "totalPersonsCreated": N,    # unknown Persons materialized
          "watermark": None,
          "stats": {
            "incoming": N, "outgoing": N, "missed": N, "voicemail": N,
            "rejected": N, "blocked": N, "withDuration": N
          }
        }
    """
    data_path_raw = params.get("data_path")
    if not isinstance(data_path_raw, str) or not data_path_raw:
        raise IpcError("INVALID_PARAMS", "params.data_path (string) is required")

    db_path = _find_db_by_candidates(
        Path(data_path_raw), _CALLLOG_DB_CANDIDATES,
        package_dirs=("com.android.providers.contacts",),
    )
    if db_path is None:
        raise IpcError(
            "INVALID_PARAMS",
            f"calllog.db / contacts2.db not found at or under {data_path_raw}",
        )

    contacts_db_raw = params.get("contacts_db_path")
    contacts_phone_index = _load_contact_phone_index(
        Path(contacts_db_raw) if contacts_db_raw else None
    )

    device_serial = params.get("device_serial") or None
    chunk_size = max(1, int(params.get("chunk_size") or DEFAULT_CHUNK_SIZE))

    conn = sqlite3.connect(str(db_path))
    try:
        captured_at_ms = int(os.path.getmtime(db_path) * 1000)
        # Probe table presence — Android moves calls between contacts2.db and calllog.db.
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('calls', 'call_log', 'calllog')"
        )
        tables = [row[0] for row in cur]
        if not tables:
            raise IpcError(
                "DB_FILE_CORRUPT",
                f"no call-log table found in {db_path.name} "
                "(expected one of: calls / call_log / calllog)",
            )
        table = tables[0]

        col_cur = conn.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in col_cur.fetchall()}
        required = {"_id", "number", "type", "date"}
        if not required.issubset(columns):
            raise IpcError(
                "DB_FILE_CORRUPT",
                f"{table} missing required columns; have={sorted(columns)}",
            )
        has_duration = "duration" in columns
        has_name = "name" in columns
        has_isread = "is_read" in columns

        try:
            total_cur = conn.execute(f"SELECT COUNT(*) FROM {table}")
            total_estimate = int(total_cur.fetchone()[0])
        except sqlite3.OperationalError:
            total_estimate = 0

        emit_progress(0, total_estimate, "scanning")

        select_cols = ["_id", "number", "type", "date"]
        if has_duration:
            select_cols.append("duration")
        if has_name:
            select_cols.append("name")
        if has_isread:
            select_cols.append("is_read")
        sql = f"SELECT {', '.join(select_cols)} FROM {table} ORDER BY date ASC"

        buffer_events: List[Dict[str, Any]] = []
        buffer_persons: List[Dict[str, Any]] = []
        unknown_cache: Dict[str, Dict[str, Any]] = {}
        seen_unknown_emit: Set[str] = set()
        total_events = 0
        stats = {n: 0 for n in _CALL_TYPE_NAMES.values()}
        stats["withDuration"] = 0

        for row in conn.execute(sql):
            d = dict(zip(select_cols, row))
            call_id = int(d["_id"])
            occurred_at = _ms_from_db_value(d.get("date"))
            if occurred_at is None:
                continue  # skip rows with broken timestamps
            number = d.get("number") or ""
            name = d.get("name") or "" if has_name else ""
            call_type = int(d.get("type") or 0)
            duration_s = int(d.get("duration") or 0) if has_duration else 0
            is_read = bool(d.get("is_read") if has_isread else True)

            other_party_id = _resolve_other_party(
                number, contacts_phone_index, unknown_cache,
                captured_at_ms, device_serial, display_name=name,
            )
            # Surface newly created unknown Persons exactly once.
            for key, person in unknown_cache.items():
                if key in seen_unknown_emit:
                    continue
                seen_unknown_emit.add(key)
                buffer_persons.append(person)

            event = _build_call_event(
                call_id=call_id,
                number=number,
                name=name,
                call_type=call_type,
                duration_s=duration_s,
                occurred_at_ms=occurred_at,
                is_read=is_read,
                captured_at_ms=captured_at_ms,
                device_serial=device_serial,
                other_party_id=other_party_id,
            )
            buffer_events.append(event)
            total_events += 1
            type_name = _CALL_TYPE_NAMES.get(call_type)
            if type_name:
                stats[type_name] += 1
            if duration_s > 0:
                stats["withDuration"] += 1

            if len(buffer_events) >= chunk_size:
                emit_chunk({
                    "events": buffer_events,
                    "persons": buffer_persons,
                    "places": [],
                    "items": [],
                })
                emit_progress(total_events, total_estimate, "parsing")
                buffer_events = []
                buffer_persons = []

        if buffer_events or buffer_persons:
            emit_chunk({
                "events": buffer_events,
                "persons": buffer_persons,
                "places": [],
                "items": [],
            })

        emit_progress(total_events, total_estimate or total_events, "done")
        return {
            "status": "ok",
            "totalEvents": total_events,
            "totalPersonsCreated": len(unknown_cache),
            "watermark": None,
            "stats": stats,
        }
    finally:
        conn.close()


# ===========================================================================
# Phase 4.5.3b — system.parse_sms
# ===========================================================================


def _build_sms_event(
    sms_id: int,
    address: str,
    body: str,
    sms_type: int,
    thread_id: Optional[int],
    occurred_at_ms: int,
    is_read: bool,
    captured_at_ms: int,
    device_serial: Optional[str],
    other_party_id: str,
    channel_type: str,
) -> Dict[str, Any]:
    type_name = _SMS_TYPE_NAMES.get(sms_type, f"unknown:{sms_type}")
    is_sent = sms_type in (2, 4)  # sent / outbox
    actor = SELF_PERSON_ID if is_sent else other_party_id

    extra: Dict[str, Any] = {
        "smsType": type_name,
        "smsTypeCode": sms_type,
        "isRead": is_read,
        "rawAddress": address,
        "channelType": channel_type,
    }
    if thread_id is not None:
        extra["threadId"] = str(thread_id)
    if device_serial:
        extra["deviceSerial"] = device_serial

    return {
        "id": f"event:system:sms:{sms_id}",
        "type": "event",
        "subtype": "message",
        "occurredAt": occurred_at_ms,
        "actor": actor,
        "participants": [other_party_id],
        "content": {"text": body or ""},
        "ingestedAt": captured_at_ms,
        "confidence": 1.0,
        "source": {
            "adapter": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
            "originalId": str(sms_id),
            "capturedAt": occurred_at_ms,
            "capturedBy": "sqlite",
        },
        "extra": extra,
    }


@register("system.parse_sms")
def parse_sms(
    params: Dict[str, Any],
    emit_progress: Callable[[int, int, str], None],
    emit_chunk: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """Parse Android SMS db (mmssms.db) → Event(subtype=message) stream.

    Per design doc Adapter_System_Data.md §5.2, SMS is opt-out — but adapter
    layer enforces gating, not the sidecar. Sidecar will parse whatever DB it
    receives; the JS adapter decides whether to invoke this at all.

    Params: same shape as parse_calllog.
    Returns:
        {
          "status": "ok",
          "totalEvents": N,
          "totalPersonsCreated": N,
          "watermark": None,
          "stats": {
            "received": N, "sent": N, "draft": N, "outbox": N,
            "verification": N, "service": N, "personal": N
          }
        }
    """
    data_path_raw = params.get("data_path")
    if not isinstance(data_path_raw, str) or not data_path_raw:
        raise IpcError("INVALID_PARAMS", "params.data_path (string) is required")

    db_path = _find_db_by_candidates(
        Path(data_path_raw), _SMS_DB_CANDIDATES,
        package_dirs=("com.android.providers.telephony",),
    )
    if db_path is None:
        raise IpcError(
            "INVALID_PARAMS",
            f"mmssms.db not found at or under {data_path_raw}",
        )

    contacts_db_raw = params.get("contacts_db_path")
    contacts_phone_index = _load_contact_phone_index(
        Path(contacts_db_raw) if contacts_db_raw else None
    )

    device_serial = params.get("device_serial") or None
    chunk_size = max(1, int(params.get("chunk_size") or DEFAULT_CHUNK_SIZE))

    conn = sqlite3.connect(str(db_path))
    try:
        captured_at_ms = int(os.path.getmtime(db_path) * 1000)
        try:
            total_cur = conn.execute("SELECT COUNT(*) FROM sms")
            total_estimate = int(total_cur.fetchone()[0])
        except sqlite3.OperationalError as exc:
            raise IpcError(
                "DB_FILE_CORRUPT", f"sms table missing/unreadable: {exc}"
            )

        emit_progress(0, total_estimate, "scanning")

        sql = (
            "SELECT _id, thread_id, address, body, type, date, read "
            "FROM sms ORDER BY date ASC"
        )

        buffer_events: List[Dict[str, Any]] = []
        buffer_persons: List[Dict[str, Any]] = []
        unknown_cache: Dict[str, Dict[str, Any]] = {}
        seen_unknown_emit: Set[str] = set()
        total_events = 0
        stats: Dict[str, int] = {n: 0 for n in _SMS_TYPE_NAMES.values()}
        stats.update({"verification": 0, "service": 0, "personal": 0})

        for row in conn.execute(sql):
            sms_id, thread_id, address, body, sms_type, date_raw, read_raw = row
            occurred_at = _ms_from_db_value(date_raw)
            if occurred_at is None:
                continue
            address = address or ""
            body = body or ""
            sms_type = int(sms_type or 1)
            is_read = bool(read_raw)

            other_party_id = _resolve_other_party(
                address, contacts_phone_index, unknown_cache,
                captured_at_ms, device_serial,
            )
            for key, person in unknown_cache.items():
                if key in seen_unknown_emit:
                    continue
                seen_unknown_emit.add(key)
                buffer_persons.append(person)

            channel = _classify_sms_channel(body, address)
            event = _build_sms_event(
                sms_id=int(sms_id),
                address=address,
                body=body,
                sms_type=sms_type,
                thread_id=int(thread_id) if thread_id is not None else None,
                occurred_at_ms=occurred_at,
                is_read=is_read,
                captured_at_ms=captured_at_ms,
                device_serial=device_serial,
                other_party_id=other_party_id,
                channel_type=channel,
            )
            buffer_events.append(event)
            total_events += 1
            type_name = _SMS_TYPE_NAMES.get(sms_type)
            if type_name:
                stats[type_name] += 1
            stats[channel] += 1

            if len(buffer_events) >= chunk_size:
                emit_chunk({
                    "events": buffer_events,
                    "persons": buffer_persons,
                    "places": [],
                    "items": [],
                })
                emit_progress(total_events, total_estimate, "parsing")
                buffer_events = []
                buffer_persons = []

        if buffer_events or buffer_persons:
            emit_chunk({
                "events": buffer_events,
                "persons": buffer_persons,
                "places": [],
                "items": [],
            })

        emit_progress(total_events, total_estimate or total_events, "done")
        return {
            "status": "ok",
            "totalEvents": total_events,
            "totalPersonsCreated": len(unknown_cache),
            "watermark": None,
            "stats": stats,
        }
    finally:
        conn.close()


# ===========================================================================
# Phase 4.5.3c — system.parse_wifi
# ===========================================================================


def _parse_wificonfig_xml(xml_path: Path) -> List[Dict[str, Any]]:
    """Parse Android 8+ WifiConfigStore.xml into raw record dicts."""
    out: List[Dict[str, Any]] = []
    try:
        tree = ET.parse(str(xml_path))
    except (ET.ParseError, OSError):
        return out
    root = tree.getroot()
    for net in root.iter("Network"):
        record: Dict[str, Any] = {"hasPassword": False, "hidden": False}
        for config in net.iter("WifiConfiguration"):
            for elem in config:
                name = elem.get("name", "")
                text = (elem.text or "").strip().strip('"')
                if name == "SSID" and text:
                    record["ssid"] = text
                elif name == "PreSharedKey" and text:
                    # Existence only — password value itself is dropped (§3.4).
                    record["hasPassword"] = True
                elif name == "HiddenSSID":
                    record["hidden"] = text.lower() == "true"
                elif name == "KeyMgmt":
                    if "WPA" in text:
                        record["securityType"] = "WPA/WPA2"
                    elif "WEP" in text:
                        record["securityType"] = "WEP"
                    else:
                        record["securityType"] = "OPEN"
        if record.get("ssid"):
            out.append(record)
    return out


def _parse_wpa_supplicant_conf(conf_path: Path) -> List[Dict[str, Any]]:
    """Parse legacy wpa_supplicant.conf into raw record dicts."""
    out: List[Dict[str, Any]] = []
    try:
        text = conf_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return out
    network_re = re.compile(r"network\s*=\s*\{([^}]+)\}", re.MULTILINE | re.DOTALL)
    for match in network_re.finditer(text):
        block = match.group(1)
        record: Dict[str, Any] = {
            "hasPassword": False,
            "hidden": False,
            "securityType": "OPEN",
        }
        for line in block.splitlines():
            line = line.strip()
            if "=" not in line:
                continue
            key, _, raw = line.partition("=")
            key = key.strip()
            raw = raw.strip().strip('"')
            if key == "ssid":
                record["ssid"] = raw
            elif key == "psk":
                record["hasPassword"] = True
                record["securityType"] = "WPA/WPA2"
            elif key.startswith("wep_key"):
                record["hasPassword"] = True
                record["securityType"] = "WEP"
            elif key == "scan_ssid" and raw == "1":
                record["hidden"] = True
            elif key == "key_mgmt":
                if "WPA" in raw:
                    record["securityType"] = "WPA/WPA2"
                elif "NONE" in raw:
                    record["securityType"] = "OPEN"
        if record.get("ssid"):
            out.append(record)
    return out


def _build_wifi_place(
    ssid: str,
    record: Dict[str, Any],
    captured_at_ms: int,
    device_serial: Optional[str],
) -> Dict[str, Any]:
    """Map a raw wifi record → UnifiedSchema Place(category=wifi).

    ID uses sha1 of ssid (first 12 hex chars) so the surface ID is short and
    free of SSID-shell-unsafe characters. originalId keeps the literal SSID
    for (adapter, originalId) uniqueness across re-ingest.
    """
    ssid_hash = hashlib.sha1(ssid.encode("utf-8")).hexdigest()[:12]
    extra: Dict[str, Any] = {
        "securityType": record.get("securityType", "OPEN"),
        "hidden": bool(record.get("hidden", False)),
        "passwordStored": bool(record.get("hasPassword", False)),
    }
    if device_serial:
        extra["deviceSerial"] = device_serial
    return {
        "id": f"place:wifi:{ssid_hash}",
        "type": "place",
        "name": ssid,
        "category": "wifi",
        "aliases": [],
        "ingestedAt": captured_at_ms,
        "confidence": 0.95,
        "source": {
            "adapter": ADAPTER_NAME,
            "adapterVersion": ADAPTER_VERSION,
            "originalId": ssid,
            "capturedAt": captured_at_ms,
            "capturedBy": "manual",  # XML / conf — not export-grade, not sqlite
        },
        "extra": extra,
    }


@register("system.parse_wifi")
def parse_wifi(
    params: Dict[str, Any],
    emit_progress: Callable[[int, int, str], None],
    emit_chunk: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    """Parse Android WiFi config (XML or wpa_supplicant.conf) → Place stream.

    Params:
        data_path: str (required) — directory containing WifiConfigStore.xml /
            wpa_supplicant.conf, or a direct path to either file.
        device_serial: str (optional)

    Returns:
        {
          "status": "ok",
          "totalPlaces": N,
          "watermark": None,
          "stats": {"with_password": N, "hidden": N, "wpa": N, "wep": N, "open": N}
        }

    Note: WiFi passwords are deliberately NOT stored (Adapter_System_Data.md §3.4).
    `extra.passwordStored=true` reports presence only.
    """
    data_path_raw = params.get("data_path")
    if not isinstance(data_path_raw, str) or not data_path_raw:
        raise IpcError("INVALID_PARAMS", "params.data_path (string) is required")

    data_path = Path(data_path_raw)
    if not data_path.exists():
        raise IpcError("INVALID_PARAMS", f"wifi config path not found: {data_path_raw}")

    # Direct file or directory of files.
    xml_path: Optional[Path] = None
    conf_path: Optional[Path] = None
    if data_path.is_file():
        if data_path.name == "WifiConfigStore.xml":
            xml_path = data_path
        elif data_path.name == "wpa_supplicant.conf":
            conf_path = data_path
        else:
            raise IpcError(
                "INVALID_PARAMS",
                f"unknown wifi config filename: {data_path.name}",
            )
    else:
        cand_xml = data_path / "WifiConfigStore.xml"
        cand_conf = data_path / "wpa_supplicant.conf"
        if cand_xml.is_file():
            xml_path = cand_xml
        if cand_conf.is_file():
            conf_path = cand_conf
        # Recursive fallback — Android 14 sometimes nests under softap/
        if xml_path is None:
            for hit in data_path.rglob("WifiConfigStore.xml"):
                xml_path = hit
                break
        if conf_path is None:
            for hit in data_path.rglob("wpa_supplicant.conf"):
                conf_path = hit
                break

    if xml_path is None and conf_path is None:
        raise IpcError(
            "INVALID_PARAMS",
            "neither WifiConfigStore.xml nor wpa_supplicant.conf found",
        )

    device_serial = params.get("device_serial") or None
    captured_at_ms = int(time.time() * 1000)
    if xml_path:
        captured_at_ms = int(os.path.getmtime(xml_path) * 1000)
    elif conf_path:
        captured_at_ms = int(os.path.getmtime(conf_path) * 1000)

    records: List[Dict[str, Any]] = []
    if xml_path:
        records.extend(_parse_wificonfig_xml(xml_path))
    if conf_path:
        records.extend(_parse_wpa_supplicant_conf(conf_path))

    # Dedup by SSID — both files may contain overlapping entries on transitional builds.
    seen: Set[str] = set()
    unique: List[Dict[str, Any]] = []
    for r in records:
        ssid = r.get("ssid", "")
        if ssid and ssid not in seen:
            seen.add(ssid)
            unique.append(r)

    emit_progress(0, len(unique), "scanning")
    places: List[Dict[str, Any]] = []
    stats = {"with_password": 0, "hidden": 0, "wpa": 0, "wep": 0, "open": 0}
    for rec in unique:
        place = _build_wifi_place(rec["ssid"], rec, captured_at_ms, device_serial)
        places.append(place)
        if place["extra"]["passwordStored"]:
            stats["with_password"] += 1
        if place["extra"]["hidden"]:
            stats["hidden"] += 1
        st = (place["extra"]["securityType"] or "").upper()
        if "WPA" in st:
            stats["wpa"] += 1
        elif "WEP" in st:
            stats["wep"] += 1
        else:
            stats["open"] += 1

    if places:
        emit_chunk({"events": [], "persons": [], "places": places, "items": []})
    emit_progress(len(places), len(places), "done")
    return {
        "status": "ok",
        "totalPlaces": len(places),
        "watermark": None,
        "stats": stats,
    }
