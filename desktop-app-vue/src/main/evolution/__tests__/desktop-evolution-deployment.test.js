import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
const {
  ARTIFACT_TYPE,
} = require("@chainlesschain/session-core/evolvable-artifact");
const {
  evaluateDesktopPmExplorationMemory,
  executeDesktopPmExplorationRound,
  inspectDesktopPmExplorationCloneRecoveryHost,
  inspectDesktopPmExplorationExecutionHost,
  inspectDesktopPmExplorationStorageHost,
  isDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationStorageHost,
  loadDesktopEvolutionDependencies,
  mergeDesktopPmExplorationBranches,
  recoverDesktopPmExplorationClone,
  resolveLoaderPath,
  resolvePmExplorationExecutionHostPath,
  resolvePmExplorationLedgerAdapterPath,
  resolvePmExplorationRecoverySnapshotStorePath,
  resolvePmExplorationTransitionCommitterPath,
} = require("../desktop-evolution-deployment");
const {
  createDesktopPmPreRunSealValue,
} = require("../desktop-pm-pre-run-seal");
const {
  createDesktopPmWorkspaceSnapshotter,
} = require("../desktop-pm-workspace-snapshot");
const {
  authorizeDesktopBrowserVisionObservation,
  consumeDesktopBrowserVisionObservationGrant,
  createDesktopBrowserVisionObservationHost,
} = require("../desktop-browser-vision-observation");
const {
  authorizeDesktopBrowserVisionAction,
} = require("../desktop-browser-vision-action");
const {
  authorizeDesktopBrowserNavigationAction,
} = require("../desktop-browser-navigation-action");
const {
  authorizeDesktopBrowserKeyboardAction,
} = require("../desktop-browser-keyboard-action");
const {
  authorizeDesktopBrowserTabOpenAction,
} = require("../desktop-browser-tab-open-action");
const {
  authorizeDesktopBrowserDownloadAction,
} = require("../desktop-browser-download-action");
const {
  authorizeDesktopBrowserDownloadArtifactDisposal,
} = require("../desktop-browser-download-artifact-disposal");

function runtimeConfig(revision) {
  const allow = () => ({ decision: "allow", policyRevision: revision });
  return {
    policy: {
      revision,
      admission: allow,
      evaluator: allow,
      activation: allow,
      rollback: allow,
    },
    candidateWriter: { persistCandidate: async () => null },
    transitionWriter: { commitTransition: async () => null },
    transitionReader: { readTransition: async () => null },
    activeProvider: {
      listActive: async () => [],
      readActive: async () => null,
    },
    candidateProvider: { readCandidate: async () => null },
    promotionProvider: { authorizePromotion: async () => null },
    revalidationProvider: { authorizeRevalidation: async () => null },
  };
}

