import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openEvolutionDurableStore } from "../fixtures/evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "../fixtures/skill-revocation-release-registry.js";
import {
  assertSkillRuntimeAdmission,
  bindSkillRuntimeAdmission,
  createSkillRuntimeRevalidationAuthority,
  digestSkillRuntimeValue,
  isSkillRuntimeAdmissionProof,
  SKILL_RUNTIME_EVALUATION_SCHEMA,
  SKILL_RUNTIME_STALE,
  SKILL_RUNTIME_STALE_CODE,
} from "../../src/lib/evolution/skill-runtime-revalidation.js";
import { SkillRuntimeRevalidationLedgerAdapter } from "../../src/lib/evolution/skill-runtime-revalidation-ledger-adapter.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import {
  captureSkillExecutionSnapshot,
  executionIdentityMetadata,
} from "../../src/lib/skill-execution-identity.js";

vi.mock("../../src/lib/sub-agent-context.js", () => ({
  SubAgentContext: {
    create: vi.fn(() => ({
      id: "test-child",
      status: "completed",
      run: vi.fn(async () => ({ summary: "done", toolsUsed: [] })),
    })),
  },
}));
const { SubAgentContext } = await import("../../src/lib/sub-agent-context.js");
const { executeTool } = await import("../../src/runtime/agent-core.js");
const { runControlledSkill } = await import("../../src/commands/skill.js");
const { CLISkillLoader } = await import("../../src/lib/skill-loader.js");
const roots = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-runtime-revalidation-"),
  );
  roots.push(root);
  const storeRoot = path.join(root, "store");
  const openStorage = () =>
    openEvolutionDurableStore(storeRoot, {
      tenantId: "tenant-a",
      streamId: "runtime-revalidation",
    });
  const storage = openStorage();
  storage.now = storage.clock();
  const releases = await openRevocationReleaseRegistry({
    root,
    storage,
    fsImpl: storage.fsImpl,
    seed: true,
    artifactTenantId: storage.descriptor.artifactTenantId,
  });
  const registry = releases.pruningRollbackOptions.releaseRegistry;
  const release = registry.readActive("safe-refactor").release;
  const skillDir = path.join(root, "skill");
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), release.candidate.content);
  fs.writeFileSync(
    path.join(skillDir, "handler.js"),
    "// governed handler identity\n",
  );
  const skill = {
    id: "safe-refactor",
    dirName: "safe-refactor",
    skillDir,
    source: "workspace",
    hasHandler: true,
    isolation: true,
    body: "Apply the candidate procedure and verify tests.",
    releaseDigest: release.releaseDigest,
  };
  const context = {
    cwd: root,
    llmOptions: { provider: "test", model: "model-v1" },
    effectiveAllowedToolNames: ["read_file", "search_files", "list_dir"],
  };
  let runtime = {
    runtimeManifest: release.runtimeManifest,
    dependencyLock: release.dependencyLock,
    runtimeId: "cli",
    toolManifestDigest: digestSkillRuntimeValue("tool-implementations-v1"),
    targetEnvironmentRef: "environment:test",
    environmentDigest: digestSkillRuntimeValue("environment-v1"),
  };
  const approved = new Set();
  let verifier = (receipt) => approved.has(receipt.receiptDigest);
  function openAuthority(store = storage, override = {}) {
    const adapter = new SkillRuntimeRevalidationLedgerAdapter({
      descriptor: store.descriptor,
      artifactPorts: store.artifactPorts,
      ledger: store.backend.ledger,
      ledgerArtifactResolver: store.resolver,
      now: store.clock,
    });
    return createSkillRuntimeRevalidationAuthority({
      releaseRegistry: registry,
      persistence: adapter.persistencePorts(),
      resolveRuntime: () => runtime,
      verifyEvaluation: (receipt) => verifier(receipt),
      ...override,
    });
  }
  const authority = openAuthority();
  let nextEvaluation = 0;
  function receipt(owner = authority) {
    const inspection = owner.inspect({ skill, context });
    const core = {
      schema: SKILL_RUNTIME_EVALUATION_SCHEMA,
      evaluationId: `evaluation:${++nextEvaluation}`,
      binding: inspection.binding,
      expectedEligibilityDigest: inspection.eligibilityDigest,
      passed: true,
      evidenceDigest: digestSkillRuntimeValue(
        `evaluation-evidence:${nextEvaluation}`,
      ),
    };
    const value = { ...core, receiptDigest: digestSkillRuntimeValue(core) };
    approved.add(value.receiptDigest);
    return value;
  }
  const revalidate = (owner = authority) =>
    owner.revalidate({ skill, context, receipt: receipt(owner) });
  return {
    root,
    skill,
    context,
    authority,
    openAuthority,
    openStorage,
    registry,
    releases,
    receipt,
    revalidate,
    approved,
    getRuntime: () => runtime,
    setRuntime: (value) => {
      runtime = value;
    },
    setVerifier: (value) => {
      verifier = value;
    },
  };
}

