from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from chainlesschain_agent_sdk import (
    CC_AGENT_STREAM_EVENT_TYPES,
    KNOWN_EVENT_CLASSES,
    PROTOCOL_FEATURES,
    ApprovalRequestEvent,
    ApprovalResolvedEvent,
    ContentDeltaEvent,
    PlanUpdateEvent,
    ProtocolDecodeError,
    QuestionRequestEvent,
    ResultEvent,
    SystemInitEvent,
    ToolResultEvent,
    UnknownAgentEvent,
    UnknownContentDelta,
    parse_event,
    parse_event_json,
    validate_approval_decision,
    validate_agent_stream_event,
    validate_canonical_agent_stream_event,
)

from tests.event_samples import EVENT_SAMPLES


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PACKAGE_ROOT.parent / "agent-sdk" / "__fixtures__" / "protocol"
TYPESCRIPT_PROTOCOL = PACKAGE_ROOT.parent / "agent-sdk" / "src" / "protocol.ts"
APPROVAL_FIXTURES = (
    PACKAGE_ROOT.parent
    / "agent-protocol"
    / "test"
    / "fixtures"
    / "approval-decisions.json"
)
AGENT_STREAM_EVENT_FIXTURES = (
    PACKAGE_ROOT.parent
    / "agent-protocol"
    / "test"
    / "fixtures"
    / "agent-stream-events.json"
)
CANONICAL_AGENT_STREAM_PAYLOAD_FIXTURES = (
    PACKAGE_ROOT.parent
    / "agent-protocol"
    / "test"
    / "fixtures"
    / "canonical-agent-stream-payloads.json"
)
CAUSAL_AGENT_STREAM_FIXTURE = (
    PACKAGE_ROOT.parent
    / "agent-sdk"
    / "__fixtures__"
    / "protocol"
    / "causal-conformance.json"
)


