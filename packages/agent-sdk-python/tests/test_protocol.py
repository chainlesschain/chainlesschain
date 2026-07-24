from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from chainlesschain_agent_sdk import (
    KNOWN_EVENT_CLASSES,
    ContentDeltaEvent,
    PlanUpdateEvent,
    ProtocolDecodeError,
    QuestionRequestEvent,
    ResultEvent,
    SystemInitEvent,
    UnknownAgentEvent,
    UnknownContentDelta,
    parse_event,
    parse_event_json,
)

from tests.event_samples import EVENT_SAMPLES


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PACKAGE_ROOT.parent / "agent-sdk" / "__fixtures__" / "protocol"
TYPESCRIPT_PROTOCOL = PACKAGE_ROOT.parent / "agent-sdk" / "src" / "protocol.ts"


class ProtocolTests(unittest.TestCase):
    def test_event_inventory_matches_typescript_union(self) -> None:
        source = TYPESCRIPT_PROTOCOL.read_text(encoding="utf-8")
        match = re.search(
            r"export type AgentStreamEvent =(?P<body>.*?);",
            source,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        names = set(re.findall(r"\|\s+([A-Za-z][A-Za-z0-9]+)", match["body"]))
        names.discard("UnknownAgentEvent")
        self.assertEqual(
            {event_class.__name__ for event_class in KNOWN_EVENT_CLASSES},
            names,
        )

    def test_one_sample_maps_to_every_known_event_class(self) -> None:
        parsed = [parse_event(sample) for _, sample in EVENT_SAMPLES]
        self.assertEqual(
            [type(event).__name__ for event in parsed],
            [name for name, _ in EVENT_SAMPLES],
        )
        self.assertEqual({type(event) for event in parsed}, set(KNOWN_EVENT_CLASSES))

    def test_unknown_event_is_lossless_and_input_is_not_aliased(self) -> None:
        original = {
            "type": "future_v8",
            "payload": {"items": [1, 2]},
            "seq": 9,
            "new_field": True,
        }
        event = parse_event(original)
        self.assertIsInstance(event, UnknownAgentEvent)
        original["payload"]["items"].append(3)
        self.assertEqual(event.to_dict()["payload"]["items"], [1, 2])
        self.assertEqual(event.seq, 9)
        self.assertEqual(event.to_dict()["new_field"], True)
        with self.assertRaises(AttributeError):
            event.raw["payload"]["items"].append(4)

        exported = event.to_dict()
        exported["payload"]["items"].append(4)
        self.assertEqual(event.to_dict()["payload"]["items"], [1, 2])

    def test_additive_fields_survive_known_event_parsing(self) -> None:
        event = parse_event(
            {
                "type": "system",
                "subtype": "init",
                "session_id": "s",
                "seq": 1,
                "trace_id": "tr-1",
                "future": {"enabled": True},
            }
        )
        self.assertIsInstance(event, SystemInitEvent)
        self.assertEqual(event.seq, 1)
        self.assertEqual(event.trace_id, "tr-1")
        self.assertEqual(event.to_dict()["future"], {"enabled": True})

    def test_nested_typed_fields_and_forward_compatible_deltas(self) -> None:
        question = parse_event(
            {
                "type": "question_request",
                "id": "mcp-1",
                "question": "Configure",
                "metadata": {
                    "kind": "mcp_elicitation",
                    "server": "demo",
                    "requestId": 42,
                    "requestedSchema": {"type": "object"},
                    "future": 1,
                },
            }
        )
        self.assertIsInstance(question, QuestionRequestEvent)
        self.assertTrue(question.is_mcp_elicitation)
        self.assertEqual(question.metadata.request_id, 42)
        self.assertEqual(question.metadata.raw["future"], 1)

        plan = parse_event(
            {
                "type": "plan_update",
                "items": [{"id": "p1", "title": "Test", "turn": 2}],
                "risk": {"level": "low", "totalScore": 1},
                "execution_lock": {
                    "planId": "plan-1",
                    "permissionMode": "plan",
                    "approvedItemIds": ["p1"],
                    "allowedTools": ["read_file"],
                },
            }
        )
        self.assertIsInstance(plan, PlanUpdateEvent)
        self.assertEqual(plan.items[0].turn, 2)
        self.assertEqual(plan.risk.total_score, 1.0)
        self.assertEqual(plan.execution_lock.approved_item_ids, ("p1",))

        delta = parse_event(
            {
                "type": "stream_event",
                "event": {
                    "type": "content_block_delta",
                    "delta": {"type": "signature_delta", "signature": "abc"},
                },
            }
        )
        self.assertIsInstance(delta, ContentDeltaEvent)
        self.assertIsInstance(delta.delta, UnknownContentDelta)
        self.assertEqual(delta.to_dict()["event"]["delta"]["signature"], "abc")

    def test_runtime_result_subtypes_remain_accepted(self) -> None:
        event = parse_event(
            {
                "type": "result",
                "subtype": "error_max_budget",
                "is_error": True,
                "result": "",
            }
        )
        self.assertIsInstance(event, ResultEvent)
        self.assertEqual(event.subtype, "error_max_budget")

    def test_non_event_values_raise_a_protocol_error(self) -> None:
        for value in (None, [], "event", {"type": 1}, {"no_type": True}):
            with self.subTest(value=value):
                with self.assertRaises(ProtocolDecodeError):
                    parse_event(value)
        with self.assertRaises(ProtocolDecodeError):
            parse_event_json("{broken")

    def test_canonical_typescript_fixtures_are_all_forwarded(self) -> None:
        fixture_paths = sorted(FIXTURE_ROOT.glob("*.ndjson"))
        self.assertTrue(fixture_paths, FIXTURE_ROOT)
        raw_count = 0
        events = []
        for path in fixture_paths:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                raw_count += 1
                events.append(parse_event_json(line))

        self.assertEqual(len(events), raw_count)
        self.assertIn(
            "totally_new_event_v9",
            {
                event.event_type
                for event in events
                if isinstance(event, UnknownAgentEvent)
            },
        )
        elicitation = next(
            event
            for event in events
            if isinstance(event, QuestionRequestEvent) and event.is_mcp_elicitation
        )
        self.assertEqual(elicitation.metadata.server, "release-mcp")
        # Exact round-trip for every fixture object, including unknown types.
        expected_objects = [
            json.loads(line)
            for path in fixture_paths
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual([event.to_dict() for event in events], expected_objects)


if __name__ == "__main__":
    unittest.main()
