import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadUserConfig,
  setConfigValue,
} from "../../src/lib/config-manager.js";
import {
  getEvolutionDeploymentStatus,
  setEvolutionDeploymentEnabled,
} from "../../src/lib/evolution/evolution-deployment-config.js";
import { loadEvolutionDeploymentCommandDependencies } from "../../src/lib/evolution/evolution-deployment-loader.js";
import { prepareConfiguredUiModelTurn } from "../../src/lib/evolution/optional-ui-model-turn.js";

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cc-evolution-opt-in-"));
  roots.push(root);
  return { root, env: { CHAINLESSCHAIN_HOME: root } };
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("optional Evolution setting shared by CLI and UI", () => {
  it("defaults to ordinary model turns without creating deployment state", async () => {
    const f = fixture();
    for (const command of ["agent", "ask", "chat", "ui"])
      expect(
        await loadEvolutionDeploymentCommandDependencies(command, f),
      ).toBeNull();
    const messages = [
      { role: "user", content: 'inspect this incomplete example: {"partial":' },
    ];
    const turn = await prepareConfiguredUiModelTurn(
      { mode: "ws-llm-chat", messages },
      f,
    );
    expect(turn.governed).toBe(false);
    expect(turn.messages).toEqual(messages);
    await turn.complete("done");
    expect((await getEvolutionDeploymentStatus(f)).profileEnabled).toBe(false);
    expect(existsSync(join(f.root, "evolution"))).toBe(false);
    expect(existsSync(join(f.root, "config.json"))).toBe(false);
  });

  it("persists enable-disable-enable and applies it to subsequent UI turns", async () => {
    const f = fixture();
    const enabled = await setEvolutionDeploymentEnabled(true, f);
    expect(enabled).toMatchObject({
      profileEnabled: true,
      effectiveEnabled: true,
      verified: true,
    });
    expect(loadUserConfig(f).evolution.enabled).toBe(true);
    const messages = [{ role: "user", content: "hello" }];
    const first = await prepareConfiguredUiModelTurn(
      { mode: "ws-llm-chat", messages },
      f,
    );
    expect(first.governed).toBe(true);
    await first.complete("hello back");
    await setEvolutionDeploymentEnabled(false, f);
    expect(loadUserConfig(f).evolution.enabled).toBe(false);
    expect(
      await loadEvolutionDeploymentCommandDependencies("agent", f),
    ).toBeNull();
    const off = await prepareConfiguredUiModelTurn(
      { mode: "ws-llm-chat", messages },
      f,
    );
    expect(off.governed).toBe(false);
    const again = await setEvolutionDeploymentEnabled(true, f);
    expect(again).toMatchObject({
      effectiveEnabled: true,
      verified: true,
      activeTrustRootDigest: enabled.activeTrustRootDigest,
    });
    // Direct file editing is the same switch, including in a resident UI.
    const configPath = join(f.root, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.evolution.enabled = false;
    writeFileSync(configPath, JSON.stringify(config));
    expect(
      (await prepareConfiguredUiModelTurn({ mode: "ws-llm-chat", messages }, f))
        .governed,
    ).toBe(false);
  }, 60000);

  it("explicit false wins over inherited deployments and rejects non-boolean configuration", async () => {
    const f = fixture();
    const env = {
      ...f.env,
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "missing",
      CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: "missing",
    };
    setConfigValue("evolution.enabled", false, f);
    expect(
      await loadEvolutionDeploymentCommandDependencies("agent", { env }),
    ).toBeNull();
    expect((await getEvolutionDeploymentStatus({ env })).effectiveEnabled).toBe(
      false,
    );
    writeFileSync(
      join(f.root, "config.json"),
      JSON.stringify({ evolution: { enabled: "false" } }),
    );
    await expect(
      loadEvolutionDeploymentCommandDependencies("agent", f),
    ).rejects.toThrow("evolution.enabled must be a boolean");
  });

  it("keeps external opt-in when unrelated user configuration is saved", async () => {
    const f = fixture();
    f.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR = "missing-descriptor";
    f.env.CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT = "missing-root";
    expect((await getEvolutionDeploymentStatus(f)).evolutionEnabled).toBe(true);
    setConfigValue("llm.model", "example-model", f);
    expect(loadUserConfig(f).evolution?.enabled).toBeUndefined();
    expect((await getEvolutionDeploymentStatus(f)).evolutionEnabled).toBe(true);
    // An invalid opted-in deployment still fails instead of falling back.
    await expect(
      loadEvolutionDeploymentCommandDependencies("ask", f),
    ).rejects.toThrow();
    setConfigValue("evolution.enabled", false, f);
    expect(
      await loadEvolutionDeploymentCommandDependencies("ask", f),
    ).toBeNull();
  });

  it("does not suppress enabled deployment failures", async () => {
    const f = fixture();
    setConfigValue("evolution.enabled", true, f);
    await expect(
      prepareConfiguredUiModelTurn(
        { mode: "ws-llm-chat", messages: [] },
        {
          env: {
            ...f.env,
            CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_DESCRIPTOR: "missing",
            CHAINLESSCHAIN_EVOLUTION_DEPLOYMENT_TRUST_ROOT: "missing",
          },
        },
      ),
    ).rejects.toThrow();
  });
});
