import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  GovernedSkillMarketplace,
  buildGovernedSkillMarketplaceManifest,
} from "../../src/lib/evolution/governed-skill-marketplace.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
const TARGET = {
  model: "qwen-3.5-9b",
  os: "linux-x64",
  tool: "cli",
  runtime: "node-22.12.0",
};

function manifest(overrides = {}) {
  return buildGovernedSkillMarketplaceManifest(
    {
      tenantId: "tenant:a",
      skillName: "repair-tests",
      version: "2.0.0",
      sourceModel: "qwen-3.6-27b",
      packageDigest: D("package"),
      sourceCommitDigest: D("commit"),
      sbomDigest: D("sbom"),
      dependencyLockDigest: D("lock"),
      permissionManifestDigest: D("permissions"),
      targetMatrixDigest: D("matrix"),
      evalBadgeDigest: D("badge"),
      lineage: [D("evidence"), D("candidate")],
      compatibilityMatrix: [
        { ...TARGET, accepted: true, evalReceiptDigest: D("target-eval") },
      ],
      ...overrides,
    },
    "signed-marketplace-manifest-value",
  );
}

function harness() {
  let state = null;
  const ports = {
    verifySignature: vi.fn(async () => true),
    adapt: vi.fn(async ({ manifest: value, cell }) => ({
      authenticated: true,
      manifestDigest: value.manifestDigest,
      evalReceiptDigest: cell.evalReceiptDigest,
      outputDigest: D("adapted-output"),
      adapterDigest: D("adapter"),
    })),
    load: vi.fn(async () => state),
    commit: vi.fn(async ({ state: next, expectedStateDigest }) => {
      state = next;
      return {
        authenticated: true,
        durable: true,
        stateDigest: next.stateDigest,
        expectedStateDigest,
      };
    }),
    transition: vi.fn(async ({ request, requestDigest }) => ({
      authenticated: true,
      durable: true,
      requestDigest,
      nextStage: request.nextStage,
      receiptDigest: D(`transition:${request.nextStage}`),
    })),
    verifyPilot: vi.fn(async ({ state: current, nextStage }) => ({
      authenticated: true,
      accepted: true,
      stateDigest: current.stateDigest,
      nextStage,
      receiptDigest: D(`pilot:${nextStage}`),
    })),
    verifyRevocation: vi.fn(async ({ state: current }) => ({
      authenticated: true,
      revoked: true,
      manifestDigest: current.manifestDigest,
      receiptDigest: D("revocation"),
    })),
  };
  return {
    market: new GovernedSkillMarketplace({ tenantId: "tenant:a", ports }),
    ports,
    get state() {
      return state;
    },
  };
}

describe("Governed Skill Marketplace", () => {
  it("requires a signed manifest and exact accepted target evaluation before staging", async () => {
    const h = harness();
    const state = await h.market.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    expect(state).toMatchObject({
      skillName: "repair-tests",
      version: "2.0.0",
      stage: "candidate",
      target: TARGET,
      revoked: false,
    });
    expect(h.ports.verifySignature).toHaveBeenCalledOnce();
    expect(h.ports.adapt).toHaveBeenCalledOnce();
  });

  it("does not infer target compatibility from a stronger source model", async () => {
    const h = harness();
    await expect(
      h.market.stage({
        manifest: manifest({
          compatibilityMatrix: [
            {
              ...TARGET,
              model: "qwen-3.6-27b",
              accepted: true,
              evalReceiptDigest: D("source-eval"),
            },
          ],
        }),
        target: TARGET,
        expectedStateDigest: null,
      }),
    ).rejects.toThrow("no unique accepted compatibility");
    expect(h.ports.commit).not.toHaveBeenCalled();
  });

  it("rejects unsigned, tampered and rejected target cells", async () => {
    const unsigned = harness();
    unsigned.ports.verifySignature.mockResolvedValueOnce(false);
    await expect(unsigned.market.inspect(manifest(), TARGET)).rejects.toThrow(
      "signature",
    );

    const tampered = manifest();
    await expect(
      harness().market.inspect({ ...tampered, sbomDigest: D("other") }, TARGET),
    ).rejects.toThrow("digest is invalid");

    await expect(
      harness().market.inspect(
        manifest({
          compatibilityMatrix: [
            { ...TARGET, accepted: false, evalReceiptDigest: D("failed-eval") },
          ],
        }),
        TARGET,
      ),
    ).rejects.toThrow("no unique accepted compatibility");
  });

  it("advances only one shadow/canary/active stage per exact pilot receipt", async () => {
    const h = harness();
    let state = await h.market.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    for (const expected of ["shadow", "canary", "active"]) {
      state = await h.market.advance({
        skillName: "repair-tests",
        expectedStateDigest: state.stateDigest,
        pilotReceipt: { ref: `pilot:${expected}` },
      });
      expect(state.stage).toBe(expected);
    }
    await expect(
      h.market.advance({
        skillName: "repair-tests",
        expectedStateDigest: state.stateDigest,
        pilotReceipt: {},
      }),
    ).rejects.toThrow("cannot advance");
  });

  it("fails closed on stale baselines and non-durable transitions", async () => {
    const h = harness();
    const state = await h.market.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    await expect(
      h.market.advance({
        skillName: "repair-tests",
        expectedStateDigest: D("stale"),
        pilotReceipt: {},
      }),
    ).rejects.toThrow("changed or is missing");
    h.ports.transition.mockResolvedValueOnce({ durable: false });
    await expect(
      h.market.advance({
        skillName: "repair-tests",
        expectedStateDigest: state.stateDigest,
        pilotReceipt: {},
      }),
    ).rejects.toThrow("did not durably apply");
  });

  it("retries an acknowledgement-lost transition with the same request identity", async () => {
    const h = harness();
    const state = await h.market.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    h.ports.transition.mockRejectedValueOnce(new Error("acknowledgement lost"));

    const input = {
      skillName: "repair-tests",
      expectedStateDigest: state.stateDigest,
      pilotReceipt: { ref: "pilot:shadow" },
    };
    await expect(h.market.advance(input)).rejects.toThrow(
      "acknowledgement lost",
    );
    const advanced = await h.market.advance(input);

    expect(advanced.stage).toBe("shadow");
    expect(h.ports.transition).toHaveBeenCalledTimes(2);
    const [first, second] = h.ports.transition.mock.calls.map(([call]) => call);
    expect(second.requestDigest).toBe(first.requestDigest);
    expect(second.request).toEqual(first.request);
  });

  it("revokes and rolls back the exact installed manifest", async () => {
    const h = harness();
    const state = await h.market.stage({
      manifest: manifest(),
      target: TARGET,
      expectedStateDigest: null,
    });
    const revoked = await h.market.revoke({
      skillName: "repair-tests",
      expectedStateDigest: state.stateDigest,
      revocationReceipt: { ref: "revocation:1" },
    });
    expect(revoked).toMatchObject({ stage: "rolled-back", revoked: true });
    expect(h.ports.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ nextStage: "rolled-back" }),
      }),
    );
  });
});
