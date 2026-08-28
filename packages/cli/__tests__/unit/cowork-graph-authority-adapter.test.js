import { describe, expect, it } from "vitest";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import {
  CoworkGraphAuthorityAdapter,
  coworkGraphAuthorityMode,
} from "../../src/lib/cowork-graph-authority-adapter.js";
import { GraphEventStore } from "../../src/lib/graph-kernel/event-store.js";

const ADMISSION = Object.freeze({
  definitionDigest: `sha256:${"a".repeat(64)}`,
  admissionDigest: `sha256:${"b".repeat(64)}`,
});
const WORKFLOW = Object.freeze({ id: "workflow-1", name: "Workflow 1" });

function eventStore() {
  return new GraphEventStore({ rolloutStore: new MemoryRolloutStore() });
}

class CrashAfterGraphAppendStore extends GraphEventStore {
  arm(type) {
    this.crashType = type;
  }

  append(...args) {
    const event = super.append(...args);
    if (args[1] === this.crashType) {
      this.crashType = null;
      throw new Error(`crash after ${args[1]}`);
    }
    return event;
  }
}

function ids(prefix) {
  let count = 0;
  return () => `${prefix}-${++count}`;
}

describe("Cowork Graph terminal authority", () => {
  it("recovers the exact committed result without replaying the provider", () => {
    const store = eventStore();
    const first = new CoworkGraphAuthorityAdapter({
      mode: "canonical",
      eventStore: store,
      createId: ids("first"),
    });
    const claim = first.begin({ workflow: WORKFLOW, admission: ADMISSION });
    const record = { workflowId: WORKFLOW.id, status: "completed" };
    expect(first.settleSuccess(claim, record)).toMatchObject({
      status: "succeeded",
      originSurface: "cowork",
      authoritySource: "graph_kernel",
    });

    const recovered = new CoworkGraphAuthorityAdapter({
      mode: "canonical",
      eventStore: store,
      createId: ids("recovered"),
    }).begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(recovered).toMatchObject({
      alreadySettled: true,
      record,
      projection: { status: "succeeded", authorityGeneration: 2 },
    });
  });

  it("pins an existing canonical run across a ledger rollback", () => {
    const store = eventStore();
    let selectedMode = "canonical";
    const resolveAuthority = ({ runKey }) => {
      expect(runKey).toMatch(/^cowork:/u);
      return selectedMode;
    };
    const first = new CoworkGraphAuthorityAdapter({
      mode: "legacy",
      authorityResolver: resolveAuthority,
      eventStore: store,
      createId: ids("rollback-first"),
    });
    const claim = first.begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(claim.authorityMode).toBe("canonical");
    first.settleSuccess(claim, { status: "completed" });

    selectedMode = "legacy";
    const recovered = new CoworkGraphAuthorityAdapter({
      mode: "legacy",
      authorityResolver: resolveAuthority,
      eventStore: store,
      createId: ids("rollback-recovered"),
    }).begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(recovered).toMatchObject({
      authorityMode: "canonical",
      alreadySettled: true,
    });
    expect(
      new CoworkGraphAuthorityAdapter({
        mode: "canonical",
        authorityResolver: resolveAuthority,
        eventStore: store,
      }).begin({
        workflow: { ...WORKFLOW, id: "workflow-after-rollback" },
        admission: {
          ...ADMISSION,
          admissionDigest: `sha256:${"c".repeat(64)}`,
        },
      }),
    ).toBeNull();
  });

  it("keeps shadow execution effect-free and detects result divergence", () => {
    const store = eventStore();
    const first = new CoworkGraphAuthorityAdapter({
      mode: "shadow",
      eventStore: store,
      createId: ids("shadow-first"),
    });
    const record = { workflowId: WORKFLOW.id, status: "completed" };
    first.settleSuccess(
      first.begin({ workflow: WORKFLOW, admission: ADMISSION }),
      record,
    );
    const observer = new CoworkGraphAuthorityAdapter({
      mode: "shadow",
      eventStore: store,
      createId: ids("shadow-next"),
    });
    const claim = observer.begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(claim).toMatchObject({ alreadySettled: false, compareOnly: true });
    expect(observer.settleSuccess(claim, record)).toMatchObject({
      status: "succeeded",
      authoritySource: "graph_kernel_shadow",
    });
    expect(() =>
      observer.settleSuccess(claim, { ...record, status: "failed" }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_COWORK_GRAPH_SHADOW_DIVERGENCE" }),
    );
  });

  it("fails closed on an unknown provider outcome", () => {
    const authority = new CoworkGraphAuthorityAdapter({
      mode: "canonical",
      eventStore: eventStore(),
      createId: ids("unknown"),
    });
    const claim = authority.begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(
      authority.settleFailure(claim, new Error("connection lost")),
    ).toMatchObject({
      status: "reconciliation_required",
      reconciliationEffectIds: [expect.any(String)],
    });
  });

  it("recovers a crash after result and effect commit without provider replay", () => {
    const store = new CrashAfterGraphAppendStore({
      rolloutStore: new MemoryRolloutStore(),
    });
    const first = new CoworkGraphAuthorityAdapter({
      mode: "canonical",
      eventStore: store,
      createId: ids("cutpoint-first"),
    });
    const claim = first.begin({ workflow: WORKFLOW, admission: ADMISSION });
    const record = { workflowId: WORKFLOW.id, status: "completed" };
    store.arm("effect.settled");
    expect(() => first.settleSuccess(claim, record)).toThrowError(
      /crash after effect\.settled/u,
    );

    const recovered = new CoworkGraphAuthorityAdapter({
      mode: "canonical",
      eventStore: store,
      createId: ids("cutpoint-recovered"),
    }).begin({ workflow: WORKFLOW, admission: ADMISSION });
    expect(recovered).toMatchObject({
      alreadySettled: true,
      record,
      projection: { status: "succeeded", authorityGeneration: 2 },
    });
  });

  it("keeps rollout explicit", () => {
    expect(coworkGraphAuthorityMode({})).toBe("legacy");
    expect(
      coworkGraphAuthorityMode({ CHAINLESSCHAIN_GRAPH_COWORK: "shadow" }),
    ).toBe("shadow");
    expect(() =>
      coworkGraphAuthorityMode({ CHAINLESSCHAIN_GRAPH_COWORK: "invalid" }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_AUTHORITY_MODE_INVALID" }),
    );
  });
});
