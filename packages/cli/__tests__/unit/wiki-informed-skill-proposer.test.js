import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  WIKI_PROPOSAL_STATUS,
  WikiInformedSkillProposer,
} from "../../src/lib/evolution/wiki-informed-skill-proposer.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}
function envelope(kind, data, ref = `evidence://${kind}/1`) {
  return {
    kind,
    ref,
    data,
    trusted: true,
    digest: `sha256:${createHash("sha256").update(canonical(data)).digest("hex")}`,
  };
}

const descriptor = (overrides = {}) => ({
  tenantId: "tenant-a",
  evolutionRunId: "run-1",
  targetSkillName: "safe-refactor",
  wikiRevision: "wiki:revision-7",
  proposerModel: {
    provider: "provider",
    model: "model-v1",
    version: "2026-09-05",
  },
  minEvidenceSamples: 3,
  maxSelectiveEvidence: 2,
  ...overrides,
});

function validProposal(refs) {
  return {
    status: "proposal",
    skillName: "safe-refactor",
    purpose: {
      summary: "Apply a bounded refactor backed by repeated evidence.",
      patternRefs: [refs[0]],
      sourceEvidenceRefs: refs,
    },
    applicableWhen: ["deterministic unit tests exist"],
    notApplicableWhen: ["migration changes persisted data"],
    failureCounterexamples: ["tests pass while public API breaks"],
    rollbackSteps: ["discard candidate and retain active digest"],
    validationMethods: ["run fixed unit and contract graders"],
    requestedCapabilities: ["workspace-write"],
    targetRuntimes: ["node22-windows", "node22-linux"],
    contextCost: { maxTokens: 1800, maxBytes: 12000 },
    machineDiff: [
      {
        op: "replace",
        path: "SKILL.md",
        beforeDigest: "old",
        afterDigest: "new",
      },
      {
        op: "add",
        path: "PURPOSE.md",
        beforeDigest: null,
        afterDigest: "purpose",
      },
    ],
  };
}

function ports(overrides = {}) {
  const initial = {
    "wiki-index": envelope("wiki-index", { contradictionRefs: [] }),
    "skill-impact": envelope("skill-impact", {
      affectedSkills: ["safe-refactor"],
    }),
    "active-skill": envelope("active-skill", {
      skillName: "safe-refactor",
      digest: "active",
    }),
    "training-summary": envelope("training-summary", {
      sampleCount: 5,
      passed: 4,
    }),
  };
  const refs = Object.values(initial).map((item) => item.ref);
  return {
    readInitial: vi.fn(async (kind) => initial[kind]),
    readSelective: vi.fn(async (kind, ref) =>
      envelope(kind, { selected: true }, ref),
    ),
    generate: vi.fn(async () => validProposal(refs)),
    createCandidate: vi.fn(async (input) => ({
      created: true,
      candidate: {
        ...input,
        candidateId: "candidate:1",
        contentDigest: "sha256:1",
        targetRuntimes: ["node22-linux", "node22-windows"],
      },
    })),
    ...overrides,
  };
}

const policy = { proposerWikiRead: true, executionAgentWikiRead: false };

