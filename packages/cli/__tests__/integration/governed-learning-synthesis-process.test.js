import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import {
  computeEvolutionDeploymentDigest as digest,
  EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
  serializeEvolutionDeploymentDescriptorPayload,
} from "../../src/lib/evolution/evolution-deployment-loader.js";

const bin = fileURLToPath(
  new URL("../../bin/chainlesschain.js", import.meta.url),
);

function runCli(args, env, cwd) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  expect(result.error, result.stderr).toBeUndefined();
  return result;
}

it("loads a signed learning host in a real CLI process and writes only an evaluated candidate", () => {
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-governed-learning-process-",
    ),
  );
  try {
    const workspace = path.join(root, "workspace");
    const activeRoot = path.join(root, "active-skills");
    const candidateRoot = path.join(root, "candidate-skills");
    fs.mkdirSync(workspace);
    fs.mkdirSync(activeRoot);

    const source = `export async function createChainlessChainCommandDependencies({ descriptor, factories }) {
      return {
        learningSynthesisHost: factories.createGovernedSkillSynthesisCliHost({
          descriptor: { tenantId: "tenant:learning-process", handlerArtifactDigest: descriptor.moduleDigest },
          llmChat: async () => JSON.stringify({
            name: "review-security-config",
            description: "Review a security configuration",
            procedure: ["Inspect the configuration", "Report risky settings"],
            pitfalls: ["Do not expose configuration secrets"],
            verification: "All risky settings are reported",
            tools: ["read", "audit"]
          }),
          candidateOutputDir: ${JSON.stringify(candidateRoot)},
          activeSkillsDirs: [${JSON.stringify(activeRoot)}],
          evaluateCandidate: async ({ skillName, content }) => ({
            accepted: skillName === "review-security-config" && content.includes("Report risky settings")
          }),
          synthesis: { minToolCount: 1, minScore: 0, minSimilar: 1 }
        })
      };
    }\n`;
    const modulePath = path.join(root, "learning-deployment.mjs");
    fs.writeFileSync(modulePath, source, { flag: "wx" });
    const moduleDigest = digest(Buffer.from(source));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const trustRoot = publicKey.export({ type: "spki", format: "pem" });
    const descriptor = {
      schema: EVOLUTION_DEPLOYMENT_DESCRIPTOR_SCHEMA,
      revision: 1,
      modulePath,
      moduleDigest,
      trustRootDigest: digest(trustRoot),
      commands: ["learning"],
    };
    descriptor.signature = sign(
      null,
      Buffer.from(serializeEvolutionDeploymentDescriptorPayload(descriptor)),
      privateKey,
    ).toString("base64");
    const descriptorPath = path.join(root, "descriptor.json");
    const trustRootPath = path.join(root, "trust-root.pem");
    fs.writeFileSync(descriptorPath, JSON.stringify(descriptor), {
      flag: "wx",
    });
    fs.writeFileSync(trustRootPath, trustRoot, { flag: "wx" });

    const rows = [
      {
        id: "trajectory-primary",
        session_id: "session-primary",
        user_intent: "Review this security configuration",
        tool_chain: JSON.stringify([{ tool: "read" }, { tool: "audit" }]),
        tool_count: 2,
        outcome_score: 0.95,
        complexity_level: "complex",
        created_at: "2026-09-09 01:00:00",
        completed_at: "2026-09-09 01:01:00",
      },
      {
        id: "trajectory-similar",
        session_id: "session-similar",
        user_intent: "Audit another security configuration",
        tool_chain: JSON.stringify([{ tool: "read" }, { tool: "audit" }]),
        tool_count: 2,
        outcome_score: 0.9,
        complexity_level: "complex",
        created_at: "2026-09-09 00:00:00",
        completed_at: "2026-09-09 00:01:00",
      },
    ];
    const inputPath = path.join(root, "trajectories.json");
    fs.writeFileSync(inputPath, JSON.stringify(rows), { flag: "wx" });
    const env = {
      ...process.env,
      FORCE_COLOR: "0",
      CHAINLESSCHAIN_HOME: path.join(root, "cli-home"),
      CHAINLESSCHAIN_SECURITY_ANCHOR_HOME: path.join(root, "security-anchor"),
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: descriptorPath,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: trustRootPath,
    };

    const imported = runCli(
      ["learning", "import", "--input", inputPath, "--json"],
      env,
      workspace,
    );
    expect(imported.status, imported.stderr).toBe(0);
    expect(imported.stdout).toContain('"imported":2');

    const synthesized = runCli(
      ["learning", "synthesize", "--json"],
      env,
      workspace,
    );
    expect(synthesized.status, synthesized.stderr).toBe(0);
    expect(synthesized.stdout).toContain('"status": "completed"');
    expect(synthesized.stdout).toContain('"review-security-config"');
    expect(
      fs.readFileSync(
        path.join(candidateRoot, "review-security-config", "1.0.0", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Report risky settings");
    expect(fs.readdirSync(activeRoot)).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
