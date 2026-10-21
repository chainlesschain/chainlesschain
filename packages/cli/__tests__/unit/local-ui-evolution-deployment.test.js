import {
  generateKeyPairSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const providerStreams = vi.hoisted(() => ({
  ollama: vi.fn(),
  openai: vi.fn(),
  anthropic: vi.fn(),
  gemini: vi.fn(),
}));
vi.mock("../../src/lib/chat-core.js", () => ({
  streamOllama: providerStreams.ollama,
  streamOpenAI: providerStreams.openai,
  streamAnthropic: providerStreams.anthropic,
  streamGemini: providerStreams.gemini,
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: new Proxy({}, { get: () => () => {} }),
}));
import { handleLlmChat } from "../../src/gateways/ws/llm-chat-protocol.js";
import { loadEvolutionDeploymentCommandDependencies } from "../../src/lib/evolution/evolution-deployment-loader.js";
import {
  initializeDefaultLocalUiEvolutionDeployment,
} from "../../src/lib/evolution/local-ui-evolution-deployment.js";
import { createLocalUiEvolutionAuthorities } from "../../src/lib/evolution/local-ui-evolution-runtime.js";
import { configureEvolutionDeployment } from "../../src/lib/evolution/evolution-deployment-config.js";

const temporaryRoots = [];
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function domainDigest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`, "utf8")
    .digest("hex")}`;
}

function createConfig() {
  const root = mkdtempSync(join(tmpdir(), "chainlesschain-local-ui-evolution-"));
  temporaryRoots.push(root);
  return {
    env: { CHAINLESSCHAIN_HOME: root },
    cwd: process.cwd(),
    root,
  };
}

