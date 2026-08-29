"use strict";

const { cloneCanonical } = require("./canonical.js");
const { invalidArgument } = require("./errors.js");

const CONTEXT_MEMORY_CONFORMANCE_SURFACES = Object.freeze([
  "cli-js",
  "desktop-js",
  "app-server",
  "typescript-sdk",
  "python-sdk",
  "vscode",
  "jetbrains",
]);

const CONTEXT_MEMORY_CONFORMANCE_SCENARIOS = Object.freeze([
  "multilingual-window-512",
  "multilingual-window-4096",
  "parallel-tools-pending",
  "orphan-late-tool-result",
  "overlapping-scopes",
  "provider-normal",
  "provider-failure",
  "provider-usage-unknown",
  "provider-cancelled",
  "crash-restart",
  "cas-race",
  "index-rebuild",
  "offline-replica-reinjection",
  "partial-delete-reconcile",
]);

const REQUIRED_COLUMNS = Object.freeze([
  "method",
  "type",
  "memory_id",
  "memory_revision",
  "record_memory_id",
  "expected_memory_count",
  "scenario_id",
  "category",
  "surfaces",
  "input_json",
  "expected_json",
]);

function parseJsonCell(value, field, lineNumber) {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) {
    throw invalidArgument(`${field} exceeds 64 KiB`, { lineNumber, field });
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("JSON cell must contain an object");
    }
    return parsed;
  } catch (cause) {
    throw invalidArgument(`${field} is not a JSON object`, {
      lineNumber,
      field,
      cause: cause.message,
    });
  }
}

function parseContextMemoryConformanceFixture(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw invalidArgument("conformance fixture must be a non-empty string");
  }
  const lines = source.trim().split(/\r?\n/u);
  const columns = lines[0].split("\t");
  if (
    columns.length !== REQUIRED_COLUMNS.length ||
    columns.some((column, index) => column !== REQUIRED_COLUMNS[index])
  ) {
    throw invalidArgument("conformance fixture columns are not canonical", {
      expected: REQUIRED_COLUMNS,
      actual: columns,
    });
  }
  const rows = lines.slice(1).map((line, index) => {
    const fields = line.split("\t");
    if (fields.length !== columns.length) {
      throw invalidArgument(
        "conformance fixture row has the wrong field count",
        {
          lineNumber: index + 2,
        },
      );
    }
    return Object.fromEntries(
      columns.map((column, fieldIndex) => [column, fields[fieldIndex]]),
    );
  });
  const events = rows.filter((row) =>
    ["context/event", "memory/event"].includes(row.method),
  );
  const expectedRows = rows.filter((row) => row.method === "expected");
  const fixtureRows = rows.filter((row) => row.method === "fixture");
  const unknown = rows.filter(
    (row) =>
      !["context/event", "memory/event", "expected", "fixture"].includes(
        row.method,
      ),
  );
  if (unknown.length > 0 || expectedRows.length !== 1 || events.length === 0) {
    throw invalidArgument("conformance fixture row kinds are invalid", {
      unknown: unknown.map((row) => row.method),
      expectedRowCount: expectedRows.length,
      eventCount: events.length,
    });
  }
  const cases = fixtureRows.map((row, index) => ({
    id: row.scenario_id,
    category: row.category,
    operation: row.type,
    surfaces: row.surfaces.split(",").filter(Boolean),
    input: parseJsonCell(row.input_json, "input_json", index + 2),
    expected: parseJsonCell(row.expected_json, "expected_json", index + 2),
  }));
  if (new Set(cases.map((entry) => entry.id)).size !== cases.length) {
    throw invalidArgument("conformance scenario IDs must be unique");
  }
  const actualScenarios = [...cases.map((entry) => entry.id)].sort();
  const requiredScenarios = [...CONTEXT_MEMORY_CONFORMANCE_SCENARIOS].sort();
  if (JSON.stringify(actualScenarios) !== JSON.stringify(requiredScenarios)) {
    throw invalidArgument(
      "conformance fixture scenario coverage is incomplete",
      {
        requiredScenarios,
        actualScenarios,
      },
    );
  }
  for (const scenario of cases) {
    const actualSurfaces = [...new Set(scenario.surfaces)].sort();
    const requiredSurfaces = [...CONTEXT_MEMORY_CONFORMANCE_SURFACES].sort();
    if (JSON.stringify(actualSurfaces) !== JSON.stringify(requiredSurfaces)) {
      throw invalidArgument(
        "conformance scenario surface coverage is incomplete",
        {
          scenarioId: scenario.id,
          requiredSurfaces,
          actualSurfaces,
        },
      );
    }
  }
  return Object.freeze({
    events: Object.freeze(cloneCanonical(events)),
    cases: Object.freeze(cloneCanonical(cases)),
    expected: Object.freeze(cloneCanonical(expectedRows[0])),
  });
}

module.exports = {
  CONTEXT_MEMORY_CONFORMANCE_SCENARIOS,
  CONTEXT_MEMORY_CONFORMANCE_SURFACES,
  parseContextMemoryConformanceFixture,
};
