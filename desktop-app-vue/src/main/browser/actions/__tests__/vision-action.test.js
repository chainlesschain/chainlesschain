/**
 * Browser VisionAction is deliberately unavailable until image bytes can use
 * the same authenticated Raw/projection/response-evidence lifecycle as text.
 */

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { VisionAction, VisionModel } = require("../vision-action");
const {
  createDesktopModelIngressHost,
  bindDesktopModelIngressClient,
} = require("../../../evolution/desktop-model-ingress");
const {
  LLMManager,
  createDesktopGovernedVisionModelClient,
} = require("../../../llm/llm-manager");
const {
  authorizeDesktopBrowserVisionObservation,
  createDesktopBrowserVisionObservationHost,
} = require("../../../evolution/desktop-browser-vision-observation");
const {
  authorizeDesktopBrowserVisionAction,
  createDesktopBrowserVisionActionHost,
} = require("../../../evolution/desktop-browser-vision-action");

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const domainDigest = (domain, value) =>
  `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;

async function createObservationGrant({
  targetId = "tab-1",
  operation = "analyze",
  options = {},
} = {}) {
  const descriptor = Object.freeze({
    authorityId: "vision-test",
    tenantId: "tenant-test",
    handlerArtifactDigest: digest("handler"),
  });
  const authority = Object.freeze({});
  const host = createDesktopBrowserVisionObservationHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({
      descriptor,
      authorizeObservation: async (request) =>
        Object.freeze({
          schema: "chainlesschain.browser-vision-observation-receipt/v1",
          authorityId: descriptor.authorityId,
          tenantId: descriptor.tenantId,
          handlerArtifactDigest: descriptor.handlerArtifactDigest,
          requestId: request.requestId,
          targetId: request.targetId,
          operation: request.operation,
          senderId: request.senderId,
          frameUrlDigest: request.frameUrlDigest,
          inputDigest: request.inputDigest,
          validUntil: new Date(Date.now() + 10_000).toISOString(),
          receiptDigest: digest(request.requestId),
        }),
    });
  });
  return await authorizeDesktopBrowserVisionObservation(host, {
    targetId,
    operation,
    options,
    senderId: 1,
    frameUrl: "app://desktop/index.html",
  });
}

async function createActionGrant({
  observationGrant,
  targetId = "tab-1",
  operation = "visual-click",
  options,
  recordOutcome,
}) {
  const descriptor = Object.freeze({
    authorityId: "vision-action-test",
    tenantId: "tenant-test",
    handlerArtifactDigest: digest("action-handler"),
    approvalMode: "interactive",
    auditMode: "authenticated-durable-readback",
  });
  const authority = Object.freeze({});
  const host = createDesktopBrowserVisionActionHost(authority, (value) => {
    if (value !== authority) throw new TypeError("unbranded");
    return Object.freeze({
      descriptor,
      authorizeAction: async (request) =>
        Object.freeze({
          schema: "chainlesschain.browser-vision-action-receipt/v1",
          authorityId: descriptor.authorityId,
          tenantId: descriptor.tenantId,
          handlerArtifactDigest: descriptor.handlerArtifactDigest,
          approvalMode: descriptor.approvalMode,
          requestId: request.requestId,
          targetId: request.targetId,
          operation: request.operation,
          senderId: request.senderId,
          frameUrlDigest: request.frameUrlDigest,
          inputDigest: request.inputDigest,
          observationReceiptDigest: request.observationReceiptDigest,
          requestDigest: digest(`request:${request.requestId}`),
          validUntil: new Date(Date.now() + 5000).toISOString(),
          receiptDigest: digest(request.requestId),
        }),
      recordActionOutcome:
        recordOutcome ||
        (async (request) =>
          Object.freeze({
            schema: "chainlesschain.browser-vision-action-outcome-ack/v1",
            authorityId: descriptor.authorityId,
            tenantId: descriptor.tenantId,
            handlerArtifactDigest: descriptor.handlerArtifactDigest,
            actionReceiptDigest: request.actionReceiptDigest,
            outcomeRequestDigest: domainDigest(request.schema, request),
            auditEventDigest: digest(`audit:${request.resultDigest}`),
            durabilityReceiptDigest: digest(`durable:${request.resultDigest}`),
            authenticated: true,
            durable: true,
            readbackVerified: true,
            qualifiesForPromotion: false,
          })),
    });
  });
  return await authorizeDesktopBrowserVisionAction(host, {
    targetId,
    operation,
    options,
    observationGrant,
    senderId: 1,
    frameUrl: "app://desktop/index.html",
  });
}

async function createVisionAction({
  governed = false,
  response = "visual result",
  observation = null,
  action = null,
} = {}) {
  const page = {
    screenshot: vi.fn().mockResolvedValue(Buffer.from("private-image")),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    mouse: { click: vi.fn() },
    keyboard: { press: vi.fn(), type: vi.fn() },
  };
  const llmService = { chat: vi.fn() };
  let modelClient = llmService;
  if (governed) {
    const host = createDesktopModelIngressHost(async () => null);
    const manager = new LLMManager(
      {
        enableStateBus: false,
        provider: "openai",
        model: "vision-test",
      },
      host,
    );
    manager.client = bindDesktopModelIngressClient(
      {
        model: "vision-test",
        chat: llmService.chat.mockResolvedValue({ text: response }),
      },
      host,
    );
    manager.isInitialized = true;
    modelClient = createDesktopGovernedVisionModelClient(manager);
  }
  const observationGrant = observation
    ? await createObservationGrant(observation)
    : null;
  const actionGrant = action
    ? await createActionGrant({
        observationGrant,
        targetId: action.targetId,
        operation: action.operation,
        options: action.options,
        recordOutcome: action.recordOutcome,
      })
    : null;
  return {
    page,
    llmService,
    action: new VisionAction(
      { getPage: vi.fn().mockReturnValue(page) },
      modelClient,
      observationGrant,
      actionGrant,
    ),
  };
}

describe("VisionAction governed multimodal ingress", () => {
  it("rejects before capturing a screenshot or calling a model", async () => {
    const { action, page, llmService } = await createVisionAction();

    await expect(
      action.analyze("tab-1", "describe the page"),
    ).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it.each([
    ["locate", (action) => action.locateElement("tab-1", "login button")],
    ["click", (action) => action.visualClick("tab-1", "login button")],
    [
      "type",
      (action) => action.visualType("tab-1", "email input", "private text"),
    ],
    ["compare", (action) => action.compareWithBaseline("tab-1", "baseline")],
    ["task", (action) => action.executeVisualTask("tab-1", "submit the form")],
  ])(
    "rejects %s workflows without provider dispatch",
    async (_name, invoke) => {
      const { action, page, llmService } = await createVisionAction();

      await expect(invoke(action)).rejects.toMatchObject({
        code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
      });

      expect(page.screenshot).not.toHaveBeenCalled();
      expect(llmService.chat).not.toHaveBeenCalled();
    },
  );

  it("does not replay a cached image analysis without authenticated evidence", async () => {
    const { action, page, llmService } = await createVisionAction();
    action.analysisCache.set("tab-1:describe the page", {
      result: { success: true, analysis: "stale image result" },
      timestamp: Date.now(),
    });

    await expect(
      action.analyze("tab-1", "describe the page"),
    ).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("captures a fresh bounded screenshot and dispatches only through a branded governed client", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
      response: "The page contains a project board.",
      observation: {
        operation: "analyze",
        options: { prompt: "describe the page", maxTokens: 512 },
      },
    });
    action.analysisCache.set("tab-1:describe the page", {
      result: { success: true, analysis: "legacy cache" },
      timestamp: Date.now(),
    });

    await expect(
      action.analyze("tab-1", "describe the page", { maxTokens: 512 }),
    ).resolves.toMatchObject({
      success: true,
      analysis: "The page contains a project board.",
    });

    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(llmService.chat).toHaveBeenCalledOnce();
    expect(llmService.chat.mock.calls[0][0][1].content[0]).toMatchObject({
      type: "image_url",
      image_url: {
        url: expect.stringMatching(/^data:image\/jpeg;base64,/u),
      },
    });
    expect(llmService.chat.mock.calls[0][1]).toMatchObject({
      max_tokens: 512,
      skipCache: true,
      skipCompression: true,
    });
    expect(
      action.analysisCache.get("tab-1:describe the page").result.analysis,
    ).toBe("legacy cache");
  });

  it("routes OCR through a fresh screenshot with an OCR-bound grant", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
      response: "Visible heading\nVisible body",
      observation: {
        operation: "ocr",
        options: { task: "ocr" },
      },
    });

    await expect(
      action.execute("tab-1", { task: "ocr" }),
    ).resolves.toMatchObject({
      success: true,
      analysis: "Visible heading\nVisible body",
    });
    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(llmService.chat).toHaveBeenCalledOnce();
  });

  it("rejects a governed model client without a bound observation grant", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
    });

    await expect(action.analyze("tab-1", "describe")).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("rejects cancellation and excessive token budgets before screenshot capture", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      action.analyze("tab-1", "describe", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(
      action.analyze("tab-1", "describe", { maxTokens: 4097 }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("does not allow callers to replace the configured provider model", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
    });

    await expect(
      action.analyze("tab-1", "describe", { model: "unbound-model" }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("rejects invalid prompts and baselines before screenshot capture", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
    });

    await expect(action.analyze("tab-1", "")).rejects.toMatchObject({
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
    await expect(
      action.compareWithBaseline("tab-1", "not-base64"),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("keeps visual mutations closed without a separately governed action authority", async () => {
    const { action, page, llmService } = await createVisionAction({
      governed: true,
    });

    await expect(
      action.visualClick("tab-1", "submit button"),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(
      action.visualType("tab-1", "email input", "private text"),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(
      action.executeVisualTask("tab-1", "submit the form"),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });

    expect(page.screenshot).not.toHaveBeenCalled();
    expect(llmService.chat).not.toHaveBeenCalled();
  });

  it("permits one visual click only with linked observation and interactive action grants", async () => {
    const options = { description: "submit button" };
    const { action, page, llmService } = await createVisionAction({
      governed: true,
      response: JSON.stringify({
        found: true,
        confidence: 0.99,
        element: { x: 10, y: 20, width: 100, height: 40 },
        alternatives: [],
      }),
      observation: {
        operation: "locate",
        options,
      },
      action: { options },
    });

    await expect(
      action.visualClick("tab-1", "submit button"),
    ).resolves.toMatchObject({
      success: true,
      action: "visualClick",
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(llmService.chat).toHaveBeenCalledOnce();
    expect(page.mouse.click).toHaveBeenCalledWith(60, 40, {
      button: "left",
      clickCount: 1,
      delay: 0,
    });
    await expect(
      action.visualClick("tab-1", "submit button"),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(page.mouse.click).toHaveBeenCalledOnce();
  });

  it("reports an uncertain audit after a click instead of claiming success", async () => {
    const options = { description: "submit button" };
    const { action, page } = await createVisionAction({
      governed: true,
      response: JSON.stringify({
        found: true,
        confidence: 0.99,
        element: { x: 10, y: 20, width: 100, height: 40 },
        alternatives: [],
      }),
      observation: { operation: "locate", options },
      action: {
        options,
        recordOutcome: async () => {
          throw new Error("durability readback unavailable");
        },
      },
    });

    await expect(
      action.visualClick("tab-1", "submit button"),
    ).rejects.toMatchObject({ code: "CC_AGENT_ACTION_AUDIT_UNCERTAIN" });
    expect(page.mouse.click).toHaveBeenCalledOnce();
  });

  it("permits one redacted visual type action with its own linked grant", async () => {
    const text = "private@example.test";
    const options = {
      description: "email input",
      text,
      delay: 5,
      clearExisting: true,
    };
    const { action, page, llmService } = await createVisionAction({
      governed: true,
      response: JSON.stringify({
        found: true,
        confidence: 0.98,
        element: { x: 20, y: 30, width: 200, height: 30 },
        alternatives: [],
      }),
      observation: { operation: "locate", options },
      action: { operation: "visual-type", options },
    });

    const result = await action.visualType("tab-1", "email input", text, {
      delay: 5,
      clearExisting: true,
    });
    expect(result).toMatchObject({
      success: true,
      action: "visualType",
      requestedCharacterCount: [...text].length,
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toContain(text);
    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(llmService.chat).toHaveBeenCalledOnce();
    expect(page.mouse.click).toHaveBeenCalledWith(120, 45, {
      button: "left",
      clickCount: 1,
    });
    expect(page.keyboard.press).toHaveBeenCalledWith(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    expect(page.keyboard.type).toHaveBeenCalledWith(text, { delay: 5 });
    await expect(
      action.visualType("tab-1", "email input", text, {
        delay: 5,
        clearExisting: true,
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(page.keyboard.type).toHaveBeenCalledOnce();
  });

  it("durably records a failed visual type mutation without returning text", async () => {
    const text = "private@example.test";
    const options = { description: "email input", text };
    const { action, page } = await createVisionAction({
      governed: true,
      response: JSON.stringify({
        found: true,
        confidence: 0.98,
        element: { x: 20, y: 30, width: 200, height: 30 },
        alternatives: [],
      }),
      observation: { operation: "locate", options },
      action: { operation: "visual-type", options },
    });
    page.keyboard.type.mockRejectedValueOnce(new Error("page closed"));

    const result = await action.visualType("tab-1", "email input", text);
    expect(result).toMatchObject({
      success: false,
      error: "Type failed: page closed",
      requestedCharacterCount: [...text].length,
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(JSON.stringify(result)).not.toContain(text);
    expect(page.keyboard.type).toHaveBeenCalledOnce();
  });

  it("durably records a failed browser click before returning failure", async () => {
    const options = { description: "submit button" };
    const { action, page } = await createVisionAction({
      governed: true,
      response: JSON.stringify({
        found: true,
        confidence: 0.99,
        element: { x: 10, y: 20, width: 100, height: 40 },
        alternatives: [],
      }),
      observation: { operation: "locate", options },
      action: { options },
    });
    page.mouse.click.mockRejectedValueOnce(new Error("page closed"));

    await expect(
      action.visualClick("tab-1", "submit button"),
    ).resolves.toMatchObject({
      success: false,
      error: "Click failed: page closed",
      authorizationReceiptDigest: expect.stringMatching(/^sha256:/u),
      auditEventDigest: expect.stringMatching(/^sha256:/u),
      durabilityReceiptDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(page.mouse.click).toHaveBeenCalledOnce();
  });

  it("retains pure message-shape helpers without dispatching a model", async () => {
    const { action, llmService } = await createVisionAction();

    const message = action._buildVisionMessage("Describe this", "base64data", {
      model: VisionModel.GPT4_VISION,
    });

    expect(message.content[0].type).toBe("image_url");
    expect(llmService.chat).not.toHaveBeenCalled();
  });
});