const quickAskCases = [
  {
    provider: "ollama",
    options: {
      provider: "ollama",
      model: "qwen2.5:7b",
      baseUrl: "http://127.0.0.1:11434/v1/",
    },
    stream: providerStreams.ollama,
    expectedUrl: "http://127.0.0.1:11434",
  },
  {
    provider: "volcengine",
    options: {
      provider: "volcengine",
      model: "doubao-seed-1-6-250615",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "test-key",
    },
    stream: providerStreams.openai,
    expectedUrl: "https://ark.cn-beijing.volces.com/api/v3",
  },
  {
    provider: "anthropic",
    options: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      baseUrl: "https://api.anthropic.com/v1/",
      apiKey: "test-key",
    },
    stream: providerStreams.anthropic,
    expectedUrl: "https://api.anthropic.com/v1",
  },
  {
    provider: "gemini",
    options: {
      provider: "gemini",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      apiKey: "test-key",
    },
    stream: providerStreams.gemini,
    expectedUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("default local UI Evolution deployment", () => {
  it("creates one authenticated host under concurrent first UI starts", async () => {
    const config = createConfig();
    const [first, second] = await Promise.all([
      initializeDefaultLocalUiEvolutionDeployment(config),
      initializeDefaultLocalUiEvolutionDeployment(config),
    ]);

    expect(first.status.deploymentMode).toBe("local");
    expect(first.status.readiness.ui.ready).toBe(true);
    expect(second.deployment.tenantId).toBe(first.deployment.tenantId);
    expect(second.deployment.keys["deployment-root"].privateKey).toBe(
      first.deployment.keys["deployment-root"].privateKey,
    );
  });

  it.each(quickAskCases)(
    "loads a local factory that completes a governed Quick Ask turn using $provider",
    async ({ provider, options, stream, expectedUrl }) => {
      const config = createConfig();
      const dependencies = await loadEvolutionDeploymentCommandDependencies(
        "ui",
        { env: config.env, initializeDefaultLocalUi: true },
      );

      expect(typeof dependencies.evolutionCompositionFactory).toBe("function");
      const providerUrls = {};
      stream.mockImplementation(async (...args) => {
        providerUrls[provider] = args[2];
        const onToken = provider === "ollama" ? args[3] : args[4];
        onToken("hello");
        return "hello";
      });
      const sent = [];
      const server = {
        evolutionCompositionFactory: dependencies.evolutionCompositionFactory,
        _send: (_socket, frame) => sent.push(frame),
      };
      await handleLlmChat(server, provider, null, {
        messages: [{ role: "user", content: "hello" }],
        options,
      });
      expect(sent.at(-1).ok, sent.at(-1).error).toBe(true);
      expect(sent.at(-1)).toMatchObject({
        type: "llm.chat.result",
        ok: true,
        result: { provider, message: { content: "hello" } },
      });
      expect(providerUrls).toEqual({ [provider]: expectedUrl });
      stream.mockReset();
    },
    150_000,
  );

  it("binds local source envelopes to one Quick Ask run", async () => {
    const config = createConfig();
    const { deployment } = await initializeDefaultLocalUiEvolutionDeployment(
      config,
    );
    const runA = "ws-llm-chat-run-a";
    const runB = "ws-llm-chat-run-b";
    const authoritiesA = createLocalUiEvolutionAuthorities(
      deployment,
      runA,
    ).authorities;
    const authoritiesB = createLocalUiEvolutionAuthorities(
      deployment,
      runB,
    ).authorities;
    const evidence = { messages: [{ role: "user", content: "hello" }] };
    const occurredAt = new Date().toISOString();
    const sourceEnvelope = authoritiesA.sourceEnvelope.issue({
      tenantId: deployment.tenantId,
      runId: runA,
      eventId: "agent:ingress-event-a",
      kind: "user-prompt",
      occurredAt,
      evidence,
    });
    const request = {
      sourceEnvelope,
      sourceEnvelopeDigest: `sha256:${createHash("sha256")
        .update(sourceEnvelope, "utf8")
        .digest("hex")}`,
      sourceInputDigest: domainDigest(
        evidence,
        "chainlesschain.evolution-raw-plaintext/v2",
      ),
      tenantId: deployment.tenantId,
      payload: evidence,
      requestNonce: "nonce-a",
      requestedAt: occurredAt,
    };

    const verification = await authoritiesA.sourceVerifier.verify(request);
    expect(verification).toMatchObject({
      verified: true,
      tenantId: deployment.tenantId,
    });
    expect(verification.sourceRef).toMatch(
      new RegExp(`^rollout://${deployment.tenantId}/quick-ask/[a-f0-9]{64}/[a-f0-9]{64}$`, "u"),
    );
    await expect(authoritiesB.sourceVerifier.verify(request)).rejects.toThrow(
      /not bound to this evidence/u,
    );
    expect(() =>
      authoritiesB.sourceEnvelope.issue({
        tenantId: deployment.tenantId,
        runId: runA,
        eventId: "event-b",
        kind: "user-prompt",
        occurredAt,
        evidence,
      }),
    ).toThrow(/not authorized/u);
  });

  it("does not replace an existing disabled managed profile", async () => {
    const config = createConfig();
    const initialized = await initializeDefaultLocalUiEvolutionDeployment(config);
    await configureEvolutionDeployment(
      {
        descriptorPath: initialized.deployment.descriptorPath,
        trustRootPath: initialized.deployment.trustRootPath,
        deploymentMode: "managed",
        enabled: false,
      },
      config,
    );
    const profilePath = join(
      config.root,
      "evolution",
      "deployment-profile.json",
    );
    const before = readFileSync(profilePath, "utf8");

    await expect(
      initializeDefaultLocalUiEvolutionDeployment(config),
    ).resolves.toBeNull();
    expect(readFileSync(profilePath, "utf8")).toBe(before);
  });

  it("does not re-enable a local host after its profile file is removed", async () => {
    const config = createConfig();
    const initialized = await initializeDefaultLocalUiEvolutionDeployment(config);
    const profilePath = join(
      config.root,
      "evolution",
      "deployment-profile.json",
    );
    unlinkSync(profilePath);

    await expect(
      initializeDefaultLocalUiEvolutionDeployment(config),
    ).resolves.toBeNull();
    expect(initialized.deployment.tenantId).toMatch(/^local-ui-/u);
    expect(
      readFileSync(
        join(config.root, "evolution", "local-ui-host.state.json"),
        "utf8",
      ),
    ).toContain('"phase": "active"');
  });

  it("does not initialize when deployment environment overrides are present", async () => {
    const config = createConfig();
    const env = {
      ...config.env,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: join(
        config.root,
        "external.json",
      ),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: join(
        config.root,
        "external-public.pem",
      ),
    };

    await expect(
      initializeDefaultLocalUiEvolutionDeployment({ ...config, env }),
    ).resolves.toBeNull();
  });

  it("rejects a modified local host manifest instead of regenerating it", async () => {
    const config = createConfig();
    await initializeDefaultLocalUiEvolutionDeployment(config);
    const manifestPath = join(
      config.root,
      "evolution",
      "local-ui-host",
      "local-host-manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.tenantId = "local-ui-tampered";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(
      initializeDefaultLocalUiEvolutionDeployment(config),
    ).rejects.toThrow(/manifest signature is invalid/u);
  });

  it("rejects replacement of a persisted authority key", async () => {
    const config = createConfig();
    await initializeDefaultLocalUiEvolutionDeployment(config);
    const keyPath = join(
      config.root,
      "evolution",
      "local-ui-host",
      "keys",
      "witness.private.pem",
    );
    const replacementPrivateKey = generateKeyPairSync("ed25519").privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    writeFileSync(keyPath, replacementPrivateKey);

    await expect(
      initializeDefaultLocalUiEvolutionDeployment(config),
    ).rejects.toThrow(/signed identity/u);
  });
});
