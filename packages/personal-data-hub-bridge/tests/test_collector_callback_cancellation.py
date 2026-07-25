"""Cancellation propagation at legacy collector progress boundaries."""

from __future__ import annotations

import pytest

from forensics_bridge.extractors import android, qq_nt, wechat_pc
from forensics_bridge.ipc_server import _RequestCancelled


def _cancelling_progress(calls):
    def cancel(processed: int, total: int, phase: str) -> None:
        calls.append((processed, total, phase))
        raise _RequestCancelled()

    return cancel


def test_android_collect_system_data_propagates_progress_cancellation(
    monkeypatch,
) -> None:
    calls = []

    def unexpected_pull(*_args, **_kwargs):
        raise AssertionError("root pull must not start after cancellation")

    monkeypatch.setattr(android, "root_pull", unexpected_pull)

    with pytest.raises(_RequestCancelled):
        android.collect_system_data(
            {"local_dir": "unused"},
            _cancelling_progress(calls),
            lambda _batch: None,
        )

    assert calls == [(1, len(android._SYSTEM_DATA_TARGETS), "pulling contacts2.db")]


def test_wechat_collect_propagates_canonical_progress_cancellation(
    monkeypatch,
) -> None:
    calls = []
    monkeypatch.setattr(
        wechat_pc,
        "find_accounts",
        lambda: [
            {
                "id": "wxid-test",
                "messageDbs": ["missing-message.db"],
                "bizDbs": [],
                "contactDb": None,
                "snsDb": None,
                "favoriteDb": None,
            }
        ],
    )

    def unexpected_key_scan(*_args, **_kwargs):
        raise AssertionError("memory scan must not start after cancellation")

    monkeypatch.setattr(wechat_pc, "extract_keys_for_salts", unexpected_key_scan)

    with pytest.raises(_RequestCancelled):
        wechat_pc.m_collect(
            {},
            _cancelling_progress(calls),
            lambda _batch: None,
        )

    assert calls == [(0, 0, "extract-keys")]


@pytest.mark.parametrize(
    ("with_contact", "expected_phase"),
    [
        (True, "decrypt contact.db"),
        (False, "decrypt message.db"),
    ],
)
def test_wechat_collect_propagates_decrypt_progress_cancellation(
    monkeypatch,
    tmp_path,
    with_contact,
    expected_phase,
) -> None:
    calls = []
    message_db = tmp_path / "message.db"
    contact_db = tmp_path / "contact.db"
    message_db.write_bytes(b"m" * 16)
    contact_db.write_bytes(b"c" * 16)
    monkeypatch.setattr(
        wechat_pc,
        "find_accounts",
        lambda: [
            {
                "id": "wxid-test",
                "messageDbs": [str(message_db)],
                "bizDbs": [],
                "contactDb": str(contact_db) if with_contact else None,
                "snsDb": None,
                "favoriteDb": None,
            }
        ],
    )

    with pytest.raises(_RequestCancelled):
        wechat_pc.m_collect(
            {
                "key": "00" * 32,
                "staging_dir": str(tmp_path / "staging"),
            },
            _cancelling_progress(calls),
            lambda _batch: None,
        )

    assert calls == [(0, 1, expected_phase)]


def test_qq_nt_collect_propagates_canonical_progress_cancellation() -> None:
    calls = []

    with pytest.raises(_RequestCancelled):
        qq_nt.m_collect(
            {
                "passphrase": "test-key",
                "db_path": "must-not-be-opened.db",
            },
            _cancelling_progress(calls),
            lambda _batch: None,
        )

    assert calls == [(0, 1, "decrypt nt_msg.db")]