function sha(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function successTransitionEvidence({
  manifestDigest,
  preRunSeal,
  postRunSeal,
  previousStateTransitionDigest = null,
  executionReceiptDigest = sha("recovered-execution-receipt"),
  graderReceiptDigest = sha("recovered-grader-receipt"),
}) {
  const stateTransitionDigest = `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-transition/v1\0")
    .update(
      JSON.stringify({
        manifestDigest,
        executionReceiptDigest,
        graderReceiptDigest,
        preRunSealDigest: preRunSeal.sealDigest,
        postRunSealDigest: postRunSeal.sealDigest,
        previousStateTransitionDigest,
      }),
    )
    .digest("hex")}`;
  return Object.freeze({
    schema: "chainlesschain.desktop-pm-state-transition-success/v1",
    manifestDigest,
    executionReceiptDigest,
    graderReceiptDigest,
    preRunSeal,
    postRunSeal,
    databaseChanged:
      postRunSeal.databaseSnapshotDigest !== preRunSeal.databaseSnapshotDigest,
    previousStateTransitionDigest,
    stateTransitionDigest,
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  });
}

function failureTransitionEvidence({
  manifestDigest,
  preRunSeal,
  failureSeal,
  previousStateTransitionDigest = null,
}) {
  const core = {
    schema: "chainlesschain.desktop-pm-failed-execution-evidence/v1",
    manifestDigest,
    preRunSeal,
    failureSeal,
    databaseIdentityUnchanged:
      failureSeal.databasePathDigest === preRunSeal.databasePathDigest,
    databaseChanged:
      failureSeal.databaseSnapshotDigest !== preRunSeal.databaseSnapshotDigest,
    previousStateTransitionDigest,
    failureClass: "execution-or-evidence-failed",
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  return Object.freeze({
    ...core,
    evidenceDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.desktop-pm-failed-execution-evidence/v1\0")
      .update(JSON.stringify(core))
      .digest("hex")}`,
  });
}

function cloneRecoveryEvent(manifestDigest, restoredDatabaseSealDigest) {
  return Object.freeze({
    schema: "chainlesschain.desktop-pm-clone-recovery-event/v1",
    manifestDigest,
    cloneIdentityDigest: sha("recovered-clone-identity"),
    sourceTransitionRevision: 8,
    sourceFailureEvidenceDigest: sha("recovered-source-failure"),
    previousStateTransitionDigest: sha("pre-failure-success"),
    recoverySnapshotAckDigest: sha("recovered-snapshot-ack"),
    restoredDatabaseSealDigest,
    restoredWorkspaceSealDigest: sha("recovered-workspace-seal"),
    switchReceiptDigest: sha("recovered-switch-receipt"),
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
    recoveryEventDigest: sha("recovered-clone-event"),
  });
}

function recoveredTransition(
  manifestDigest,
  evidence,
  transitionKind,
  revision,
) {
  return Object.freeze({
    schema: "chainlesschain.pm-exploration-transition-recovery/v1",
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    revision,
    transitionKind,
    evidenceDigest:
      transitionKind === "success"
        ? evidence.stateTransitionDigest
        : transitionKind === "failure"
          ? evidence.evidenceDigest
          : evidence.recoveryEventDigest,
    evidence,
    ledgerHeadDigest: sha(`ledger-head-${revision}`),
    ledgerEventDigest: sha(`ledger-event-${revision}`),
    durabilityReceiptDigest: sha(`durability-${revision}`),
    qualifiesForPromotion: false,
  });
}

function databaseRecoverySnapshot(label, databasePathDigest = sha("database")) {
  const bytes = Buffer.from(`sqlite-backup:${label}`);
  const databaseSnapshotDigest = `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-snapshot/v1\0")
    .update(bytes)
    .digest("hex")}`;
  return Object.freeze({
    schema: "chainlesschain.desktop-pm-database-recovery-snapshot-capture/v1",
    seal: createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest,
      databaseSnapshotBytes: bytes.byteLength,
    }),
    bytes,
  });
}

describe("desktop evolution deployment", () => {
  it("rejects unbound model clients before a direct egress can be opened", async () => {
    const {
      prepareDesktopModelRequest,
      runDesktopOllamaRequest,
    } = require("../desktop-model-ingress");
    const post = vi.fn();
    const client = { model: "test", client: { post } };

    await expect(
      prepareDesktopModelRequest(client, {
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    await expect(
      runDesktopOllamaRequest(client, "hello", {}, null, false),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects bound tool execution outside its workflow and unresolved iteration limits", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopToolExecution,
      assertDesktopToolLoopComplete,
    } = require("../desktop-model-ingress");
    const client = bindDesktopModelIngressClient(
      {},
      createDesktopModelIngressHost(() => {}),
    );
    const execute = vi.fn();
    await expect(
      runDesktopToolExecution(
        client,
        { id: "call", function: { name: "lookup", arguments: "{}" } },
        execute,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(execute).not.toHaveBeenCalled();
    expect(() => assertDesktopToolLoopComplete(client)).toThrow(
      /iteration limit/,
    );
  });
  it("rejects opaque Ollama context before opening authority or dispatching", async () => {
    const {
      createDesktopModelIngressHost,
      bindDesktopModelIngressClient,
      runDesktopOllamaRequest,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const post = vi.fn();
    const client = bindDesktopModelIngressClient(
      { model: "test", client: { post } },
      createDesktopModelIngressHost(factory),
    );
    await expect(
      runDesktopOllamaRequest(
        client,
        "hi",
        { context: [1, 2, 3] },
        null,
        false,
      ),
    ).rejects.toMatchObject({ code: "CC_AGENT_EVOLUTION_INGRESS_FAILED" });
    expect(factory).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects malformed multimodal requests before opening a composition", async () => {
    const {
      createDesktopModelIngressHost,
      openDesktopMultimodalModelRun,
    } = require("../desktop-model-ingress");
    const factory = vi.fn();
    const host = createDesktopModelIngressHost(factory);

    await expect(
      openDesktopMultimodalModelRun(host, "not-a-request"),
    ).rejects.toThrow(/must be an object/);
    expect(factory).not.toHaveBeenCalled();
  });
  it("converts provider-neutral image blocks to strict Ollama chat messages", () => {
    const { toOllamaVisionMessages } = require("../desktop-model-ingress");
    const data = Buffer.from("private-image").toString("base64");
    const result = toOllamaVisionMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "inspect" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${data}` },
          },
        ],
      },
    ]);

    expect(result).toEqual([
      { role: "user", content: "inspect", images: [data] },
    ]);
    expect(() =>
      toOllamaVisionMessages([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://example.test/private.png" },
            },
          ],
        },
      ]),
    ).toThrow(/supported base64 data URL/u);
  });
  it("retains an independent model factory as an opaque branded host", async () => {
    const factory = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          evolutionCompositionFactory: factory,
        }),
      }),
    });
    const { isDesktopModelIngressHost } = require("../desktop-model-ingress");
    expect(isDesktopModelIngressHost(result.desktopModelIngressHost)).toBe(
      true,
    );
    expect(Object.keys(result.desktopModelIngressHost)).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(factory).not.toHaveBeenCalled();
  });

  it("narrows a signed browser observation authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-vision",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("signed-handler"),
    });
    const authorizeObservation = vi.fn(async (request) =>
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
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded authority");
      return Object.freeze({ descriptor, authorizeObservation });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserVisionObservationAuthority: authority,
        }),
      }),
      importBrowserVisionObservationAuthorityModule: async () => ({
        captureBrowserVisionObservationAuthority: capture,
      }),
    });

    const host = result.desktopBrowserVisionObservationHost;
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(host.authorizeObservation).toBeUndefined();
    const options = { prompt: "inspect", maxTokens: 256 };
    const grant = await authorizeDesktopBrowserVisionObservation(host, {
      targetId: "tab-1",
      operation: "analyze",
      options,
      senderId: 21,
      frameUrl: "app://desktop/index.html",
    });
    expect(
      consumeDesktopBrowserVisionObservationGrant(
        grant,
        "tab-1",
        "analyze",
        options,
      ),
    ).toMatchObject({ receiptDigest: expect.stringMatching(/^sha256:/u) });
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeObservation).toHaveBeenCalledOnce();
  });

  it("narrows a signed interactive action authority to an opaque Desktop host", async () => {
    const observationAuthority = Object.freeze({});
    const observationDescriptor = Object.freeze({
      authorityId: "desktop-observation",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("observation-handler"),
    });
    const observationHost = createDesktopBrowserVisionObservationHost(
      observationAuthority,
      (value) => {
        if (value !== observationAuthority)
          throw new TypeError("unbranded observation");
        return Object.freeze({
          descriptor: observationDescriptor,
          authorizeObservation: async (request) =>
            Object.freeze({
              schema: "chainlesschain.browser-vision-observation-receipt/v1",
              authorityId: observationDescriptor.authorityId,
              tenantId: observationDescriptor.tenantId,
              handlerArtifactDigest:
                observationDescriptor.handlerArtifactDigest,
              requestId: request.requestId,
              targetId: request.targetId,
              operation: request.operation,
              senderId: request.senderId,
              frameUrlDigest: request.frameUrlDigest,
              inputDigest: request.inputDigest,
              validUntil: new Date(Date.now() + 10_000).toISOString(),
              receiptDigest: sha(request.requestId),
            }),
        });
      },
    );
    const actionAuthority = Object.freeze({});
    const actionDescriptor = Object.freeze({
      authorityId: "desktop-action",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("action-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
    });
    const authorizeAction = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-vision-action-receipt/v1",
        authorityId: actionDescriptor.authorityId,
        tenantId: actionDescriptor.tenantId,
        handlerArtifactDigest: actionDescriptor.handlerArtifactDigest,
        approvalMode: actionDescriptor.approvalMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        inputDigest: request.inputDigest,
        observationReceiptDigest: request.observationReceiptDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const recordActionOutcome = vi.fn();
    const capture = vi.fn((value) => {
      if (value !== actionAuthority) throw new TypeError("unbranded action");
      return Object.freeze({
        descriptor: actionDescriptor,
        authorizeAction,
        recordActionOutcome,
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserVisionActionAuthority: actionAuthority,
        }),
      }),
      importBrowserVisionActionAuthorityModule: async () => ({
        captureBrowserVisionActionAuthority: capture,
      }),
    });

    expect(Object.keys(result.desktopBrowserVisionActionHost)).toEqual([]);
    const options = { description: "submit button" };
    const observationGrant = await authorizeDesktopBrowserVisionObservation(
      observationHost,
      {
        targetId: "tab-1",
        operation: "locate",
        options,
        senderId: 21,
        frameUrl: "app://desktop/index.html",
      },
    );
    await expect(
      authorizeDesktopBrowserVisionAction(
        result.desktopBrowserVisionActionHost,
        {
          targetId: "tab-1",
          operation: "visual-click",
          options,
          observationGrant,
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(actionAuthority);
    expect(authorizeAction).toHaveBeenCalledOnce();
  });

  it("narrows a signed navigation authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-navigation",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("navigation-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
    });
    const authorizeAction = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-navigation-action-receipt/v3",
        authorityId: descriptor.authorityId,
        tenantId: descriptor.tenantId,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        approvalMode: descriptor.approvalMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        destinationDigest:
          request.destinationUrl === null
            ? null
            : domainDigest(
                "chainlesschain.browser-navigation-action-destination/v1",
                request.destinationUrl,
              ),
        redirectOriginsDigest: domainDigest(
          "chainlesschain.browser-navigation-action-redirect-origins/v1",
          request.allowedRedirectOrigins,
        ),
        waitUntil: request.waitUntil,
        timeout: request.timeout,
        inputDigest: request.inputDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded navigation");
      return Object.freeze({
        descriptor,
        authorizeAction,
        recordActionOutcome: vi.fn(),
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserNavigationActionAuthority: authority,
        }),
      }),
      importBrowserNavigationActionAuthorityModule: async () => ({
        captureBrowserNavigationActionAuthority: capture,
      }),
    });

    expect(Object.keys(result.desktopBrowserNavigationActionHost)).toEqual([]);
    await expect(
      authorizeDesktopBrowserNavigationAction(
        result.desktopBrowserNavigationActionHost,
        {
          targetId: "tab-1",
          destinationUrl: "https://example.test/path",
          options: { waitUntil: "networkidle" },
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeAction).toHaveBeenCalledOnce();
  });

  it("narrows a signed keyboard authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-keyboard",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("keyboard-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
    });
    const authorizeAction = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-keyboard-action-receipt/v1",
        authorityId: descriptor.authorityId,
        tenantId: descriptor.tenantId,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        approvalMode: descriptor.approvalMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        keyDigest: domainDigest(
          "chainlesschain.browser-keyboard-action-key/v1",
          { key: request.key, modifiers: request.modifiers },
        ),
        delay: request.delay,
        inputDigest: request.inputDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded keyboard");
      return Object.freeze({
        descriptor,
        authorizeAction,
        recordActionOutcome: vi.fn(),
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserKeyboardActionAuthority: authority,
        }),
      }),
      importBrowserKeyboardActionAuthorityModule: async () => ({
        captureBrowserKeyboardActionAuthority: capture,
      }),
    });

    expect(Object.keys(result.desktopBrowserKeyboardActionHost)).toEqual([]);
    await expect(
      authorizeDesktopBrowserKeyboardAction(
        result.desktopBrowserKeyboardActionHost,
        {
          targetId: "tab-1",
          options: { key: "Enter", modifiers: ["Control"] },
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeAction).toHaveBeenCalledOnce();
  });

  it("narrows a signed tab-open authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-tab-open",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("tab-open-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
    });
    const authorizeAction = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-tab-open-action-receipt/v1",
        authorityId: descriptor.authorityId,
        tenantId: descriptor.tenantId,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        approvalMode: descriptor.approvalMode,
        requestId: request.requestId,
        profileName: request.profileName,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        destinationDigest: domainDigest(
          "chainlesschain.browser-tab-open-action-destination/v1",
          request.destinationUrl,
        ),
        redirectOriginsDigest: domainDigest(
          "chainlesschain.browser-tab-open-action-redirect-origins/v1",
          request.allowedRedirectOrigins,
        ),
        waitUntil: request.waitUntil,
        timeout: request.timeout,
        inputDigest: request.inputDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded tab open");
      return Object.freeze({
        descriptor,
        authorizeAction,
        recordActionOutcome: vi.fn(),
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserTabOpenActionAuthority: authority,
        }),
      }),
      importBrowserTabOpenActionAuthorityModule: async () => ({
        captureBrowserTabOpenActionAuthority: capture,
      }),
    });

    expect(Object.keys(result.desktopBrowserTabOpenActionHost)).toEqual([]);
    await expect(
      authorizeDesktopBrowserTabOpenAction(
        result.desktopBrowserTabOpenActionHost,
        {
          profileName: "default",
          destinationUrl: "https://example.test/path",
          options: { waitUntil: "networkidle" },
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeAction).toHaveBeenCalledOnce();
  });

  it("narrows a signed download authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-download",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("download-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
      artifactMode: "opaque-quarantine-clean-scan",
    });
    const authorizeAction = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-download-action-receipt/v1",
        authorityId: descriptor.authorityId,
        tenantId: descriptor.tenantId,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        approvalMode: descriptor.approvalMode,
        artifactMode: descriptor.artifactMode,
        requestId: request.requestId,
        targetId: request.targetId,
        operation: request.operation,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        destinationDigest: domainDigest(
          "chainlesschain.browser-download-action-destination/v1",
          request.destinationUrl,
        ),
        redirectOriginsDigest: domainDigest(
          "chainlesschain.browser-download-action-redirect-origins/v1",
          request.allowedRedirectOrigins,
        ),
        contentTypesDigest: domainDigest(
          "chainlesschain.browser-download-action-content-types/v1",
          request.allowedContentTypes,
        ),
        maxBytes: request.maxBytes,
        timeout: request.timeout,
        inputDigest: request.inputDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded download");
      return Object.freeze({
        descriptor,
        authorizeAction,
        cancelAuthorizedDownload: vi.fn(),
        executeAuthorizedDownload: vi.fn(),
        recordActionOutcome: vi.fn(),
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserDownloadActionAuthority: authority,
        }),
      }),
      importBrowserDownloadActionAuthorityModule: async () => ({
        captureBrowserDownloadActionAuthority: capture,
      }),
    });

    expect(Object.keys(result.desktopBrowserDownloadActionHost)).toEqual([]);
    await expect(
      authorizeDesktopBrowserDownloadAction(
        result.desktopBrowserDownloadActionHost,
        {
          targetId: "tab-1",
          destinationUrl: "https://example.test/report.pdf",
          options: { allowedContentTypes: ["application/pdf"] },
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeAction).toHaveBeenCalledOnce();
  });

  it("narrows a signed artifact-disposal authority to an opaque Desktop host", async () => {
    const authority = Object.freeze({});
    const descriptor = Object.freeze({
      authorityId: "desktop-download-disposal",
      tenantId: "tenant-1",
      handlerArtifactDigest: sha("download-disposal-handler"),
      approvalMode: "interactive",
      auditMode: "authenticated-durable-readback",
      effectMode: "irreversible-byte-disposal",
    });
    const authorizeDisposal = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.browser-download-artifact-disposal-receipt/v1",
        authorityId: descriptor.authorityId,
        tenantId: descriptor.tenantId,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        approvalMode: descriptor.approvalMode,
        auditMode: descriptor.auditMode,
        effectMode: descriptor.effectMode,
        requestId: request.requestId,
        senderId: request.senderId,
        frameUrlDigest: request.frameUrlDigest,
        operation: request.operation,
        artifactRefDigest: domainDigest(
          "chainlesschain.browser-download-artifact-ref/v1",
          request.artifactRef,
        ),
        artifactDigest: request.artifactDigest,
        sourceActionReceiptDigest: request.sourceActionReceiptDigest,
        reason: request.reason,
        inputDigest: request.inputDigest,
        requestDigest: sha(`request:${request.requestId}`),
        validUntil: new Date(Date.now() + 5000).toISOString(),
        receiptDigest: sha(request.requestId),
      }),
    );
    const capture = vi.fn((value) => {
      if (value !== authority) throw new TypeError("unbranded disposal");
      return Object.freeze({
        descriptor,
        authorizeDisposal,
        disposeAuthorizedArtifact: vi.fn(),
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserDownloadArtifactDisposalAuthority: authority,
        }),
      }),
      importBrowserDownloadArtifactDisposalAuthorityModule: async () => ({
        captureBrowserDownloadArtifactDisposalAuthority: capture,
      }),
    });
    expect(
      Object.keys(result.desktopBrowserDownloadArtifactDisposalHost),
    ).toEqual([]);
    await expect(
      authorizeDesktopBrowserDownloadArtifactDisposal(
        result.desktopBrowserDownloadArtifactDisposalHost,
        {
          artifactRef: "quarantine:artifact-1",
          artifactDigest: sha("artifact"),
          sourceActionReceiptDigest: sha("source-receipt"),
          senderId: 21,
          frameUrl: "app://desktop/index.html",
        },
      ),
    ).resolves.toEqual({});
    expect(capture).toHaveBeenCalledWith(authority);
    expect(authorizeDisposal).toHaveBeenCalledOnce();
  });

  it("starts a signed retention scheduler and exposes only lifecycle ports", async () => {
    const scheduler = Object.freeze({});
    const start = vi.fn(async () => ({ status: "started" }));
    const stop = vi.fn(async () => ({ status: "stopped" }));
    const inspect = vi.fn(() => ({ started: true, running: false }));
    const capture = vi.fn((value) => {
      if (value !== scheduler) throw new TypeError("unbranded scheduler");
      return Object.freeze({
        descriptor: Object.freeze({}),
        start,
        stop,
        inspect,
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          browserQuarantineRetentionScheduler: scheduler,
        }),
      }),
      importBrowserQuarantineRetentionSchedulerModule: async () => ({
        captureBrowserQuarantineRetentionScheduler: capture,
      }),
    });

    expect(start).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith(scheduler);
    expect(
      Object.keys(result.desktopBrowserQuarantineRetentionScheduler),
    ).toEqual(["stop", "inspect"]);
    await expect(
      result.desktopBrowserQuarantineRetentionScheduler.stop(),
    ).resolves.toEqual({ status: "stopped" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops a retention scheduler whose startup acknowledgement is invalid", async () => {
    const scheduler = Object.freeze({});
    const stop = vi.fn(async () => ({ status: "stopped" }));
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            browserQuarantineRetentionScheduler: scheduler,
          }),
        }),
        importBrowserQuarantineRetentionSchedulerModule: async () => ({
          captureBrowserQuarantineRetentionScheduler: (value) => {
            if (value !== scheduler) throw new TypeError("unbranded scheduler");
            return Object.freeze({
              descriptor: Object.freeze({}),
              start: async () => ({ status: "uncertain" }),
              stop,
              inspect: () => ({}),
            });
          },
        }),
      }),
    ).rejects.toThrow(/did not start/u);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("narrows a branded PM ledger store to an opaque read-only Desktop host", async () => {
    const store = Object.freeze({ name: "real-store-placeholder" });
    const load = vi.fn(() => null);
    const commitJournal = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: store,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore(value) {
          if (value !== store) throw new TypeError("unbranded store");
          return Object.freeze({
            load,
            commitJournal,
            restoreLatestJournal: vi.fn(),
          });
        },
      }),
    });

    const host = result.desktopPmExplorationStorageHost;
    expect(isDesktopPmExplorationStorageHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(host.load).toBeUndefined();
    expect(host.commitJournal).toBeUndefined();
    expect(inspectDesktopPmExplorationStorageHost(host)).toEqual({
      configured: true,
      readable: true,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
    expect(load).toHaveBeenCalledOnce();
    expect(commitJournal).not.toHaveBeenCalled();
  });

  it("sanitizes durable restore evidence and fails closed on unreadable storage", async () => {
    const durableStore = Object.freeze({ name: "durable-store" });
    const brokenStore = Object.freeze({ name: "broken-store" });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: durableStore,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore(value) {
          if (value === durableStore) {
            return Object.freeze({
              load: () => ({
                schema: "chainlesschain.pm-exploration-ledger-restore/v1",
                authenticated: true,
                durable: true,
                ledgerAuthenticated: true,
                ledgerDurable: true,
                authorityDurable: true,
                powerLossDurabilityTested: false,
                snapshotAuthenticated: false,
                qualifiesForPromotion: false,
                snapshot: { secret: "must-not-leak" },
              }),
            });
          }
          if (value === brokenStore) {
            return Object.freeze({
              load: () => {
                throw new Error("corrupt ledger");
              },
            });
          }
          throw new TypeError("unbranded store");
        },
      }),
    });
    const projection = inspectDesktopPmExplorationStorageHost(
      result.desktopPmExplorationStorageHost,
    );
    expect(projection).toMatchObject({
      configured: true,
      readable: true,
      snapshotAvailable: true,
      durableSnapshotAvailable: true,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(JSON.stringify(projection)).not.toContain("must-not-leak");

    const broken = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: brokenStore,
        }),
      }),
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore: (value) => {
          if (value !== brokenStore) throw new TypeError("unbranded store");
          return Object.freeze({
            load: () => {
              throw new Error("corrupt ledger");
            },
          });
        },
      }),
    });
    expect(
      inspectDesktopPmExplorationStorageHost(
        broken.desktopPmExplorationStorageHost,
      ),
    ).toMatchObject({ configured: true, readable: false });

    for (const load of [
      async () => null,
      () => ({ schema: "chainlesschain.pm-exploration-ledger-restore/v1" }),
    ]) {
      const store = Object.freeze({});
      const degraded = await loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationLedgerStore: store,
          }),
        }),
        importPmExplorationLedgerModule: async () => ({
          capturePmExplorationLedgerStore: (value) => {
            if (value !== store) throw new TypeError("unbranded store");
            return Object.freeze({ load });
          },
        }),
      });
      expect(
        inspectDesktopPmExplorationStorageHost(
          degraded.desktopPmExplorationStorageHost,
        ),
      ).toMatchObject({ configured: true, readable: false });
    }
  });

  it("rejects unbranded or accessor PM ledger stores without invoking getters", async () => {
    const store = Object.freeze({});
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationLedgerStore: store,
          }),
        }),
        importPmExplorationLedgerModule: async () => ({
          capturePmExplorationLedgerStore: () => {
            throw new TypeError(
              "a real PmExplorationLedgerAdapter is required",
            );
          },
        }),
      }),
    ).rejects.toThrow(/real PmExplorationLedgerAdapter/);

    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "pmExplorationLedgerStore", {
              enumerable: true,
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/enumerable data property/);
    expect(getter).not.toHaveBeenCalled();
  });

  it("narrows a signed PM execution host to an opaque main-process capability", async () => {
    const rawHost = Object.freeze({ name: "signed-host-placeholder" });
    const manifestDigest = `sha256:${"4".repeat(64)}`;
    const executionReceiptDigest = `sha256:${"5".repeat(64)}`;
    const graderReceiptDigest = `sha256:${"6".repeat(64)}`;
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const postRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: preRunSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockResolvedValueOnce(postRunSeal);
    const executeRound = vi.fn(async (_host, journal, input) => ({
      kind: "round",
      journal,
      input,
      executionReceipt: { receiptDigest: executionReceiptDigest },
      graderReceipt: { receiptDigest: graderReceiptDigest },
    }));
    const mergeBranches = vi.fn(async (_host, journal, input) => ({
      kind: "merge",
      journal,
      input,
    }));
    const evaluateMemory = vi.fn(async (_host, journal, input) => ({
      kind: "evaluate",
      journal,
      input,
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: mergeBranches,
        evaluatePmExplorationMemory: evaluateMemory,
      }),
      capturePmPreRunSeal,
    });

    const host = result.desktopPmExplorationExecutionHost;
    expect(isDesktopPmExplorationExecutionHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(Object.isFrozen(host)).toBe(true);
    expect(host.executePmExplorationRound).toBeUndefined();

    const stateTransitionDigest = `sha256:${createHash("sha256")
      .update("chainlesschain.desktop-pm-database-transition/v1\0")
      .update(
        JSON.stringify({
          manifestDigest,
          executionReceiptDigest,
          graderReceiptDigest,
          preRunSealDigest: preRunSeal.sealDigest,
          postRunSealDigest: postRunSeal.sealDigest,
          previousStateTransitionDigest: null,
        }),
      )
      .digest("hex")}`;

    const transitionEvidence = {
      schema: "chainlesschain.desktop-pm-state-transition-success/v1",
      manifestDigest,
      executionReceiptDigest,
      graderReceiptDigest,
      preRunSeal,
      postRunSeal,
      databaseChanged: true,
      previousStateTransitionDigest: null,
      stateTransitionDigest,
      authenticated: false,
      durable: false,
      qualifiesForPromotion: false,
    };
    await expect(
      executeDesktopPmExplorationRound(host, "journal", { roundId: "r1" }),
    ).resolves.toEqual({
      schema: "chainlesschain.desktop-pm-sealed-execution-result/v3",
      preRunSeal,
      postRunSeal,
      databaseChanged: true,
      previousStateTransitionDigest: null,
      stateTransitionDigest,
      transitionEvidence,
      transitionDurability: null,
      executionResult: {
        kind: "round",
        journal: "journal",
        input: { roundId: "r1" },
        executionReceipt: { receiptDigest: executionReceiptDigest },
        graderReceipt: { receiptDigest: graderReceiptDigest },
      },
      preRunSealVerified: true,
      qualifiesForPromotion: false,
    });
    await expect(
      mergeDesktopPmExplorationBranches(host, "journal", { mergeId: "m1" }),
    ).resolves.toMatchObject({ kind: "merge" });
    await expect(
      evaluateDesktopPmExplorationMemory(host, "journal", {
        finalMemoryDigest: "sha256:test",
      }),
    ).resolves.toMatchObject({ kind: "evaluate" });
    expect(executeRound).toHaveBeenCalledWith(rawHost, "journal", {
      roundId: "r1",
    });
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(2);
    expect(mergeBranches).toHaveBeenCalledWith(rawHost, "journal", {
      mergeId: "m1",
    });
    expect(evaluateMemory).toHaveBeenCalledWith(rawHost, "journal", {
      finalMemoryDigest: "sha256:test",
    });
  });

  it("commits successful transition evidence through the signed durability capability", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = `sha256:${"4".repeat(64)}`;
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const postRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: preRunSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockResolvedValueOnce(postRunSeal);
    const commitTransition = vi.fn(async (evidence) =>
      Object.freeze({
        schema: "chainlesschain.pm-exploration-transition-durability-ack/v1",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        evidenceDigest: evidence.stateTransitionDigest,
        transitionKind: "success",
        ledgerEventDigest: `sha256:${"8".repeat(64)}`,
        durabilityReceiptDigest: `sha256:${"9".repeat(64)}`,
        qualifiesForPromotion: false,
      }),
    );
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: async () => ({
          executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
          graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
        }),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: (value) => {
          if (value !== rawCommitter) throw new TypeError("unbranded");
          return Object.freeze({ manifestDigest, commitTransition });
        },
      }),
      capturePmPreRunSeal,
    });

    const execution = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r1" },
    );

    expect(result.desktopPmExplorationTransitionCommitter).toBeUndefined();
    expect(commitTransition).toHaveBeenCalledOnce();
    expect(commitTransition).toHaveBeenCalledWith(execution.transitionEvidence);
    expect(Object.isFrozen(execution.transitionEvidence)).toBe(true);
    expect(execution.transitionDurability).toMatchObject({
      authenticated: true,
      durable: true,
      readbackVerified: true,
      evidenceDigest: execution.stateTransitionDigest,
      transitionKind: "success",
    });
    expect(
      inspectDesktopPmExplorationExecutionHost(
        result.desktopPmExplorationExecutionHost,
      ),
    ).toMatchObject({ transitionDurabilityConfigured: true });
  });

  it("retains and readback-binds the post-run database snapshot before committing success", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const manifestDigest = sha("snapshot-backed-manifest");
    const databasePathDigest = sha("snapshot-backed-database");
    const preRunSnapshot = databaseRecoverySnapshot(
      "before",
      databasePathDigest,
    );
    const postRunSnapshot = databaseRecoverySnapshot(
      "after",
      databasePathDigest,
    );
    const events = [];
    const capturePmRecoverySnapshot = vi
      .fn()
      .mockImplementationOnce(async () => {
        events.push("capture-pre");
        return preRunSnapshot;
      })
      .mockImplementationOnce(async () => {
        events.push("capture-post");
        return postRunSnapshot;
      });
    const retainTransitionSnapshot = vi.fn(async (request) => {
      events.push("retain-snapshot");
      return Object.freeze({
        schema: "chainlesschain.pm-exploration-recovery-snapshot-ack/v1",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        transitionKind: request.transitionKind,
        snapshotRole: request.snapshotRole,
        evidenceDigest: request.evidenceDigest,
        sealDigest: request.seal.sealDigest,
        databaseSnapshotDigest: request.seal.databaseSnapshotDigest,
        databaseSnapshotBytes: request.seal.databaseSnapshotBytes,
        artifactDigest: sha("snapshot-artifact"),
        artifactRef: "snapshot:success",
        durabilityAuthorityId: "durability:test",
        durabilityReceiptDigest: sha("snapshot-receipt"),
        qualifiesForPromotion: false,
        snapshotAckDigest: sha("snapshot-ack"),
      });
    });
    const commitTransition = vi.fn(async (evidence, snapshotAck) => {
      events.push("commit-transition");
      return Object.freeze({
        schema: "chainlesschain.pm-exploration-transition-durability-ack/v2",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        evidenceDigest: evidence.stateTransitionDigest,
        transitionKind: "success",
        recoverySnapshotAckDigest: snapshotAck.snapshotAckDigest,
        ledgerEventDigest: sha("snapshot-ledger-event"),
        durabilityReceiptDigest: sha("transition-receipt"),
        qualifiesForPromotion: false,
      });
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSnapshot.seal.sealDigest,
        }),
        executePmExplorationRound: async () => {
          events.push("execute");
          return {
            executionReceipt: { receiptDigest: sha("snapshot-execution") },
            graderReceipt: { receiptDigest: sha("snapshot-grader") },
          };
        },
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition,
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: (value) => {
          if (value !== rawSnapshotStore) {
            throw new TypeError("unbranded");
          }
          return { manifestDigest, retainTransitionSnapshot };
        },
      }),
      capturePmRecoverySnapshot,
      capturePmPreRunSeal: vi.fn(),
    });

    const execution = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "snapshot-backed" },
    );
    expect(result.desktopPmExplorationRecoverySnapshotStore).toBeUndefined();
    expect(execution.schema).toBe(
      "chainlesschain.desktop-pm-sealed-execution-result/v4",
    );
    expect(execution.recoverySnapshot).toMatchObject({
      transitionKind: "success",
      snapshotRole: "post-run",
      evidenceDigest: execution.stateTransitionDigest,
      sealDigest: postRunSnapshot.seal.sealDigest,
    });
    expect(retainTransitionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestDigest,
        transitionKind: "success",
        snapshotRole: "post-run",
        evidenceDigest: execution.stateTransitionDigest,
        seal: postRunSnapshot.seal,
        bytes: expect.any(Buffer),
      }),
    );
    expect(commitTransition).toHaveBeenCalledWith(
      execution.transitionEvidence,
      execution.recoverySnapshot,
    );
    expect(events).toEqual([
      "capture-pre",
      "execute",
      "capture-post",
      "retain-snapshot",
      "commit-transition",
    ]);
    expect(
      inspectDesktopPmExplorationExecutionHost(
        result.desktopPmExplorationExecutionHost,
      ),
    ).toMatchObject({ recoverySnapshotConfigured: true });
  });

  it("binds database and workspace media into one retained recovery set", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const manifestDigest = sha("recovery-set-manifest");
    const databasePathDigest = sha("recovery-set-database");
    const preRunSnapshot = databaseRecoverySnapshot(
      "before",
      databasePathDigest,
    );
    const postRunSnapshot = databaseRecoverySnapshot(
      "after",
      databasePathDigest,
    );
    const workspaceSnapshotter = createDesktopPmWorkspaceSnapshotter({
      manifestDigest,
      workspaceRoot: process.cwd(),
      includePaths: ["package.json"],
      maxFileCount: 1,
      maxFileBytes: 1024 * 1024,
      maxSnapshotBytes: 2 * 1024 * 1024,
    });
    const capturePmRecoverySnapshot = vi
      .fn()
      .mockResolvedValueOnce(preRunSnapshot)
      .mockResolvedValueOnce(postRunSnapshot);
    const retainTransitionSnapshot = vi.fn(async (request) =>
      Object.freeze({
        schema: "chainlesschain.pm-exploration-recovery-snapshot-ack/v2",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        transitionKind: request.transitionKind,
        snapshotRole: request.snapshotRole,
        evidenceDigest: request.evidenceDigest,
        sealDigest: request.seal.sealDigest,
        databaseSnapshotDigest: request.seal.databaseSnapshotDigest,
        databaseSnapshotBytes: request.seal.databaseSnapshotBytes,
        workspaceSealDigest: request.workspaceSeal.sealDigest,
        workspaceRootDigest: request.workspaceSeal.workspaceRootDigest,
        capturePolicyDigest: request.workspaceSeal.capturePolicyDigest,
        workspaceSnapshotDigest: request.workspaceSeal.workspaceSnapshotDigest,
        workspaceSnapshotBytes: request.workspaceSeal.workspaceSnapshotBytes,
        workspaceFileCount: request.workspaceSeal.workspaceFileCount,
        artifactDigest: sha("recovery-set-artifact"),
        artifactRef: "snapshot:recovery-set",
        durabilityAuthorityId: "durability:test",
        durabilityReceiptDigest: sha("recovery-set-receipt"),
        qualifiesForPromotion: false,
        snapshotAckDigest: sha("recovery-set-ack"),
      }),
    );
    const commitTransition = vi.fn(async (evidence, snapshotAck) =>
      Object.freeze({
        schema: "chainlesschain.pm-exploration-transition-durability-ack/v2",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        evidenceDigest: evidence.stateTransitionDigest,
        transitionKind: "success",
        recoverySnapshotAckDigest: snapshotAck.snapshotAckDigest,
        ledgerEventDigest: sha("recovery-set-ledger-event"),
        durabilityReceiptDigest: sha("recovery-set-transition-receipt"),
        qualifiesForPromotion: false,
      }),
    );
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
          pmExplorationWorkspaceSnapshotter: workspaceSnapshotter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSnapshot.seal.sealDigest,
        }),
        executePmExplorationRound: async () => ({
          executionReceipt: { receiptDigest: sha("recovery-set-execution") },
          graderReceipt: { receiptDigest: sha("recovery-set-grader") },
        }),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition,
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: () => ({
          manifestDigest,
          retainTransitionSnapshot,
        }),
      }),
      capturePmRecoverySnapshot,
      capturePmPreRunSeal: vi.fn(),
    });

    const execution = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "recovery-set" },
    );

    expect(execution).toMatchObject({
      schema: "chainlesschain.desktop-pm-sealed-execution-result/v5",
      workspaceChanged: false,
      recoverySnapshot: {
        schema: "chainlesschain.pm-exploration-recovery-snapshot-ack/v2",
      },
    });
    expect(retainTransitionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: "chainlesschain.pm-exploration-recovery-snapshot-request/v2",
        workspaceSeal: execution.postRunWorkspaceSeal,
        workspaceBytes: expect.any(Buffer),
      }),
    );
    expect(commitTransition).toHaveBeenCalledWith(
      execution.transitionEvidence,
      execution.recoverySnapshot,
    );
    expect(
      inspectDesktopPmExplorationExecutionHost(
        result.desktopPmExplorationExecutionHost,
      ),
    ).toMatchObject({
      recoverySnapshotConfigured: true,
      workspaceSnapshotConfigured: true,
    });
  });

  it("retains the pre-run snapshot as the recovery target for a failed round", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const manifestDigest = sha("failure-snapshot-manifest");
    const databasePathDigest = sha("failure-snapshot-database");
    const preRunSnapshot = databaseRecoverySnapshot(
      "failure-before",
      databasePathDigest,
    );
    const failureSnapshot = databaseRecoverySnapshot(
      "failure-after",
      databasePathDigest,
    );
    const actorFailure = new Error("actor changed the database then failed");
    const capturePmRecoverySnapshot = vi
      .fn()
      .mockResolvedValueOnce(preRunSnapshot)
      .mockResolvedValueOnce(failureSnapshot);
    const retainTransitionSnapshot = vi.fn(async (request) => ({
      schema: "chainlesschain.pm-exploration-recovery-snapshot-ack/v1",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest,
      transitionKind: "failure",
      snapshotRole: "pre-run",
      evidenceDigest: request.evidenceDigest,
      sealDigest: request.seal.sealDigest,
      databaseSnapshotDigest: request.seal.databaseSnapshotDigest,
      databaseSnapshotBytes: request.seal.databaseSnapshotBytes,
      artifactDigest: sha("failure-snapshot-artifact"),
      artifactRef: "snapshot:failure",
      durabilityAuthorityId: "durability:test",
      durabilityReceiptDigest: sha("failure-snapshot-receipt"),
      qualifiesForPromotion: false,
      snapshotAckDigest: sha("failure-snapshot-ack"),
    }));
    const commitTransition = vi.fn(async (evidence, snapshotAck) => ({
      schema: "chainlesschain.pm-exploration-transition-durability-ack/v2",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest,
      evidenceDigest: evidence.evidenceDigest,
      transitionKind: "failure",
      recoverySnapshotAckDigest: snapshotAck.snapshotAckDigest,
      ledgerEventDigest: sha("failure-snapshot-event"),
      durabilityReceiptDigest: sha("failure-transition-receipt"),
      qualifiesForPromotion: false,
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSnapshot.seal.sealDigest,
        }),
        executePmExplorationRound: async () => {
          throw actorFailure;
        },
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition,
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: () => ({
          manifestDigest,
          retainTransitionSnapshot,
        }),
      }),
      capturePmRecoverySnapshot,
    });
    let failure;
    try {
      await executeDesktopPmExplorationRound(
        result.desktopPmExplorationExecutionHost,
        "journal",
        { roundId: "failure-snapshot" },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: "CC_DESKTOP_PM_EXECUTION_TAINTED",
      cause: actorFailure,
      recoverySnapshotFailed: false,
      recoverySnapshot: {
        transitionKind: "failure",
        snapshotRole: "pre-run",
        sealDigest: preRunSnapshot.seal.sealDigest,
      },
    });
    const request = retainTransitionSnapshot.mock.calls[0][0];
    expect(request.seal).toEqual(preRunSnapshot.seal);
    expect(request.bytes).toEqual(preRunSnapshot.bytes);
    expect(commitTransition).toHaveBeenCalledWith(
      failure.evidence,
      failure.recoverySnapshot,
    );
  });

  it("reconstructs the transition chain from an authenticated success head", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = sha("restart-success-manifest");
    const databasePathDigest = sha("restart-success-database");
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-success-initial"),
      databaseSnapshotBytes: 4096,
    });
    const recoveredSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-success-recovered"),
      databaseSnapshotBytes: 4096,
    });
    const nextSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-success-next"),
      databaseSnapshotBytes: 4096,
    });
    const recoveredEvidence = successTransitionEvidence({
      manifestDigest,
      preRunSeal: initialSeal,
      postRunSeal: recoveredSeal,
    });
    const recovery = recoveredTransition(
      manifestDigest,
      recoveredEvidence,
      "success",
      7,
    );
    const recoverTransition = vi.fn(async () => recovery);
    const commitTransition = vi.fn(async (evidence) => ({
      schema: "chainlesschain.pm-exploration-transition-durability-ack/v1",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest,
      evidenceDigest: evidence.stateTransitionDigest,
      transitionKind: "success",
      ledgerEventDigest: sha("restart-success-next-event"),
      durabilityReceiptDigest: sha("restart-success-next-receipt"),
      qualifiesForPromotion: false,
    }));
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(recoveredSeal)
      .mockResolvedValueOnce(nextSeal);
    const executeRound = vi.fn(async () => ({
      executionReceipt: { receiptDigest: sha("restart-next-execution") },
      graderReceipt: { receiptDigest: sha("restart-next-grader") },
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: (value) => {
          if (value !== rawCommitter) throw new TypeError("unbranded");
          return { manifestDigest, commitTransition, recoverTransition };
        },
      }),
      capturePmPreRunSeal,
    });
    const host = result.desktopPmExplorationExecutionHost;

    expect(recoverTransition).toHaveBeenCalledOnce();
    expect(capturePmPreRunSeal).not.toHaveBeenCalled();
    expect(inspectDesktopPmExplorationExecutionHost(host)).toMatchObject({
      tainted: false,
      transitionRecoveryConfigured: true,
      transitionRecoveryStatus: "success",
      transitionRecoveryRevision: 7,
    });

    const execution = await executeDesktopPmExplorationRound(host, "journal", {
      roundId: "after-restart",
    });
    expect(execution.preRunSeal).toEqual(recoveredSeal);
    expect(execution.previousStateTransitionDigest).toBe(
      recoveredEvidence.stateTransitionDigest,
    );
    expect(execution.transitionEvidence.previousStateTransitionDigest).toBe(
      recoveredEvidence.stateTransitionDigest,
    );
    expect(executeRound).toHaveBeenCalledOnce();
    expect(commitTransition).toHaveBeenCalledOnce();
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(2);
  });

  it("reconstructs a durable clone recovery head and resumes from its restored seal", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = sha("restart-recovery-manifest");
    const databasePathDigest = sha("restart-recovery-database");
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-recovery-initial"),
      databaseSnapshotBytes: 4096,
    });
    const restoredSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-recovery-restored"),
      databaseSnapshotBytes: 4096,
    });
    const nextSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-recovery-next"),
      databaseSnapshotBytes: 4096,
    });
    const recoveryEvent = cloneRecoveryEvent(
      manifestDigest,
      restoredSeal.sealDigest,
    );
    const recoverTransition = vi.fn(async () =>
      recoveredTransition(manifestDigest, recoveryEvent, "recovery", 9),
    );
    const commitTransition = vi.fn(async (evidence) => ({
      schema: "chainlesschain.pm-exploration-transition-durability-ack/v1",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest,
      evidenceDigest: evidence.stateTransitionDigest,
      transitionKind: "success",
      ledgerEventDigest: sha("restart-recovery-next-event"),
      durabilityReceiptDigest: sha("restart-recovery-next-receipt"),
      qualifiesForPromotion: false,
    }));
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(restoredSeal)
      .mockResolvedValueOnce(nextSeal);
    const executeRound = vi.fn(async () => ({
      executionReceipt: { receiptDigest: sha("recovery-next-execution") },
      graderReceipt: { receiptDigest: sha("recovery-next-grader") },
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition,
          recoverTransition,
        }),
      }),
      capturePmPreRunSeal,
    });
    const host = result.desktopPmExplorationExecutionHost;

    expect(inspectDesktopPmExplorationExecutionHost(host)).toMatchObject({
      tainted: false,
      requiresRecovery: false,
      transitionRecoveryStatus: "recovery",
      transitionRecoveryRevision: 9,
    });
    const execution = await executeDesktopPmExplorationRound(host, "journal", {
      roundId: "after-clone-recovery",
    });
    expect(execution.preRunSeal).toEqual(restoredSeal);
    expect(execution.previousStateTransitionDigest).toBe(
      recoveryEvent.recoveryEventDigest,
    );
    expect(execution.transitionEvidence.previousStateTransitionDigest).toBe(
      recoveryEvent.recoveryEventDigest,
    );
    expect(executeRound).toHaveBeenCalledOnce();
    expect(commitTransition).toHaveBeenCalledOnce();
  });

  it("reconstructs a durable failure head as a tainted restart state", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = sha("restart-failure-manifest");
    const databasePathDigest = sha("restart-failure-database");
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-failure-initial"),
      databaseSnapshotBytes: 4096,
    });
    const failureSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("restart-failure-written"),
      databaseSnapshotBytes: 4096,
    });
    const previousStateTransitionDigest = sha("previous-success-transition");
    const evidence = failureTransitionEvidence({
      manifestDigest,
      preRunSeal: initialSeal,
      failureSeal,
      previousStateTransitionDigest,
    });
    const recoverTransition = vi.fn(async () =>
      recoveredTransition(manifestDigest, evidence, "failure", 8),
    );
    const capturePmPreRunSeal = vi.fn();
    const executeRound = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition,
        }),
      }),
      capturePmPreRunSeal,
    });
    const host = result.desktopPmExplorationExecutionHost;

    expect(inspectDesktopPmExplorationExecutionHost(host)).toMatchObject({
      tainted: true,
      requiresRecovery: true,
      transitionRecoveryConfigured: true,
      transitionRecoveryStatus: "failure",
      transitionRecoveryRevision: 8,
    });
    await expect(
      executeDesktopPmExplorationRound(host, "journal", {
        roundId: "must-not-run",
      }),
    ).rejects.toMatchObject({ code: "CC_DESKTOP_PM_EXECUTION_TAINTED" });
    expect(recoverTransition).toHaveBeenCalledOnce();
    expect(capturePmPreRunSeal).not.toHaveBeenCalled();
    expect(executeRound).not.toHaveBeenCalled();
  });

  it("requires exact recovery-set readback for a snapshot-bound restart head", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const manifestDigest = sha("snapshot-restart-manifest");
    const databasePathDigest = sha("snapshot-restart-database");
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("snapshot-restart-initial"),
      databaseSnapshotBytes: 4096,
    });
    const failureSeal = createDesktopPmPreRunSealValue({
      databasePathDigest,
      databaseSnapshotDigest: sha("snapshot-restart-written"),
      databaseSnapshotBytes: 4096,
    });
    const evidence = failureTransitionEvidence({
      manifestDigest,
      preRunSeal: initialSeal,
      failureSeal,
    });
    const recoverySnapshot = Object.freeze({
      snapshotAckDigest: sha("snapshot-restart-ack"),
    });
    const recovery = Object.freeze({
      ...recoveredTransition(manifestDigest, evidence, "failure", 9),
      schema: "chainlesschain.pm-exploration-transition-recovery/v2",
      recoverySnapshot,
    });
    const recoverTransition = vi.fn(async () => recovery);
    const databaseBytes = Buffer.from("snapshot-restart-database-bytes");
    const resolveTransitionSnapshot = vi.fn(() =>
      Object.freeze({
        schema: "chainlesschain.pm-exploration-recovery-snapshot-resolution/v1",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        acknowledgement: recoverySnapshot,
        databaseSeal: initialSeal,
        databaseBytes,
        workspaceSeal: null,
        workspaceBytes: null,
        durabilityReceiptDigest: sha("snapshot-restart-readback"),
        qualifiesForPromotion: false,
      }),
    );
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: vi.fn(),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition,
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: (value) => {
          if (value !== rawSnapshotStore) throw new TypeError("unbranded");
          return {
            manifestDigest,
            retainTransitionSnapshot: vi.fn(),
            resolveTransitionSnapshot,
          };
        },
      }),
      capturePmPreRunSeal: vi.fn(),
    });

    expect(resolveTransitionSnapshot).toHaveBeenCalledWith(recoverySnapshot);
    expect(
      inspectDesktopPmExplorationExecutionHost(
        result.desktopPmExplorationExecutionHost,
      ),
    ).toMatchObject({
      tainted: true,
      transitionRecoveryStatus: "failure",
      transitionRecoveryRevision: 9,
    });
  });

  it("fails closed when transition recovery is not bound to the manifest", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = sha("recovery-binding-manifest");
    const recoverTransition = vi.fn(async () => ({
      schema: "chainlesschain.pm-exploration-transition-recovery/v1",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest: sha("substituted-manifest"),
      revision: 0,
      transitionKind: null,
      evidenceDigest: null,
      evidence: null,
      ledgerHeadDigest: sha("empty-ledger-head"),
      ledgerEventDigest: null,
      durabilityReceiptDigest: null,
      qualifiesForPromotion: false,
    }));

    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
            pmExplorationTransitionCommitter: rawCommitter,
          }),
        }),
        importPmExplorationExecutionModule: async () => ({
          isPmExplorationExecutionHost: (value) => value === rawHost,
          inspectPmExplorationExecutionHost: () => ({
            manifestDigest,
            preRunSealDigest: sha("initial-seal"),
          }),
          executePmExplorationRound: vi.fn(),
          mergePmExplorationBranches: vi.fn(),
          evaluatePmExplorationMemory: vi.fn(),
        }),
        importPmExplorationTransitionModule: async () => ({
          capturePmExplorationTransitionCommitter: () => ({
            manifestDigest,
            commitTransition: vi.fn(),
            recoverTransition,
          }),
        }),
      }),
    ).rejects.toThrow("transition recovery is invalid");
    expect(recoverTransition).toHaveBeenCalledOnce();
  });

  it("taints without appending a contradictory failure when success commit is ambiguous", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const manifestDigest = `sha256:${"4".repeat(64)}`;
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const postRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: preRunSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockResolvedValueOnce(postRunSeal)
      .mockResolvedValueOnce(postRunSeal);
    const commitFailure = new Error("durability acknowledgement was lost");
    const commitTransition = vi.fn(async () => {
      throw commitFailure;
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: async () => ({
          executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
          graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
        }),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition,
        }),
      }),
      capturePmPreRunSeal,
    });

    await expect(
      executeDesktopPmExplorationRound(
        result.desktopPmExplorationExecutionHost,
        "journal",
        { roundId: "r1" },
      ),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_PM_EXECUTION_TAINTED",
      cause: commitFailure,
      transitionDurability: null,
      transitionDurabilityFailed: true,
      transitionCommitOutcomeUnknown: true,
    });
    expect(commitTransition).toHaveBeenCalledOnce();
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(3);
    expect(
      inspectDesktopPmExplorationExecutionHost(
        result.desktopPmExplorationExecutionHost,
      ).tainted,
    ).toBe(true);
  });

  it("serializes seal-execute-seal windows that share a database capture", async () => {
    const rawHost = Object.freeze({});
    const seal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const events = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const capturePmPreRunSeal = vi.fn(async () => {
      events.push("seal");
      return seal;
    });
    const executeRound = vi.fn(async (_host, _journal, input) => {
      events.push(`execute:${input.roundId}:start`);
      if (input.roundId === "r1") await firstGate;
      events.push(`execute:${input.roundId}:end`);
      return {
        executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
        graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
      };
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: seal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal,
    });
    const first = executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r1" },
    );
    const second = executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r2" },
    );

    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "seal",
      "execute:r1:start",
      "execute:r1:end",
      "seal",
      "seal",
      "execute:r2:start",
      "execute:r2:end",
      "seal",
    ]);
  });

  it("chains each later pre-run seal to the previous post-run seal", async () => {
    const rawHost = Object.freeze({});
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const firstPostSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: initialSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const secondPostSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: initialSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"7".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(initialSeal)
      .mockResolvedValueOnce(firstPostSeal)
      .mockResolvedValueOnce(firstPostSeal)
      .mockResolvedValueOnce(secondPostSeal);
    const executeRound = vi.fn(async () => ({
      executionReceipt: { receiptDigest: `sha256:${"5".repeat(64)}` },
      graderReceipt: { receiptDigest: `sha256:${"6".repeat(64)}` },
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal,
    });

    const first = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r1" },
    );
    const second = await executeDesktopPmExplorationRound(
      result.desktopPmExplorationExecutionHost,
      "journal",
      { roundId: "r2" },
    );

    expect(first.preRunSeal).toEqual(initialSeal);
    expect(first.postRunSeal).toEqual(firstPostSeal);
    expect(first.previousStateTransitionDigest).toBeNull();
    expect(second.preRunSeal).toEqual(firstPostSeal);
    expect(second.postRunSeal).toEqual(secondPostSeal);
    expect(second.previousStateTransitionDigest).toBe(
      first.stateTransitionDigest,
    );
    expect(second.stateTransitionDigest).not.toBe(first.stateTransitionDigest);
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(4);
  });

  it("seals a failed execution and taints the host until recovery", async () => {
    const rawHost = Object.freeze({});
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const failureSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: preRunSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockResolvedValueOnce(failureSeal);
    const actorFailure = new Error("actor crashed after a committed write");
    const rawCommitter = Object.freeze({});
    const manifestDigest = `sha256:${"4".repeat(64)}`;
    const commitTransition = vi.fn(async (evidence) =>
      Object.freeze({
        schema: "chainlesschain.pm-exploration-transition-durability-ack/v1",
        authenticated: true,
        durable: true,
        readbackVerified: true,
        manifestDigest,
        evidenceDigest: evidence.evidenceDigest,
        transitionKind: "failure",
        ledgerEventDigest: `sha256:${"8".repeat(64)}`,
        durabilityReceiptDigest: `sha256:${"9".repeat(64)}`,
        qualifiesForPromotion: false,
      }),
    );
    const executeRound = vi.fn(async () => {
      throw actorFailure;
    });
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: (value) => {
          if (value !== rawCommitter) throw new TypeError("unbranded");
          return Object.freeze({ manifestDigest, commitTransition });
        },
      }),
      capturePmPreRunSeal,
    });
    const host = result.desktopPmExplorationExecutionHost;
    let failure;

    try {
      await executeDesktopPmExplorationRound(host, "journal", {
        roundId: "r1",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.code).toBe("CC_DESKTOP_PM_EXECUTION_TAINTED");
    expect(failure.cause).toBe(actorFailure);
    const failureCore = {
      schema: "chainlesschain.desktop-pm-failed-execution-evidence/v1",
      manifestDigest,
      preRunSeal,
      failureSeal,
      databaseIdentityUnchanged: true,
      databaseChanged: true,
      previousStateTransitionDigest: null,
      failureClass: "execution-or-evidence-failed",
      authenticated: false,
      durable: false,
      qualifiesForPromotion: false,
    };
    const evidenceDigest = `sha256:${createHash("sha256")
      .update("chainlesschain.desktop-pm-failed-execution-evidence/v1\0")
      .update(JSON.stringify(failureCore))
      .digest("hex")}`;
    expect(failure.evidence).toEqual({
      ...failureCore,
      evidenceDigest,
    });
    expect(Object.isFrozen(failure.evidence)).toBe(true);
    expect(failure.transitionDurability).toMatchObject({
      authenticated: true,
      durable: true,
      readbackVerified: true,
      evidenceDigest,
      transitionKind: "failure",
    });
    expect(failure.transitionDurabilityFailed).toBe(false);
    expect(commitTransition).toHaveBeenCalledWith(failure.evidence);
    expect(inspectDesktopPmExplorationExecutionHost(host)).toEqual({
      tainted: true,
      requiresRecovery: true,
      transitionDurabilityConfigured: true,
      recoverySnapshotConfigured: false,
      workspaceSnapshotConfigured: false,
      transitionRecoveryConfigured: false,
      transitionRecoveryStatus: "unavailable",
      transitionRecoveryRevision: null,
      qualifiesForPromotion: false,
    });

    await expect(
      executeDesktopPmExplorationRound(host, "journal", { roundId: "r2" }),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_PM_EXECUTION_TAINTED",
      message: "Desktop PM execution host is tainted and requires recovery",
    });
    expect(executeRound).toHaveBeenCalledOnce();
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(2);
  });

  it("keeps the original failure when the failure-state seal is unavailable", async () => {
    const rawHost = Object.freeze({});
    const preRunSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const capturePmPreRunSeal = vi
      .fn()
      .mockResolvedValueOnce(preRunSeal)
      .mockRejectedValueOnce(new Error("backup unavailable"));
    const actorFailure = new Error("actor failure");
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: preRunSeal.sealDigest,
        }),
        executePmExplorationRound: async () => {
          throw actorFailure;
        },
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal,
    });

    await expect(
      executeDesktopPmExplorationRound(
        result.desktopPmExplorationExecutionHost,
        "journal",
        { roundId: "r1" },
      ),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_PM_EXECUTION_TAINTED",
      cause: actorFailure,
      evidence: {
        failureSeal: null,
        databaseIdentityUnchanged: null,
        databaseChanged: null,
        authenticated: false,
        durable: false,
      },
    });
    expect(capturePmPreRunSeal).toHaveBeenCalledTimes(2);
  });

  it("rejects unbranded or accessor PM execution hosts", async () => {
    const rawHost = Object.freeze({});
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
          }),
        }),
        importPmExplorationExecutionModule: async () => ({
          isPmExplorationExecutionHost: () => false,
          executePmExplorationRound: vi.fn(),
          mergePmExplorationBranches: vi.fn(),
          evaluatePmExplorationMemory: vi.fn(),
        }),
      }),
    ).rejects.toThrow(/branded PM exploration execution host/);

    const inspectorGetter = vi.fn();
    const accessorModule = {
      isPmExplorationExecutionHost: () => true,
      executePmExplorationRound: vi.fn(),
      mergePmExplorationBranches: vi.fn(),
      evaluatePmExplorationMemory: vi.fn(),
    };
    Object.defineProperty(accessorModule, "inspectPmExplorationExecutionHost", {
      enumerable: true,
      get: inspectorGetter,
    });
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
          }),
        }),
        importPmExplorationExecutionModule: async () => accessorModule,
      }),
    ).rejects.toThrow(/inspector must be a direct function/);
    expect(inspectorGetter).not.toHaveBeenCalled();

    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "pmExplorationExecutionHost", {
              enumerable: true,
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/enumerable data property/);
    expect(getter).not.toHaveBeenCalled();
    await expect(executeDesktopPmExplorationRound({}, {}, {})).rejects.toThrow(
      /branded Desktop PM exploration execution host/,
    );
  });

  it("rejects unbound, mismatched or accessor transition committers", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const executionModule = {
      isPmExplorationExecutionHost: (value) => value === rawHost,
      inspectPmExplorationExecutionHost: () => ({
        manifestDigest: `sha256:${"4".repeat(64)}`,
        preRunSealDigest: `sha256:${"1".repeat(64)}`,
      }),
      executePmExplorationRound: vi.fn(),
      mergePmExplorationBranches: vi.fn(),
      evaluatePmExplorationMemory: vi.fn(),
    };

    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationTransitionCommitter: rawCommitter,
          }),
        }),
      }),
    ).rejects.toThrow("requires an execution host");

    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            pmExplorationExecutionHost: rawHost,
            pmExplorationTransitionCommitter: rawCommitter,
          }),
        }),
        importPmExplorationExecutionModule: async () => executionModule,
        importPmExplorationTransitionModule: async () => ({
          capturePmExplorationTransitionCommitter: () => ({
            manifestDigest: `sha256:${"7".repeat(64)}`,
            commitTransition: vi.fn(),
          }),
        }),
      }),
    ).rejects.toThrow("manifest does not match execution host");

    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty(
              { pmExplorationExecutionHost: rawHost },
              "pmExplorationTransitionCommitter",
              { enumerable: true, get: getter },
            ),
        }),
      }),
    ).rejects.toThrow("enumerable data property");
    expect(getter).not.toHaveBeenCalled();
  });

  it("blocks Desktop execution before the signed pre-run seal diverges", async () => {
    const rawHost = Object.freeze({});
    const signedSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: `sha256:${"1".repeat(64)}`,
      databaseSnapshotDigest: `sha256:${"2".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const observedSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: signedSeal.databasePathDigest,
      databaseSnapshotDigest: `sha256:${"3".repeat(64)}`,
      databaseSnapshotBytes: 4096,
    });
    const executeRound = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationExecutionHost: rawHost,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: `sha256:${"4".repeat(64)}`,
          preRunSealDigest: signedSeal.sealDigest,
        }),
        executePmExplorationRound: executeRound,
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      capturePmPreRunSeal: async () => observedSeal,
    });

    await expect(
      executeDesktopPmExplorationRound(
        result.desktopPmExplorationExecutionHost,
        "journal",
        { roundId: "round-one" },
      ),
    ).rejects.toThrow("differs from signed manifest");
    expect(executeRound).not.toHaveBeenCalled();
  });

  it("creates a frozen WebShell composition capability without exposing its factory", async () => {
    const {
      createDesktopModelIngressHost,
      createDesktopEvolutionCompositionFactory,
    } = require("../desktop-model-ingress");
    const factory = vi.fn(async (context) => ({ context }));
    const host = createDesktopModelIngressHost(factory);
    const capability = createDesktopEvolutionCompositionFactory(host);
    const context = Object.freeze({ mode: "ws-chat", runId: "run-1" });

    await expect(capability(context)).resolves.toEqual({ context });
    expect(capability).not.toBe(factory);
    expect(Object.isFrozen(capability)).toBe(true);
    expect(factory).toHaveBeenCalledWith(context);
    expect(() => createDesktopEvolutionCompositionFactory({})).toThrow(
      /branded Desktop model ingress host/,
    );
  });

  it("rejects accessor and Proxy model factories", async () => {
    const getter = vi.fn();
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () =>
            Object.defineProperty({}, "evolutionCompositionFactory", {
              get: getter,
            }),
        }),
      }),
    ).rejects.toThrow(/data property/);
    expect(getter).not.toHaveBeenCalled();
    const {
      createDesktopModelIngressHost,
    } = require("../desktop-model-ingress");
    expect(() =>
      createDesktopModelIngressHost(new Proxy(() => {}, {})),
    ).toThrow(/must be a function/);
    expect(() =>
      createDesktopModelIngressHost(() => {}, {
        isPackaged: true,
        resourcesPath: "relative",
      }),
    ).toThrow(/absolute/);
  });
  it("loads an independent marketplace capability through its branded Desktop facade", async () => {
    const marketplaceHost = {
      tenantId: "tenant:desktop",
      target: {
        tool: "desktop",
        model: "test",
        os: "win32-x64",
        runtime: "electron-39",
      },
      ...Object.fromEntries(
        ["inspect", "install", "list", "state", "rollout", "revoke"].map(
          (name) => [name, vi.fn()],
        ),
      ),
    };
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          marketplaceHost,
        }),
      }),
      importMarketplaceHostModule: async () => ({
        isGovernedSkillMarketplaceCliHost: (value) => value === marketplaceHost,
      }),
    });
    const {
      isDesktopGovernedSkillMarketplaceHost,
    } = require("../../marketplace/governed-skill-marketplace-host");
    expect(
      isDesktopGovernedSkillMarketplaceHost(
        result.governedSkillMarketplaceHost,
      ),
    ).toBe(true);
    expect(result.governedSkillMarketplaceHost.target.tool).toBe("desktop");
    result.governedSkillMarketplaceHost.state({ skillName: "safe-refactor" });
    expect(marketplaceHost.state).toHaveBeenCalledWith({
      skillName: "safe-refactor",
    });
  });

  it("rejects a marketplace host for a non-Desktop target", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            marketplaceHost: { target: { tool: "cli" } },
          }),
        }),
        importMarketplaceHostModule: async () => ({
          isGovernedSkillMarketplaceCliHost: () => true,
        }),
      }),
    ).rejects.toThrow("fixed desktop target");
  });

  it("returns no governed dependencies when deployment is not configured", async () => {
    const load = vi.fn(async () => null);
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: load,
        }),
      }),
    ).resolves.toEqual({});
    expect(load).toHaveBeenCalledWith(
      "desktop",
      expect.objectContaining({ additionalFactories: expect.any(Object) }),
    );
    const factories = load.mock.calls[0][1].additionalFactories;
    expect(Object.isFrozen(factories)).toBe(true);
    expect(factories).toEqual({
      createDesktopPmCloneRecoveryController: expect.any(Function),
      createDesktopPmReadOnlyOutcomeReader: expect.any(Function),
      createDesktopPmWorkspaceSnapshotter: expect.any(Function),
      createEvolvableArtifactRuntimeComposition: expect.any(Function),
    });
    const outcomeReader = factories.createDesktopPmReadOnlyOutcomeReader({
      planDigest: `sha256:${"1".repeat(64)}`,
      environmentDigest: `sha256:${"2".repeat(64)}`,
      databasePathDigest: `sha256:${"3".repeat(64)}`,
      bindings: [
        {
          taskId: "task-one",
          kind: "project-state",
          projectId: "project-one",
        },
      ],
    });
    expect(outcomeReader).toEqual({
      bindingDigest: expect.stringMatching(/^sha256:/u),
      readProjectState: expect.any(Function),
      readBoardExport: expect.any(Function),
    });
    expect(Object.isFrozen(outcomeReader)).toBe(true);
  });

  it("loads a branded clone recovery host without auto-recovering a non-failure head", async () => {
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const manifestDigest = sha("clone-recovery-host-manifest");
    const initialSeal = createDesktopPmPreRunSealValue({
      databasePathDigest: sha("clone-recovery-database"),
      databaseSnapshotDigest: sha("clone-recovery-initial"),
      databaseSnapshotBytes: 4096,
    });
    const acquireExclusiveClone = vi.fn();
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async (
          _command,
          options,
        ) => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
          pmExplorationWorkspaceSnapshotter:
            options.additionalFactories.createDesktopPmWorkspaceSnapshotter({
              manifestDigest,
              workspaceRoot: path.resolve("."),
              includePaths: ["package.json"],
              maxFileCount: 10,
              maxFileBytes: 1024 * 1024,
              maxSnapshotBytes: 1024 * 1024,
            }),
          pmExplorationCloneRecoveryController:
            options.additionalFactories.createDesktopPmCloneRecoveryController({
              manifestDigest,
              applicationMainDatabasePathDigest: sha("application-main"),
              cloneIdentityDigest: sha("clone-identity"),
              resolveTransitionSnapshot: vi.fn(),
              acquireExclusiveClone,
              closeClone: vi.fn(),
              replaceCloneRecoverySet: vi.fn(),
              reopenClone: vi.fn(),
              captureDatabaseSnapshot: vi.fn(),
              captureWorkspaceSnapshot: vi.fn(),
              commitRecoveryEvent: vi.fn(),
              finalizeExclusiveClone: vi.fn(),
            }),
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (value) => value === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest,
          preRunSealDigest: initialSeal.sealDigest,
        }),
        executePmExplorationRound: vi.fn(),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition: vi.fn(async () => ({
            schema: "chainlesschain.pm-exploration-transition-recovery/v1",
            authenticated: true,
            durable: true,
            readbackVerified: true,
            manifestDigest,
            revision: 0,
            transitionKind: null,
            evidenceDigest: null,
            evidence: null,
            ledgerHeadDigest: sha("empty-clone-recovery-ledger"),
            ledgerEventDigest: null,
            durabilityReceiptDigest: null,
            qualifiesForPromotion: false,
          })),
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: (value) => {
          if (value !== rawSnapshotStore) throw new TypeError("unbranded");
          return {
            manifestDigest,
            retainTransitionSnapshot: vi.fn(),
            resolveTransitionSnapshot: vi.fn(),
          };
        },
      }),
      capturePmPreRunSeal: vi.fn(),
    });
    const recoveryHost = result.desktopPmExplorationCloneRecoveryHost;

    expect(inspectDesktopPmExplorationCloneRecoveryHost(recoveryHost)).toEqual({
      configured: true,
      recoverableFailure: false,
      controllerStatus: "ready",
      qualifiesForPromotion: false,
    });
    await expect(
      recoverDesktopPmExplorationClone(recoveryHost),
    ).rejects.toMatchObject({
      code: "CC_DESKTOP_PM_CLONE_RECOVERY_UNAVAILABLE",
    });
    expect(acquireExclusiveClone).not.toHaveBeenCalled();
  });

  it("extracts all three readers only from its branded composition", async () => {
    const load = vi.fn(async (_command, options) => ({
      evolvableArtifactRuntimeComposition:
        options.additionalFactories.createEvolvableArtifactRuntimeComposition({
          tenantId: "desktop-tenant",
          artifacts: {
            [ARTIFACT_TYPE.SKILL]: runtimeConfig("skill-v1"),
            [ARTIFACT_TYPE.PROMPT]: runtimeConfig("prompt-v1"),
            [ARTIFACT_TYPE.HOOK]: runtimeConfig("hook-v1"),
          },
        }),
    }));
    const result = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: load,
      }),
    });

    expect(result.evolvableArtifactSkillActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactPromptActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactHookActiveReleaseReader).toBeDefined();
    expect(result.evolvableArtifactSkillLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactPromptLifecycleProducer).toBeDefined();
    expect(result.evolvableArtifactHookLifecycleProducer).toBeDefined();
  });

  it("rejects unbranded and incomplete deployment results", async () => {
    await expect(
      loadDesktopEvolutionDependencies({
        importLoader: async () => ({
          loadEvolutionDeploymentCommandDependencies: async () => ({
            evolvableArtifactRuntimeComposition: {},
          }),
        }),
      }),
    ).rejects.toThrow("branded runtime composition");

    expect(
      resolveLoaderPath({ isPackaged: true, resourcesPath: "C:\\app" }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "evolution-deployment-loader.js",
      ),
    );
    expect(
      resolvePmExplorationLedgerAdapterPath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-ledger-adapter.js",
      ),
    );
    expect(
      resolvePmExplorationExecutionHostPath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-execution-host.js",
      ),
    );
    expect(
      resolvePmExplorationTransitionCommitterPath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-transition-committer.js",
      ),
    );
    expect(
      resolvePmExplorationRecoverySnapshotStorePath({
        isPackaged: true,
        resourcesPath: "C:\\app",
      }),
    ).toBe(
      path.join(
        "C:\\app",
        "packages",
        "cli",
        "src",
        "lib",
        "evolution",
        "pm-exploration-recovery-snapshot-store.js",
      ),
    );
  });
});