describe("durable Skill runtime revalidation", () => {
  it("does not return a governed persona after accepted content drift or a direct body after runtime drift", async () => {
    const f = await fixture();
    const originalContent = fs.readFileSync(
      path.join(f.skill.skillDir, "SKILL.md"),
      "utf8",
    );
    const originalRuntime = f.getRuntime();
    for (const drift of ["content", "runtime"]) {
      f.revalidate();
      const descriptor = {
        ...f.skill,
        category: "persona",
        activation: "auto",
        body: null,
        skillMdPath: path.join(f.skill.skillDir, "SKILL.md"),
        executionIdentity: executionIdentityMetadata(
          captureSkillExecutionSnapshot({
            skillDir: f.skill.skillDir,
            skillId: f.skill.id,
            source: f.skill.source,
          }),
        ),
      };
      const reauthorize = vi.fn(() => true);
      const loader = new CLISkillLoader({
        skillRuntimeAdmission: f.authority.admission,
        reauthorizeSkill: reauthorize,
        contextLedger: {
          recordRead() {
            if (drift === "runtime")
              f.setRuntime({
                ...originalRuntime,
                environmentDigest: digestSkillRuntimeValue(
                  "changed while materializing",
                ),
              });
          },
        },
      });
      if (drift === "content") {
        const synchronize =
          loader._syncExecutionAuthorityGeneration.bind(loader);
        vi.spyOn(
          loader,
          "_syncExecutionAuthorityGeneration",
        ).mockImplementation(() => {
          fs.writeFileSync(
            descriptor.skillMdPath,
            `${originalContent}\nChanged persona instructions.\n`,
          );
          return synchronize();
        });
        vi.spyOn(loader, "getResolvedSkills").mockReturnValue([descriptor]);
        expect(() => loader.getAutoActivatedPersonas(f.context)).toThrow(
          expect.objectContaining({ code: SKILL_RUNTIME_STALE_CODE }),
        );
        expect(reauthorize).toHaveBeenCalledOnce();
      } else {
        expect(() => loader.materializeSkill(descriptor, f.context)).toThrow(
          expect.objectContaining({ code: SKILL_RUNTIME_STALE_CODE }),
        );
      }
      expect(
        f.authority.inspect({ skill: f.skill, context: f.context }).status,
      ).toBe(SKILL_RUNTIME_STALE);
      fs.writeFileSync(descriptor.skillMdPath, originalContent);
      f.setRuntime(originalRuntime);
    }
  }, 120000);
  it("starts stale, accepts only exact approved evaluation, and reopens from ArtifactStore + Ledger", async () => {
    const f = await fixture();
    expect(
      f.authority.inspect({ skill: f.skill, context: f.context }).status,
    ).toBe(SKILL_RUNTIME_STALE);
    const receipt = f.receipt();
    f.approved.delete(receipt.receiptDigest);
    expect(() =>
      f.authority.revalidate({ skill: f.skill, context: f.context, receipt }),
    ).toThrow(/fresh evaluation/);
    f.approved.add(receipt.receiptDigest);
    const proof = f.authority.revalidate({
      skill: f.skill,
      context: f.context,
      receipt,
    });
    expect(proof.status).toBe("eligible");
    expect(isSkillRuntimeAdmissionProof(proof)).toBe(true);
    expect(
      isSkillRuntimeAdmissionProof(JSON.parse(JSON.stringify(proof))),
    ).toBe(false);
    const reopened = f.openAuthority(f.openStorage());
    expect(
      reopened.admission.assertEligible({ skill: f.skill, context: f.context })
        .binding,
    ).toEqual(proof.binding);
  }, 60000);

  it("durably invalidates runtime, model, tools, dependencies and environment; restoring old values cannot revive eligibility", async () => {
    const f = await fixture();
    const initialRuntime = f.getRuntime();
    const mutations = [
      () =>
        f.setRuntime({
          ...initialRuntime,
          runtimeManifest: buildSkillRuntimeManifest({
            tenantId: "tenant-a",
            runtimes: [{ runtimeId: "cli", descriptor: { version: "v2" } }],
          }),
        }),
      () => {
        f.context.llmOptions.model = "model-v2";
      },
      () => {
        f.context.effectiveAllowedToolNames = ["read_file"];
      },
      () =>
        f.setRuntime({
          ...initialRuntime,
          toolManifestDigest: digestSkillRuntimeValue(
            "tool-implementations-v2",
          ),
        }),
      () =>
        f.setRuntime({
          ...initialRuntime,
          dependencyLock: buildSkillDependencyLock({
            tenantId: "tenant-a",
            lock: { packages: { lib: "2.0" } },
          }),
        }),
      () =>
        f.setRuntime({
          ...initialRuntime,
          environmentDigest: digestSkillRuntimeValue("environment-v2"),
        }),
      () =>
        f.setRuntime({
          ...initialRuntime,
          targetEnvironmentRef: "environment:other",
        }),
      () =>
        fs.writeFileSync(
          path.join(f.skill.skillDir, "handler.js"),
          "// changed handler\n",
        ),
    ];
    for (const mutate of mutations) {
      f.revalidate();
      mutate();
      expect(() =>
        f.authority.admission.assertEligible({
          skill: f.skill,
          context: f.context,
        }),
      ).toThrow(expect.objectContaining({ code: SKILL_RUNTIME_STALE_CODE }));
      const reopened = f.openAuthority(f.openStorage());
      expect(
        reopened.inspect({ skill: f.skill, context: f.context }).status,
      ).toBe(SKILL_RUNTIME_STALE);
      f.setRuntime(initialRuntime);
      f.context.llmOptions.model = "model-v1";
      f.context.effectiveAllowedToolNames = [
        "read_file",
        "search_files",
        "list_dir",
      ];
      fs.writeFileSync(
        path.join(f.skill.skillDir, "handler.js"),
        "// governed handler identity\n",
      );
      expect(() =>
        reopened.admission.assertEligible({
          skill: f.skill,
          context: f.context,
        }),
      ).toThrow();
    }
  }, 240000);

  it("marks missing runtime, corrupt filesystem and revoked evaluator stale and forbids reusing old receipts", async () => {
    const f = await fixture();
    const oldReceipt = f.receipt();
    f.authority.revalidate({
      skill: f.skill,
      context: f.context,
      receipt: oldReceipt,
    });
    const runtime = f.getRuntime();
    f.setRuntime(null);
    expect(
      f.authority.inspect({ skill: f.skill, context: f.context }),
    ).toMatchObject({ status: SKILL_RUNTIME_STALE, binding: null });
    f.setRuntime(runtime);
    expect(() =>
      f.authority.revalidate({
        skill: f.skill,
        context: f.context,
        receipt: oldReceipt,
      }),
    ).toThrow();
    f.revalidate();
    f.setVerifier(() => false);
    expect(
      f.authority.inspect({ skill: f.skill, context: f.context }).status,
    ).toBe(SKILL_RUNTIME_STALE);
    f.setVerifier((receipt) => f.approved.has(receipt.receiptDigest));
    f.revalidate();
    fs.writeFileSync(
      path.join(f.skill.skillDir, "SKILL.md"),
      "replaced contents",
    );
    expect(
      f.authority.inspect({ skill: f.skill, context: f.context }),
    ).toMatchObject({ status: SKILL_RUNTIME_STALE, binding: null });
    expect(() => f.revalidate()).toThrow();
  }, 60000);

  it("rejects old active release CAS after a real rollback and requires evaluation of the replacement", async () => {
    const f = await fixture();
    const receipt = f.receipt();
    await f.releases.rollbackTo(
      f.releases.baseline.releaseDigest,
      "revalidation:rollback",
    );
    f.skill.releaseDigest = f.releases.baseline.releaseDigest;
    fs.writeFileSync(
      path.join(f.skill.skillDir, "SKILL.md"),
      f.releases.baseline.candidate.content,
    );
    expect(() =>
      f.authority.revalidate({ skill: f.skill, context: f.context, receipt }),
    ).toThrow();
    const inspected = f.authority.inspect({
      skill: f.skill,
      context: f.context,
    });
    expect(inspected.binding.activeStateDigest).toBe(
      f.registry.readActive("safe-refactor").state.stateDigest,
    );
    expect(f.revalidate().status).toBe("eligible");
  }, 60000);

  it("fails closed before materialization and before child creation if loading changes the runtime", async () => {
    const f = await fixture();
    const materialize = vi.fn(async (skill) => skill);
    const loader = {
      getResolvedSkills: () => [f.skill],
      materializeSkillForExecution: materialize,
    };
    bindSkillRuntimeAdmission(loader, f.authority.admission);
    const args = { skill_name: f.skill.id, input: "test" };
    const result = await executeTool("run_skill", args, {
      ...f.context,
      effectiveAllowedToolNames: [
        ...f.context.effectiveAllowedToolNames,
        "run_skill",
      ],
      skillLoader: loader,
    });
    expect(result.code).toBe(SKILL_RUNTIME_STALE_CODE);
    expect(materialize).not.toHaveBeenCalled();
    expect(SubAgentContext.create).not.toHaveBeenCalled();
    f.revalidate();
    materialize.mockImplementation(async (skill) => {
      f.setRuntime({
        ...f.getRuntime(),
        environmentDigest: digestSkillRuntimeValue(
          "drift during materialization",
        ),
      });
      return skill;
    });
    const drift = await executeTool("run_skill", args, {
      ...f.context,
      effectiveAllowedToolNames: [
        ...f.context.effectiveAllowedToolNames,
        "run_skill",
      ],
      skillLoader: loader,
    });
    expect(drift.code).toBe(SKILL_RUNTIME_STALE_CODE);
    expect(materialize).toHaveBeenCalledOnce();
    expect(SubAgentContext.create).not.toHaveBeenCalled();
  }, 60000);

  it("cc skill run blocks missing/forged ports before loading; legacy output cannot mint a governed proof", async () => {
    const governed = {
      id: "safe-refactor",
      hasHandler: true,
      isolation: true,
      releaseDigest: digestSkillRuntimeValue("release"),
      body: "Do a test.",
    };
    const materialize = vi.fn(async (skill) => skill);
    const dispatch = vi.fn(async () => ({ success: true }));
    const loader = {
      getResolvedSkills: () => [governed],
      materializeSkillForExecution: materialize,
    };
    await expect(
      runControlledSkill({ name: governed.id, loader, executeTool: dispatch }),
    ).rejects.toMatchObject({ code: SKILL_RUNTIME_STALE_CODE });
    await expect(
      runControlledSkill({
        name: governed.id,
        loader,
        executeTool: dispatch,
        skillRuntimeAdmission: { assertEligible: () => true },
      }),
    ).rejects.toMatchObject({ code: SKILL_RUNTIME_STALE_CODE });
    expect(materialize).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    const plain = { ...governed };
    delete plain.releaseDigest;
    const governedLoader = new CLISkillLoader({
      skillRuntimeAdmissionRequired: true,
    });
    expect(() => governedLoader.materializeSkill(plain)).toThrow(
      expect.objectContaining({ code: SKILL_RUNTIME_STALE_CODE }),
    );
    await expect(
      runControlledSkill({
        name: plain.id,
        loader: { getResolvedSkills: () => [plain] },
        skillRuntimeAdmissionRequired: true,
      }),
    ).rejects.toMatchObject({ code: SKILL_RUNTIME_STALE_CODE });
    const result = assertSkillRuntimeAdmission({ skill: plain, loader });
    expect(result).toEqual({ governed: false, status: "unassessed" });
    expect(isSkillRuntimeAdmissionProof(result)).toBe(false);
    expect(
      isSkillRuntimeAdmissionProof({
        ...result,
        governed: true,
        status: "eligible",
      }),
    ).toBe(false);
    const plainLoader = {
      getResolvedSkills: () => [plain],
      materializeSkillForExecution: materialize,
    };
    const output = await executeTool(
      "run_skill",
      { skill_name: plain.id },
      { skillLoader: plainLoader, cwd: process.cwd() },
    );
    expect(output).toMatchObject({
      success: true,
      runtimeEligibility: { governed: false, status: "unassessed" },
    });
    expect(isSkillRuntimeAdmissionProof(output.runtimeEligibility)).toBe(false);
  });

  it("never executes after stale persistence fails or evaluation races the runtime", async () => {
    const f = await fixture();
    const unavailable = f.openAuthority(undefined, {
      persistence: {
        load: () => ({
          authenticated: true,
          durable: true,
          found: false,
          state: null,
        }),
        commit: () => {
          throw new Error("durability unavailable");
        },
      },
    });
    expect(() =>
      unavailable.admission.assertEligible({
        skill: f.skill,
        context: f.context,
      }),
    ).toThrow(expect.objectContaining({ code: SKILL_RUNTIME_STALE_CODE }));
    const receipt = f.receipt();
    f.setVerifier(() => {
      f.context.llmOptions.model = "changed while evaluation verified";
      return true;
    });
    expect(() =>
      f.authority.revalidate({ skill: f.skill, context: f.context, receipt }),
    ).toThrow(/changed during revalidation/);
    expect(
      f.authority.inspect({ skill: f.skill, context: f.context }).status,
    ).toBe(SKILL_RUNTIME_STALE);
  }, 60000);
});
