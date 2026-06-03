"""Unit tests for system.parse_contacts.

Fixtures synthesize a minimal contacts2.db with the schema Android actually uses
(raw_contacts + data + mimetypes), so we don't ship a real device dump and we
don't depend on /data/data permissions to run tests.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Dict, List, Tuple

import pytest

from forensics_bridge.dispatcher import IpcError, dispatch
from forensics_bridge.parsers.system import parse_contacts  # noqa: F401 (registers)


# ---------------------------------------------------------------------------
# Fixture: synthetic Android contacts2.db
# ---------------------------------------------------------------------------

_MIMETYPES = {
    "vnd.android.cursor.item/phone_v2": 5,
    "vnd.android.cursor.item/email_v2": 1,
    "vnd.android.cursor.item/organization": 4,
    "vnd.android.cursor.item/note": 10,
    "vnd.android.cursor.item/photo": 14,
}


def _seed_contacts_db(
    db_path: Path,
    contacts: List[Tuple[int, str, int]],  # (raw_id, display_name, starred)
    data: List[Tuple[int, str, str]],       # (raw_id, mimetype, value)
) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(
            """
            CREATE TABLE raw_contacts (
              _id INTEGER PRIMARY KEY,
              display_name TEXT,
              starred INTEGER DEFAULT 0,
              deleted INTEGER DEFAULT 0
            );
            CREATE TABLE mimetypes (
              _id INTEGER PRIMARY KEY,
              mimetype TEXT NOT NULL UNIQUE
            );
            CREATE TABLE data (
              _id INTEGER PRIMARY KEY,
              raw_contact_id INTEGER NOT NULL,
              mimetype_id INTEGER NOT NULL,
              data1 TEXT
            );
            """
        )
        conn.executemany(
            "INSERT INTO mimetypes (_id, mimetype) VALUES (?, ?)",
            [(mid, mt) for mt, mid in _MIMETYPES.items()],
        )
        conn.executemany(
            "INSERT INTO raw_contacts (_id, display_name, starred, deleted) VALUES (?, ?, ?, 0)",
            contacts,
        )
        for raw_id, mt, value in data:
            mid = _MIMETYPES[mt]
            conn.execute(
                "INSERT INTO data (raw_contact_id, mimetype_id, data1) VALUES (?, ?, ?)",
                (raw_id, mid, value),
            )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def contacts_db(tmp_path: Path) -> Path:
    """Realistic mixed-content contacts2.db: 4 contacts incl. starred + multi-phone + email."""
    db = tmp_path / "contacts2.db"
    _seed_contacts_db(
        db,
        contacts=[
            (1, "妈妈", 1),
            (2, "张三", 0),
            (3, "李四 Manager", 0),
            (4, "", 0),  # nameless — should be skipped
        ],
        data=[
            (1, "vnd.android.cursor.item/phone_v2", "13800001111"),
            (1, "vnd.android.cursor.item/phone_v2", "13900002222"),
            (1, "vnd.android.cursor.item/email_v2", "mom@example.com"),
            (1, "vnd.android.cursor.item/note", "亲妈，过年回家"),
            (2, "vnd.android.cursor.item/phone_v2", "13711112222"),
            (3, "vnd.android.cursor.item/phone_v2", "13822223333"),
            (3, "vnd.android.cursor.item/email_v2", "lisi@corp.example.com"),
            (3, "vnd.android.cursor.item/organization", "Example Corp"),
            (3, "vnd.android.cursor.item/photo", "content://com.android.contacts/3"),
            # raw_id 4 deliberately has no data rows
        ],
    )
    return db


def _drain(db_path: str, **extra) -> Tuple[Dict, List[List[Dict]], List[Tuple[int, int, str]]]:
    """Run parse_contacts collecting all chunks and progress events."""
    chunks: List[List[Dict]] = []
    progress: List[Tuple[int, int, str]] = []

    def on_progress(p: int, t: int, phase: str = "") -> None:
        progress.append((p, t, phase))

    def on_chunk(batch: Dict) -> None:
        # We only emit Persons in this method; verify the contract anyway.
        assert batch["events"] == []
        assert batch["places"] == []
        assert batch["items"] == []
        chunks.append(batch["persons"])

    result = dispatch(
        "system.parse_contacts",
        {"data_path": str(db_path), **extra},
        on_progress,
        on_chunk,
    )
    return result, chunks, progress


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_basic_extraction_yields_three_persons_and_skips_nameless(contacts_db: Path) -> None:
    result, chunks, _progress = _drain(str(contacts_db))
    persons = [p for chunk in chunks for p in chunk]
    assert result["status"] == "ok"
    assert result["totalPersons"] == 3
    assert result["watermark"] is None
    assert len(persons) == 3
    # Nameless raw_id=4 must not surface.
    assert all(p["id"] != "person:system:android:4" for p in persons)


def test_person_envelope_matches_unified_schema(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db))
    persons = [p for chunk in chunks for p in chunk]
    mom = next(p for p in persons if p["names"] == ["妈妈"])
    assert mom == {
        "id": "person:system:android:1",
        "type": "person",
        "subtype": "contact",
        "names": ["妈妈"],
        "ingestedAt": mom["ingestedAt"],  # derived from file mtime
        "confidence": 1.0,
        "identifiers": {
            "phone": ["13800001111", "13900002222"],
            "email": ["mom@example.com"],
        },
        "source": {
            "adapter": "system-data",
            "adapterVersion": "0.1.0",
            "originalId": "1",
            "capturedAt": mom["source"]["capturedAt"],
            "capturedBy": "sqlite",
        },
        "extra": {"starred": True},
        "notes": "亲妈，过年回家",
    }


def test_identifiers_omit_email_when_absent(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db))
    persons = {p["id"]: p for chunk in chunks for p in chunk}
    zhang = persons["person:system:android:2"]
    assert zhang["identifiers"]["phone"] == ["13711112222"]
    assert "email" not in zhang["identifiers"]
    # extra has only `starred` for phone-only contact (no org / photo / notes).
    assert zhang["extra"] == {"starred": False}
    assert "notes" not in zhang


def test_organization_and_photo_propagate_to_extra(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db))
    persons = {p["id"]: p for chunk in chunks for p in chunk}
    lisi = persons["person:system:android:3"]
    assert lisi["identifiers"]["phone"] == ["13822223333"]
    assert lisi["identifiers"]["email"] == ["lisi@corp.example.com"]
    assert lisi["extra"]["organization"] == "Example Corp"
    assert lisi["extra"]["photoUri"] == "content://com.android.contacts/3"


def test_device_serial_propagates_into_extra(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db), device_serial="24115RA8EC-abcd1234")
    persons = [p for chunk in chunks for p in chunk]
    for p in persons:
        assert p["extra"]["deviceSerial"] == "24115RA8EC-abcd1234"


def test_chunking_respects_chunk_size(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db), chunk_size=2)
    # 3 persons + chunk_size 2 → expect 2 chunks (sizes 2, 1)
    assert [len(c) for c in chunks] == [2, 1]


def test_progress_events_have_done_phase(contacts_db: Path) -> None:
    _, _, progress = _drain(str(contacts_db))
    assert progress, "expected at least one progress event"
    assert progress[0][2] == "scanning"
    assert progress[-1][2] == "done"


def test_directory_path_resolves_to_contacts2db(contacts_db: Path) -> None:
    _, chunks, _ = _drain(str(contacts_db.parent))
    persons = [p for chunk in chunks for p in chunk]
    assert len(persons) == 3


def test_missing_data_path_raises_invalid_params() -> None:
    with pytest.raises(IpcError) as info:
        dispatch("system.parse_contacts", {}, lambda *a, **k: None, lambda b: None)
    assert info.value.code == "INVALID_PARAMS"


def test_path_not_found_raises_invalid_params(tmp_path: Path) -> None:
    bogus = tmp_path / "does-not-exist.db"
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_contacts",
            {"data_path": str(bogus)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "INVALID_PARAMS"


def test_corrupt_schema_raises_db_file_corrupt(tmp_path: Path) -> None:
    db = tmp_path / "bad.db"
    conn = sqlite3.connect(str(db))
    try:
        conn.execute("CREATE TABLE foo (bar INTEGER)")
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(IpcError) as info:
        dispatch(
            "system.parse_contacts",
            {"data_path": str(db)},
            lambda *a, **k: None,
            lambda b: None,
        )
    assert info.value.code == "DB_FILE_CORRUPT"


def test_sidecar_capabilities_lists_system_parser() -> None:
    caps = dispatch("sidecar.capabilities", {}, lambda *a, **k: None, lambda b: None)
    assert "system" in caps["parsers"]
    assert "system.parse_contacts" in caps["methods"]
