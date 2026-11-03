import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAuthorizedPublic139Dispatch,
  public139RoundDirectory,
  public139RoundSampleIds,
} from "../scripts/verify01-public139-dispatch.mjs";
const plan = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../docs/research/cli/verify01-openai-139/retest-plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const context = {
  source: "1".repeat(40),
  ref: "verify01-public139-run-" + "1".repeat(10),
  credentialPresent: true,
  runAttempt: 1,
};
test("the authorized two cases retain their original budgets", () =>
  assert.equal(assertAuthorizedPublic139Dispatch(plan, context), true));
test("a fresh round uses a distinct immutable ref and evidence directory", () => {
  const roundDirectory = "docs/research/cli/verify01-openai-139-r2-20261103";
  const nextContext = {
    ...context,
    roundDirectory,
    ref: "verify01-native139-r2-" + context.source.slice(0, 10),
  };
  assert.equal(public139RoundDirectory(roundDirectory), roundDirectory);
  assert.equal(assertAuthorizedPublic139Dispatch(plan, nextContext), true);
  assert.throws(() =>
    assertAuthorizedPublic139Dispatch(plan, {
      ...nextContext,
      ref: context.ref,
    }),
  );
  assert.throws(() =>
    assertAuthorizedPublic139Dispatch(plan, {
      ...context,
      ref: nextContext.ref,
    }),
  );
  for (const path of [
    "../verify01-openai-139",
    "docs/research/cli/verify01-openai-139-r3",
  ]) {
    assert.throws(() => public139RoundDirectory(path));
  }
});
test("rejects absent credentials, retries, wrong source references and changed task scope", () => {
  for (const change of [
    { credentialPresent: false },
    { runAttempt: 2 },
    { ref: "main" },
  ])
    assert.throws(() =>
      assertAuthorizedPublic139Dispatch(plan, { ...context, ...change }),
    );
  for (const change of [
    { selectedSampleIds: [...plan.selectedSampleIds, "verify-19"] },
    { reviewChanges: false },
    {
      projectRevisionFile:
        "docs/research/cli/verify01-openai-139/project-revision.json",
    },
    { maximumPhysicalRequestsAcrossSelectedSamples: 96 },
    { versions: { ...plan.versions, cli: "0.166.138" } },
    { requestBudgets: { ...plan.requestBudgets, modelTurns: 40 } },
    {
      dispatches: [
        ...plan.dispatches,
        { group: "windows-cli", sampleIds: ["verify-19"] },
      ],
    },
  ])
    assert.throws(() =>
      assertAuthorizedPublic139Dispatch({ ...plan, ...change }, context),
    );
});

test("round three admits only the still-unaccepted sample within one request budget", () => {
  const roundDirectory = "docs/research/cli/verify01-openai-139-r3-20261103";
  const next = {
    ...plan,
    selectedSampleIds: ["verify-08"],
    dispatches: [plan.dispatches[0]],
    maximumPhysicalRequestsAcrossSelectedSamples: 24,
  };
  const nextContext = {
    ...context,
    roundDirectory,
    ref: `verify01-native139-r3-${context.source.slice(0, 10)}`,
  };
  assert.deepEqual(public139RoundSampleIds(roundDirectory), ["verify-08"]);
  assert.equal(assertAuthorizedPublic139Dispatch(next, nextContext), true);
  for (const change of [
    { selectedSampleIds: ["verify-36"] },
    { selectedSampleIds: ["verify-08", "verify-36"] },
    { dispatches: plan.dispatches },
    { maximumPhysicalRequestsAcrossSelectedSamples: 48 },
    { reviewChanges: false },
  ])
    assert.throws(() =>
      assertAuthorizedPublic139Dispatch({ ...next, ...change }, nextContext),
    );
  assert.throws(() => assertAuthorizedPublic139Dispatch(next, context));
});
