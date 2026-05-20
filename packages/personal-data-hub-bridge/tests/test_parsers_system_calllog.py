"""Unit tests for system.parse_calllog.

Fixture synthesizes the Android `calls` table schema (frameworks/base/.../CallLog.java)
and exercises actor-resolution via a side contacts2.db so the unknown-Person
materialization path is covered too.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

from forensics_bridge.dispatcher import IpcError, dispatch
from forensics_bridge.parsers.system import (  # noqa: F401 (registers)
    parse_calllog,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _seed_calllog_db(db_path: Path, rows: List[Tuple]) -> None:
    """Each row = (_id, number, type, duration, date_ms, name, is_read)."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE calls (
              _id INTEGER PRIMARY KEY,
              number TEXT,
              type INTEGER,
              duration INTEGER,
              date INTEGER,
              name TEXT,
              is_read INTEGER DEFAULT 1
            )
            """
        )
        conn.executemany(
            "INSERT INTO calls (_id, number, type, duration, date, name, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def _seed_contacts_index_db(db_path: Path, phone_to_contact: Dict[str, int]) -> None:
    """Minimal contacts2.db carrying only the phone→raw_contact_id mapping
    that _load_contact_phone_index reads."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(
            """
            CREATE TABLE mimetypes (_id INTEGER PRIMARY KEY, mimetype TEXT NOT NULL UNIQUE);
            CREATE TABLE data (
              _id INTEGER PRIMARY KEY,
              raw_contact_id INTEGER,
              mimetype_id INTEGER,
              data1 TEXT
            );
            INSERT INTO mimetypes (_id, mimetype) VALUES (5, 'vnd.android.cursor.item/phone_v2');
            """
        )
        conn.executemany(
            "INSERT INTO data (raw_contact_id, mimetype_id, data1) VALUES (?, 5, ?)",
            [(cid, phone) for phone, cid in phone_to_contact.items()],
        )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def calllog_db(tmp_path: Path) -> Path:
    db = tmp_path / "calllog.db"
    _seed_calllog_db(
        db,
        rows=[
            # (id, number, type, duration, date_ms, name, is_read)
            (1, "13800001111", 1, 120, 1737000000000, "妈妈", 1),    # incoming, 2min
            (2, "13800001111", 2, 45, 1737010000000, "妈妈", 1),     # outgoing
            (3, "13999998888", 3, 0, 1737020000000, "", 0),          # missed unknown
            (4, "10086",       1, 8, 1737030000000, "中国移动", 1),  # service
            (5, "",            6, 0, 1737040000000, "", 1),          # blocked withheld
        ],
    )
    return db


@pytest.fixture
def contacts_index_db(tmp_path: Path) -> Path:
    db = tmp_path / "contacts2.db"
    _seed_contacts_index_db(db, {"13800001111": 42})
    return db


def _drain(db_path: str, **extra):
    chunks: List[Dict] = []
    progress: List[Tuple[int, int, str]] = []

    def on_chunk(b):
        chunks.append(b)

    def on_prog(p, t, ph=""):
        progress.append((p, t, ph))

    result = dispatch(
        "system.parse_calllog",
        {"data_path": str(db_path), **extra},
        on_prog,
        on_chunk,
    )
    return result, chunks, progress


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_basic_extraction_emits_one_event_per_row(calllog_db: Path) -> None:
    result, chunks, _ = _drain(str(calllog_db))
    events = [e for c in chunks for e in c["events"]]
    assert result["status"] == "ok"
    assert result["totalEvents"] == 5
    assert len(events) == 5
    # All events have type=event and subtype=call
    assert {e["type"] for e in events} == {"event"}
    assert {e["subtype"] for e in events} == {"call"}


def test_outgoing_actor_is_self_incoming_is_other(
    calllog_db: Path, contacts_index_db: Path
) -> None:
    result, chunks, _ = _drain(
        str(calllog_db),
        contacts_db_path=str(contacts_index_db),
    )
    events = {e["id"]: e for c in chunks for e in c["events"]}
    incoming = events["event:system:call:1"]
    outgoing = events["event:system:call:2"]
    assert incoming["actor"] == "person:system:android:42"  # mom = canonical contact
    assert outgoing["actor"] == "person:self"
    assert incoming["participants"] == ["person:system:android:42"]
    assert outgoing["participants"] == ["person:system:android:42"]
    # Unknowns materialized: 13999998888 (unsaved caller) + 10086 (service) + anonymous (withheld).
    # mom (13800001111) is NOT unknown because contacts_index_db maps her.
    assert result["totalPersonsCreated"] == 3


