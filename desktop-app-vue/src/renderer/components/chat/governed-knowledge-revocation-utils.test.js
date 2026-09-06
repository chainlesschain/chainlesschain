import { flushPromises, shallowMount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import GovernedKnowledgeRevocationDrawer from "./GovernedKnowledgeRevocationDrawer.vue";
import {
  buildGovernedKnowledgeRevocationPublishRequest,
  governedKnowledgeRevocationConfirmation,
  parseGovernedKnowledgeRevocationDraft,
  validateGovernedKnowledgeRevocationPrepareResponse,
  validateGovernedKnowledgeRevocationPublishResponse,
} from "./governed-knowledge-revocation-utils.js";

vi.mock("ant-design-vue", () => ({
  message: { success: vi.fn(), warning: vi.fn() },
}));

const digest = (character) => `sha256:${character.repeat(64)}`;
const draft = {
  tenantId: "tenant:1",
  knowledgeId: "knowledge:1",
  scope: "team",
  scopeId: "team:1",
  action: "revoke",
  contentDigest: digest("1"),
  vectorClock: { "device:local": 2 },
  approvalReceiptDigest: digest("2"),
  revocationReceiptDigest: digest("3"),
};
const dependencies = [
  {
    kind: "active-skill",
    digest: digest("4"),
    disposition: "rollback-active",
  },
  {
    kind: "candidate",
    digest: digest("5"),
    disposition: "quarantine",
  },
  { kind: "wiki", digest: digest("6"), disposition: "quarantine" },
];

function preparedResponse(overrides = {}) {
  return {
    success: true,
    result: {
      authenticated: true,
      durable: true,
      operationDigest: digest("7"),
      inventoryDigest: digest("8"),
      knowledge: {
        schema: "chainlesschain.governed-evolution-knowledge-sync/v1",
        ...draft,
        dependencies,
      },
      ...overrides,
    },
  };
}

describe("Governed Knowledge revocation Desktop boundary", () => {
  afterEach(() => {
    delete window.electronAPI;
  });

  it("compiles the two-confirmation revocation drawer", () => {
    expect(GovernedKnowledgeRevocationDrawer).toMatchObject({
      __name: "GovernedKnowledgeRevocationDrawer",
    });
  });

  it("accepts a bounded draft only when the caller did not supply dependencies", () => {
    expect(
      parseGovernedKnowledgeRevocationDraft(JSON.stringify(draft)),
    ).toEqual(draft);
    expect(() =>
      parseGovernedKnowledgeRevocationDraft(
        JSON.stringify({ ...draft, dependencies: [] }),
      ),
    ).toThrow(/字段、作用域、摘要或时钟无效/u);
    expect(() =>
      parseGovernedKnowledgeRevocationDraft(
        JSON.stringify({ ...draft, content: "raw knowledge" }),
      ),
    ).toThrow(/字段、作用域、摘要或时钟无效/u);
  });

  it("projects only the authenticated dependency summary and requires an exact phrase", () => {
    const prepared =
      validateGovernedKnowledgeRevocationPrepareResponse(preparedResponse());
    expect(prepared).toMatchObject({
      knowledgeId: draft.knowledgeId,
      operationDigest: digest("7"),
      inventoryDigest: digest("8"),
      dependencies,
    });
    expect(governedKnowledgeRevocationConfirmation(prepared)).toBe(
      "REVOKE knowledge:1",
    );
    expect(() =>
      buildGovernedKnowledgeRevocationPublishRequest(
        prepared,
        "REVOKE knowledge:1",
        false,
      ),
    ).toThrow(/确认短语/u);
    expect(() =>
      buildGovernedKnowledgeRevocationPublishRequest(
        prepared,
        "revoke knowledge:1",
        true,
      ),
    ).toThrow(/确认短语/u);
    expect(
      buildGovernedKnowledgeRevocationPublishRequest(
        prepared,
        "REVOKE knowledge:1",
        true,
      ),
    ).toEqual({ operationDigest: digest("7") });
  });

  it("rejects widened prepare output and mismatched publish receipts", () => {
    expect(() =>
      validateGovernedKnowledgeRevocationPrepareResponse(
        preparedResponse({ plaintext: "not-redacted" }),
      ),
    ).toThrow(/安全校验/u);
    const prepared =
      validateGovernedKnowledgeRevocationPrepareResponse(preparedResponse());
    const response = {
      success: true,
      result: {
        authenticated: true,
        durable: true,
        recoveredPlan: true,
        operationDigest: prepared.operationDigest,
        envelopeDigest: digest("9"),
        knowledgeId: prepared.knowledgeId,
        contentDigest: prepared.contentDigest,
        dependencyCount: prepared.dependencies.length,
      },
    };
    expect(
      validateGovernedKnowledgeRevocationPublishResponse(response, prepared),
    ).toEqual({
      durable: true,
      knowledgeId: prepared.knowledgeId,
      operationDigest: prepared.operationDigest,
      envelopeDigest: digest("9"),
      dependencyCount: 3,
    });
    expect(() =>
      validateGovernedKnowledgeRevocationPublishResponse(
        {
          ...response,
          result: { ...response.result, operationDigest: digest("a") },
        },
        prepared,
      ),
    ).toThrow(/安全校验/u);
    expect(() =>
      validateGovernedKnowledgeRevocationPublishResponse(
        {
          ...response,
          result: { ...response.result, artifact: { content: "raw" } },
        },
        prepared,
      ),
    ).toThrow(/安全校验/u);
  });

  it("does not call publish before both confirmations and shows the verified receipt", async () => {
    const prepare = vi.fn().mockResolvedValue(preparedResponse());
    const publish = vi.fn().mockImplementation(({ operationDigest }) => ({
      success: true,
      result: {
        authenticated: true,
        durable: true,
        recoveredPlan: true,
        operationDigest,
        envelopeDigest: digest("9"),
        knowledgeId: draft.knowledgeId,
        contentDigest: draft.contentDigest,
        dependencyCount: dependencies.length,
      },
    }));
    window.electronAPI = {
      codingAgent: {
        appServerGovernedKnowledgeRevocationPrepare: prepare,
        appServerGovernedKnowledgeRevocationPublish: publish,
      },
    };
    const wrapper = shallowMount(GovernedKnowledgeRevocationDrawer, {
      props: { open: true },
    });
    wrapper.vm.recordJson = JSON.stringify(draft);
    wrapper.vm.prepareAcknowledged = true;
    await wrapper.vm.prepareRevocation();
    await flushPromises();
    expect(prepare).toHaveBeenCalledWith({ record: draft });
    expect(wrapper.vm.prepared.operationDigest).toBe(digest("7"));

    wrapper.vm.publishConfirmation = "REVOKE knowledge:1";
    await wrapper.vm.publishRevocation();
    await flushPromises();
    expect(publish).not.toHaveBeenCalled();

    wrapper.vm.publishAcknowledged = true;
    await wrapper.vm.publishRevocation();
    await flushPromises();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.published).toEqual({
      durable: true,
      knowledgeId: draft.knowledgeId,
      operationDigest: digest("7"),
      envelopeDigest: digest("9"),
      dependencyCount: 3,
    });
  });
});
