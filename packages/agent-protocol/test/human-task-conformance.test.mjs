import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/human-task-settlement-conformance.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("HumanTask settlement fixture is bounded and surface-complete", () => {
  assert.equal(fixture.schema_version, 1);
  assert.deepEqual(fixture.surfaces, ["graph", "desktop", "vscode"]);
  assert.ok(fixture.scenarios.length > 0 && fixture.scenarios.length <= 64);

  const knownSurfaces = new Set(fixture.surfaces);
  const knownActions = new Set(fixture.actions);
  const names = new Set();
  for (const scenario of fixture.scenarios) {
    assert.match(scenario.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(names.has(scenario.name), false, scenario.name);
    names.add(scenario.name);
    assert.ok(scenario.surfaces.length > 0);
    assert.ok(scenario.steps.length > 0 && scenario.steps.length <= 16);
    assert.ok(Number.isInteger(scenario.quorum));
    assert.ok(scenario.quorum >= 1 && scenario.quorum <= 64);
    assert.equal(typeof scenario.separation_of_duties, "boolean");
    assert.ok(
      ["approve", "decline", "cancel"].includes(scenario.expected.winner),
    );

    for (const surface of scenario.surfaces) {
      assert.equal(
        knownSurfaces.has(surface),
        true,
        `${scenario.name}:${surface}`,
      );
      assert.ok(scenario.expected[surface], `${scenario.name}:${surface}`);
    }
    for (const step of scenario.steps) {
      assert.equal(knownActions.has(step.action), true, scenario.name);
      for (const surface of scenario.surfaces) {
        assert.ok(
          step.expect[surface],
          `${scenario.name}:${step.action}:${surface}`,
        );
        assert.ok(
          ["settled", "rejected"].includes(step.expect[surface]),
          `${scenario.name}:${step.action}:${surface}`,
        );
      }
      if (["approve", "decline"].includes(step.action)) {
        assert.match(step.actor_id, /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
      }
      if (step.action === "advance") {
        assert.ok(Number.isInteger(step.milliseconds));
        assert.ok(step.milliseconds > 0 && step.milliseconds <= 60_000);
      }
    }
  }
});