def test_unknown_caller_materializes_unknown_person(calllog_db: Path) -> None:
    """No contacts db → every caller becomes an unknown Person."""
    result, chunks, _ = _drain(str(calllog_db))
    persons = {p["id"]: p for c in chunks for p in c["persons"]}
    assert "person:system:android:unknown:13800001111" in persons
    mom_unknown = persons["person:system:android:unknown:13800001111"]
    assert mom_unknown["subtype"] == "unknown"
    assert mom_unknown["identifiers"]["phone"] == ["13800001111"]
    assert mom_unknown["confidence"] == 0.6
    # blocked withheld number → anonymous
    assert "person:system:android:unknown:anonymous" in persons


def test_unknown_persons_emitted_at_most_once_each(calllog_db: Path) -> None:
    """Even though 13800001111 appears in 2 rows, only one Person record emitted."""
    _, chunks, _ = _drain(str(calllog_db))
    persons = [p for c in chunks for p in c["persons"]]
    ids = [p["id"] for p in persons]
    assert len(ids) == len(set(ids))


def test_extra_call_metadata(calllog_db: Path) -> None:
    _, chunks, _ = _drain(str(calllog_db), device_serial="24115RA8EC-test")
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    incoming = by_id["event:system:call:1"]
    assert incoming["extra"]["callType"] == "incoming"
    assert incoming["extra"]["callTypeCode"] == 1
    assert incoming["extra"]["isRead"] is True
    assert incoming["extra"]["rawNumber"] == "13800001111"
    assert incoming["extra"]["deviceSerial"] == "24115RA8EC-test"
    assert incoming["durationMs"] == 120 * 1000

    missed = by_id["event:system:call:3"]
    assert missed["extra"]["callType"] == "missed"
    assert "durationMs" not in missed  # duration=0 → omitted

    blocked = by_id["event:system:call:5"]
    assert blocked["extra"]["callType"] == "blocked"


def test_content_title_carries_display_name(calllog_db: Path) -> None:
    _, chunks, _ = _drain(str(calllog_db))
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    assert by_id["event:system:call:1"]["content"]["title"] == "妈妈"
    # Row 3 has no `name` column value → content has no title
    assert "title" not in by_id["event:system:call:3"]["content"]


def test_seconds_epoch_dates_get_scaled_to_ms(tmp_path: Path) -> None:
    """Some vendor forks store dates in seconds; helper must rescale."""
    db = tmp_path / "calllog.db"
    _seed_calllog_db(
        db,
        rows=[(1, "13800001111", 1, 10, 1737000000, "", 1)],  # seconds, not ms
    )
    _, chunks, _ = _drain(str(db))
    events = [e for c in chunks for e in c["events"]]
    assert events[0]["occurredAt"] == 1737000000 * 1000


def test_missing_data_path_raises_invalid_params() -> None:
    with pytest.raises(IpcError) as info:
        dispatch("system.parse_calllog", {}, lambda *a, **k: None, lambda b: None)
    assert info.value.code == "INVALID_PARAMS"


def test_db_without_call_table_raises(tmp_path: Path) -> None:
    bogus = tmp_path / "bogus.db"
    conn = sqlite3.connect(str(bogus))
    conn.execute("CREATE TABLE other (x INTEGER)")
    conn.commit()
    conn.close()
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_calllog",
            {"data_path": str(bogus)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code in ("INVALID_PARAMS", "DB_FILE_CORRUPT")


def test_capabilities_includes_calllog() -> None:
    caps = dispatch("sidecar.capabilities", {}, lambda *a, **k: None, lambda b: None)
    assert "system.parse_calllog" in caps["methods"]


def test_chunking_respects_chunk_size(calllog_db: Path) -> None:
    _, chunks, _ = _drain(str(calllog_db), chunk_size=2)
    # 5 events @ chunk=2 → at least 3 chunks; precise count depends on Person
    # interleaving but every chunk except possibly the last has 2 events.
    sizes = [len(c["events"]) for c in chunks]
    assert sizes[-1] >= 1
    assert sum(sizes) == 5


def test_normalized_phone_dedup_across_plus86(tmp_path: Path) -> None:
    """+8613800001111 and 13800001111 must collapse to one unknown Person."""
    db = tmp_path / "calllog.db"
    _seed_calllog_db(
        db,
        rows=[
            (1, "+8613800001111", 1, 10, 1737000000000, "", 1),
            (2, "13800001111", 2, 5, 1737010000000, "", 1),
        ],
    )
    result, chunks, _ = _drain(str(db))
    persons = [p for c in chunks for p in c["persons"]]
    assert len(persons) == 1
    assert persons[0]["id"] == "person:system:android:unknown:13800001111"
    assert result["totalPersonsCreated"] == 1
