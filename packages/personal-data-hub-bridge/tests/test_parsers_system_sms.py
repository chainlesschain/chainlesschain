"""Unit tests for system.parse_sms."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

from forensics_bridge.dispatcher import IpcError, dispatch
from forensics_bridge.parsers.system import (  # noqa: F401 (registers)
    parse_sms,
    _classify_sms_channel,
)


def _seed_sms_db(db_path: Path, rows: List[Tuple]) -> None:
    """rows: (_id, thread_id, address, body, type, date_ms, read)"""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE sms (
              _id INTEGER PRIMARY KEY,
              thread_id INTEGER,
              address TEXT,
              body TEXT,
              type INTEGER,
              date INTEGER,
              read INTEGER
            )
            """
        )
        conn.executemany(
            "INSERT INTO sms (_id, thread_id, address, body, type, date, read) VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def sms_db(tmp_path: Path) -> Path:
    db = tmp_path / "mmssms.db"
    _seed_sms_db(
        db,
        rows=[
            (1, 100, "13800001111", "妈妈我到家了", 2, 1737000000000, 1),   # sent personal
            (2, 100, "13800001111", "好的，注意安全", 1, 1737000010000, 1),  # received personal
            (3, 200, "10086",
             "【中国移动】您的话费余额为 ¥36.50", 1, 1737000020000, 1),       # service
            (4, 300, "95588",
             "【工商银行】您的验证码为 123456，3 分钟内有效", 1, 1737000030000, 0),  # verification
            (5, 400, "13999998888", "在吗？", 3, 1737000040000, 0),         # draft
        ],
    )
    return db


def _drain(db_path: str, **extra):
    chunks: List[Dict] = []

    def on_chunk(b):
        chunks.append(b)

    result = dispatch(
        "system.parse_sms",
        {"data_path": str(db_path), **extra},
        lambda *a, **k: None,
        on_chunk,
    )
    return result, chunks


# ---------------------------------------------------------------------------
# Channel classification (pure unit, no DB)
# ---------------------------------------------------------------------------


def test_channel_verification_explicit_keyword() -> None:
    assert _classify_sms_channel("【银行】您的验证码为 123456", "95588") == "verification"


def test_channel_verification_english_phrase() -> None:
    assert _classify_sms_channel("Your verification code is 9876", "10690000") == "verification"


def test_channel_service_for_short_numeric_sender() -> None:
    assert _classify_sms_channel("亲，您的快递已到", "10086") == "service"


def test_channel_personal_default() -> None:
    assert _classify_sms_channel("吃饭了吗", "13800001111") == "personal"


def test_channel_verification_wins_over_service_when_both_match() -> None:
    """Bank service-number-sender + verification-code body → verification (most specific)."""
    assert _classify_sms_channel("您的验证码 1234", "95588") == "verification"


# ---------------------------------------------------------------------------
# Full IPC method
# ---------------------------------------------------------------------------


def test_basic_extraction(sms_db: Path) -> None:
    result, chunks = _drain(str(sms_db))
    events = [e for c in chunks for e in c["events"]]
    assert result["status"] == "ok"
    assert result["totalEvents"] == 5
    assert len(events) == 5
    assert {e["subtype"] for e in events} == {"message"}


def test_sent_is_self_received_is_other(sms_db: Path) -> None:
    _, chunks = _drain(str(sms_db))
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    assert by_id["event:system:sms:1"]["actor"] == "person:self"
    assert by_id["event:system:sms:2"]["actor"].startswith("person:system:android:")
    assert by_id["event:system:sms:2"]["actor"] != "person:self"


def test_channel_type_classification_pipeline(sms_db: Path) -> None:
    _, chunks = _drain(str(sms_db))
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    assert by_id["event:system:sms:1"]["extra"]["channelType"] == "personal"
    assert by_id["event:system:sms:3"]["extra"]["channelType"] == "service"
    assert by_id["event:system:sms:4"]["extra"]["channelType"] == "verification"


def test_stats_counts(sms_db: Path) -> None:
    result, _ = _drain(str(sms_db))
    stats = result["stats"]
    assert stats["sent"] == 1
    assert stats["received"] == 3
    assert stats["draft"] == 1
    assert stats["verification"] == 1
    assert stats["service"] == 1
    assert stats["personal"] == 3  # sms 1, 2, 5


def test_sms_event_content_text(sms_db: Path) -> None:
    _, chunks = _drain(str(sms_db))
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    assert by_id["event:system:sms:4"]["content"]["text"].startswith("【工商银行】")
    # thread_id propagates as string in extra
    assert by_id["event:system:sms:4"]["extra"]["threadId"] == "300"


def test_sms_extra_metadata(sms_db: Path) -> None:
    _, chunks = _drain(str(sms_db), device_serial="redmi-test")
    by_id = {e["id"]: e for c in chunks for e in c["events"]}
    incoming = by_id["event:system:sms:2"]
    assert incoming["extra"]["smsType"] == "received"
    assert incoming["extra"]["smsTypeCode"] == 1
    assert incoming["extra"]["isRead"] is True
    assert incoming["extra"]["rawAddress"] == "13800001111"
    assert incoming["extra"]["deviceSerial"] == "redmi-test"


def test_unknown_contact_materialized(sms_db: Path) -> None:
    _, chunks = _drain(str(sms_db))
    persons = [p for c in chunks for p in c["persons"]]
    # 4 distinct addresses → 4 unknown Persons (no contacts_db_path provided)
    ids = {p["id"] for p in persons}
    assert "person:system:android:unknown:13800001111" in ids
    assert "person:system:android:unknown:10086" in ids
    assert "person:system:android:unknown:95588" in ids
    assert "person:system:android:unknown:13999998888" in ids
    assert len(persons) == 4


def test_missing_data_path_raises_invalid_params() -> None:
    with pytest.raises(IpcError) as info:
        dispatch("system.parse_sms", {}, lambda *a, **k: None, lambda b: None)
    assert info.value.code == "INVALID_PARAMS"


def test_sms_table_missing_raises_corrupt(tmp_path: Path) -> None:
    bogus = tmp_path / "empty.db"
    conn = sqlite3.connect(str(bogus))
    conn.execute("CREATE TABLE other (x INTEGER)")
    conn.commit()
    conn.close()
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_sms",
            {"data_path": str(bogus)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "DB_FILE_CORRUPT"


def test_capabilities_includes_sms() -> None:
    caps = dispatch("sidecar.capabilities", {}, lambda *a, **k: None, lambda b: None)
    assert "system.parse_sms" in caps["methods"]
