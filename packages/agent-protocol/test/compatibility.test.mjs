import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProtocolCompatible,
  compareProtocolSchemas,
} from "../src/compatibility.mjs";

const base = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string" } },
  $defs: {
    Event: {
      type: "object",
      required: ["type"],
      properties: { type: { const: "event" } },
    },
  },
};

test("optional fields and definitions are additive", () => {
  const next = structuredClone(base);
  next.properties.trace_id = { type: "string" };
  next.$defs.NewEvent = { type: "object", properties: {} };
  const report = assertProtocolCompatible(base, next);
  assert.equal(report.compatible, true);
  assert.ok(
    report.changes.some((change) => change.kind === "optional_property_added"),
  );
});

test("required fields, removed fields and tightened bounds are breaking", () => {
  const next = structuredClone(base);
  next.required.push("trace_id");
  next.properties.trace_id = { type: "string", minLength: 8 };
  delete next.$defs.Event.properties.type;
  const report = compareProtocolSchemas(base, next);
  assert.equal(report.compatible, false);
  assert.throws(() => assertProtocolCompatible(base, next), {
    code: "CC_PROTOCOL_BREAKING_CHANGE",
  });
});
