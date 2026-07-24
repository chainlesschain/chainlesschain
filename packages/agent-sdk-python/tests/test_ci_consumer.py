from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from chainlesschain_agent_sdk import (
    KNOWN_EVENT_CLASSES,
    UnknownAgentEvent,
    parse_event,
)
from examples.ci_gate import (
    HANDLED_EVENT_CLASSES,
    CiEventConsumer,
    assert_exhaustive_handlers,
    main,
)
from tests.event_samples import EVENT_SAMPLES


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PACKAGE_ROOT.parent / "agent-sdk" / "__fixtures__" / "protocol"


class CiConsumerTests(unittest.TestCase):
    def test_handler_inventory_is_exhaustive(self) -> None:
        assert_exhaustive_handlers()
        self.assertEqual(
            HANDLED_EVENT_CLASSES,
            frozenset(KNOWN_EVENT_CLASSES) | {UnknownAgentEvent},
        )

    def test_all_known_classes_and_unknown_are_journaled_before_dispatch(self) -> None:
        journal = io.StringIO()
        console = io.StringIO()
        consumer = CiEventConsumer(journal, console=console)
        events = [parse_event(sample) for _, sample in EVENT_SAMPLES]
        events.append(
            parse_event({"type": "future_ci_event", "payload": {"kept": True}})
        )
        for event in events:
            consumer.consume(event)

        written = [json.loads(line) for line in journal.getvalue().splitlines()]
        self.assertEqual(written, [event.to_dict() for event in events])
        self.assertEqual(consumer.total, len(events))
        self.assertEqual(consumer.unknown, 1)
        self.assertIn("preserved in the event journal", console.getvalue())

    def test_replay_mode_consumes_shared_canonical_fixtures_losslessly(self) -> None:
        fixture_paths = sorted(FIXTURE_ROOT.glob("*.ndjson"))
        expected = [
            json.loads(line)
            for path in fixture_paths
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "events.ndjson"
            code = main(
                [
                    "--replay",
                    *(str(path) for path in fixture_paths),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(code, 0)
            actual = [
                json.loads(line)
                for line in output.read_text(encoding="utf-8").splitlines()
            ]
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