class ProtocolTests(unittest.TestCase):
    def test_generated_structured_approval_validator(self) -> None:
        self.assertEqual(validate_approval_decision({"kind": "acceptOnce"}), (True, ()))
        self.assertTrue(
            validate_approval_decision(
                {
                    "kind": "acceptForSession",
                    "permissions": [
                        {"capability": "tool:run_shell", "scope": "npm test"}
                    ],
                }
            )[0]
        )
        self.assertFalse(
            validate_approval_decision(
                {"kind": "acceptOnce", "unexpected": True}
            )[0]
        )
        self.assertFalse(validate_approval_decision({"kind": "allowEverything"})[0])

    def test_shared_approval_decision_conformance_fixture(self) -> None:
        fixtures = json.loads(APPROVAL_FIXTURES.read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(fixture["name"]):
                self.assertEqual(
                    validate_approval_decision(fixture["value"])[0],
                    fixture["valid"],
                )

    def test_shared_agent_stream_event_conformance_fixture(self) -> None:
        fixtures = json.loads(AGENT_STREAM_EVENT_FIXTURES.read_text(encoding="utf-8"))
        for fixture in fixtures:
            with self.subTest(fixture["name"]):
                # JSON cannot encode Python's undefined sentinel; that case is
                # exercised by the JavaScript validators.
                if fixture.get("injectUndefinedAt"):
                    continue
                self.assertEqual(
                    validate_agent_stream_event(fixture["value"])[0],
                    fixture["valid"],
                )
        self.assertIn("hook_started", CC_AGENT_STREAM_EVENT_TYPES)
        self.assertIn("structured_result", CC_AGENT_STREAM_EVENT_TYPES)

    def test_shared_canonical_agent_payload_conformance_fixture(self) -> None:
        fixtures = json.loads(
            CANONICAL_AGENT_STREAM_PAYLOAD_FIXTURES.read_text(encoding="utf-8")
        )
        for fixture in fixtures:
            with self.subTest(fixture["name"]):
                self.assertEqual(
                    validate_canonical_agent_stream_event(fixture["value"])[0],
                    fixture["valid"],
                )

    def test_shared_causal_agent_stream_fixture_is_lossless(self) -> None:
        fixture = json.loads(
            CAUSAL_AGENT_STREAM_FIXTURE.read_text(encoding="utf-8")
        )
        baseline = None
        for fixture_case in fixture["cases"]:
            events = [parse_event(event) for event in fixture_case["events"]]
            self.assertEqual(
                [event.to_dict() for event in events], fixture_case["events"]
            )
            normalized = sorted(
                (
                    event.type,
                    event.to_dict().get("id"),
                    event.to_dict().get("tool"),
                    event.to_dict().get("binding"),
                    event.to_dict().get("subtype"),
                )
                for event in events
            )
            if baseline is None:
                baseline = normalized
            self.assertEqual(normalized, baseline, fixture_case["name"])

    def test_approval_events_preserve_binding_and_decision(self) -> None:
        request = parse_event(
            {
                "type": "approval_request",
                "id": "approval-1",
                "binding": "sha256:binding",
                "requested_permissions": [
                    {"capability": "tool:run_shell", "scope": "npm test"}
                ],
            }
        )
        resolved = parse_event(
            {
                "type": "approval_resolved",
                "id": "approval-1",
                "approved": True,
                "via": "user-approve",
                "decision": {"kind": "acceptOnce"},
            }
        )
        self.assertIsInstance(request, ApprovalRequestEvent)
        self.assertEqual(request.binding, "sha256:binding")
        self.assertEqual(
            [dict(permission) for permission in request.requested_permissions],
            [{"capability": "tool:run_shell", "scope": "npm test"}],
        )
        self.assertIsInstance(resolved, ApprovalResolvedEvent)
        self.assertEqual(dict(resolved.decision), {"kind": "acceptOnce"})

    def test_protocol_features_advertise_permission_decisions(self) -> None:
        self.assertEqual(
            PROTOCOL_FEATURES,
            ("event_seq", "tool_use_id", "permission_decision", "trace_id"),
        )

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
                "binding": {
                    "backgroundAgentId": None,
                    "sessionId": "s",
                    "turnId": "turn-1",
                    "toolUseId": "tool-1",
                    "sequence": 1,
                },
                "metadata": {
                    "kind": "mcp_elicitation",
                    "server": "demo",
                    "requestId": 42,
                    "mode": "url",
                    "elicitationId": "elicit-42",
                    "url": "https://accounts.example.test/authorize",
                    "urlHost": "accounts.example.test",
                    "requestedSchema": {"type": "object"},
                    "future": 1,
                },
            }
        )
        self.assertIsInstance(question, QuestionRequestEvent)
        self.assertTrue(question.is_mcp_elicitation)
        self.assertEqual(question.binding["turnId"], "turn-1")
        self.assertEqual(question.binding["sequence"], 1)
        self.assertEqual(question.metadata.request_id, 42)
        self.assertEqual(question.metadata.mode, "url")
        self.assertEqual(question.metadata.elicitation_id, "elicit-42")
        self.assertEqual(
            question.metadata.url, "https://accounts.example.test/authorize"
        )
        self.assertEqual(question.metadata.url_host, "accounts.example.test")
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

    def test_tool_result_exposes_the_permission_decision(self) -> None:
        event = parse_event(
            {
                "type": "tool_result",
                "id": "tu-1",
                "tool": "run_shell",
                "is_error": True,
                "permission_decision_id": "tu-1:perm:managed",
                "permission_decision": {
                    "version": 1,
                    "id": "tu-1:perm:managed",
                    "tool": "run_shell",
                    "decision": "deny",
                    "via": "managed",
                    "rule": "Bash(publish:*)",
                    "reason": "publishing is disabled",
                    "chain": [],
                },
            }
        )
        self.assertIsInstance(event, ToolResultEvent)
        self.assertEqual(event.permission_decision_id, "tu-1:perm:managed")
        self.assertEqual(event.permission_decision["decision"], "deny")

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