describe("WikiInformedSkillProposer", () => {
  it("drafts a proposal without crossing the Candidate persistence boundary", async () => {
    const p = ports();
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).draft();

    expect(result).toMatchObject({
      status: WIKI_PROPOSAL_STATUS.PROPOSAL,
      proposal: { skillName: "safe-refactor" },
      proposalDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(p.createCandidate).not.toHaveBeenCalled();
  });

  it("rejects a substituted persisted draft before crossing the Candidate boundary", async () => {
    const p = ports();
    const proposer = new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    });
    const drafted = await proposer.draft();
    const substituted = {
      ...drafted,
      proposal: {
        ...drafted.proposal,
        wikiRevision: "wiki:revision-substituted",
      },
    };

    await expect(
      proposer.createCandidateFromDraft(substituted),
    ).rejects.toMatchObject({
      code: "WIKI_PROPOSAL_DRAFT_UNCONFIRMED",
    });
    expect(p.createCandidate).not.toHaveBeenCalled();
  });

  it("creates one candidate with PURPOSE, boundaries, lineage and machine diff", async () => {
    const p = ports();
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).propose();
    expect(result.status).toBe(WIKI_PROPOSAL_STATUS.PROPOSAL);
    expect(result.candidateId).toBe("candidate:1");
    expect(result.proposal).toMatchObject({
      skillName: "safe-refactor",
      requestedCapabilities: ["workspace-write"],
      targetRuntimes: ["node22-linux", "node22-windows"],
    });
    expect(result.proposal.purpose.sourceEvidenceRefs).toHaveLength(4);
    expect(p.readInitial.mock.calls.map((call) => call[0])).toEqual([
      "wiki-index",
      "skill-impact",
      "active-skill",
      "training-summary",
    ]);
    expect(p.readSelective).not.toHaveBeenCalled();
    expect(p.createCandidate).toHaveBeenCalledTimes(1);
    expect(p.createCandidate.mock.calls[0][0]).toMatchObject({
      derivationMode: "wiki",
      wikiRevision: "wiki:revision-7",
      proposerModel: {
        provider: "provider",
        model: "model-v1",
        version: "2026-09-05",
      },
    });
  });

  it("abstains before generation when evidence is contradictory", async () => {
    const p = ports();
    p.readInitial = vi.fn(async (kind) =>
      kind === "wiki-index"
        ? envelope(kind, { contradictionRefs: ["conflict:1"] })
        : ports().readInitial(kind),
    );
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).propose();
    expect(result.status).toBe("needs-evidence");
    expect(p.generate).not.toHaveBeenCalled();
    expect(p.createCandidate).not.toHaveBeenCalled();
  });

  it("abstains on insufficient samples instead of forcing a change", async () => {
    const p = ports();
    const original = p.readInitial;
    p.readInitial = vi.fn(async (kind) =>
      kind === "training-summary"
        ? envelope(kind, { sampleCount: 2 })
        : original(kind),
    );
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).propose();
    expect(result).toMatchObject({
      status: "needs-evidence",
      reason: expect.stringContaining("insufficient"),
    });
    expect(p.createCandidate).not.toHaveBeenCalled();
  });

  it("selectively reads only requested pattern/raw evidence and retries once", async () => {
    const p = ports();
    const patternRef = "evidence://pattern/selected";
    const initialRefs = [
      "evidence://wiki-index/1",
      "evidence://skill-impact/1",
      "evidence://active-skill/1",
      "evidence://training-summary/1",
    ];
    p.generate = vi
      .fn()
      .mockResolvedValueOnce({
        status: "needs-evidence",
        requests: [{ kind: "pattern", ref: patternRef }],
      })
      .mockResolvedValueOnce(validProposal([...initialRefs, patternRef]));
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).propose();
    expect(result.status).toBe("proposal");
    expect(p.readSelective).toHaveBeenCalledWith("pattern", patternRef);
    expect(p.generate).toHaveBeenCalledTimes(2);
  });

  it("returns no-proposal without writing a candidate", async () => {
    const p = ports({
      generate: vi.fn(async () => ({
        status: "no-proposal",
        reason: "no measurable benefit",
      })),
    });
    const result = await new WikiInformedSkillProposer({
      descriptor: descriptor(),
      policy,
      ports: p,
    }).propose();
    expect(result.status).toBe("no-proposal");
    expect(p.createCandidate).not.toHaveBeenCalled();
  });

  it("rejects a second Skill, unsafe active path, and unknown PURPOSE lineage", async () => {
    for (const mutate of [
      (o) => {
        o.skillName = "other-skill";
      },
      (o) => {
        o.machineDiff[0].path = "../active/SKILL.md";
      },
      (o) => {
        o.purpose.sourceEvidenceRefs.push("evidence://unknown/1");
      },
    ]) {
      const p = ports();
      const refs = [
        "evidence://wiki-index/1",
        "evidence://skill-impact/1",
        "evidence://active-skill/1",
        "evidence://training-summary/1",
      ];
      const output = validProposal(refs);
      mutate(output);
      p.generate = vi.fn(async () => output);
      await expect(
        new WikiInformedSkillProposer({
          descriptor: descriptor(),
          policy,
          ports: p,
        }).propose(),
      ).rejects.toThrow();
      expect(p.createCandidate).not.toHaveBeenCalled();
    }
  });

  it("rejects tampered evidence before invoking the generator", async () => {
    const p = ports();
    const original = p.readInitial;
    p.readInitial = vi.fn(async (kind) => {
      const value = await original(kind);
      return kind === "wiki-index"
        ? { ...value, data: { contradictionRefs: [], tampered: true } }
        : value;
    });
    await expect(
      new WikiInformedSkillProposer({
        descriptor: descriptor(),
        policy,
        ports: p,
      }).propose(),
    ).rejects.toMatchObject({ code: "WIKI_PROPOSAL_UNTRUSTED_EVIDENCE" });
    expect(p.generate).not.toHaveBeenCalled();
  });

  it("requires the Wiki capability policy to exclude execution agents", () => {
    expect(
      () =>
        new WikiInformedSkillProposer({
          descriptor: descriptor(),
          policy: { proposerWikiRead: true, executionAgentWikiRead: true },
          ports: ports(),
        }),
    ).toThrow(/isolate Wiki reads/);
  });

  it("fails closed when the candidate sink cannot confirm immutable content", async () => {
    const p = ports({
      createCandidate: vi.fn(async () => ({ created: true })),
    });
    await expect(
      new WikiInformedSkillProposer({
        descriptor: descriptor(),
        policy,
        ports: p,
      }).propose(),
    ).rejects.toMatchObject({ code: "WIKI_PROPOSAL_CANDIDATE_UNCONFIRMED" });
  });

  it("rejects a sink that substitutes the target runtime after proposal review", async () => {
    const p = ports();
    p.createCandidate = vi.fn(async (input) => ({
      candidate: {
        ...input,
        candidateId: "candidate:substituted",
        contentDigest: "sha256:substituted",
        targetRuntimes: ["unreviewed-runtime"],
      },
    }));
    await expect(
      new WikiInformedSkillProposer({
        descriptor: descriptor(),
        policy,
        ports: p,
      }).propose(),
    ).rejects.toMatchObject({ code: "WIKI_PROPOSAL_CANDIDATE_UNCONFIRMED" });
  });
});
