import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  getActiveVersion,
  inspectPluginTransaction,
  installFromDirectory,
  isPluginEnabled,
  planPluginProvenanceMigration,
  readSourceMetadataStrict,
  recoverPluginTransaction,
} from "../../src/lib/plugin-runtime/install.js";
import {
  discoverPlugins,
  listInstalledVersions,
  pluginLifecycleCoordinatorLock,
  pluginVersionDir,
} from "../../src/lib/plugin-runtime/scopes.js";

const holderFixture = fileURLToPath(
  new URL("../fixtures/plugin-transaction-holder.mjs", import.meta.url),
);

let cwd;
let sources;
let child = null;
let previousPluginTransactionHome;

function makeSource(version, marker = version) {
  const root = fs.mkdtempSync(path.join(sources, `durable-${version}-`));
  fs.writeFileSync(
    path.join(root, "plugin.json"),
    JSON.stringify({ name: "durable-process", version }),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "marker.txt"), marker, "utf8");
  return root;
}

function makeProvenanceAttestationFile(installedDir) {
  fs.rmSync(path.join(installedDir, ".plugin-source.json"));
  const plan = planPluginProvenanceMigration("durable-process", {
    scope: "project",
    cwd,
    version: "1.0.0",
    issuedAt: "2026-08-18T00:00:00.000Z",
    sourceMetadata: { type: "local", source: "reviewed-process-source" },
  });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const expectedSignerSha256 = crypto
    .createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const file = path.join(sources, "provenance-attestation.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      authority: plan.authority,
      publicKeyPem,
      signatureBase64: crypto
        .sign(
          null,
          Buffer.from(plan.signingPayloadBase64, "base64"),
          privateKey,
        )
        .toString("base64"),
      expectedSignerSha256,
    }),
    "utf8",
  );
  return file;
}

function waitForReady(processHandle) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`transaction holder did not become ready: ${stderr}`));
    }, 15_000);
    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split(/\r?\n/u).find(Boolean);
      if (!line) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    });
    processHandle.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    processHandle.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processHandle.once("exit", (code) => {
      if (stdout.trim()) return;
      clearTimeout(timeout);
      reject(
        new Error(
          `transaction holder exited before ready (${code}): ${stderr}`,
        ),
      );
    });
  });
}

function waitForExit(processHandle) {
  if (processHandle.exitCode != null)
    return Promise.resolve(processHandle.exitCode);
  return new Promise((resolve) => processHandle.once("exit", resolve));
}

async function startHolder(
  source,
  pauseSpec = null,
  mode = null,
  scope = "project",
  operation = "update",
) {
  const argv = [holderFixture, cwd, source];
  if (pauseSpec || mode || scope !== "project" || operation !== "update")
    argv.push(pauseSpec || "");
  if (mode || scope !== "project" || operation !== "update")
    argv.push(mode || "");
  if (scope !== "project" || operation !== "update") argv.push(scope);
  if (operation !== "update") argv.push(operation);
  child = spawn(process.execPath, argv, {
    cwd: path.dirname(holderFixture),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return waitForReady(child);
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-process-cwd-"));
  sources = fs.mkdtempSync(path.join(os.tmpdir(), "cc-plugin-process-src-"));
  previousPluginTransactionHome = process.env.CC_PLUGIN_TRANSACTION_HOME;
  process.env.CC_PLUGIN_TRANSACTION_HOME = path.join(
    cwd,
    "plugin-transaction-home",
  );
});

afterEach(async () => {
  if (child && child.exitCode == null) {
    child.kill();
    await waitForExit(child);
  }
  child = null;
  if (previousPluginTransactionHome === undefined) {
    delete process.env.CC_PLUGIN_TRANSACTION_HOME;
  } else {
    process.env.CC_PLUGIN_TRANSACTION_HOME = previousPluginTransactionHome;
  }
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(sources, { recursive: true, force: true });
});

describe("plugin lifecycle cross-process ownership", () => {
  it("fences the same name across project and local scopes", async () => {
    const local = makeSource("1.0.0");
    const project = makeSource("2.0.0");
    const competing = makeSource("3.0.0");
    installFromDirectory(local, {
      scope: "local",
      cwd,
      allowSourceSwitch: true,
    });

    const ready = await startHolder(project, "staging");
    expect(ready.phase).toBe("staging");
    expect(() =>
      installFromDirectory(competing, {
        scope: "local",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/already owned/u);
    expect(
      discoverPlugins({
        cwd,
        scopes: ["project", "local"],
        skipPolicy: true,
      }),
    ).toEqual([]);
    expect(() =>
      inspectPluginTransaction("durable-process", {
        scope: "project",
        cwd: path.join(cwd, "wrong-project"),
      }),
    ).toThrow(/does not match the requested name\/scope\/context/u);

    child.kill();
    await waitForExit(child);
    child = null;
    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({ recovered: true, rolledBack: true });

    const installed = installFromDirectory(competing, {
      scope: "local",
      cwd,
      allowSourceSwitch: true,
    });
    expect(installed.version).toBe("3.0.0");
  }, 30_000);

  it("rejects a competing CLI and rolls back after the exact owner dies", async () => {
    const first = makeSource("1.0.0");
    const second = makeSource("2.0.0");
    const third = makeSource("3.0.0");
    installFromDirectory(first, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });

    const ready = await startHolder(second);
    expect(ready).toMatchObject({
      ready: true,
      name: "durable-process",
      version: "2.0.0",
    });
    expect(getActiveVersion("durable-process", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    expect(() =>
      installFromDirectory(third, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toThrow(/already owned by PID/u);

    child.kill();
    await waitForExit(child);
    child = null;
    expect(
      inspectPluginTransaction("durable-process", {
        scope: "project",
        cwd,
      }),
    ).toMatchObject({
      phase: "candidate-active",
      owner: { pid: ready.pid, alive: false },
      recoverable: true,
    });

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({
      recovered: true,
      action: "rollback",
      rolledBack: true,
      version: "1.0.0",
    });
    expect(getActiveVersion("durable-process", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
    expect(
      fs.existsSync(
        pluginVersionDir("project", "durable-process", "2.0.0", { cwd }),
      ),
    ).toBe(false);

    expect(
      installFromDirectory(third, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      }),
    ).toMatchObject({ version: "3.0.0" });
  }, 30_000);

  it("finalizes only the exact candidate recorded by a dead owner", async () => {
    const first = makeSource("1.0.0");
    const second = makeSource("2.0.0");
    installFromDirectory(first, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    await startHolder(second);
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "finalize",
      }),
    ).toMatchObject({
      recovered: true,
      action: "finalize",
      version: "2.0.0",
    });
    expect(getActiveVersion("durable-process", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
    expect(
      inspectPluginTransaction("durable-process", {
        scope: "project",
        cwd,
      }),
    ).toBeNull();
  }, 30_000);

  it.each(["staging", "prepared", "before:candidate-active"])(
    "rolls back a dead owner stopped at %s",
    async (pauseSpec) => {
      const first = makeSource("1.0.0");
      const second = makeSource("2.0.0");
      installFromDirectory(first, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(second, pauseSpec);
      expect(ready.phase).toBe(pauseSpec);
      if (pauseSpec === "staging") {
        const nameDir = path.dirname(
          pluginVersionDir("project", "durable-process", "1.0.0", { cwd }),
        );
        const journal = JSON.parse(
          fs.readFileSync(
            path.join(
              pluginLifecycleCoordinatorLock("durable-process"),
              "journal.json",
            ),
            "utf8",
          ),
        );
        expect(journal.transaction.transactionRootName).toMatch(
          /^\.install-[a-f0-9]{32}$/u,
        );
        expect(
          fs.existsSync(
            path.join(nameDir, journal.transaction.transactionRootName),
          ),
        ).toBe(false);
      }
      child.kill();
      await waitForExit(child);
      child = null;

      const recovered = recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      });
      expect(recovered).toMatchObject({
        recovered: true,
        action: "rollback",
        version: "1.0.0",
      });
      expect(
        getActiveVersion("durable-process", { scope: "project", cwd }),
      ).toBe("1.0.0");
      expect(
        fs.existsSync(
          pluginVersionDir("project", "durable-process", "2.0.0", { cwd }),
        ),
      ).toBe(false);
    },
    30_000,
  );

  it.each([
    "rollback-bytes-recovery",
    "rollback-bytes-restored",
    "before:rolled-back",
  ])(
    "resumes rollback after a dead owner stopped at %s",
    async (pauseSpec) => {
      const first = makeSource("1.0.0");
      const second = makeSource("2.0.0");
      installFromDirectory(first, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(second, pauseSpec, "rollback");
      expect(ready.phase).toBe(pauseSpec);
      child.kill();
      await waitForExit(child);
      child = null;

      expect(
        recoverPluginTransaction("durable-process", {
          scope: "project",
          cwd,
          action: "rollback",
        }),
      ).toMatchObject({ recovered: true, rolledBack: true, version: "1.0.0" });
      expect(
        getActiveVersion("durable-process", { scope: "project", cwd }),
      ).toBe("1.0.0");
      expect(
        fs.existsSync(
          pluginVersionDir("project", "durable-process", "2.0.0", { cwd }),
        ),
      ).toBe(false);
    },
    30_000,
  );

  it.each(["finalizing", "before:finalized"])(
    "resumes finalize after a dead owner stopped at %s",
    async (pauseSpec) => {
      const first = makeSource("1.0.0");
      const second = makeSource("2.0.0");
      installFromDirectory(first, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(second, pauseSpec, "finalize");
      expect(ready.phase).toBe(pauseSpec);
      child.kill();
      await waitForExit(child);
      child = null;

      expect(
        recoverPluginTransaction("durable-process", {
          scope: "project",
          cwd,
          action: "finalize",
        }),
      ).toMatchObject({
        recovered: true,
        action: "finalize",
        version: "2.0.0",
      });
      expect(
        getActiveVersion("durable-process", { scope: "project", cwd }),
      ).toBe("2.0.0");
      expect(
        inspectPluginTransaction("durable-process", {
          scope: "project",
          cwd,
        }),
      ).toBeNull();
    },
    30_000,
  );

  it.each(["finalizing", "before:finalized"])(
    "resumes finalize after a dead owner stopped at %s",
    async (pauseSpec) => {
      const first = makeSource("1.0.0");
      const second = makeSource("2.0.0");
      installFromDirectory(first, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(second, pauseSpec, "finalize");
      expect(ready.phase).toBe(pauseSpec);
      child.kill();
      await waitForExit(child);
      child = null;

      expect(
        recoverPluginTransaction("durable-process", {
          scope: "project",
          cwd,
          action: "finalize",
        }),
      ).toMatchObject({
        recovered: true,
        action: "finalize",
        version: "2.0.0",
      });
      expect(
        getActiveVersion("durable-process", { scope: "project", cwd }),
      ).toBe("2.0.0");
      expect(
        inspectPluginTransaction("durable-process", {
          scope: "project",
          cwd,
        }),
      ).toBeNull();
    },
    30_000,
  );

  it("restores a same-version predecessor quarantined before publish", async () => {
    const first = makeSource("1.0.0", "original");
    const replacement = makeSource("1.0.0", "replacement");
    const installed = installFromDirectory(first, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    await startHolder(replacement, "predecessor-quarantined", "force");
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({ recovered: true, rolledBack: true, version: "1.0.0" });
    expect(
      fs.readFileSync(path.join(installed.dir, "marker.txt"), "utf8"),
    ).toBe("original");
    expect(getActiveVersion("durable-process", { scope: "project", cwd })).toBe(
      "1.0.0",
    );
  }, 30_000);

  it("finalizes a disable after the owner dies before marker publication", async () => {
    const source = makeSource("1.0.0");
    installFromDirectory(source, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    const ready = await startHolder(
      source,
      "marker-committing",
      null,
      "project",
      "disable",
    );
    expect(ready.phase).toBe("marker-committing");
    expect(isPluginEnabled("durable-process", { scope: "project", cwd })).toBe(
      true,
    );
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "finalize",
      }),
    ).toMatchObject({ recovered: true, enabled: false });
    expect(isPluginEnabled("durable-process", { scope: "project", cwd })).toBe(
      false,
    );
  }, 30_000);

  it("rolls back a disable after bytes publish but before journal publication", async () => {
    const source = makeSource("1.0.0");
    installFromDirectory(source, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    const ready = await startHolder(
      source,
      "before:marker-published",
      null,
      "project",
      "disable",
    );
    expect(ready.phase).toBe("before:marker-published");
    expect(isPluginEnabled("durable-process", { scope: "project", cwd })).toBe(
      false,
    );
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({ recovered: true, rolledBack: true, enabled: true });
    expect(isPluginEnabled("durable-process", { scope: "project", cwd })).toBe(
      true,
    );
  }, 30_000);

  it("rolls back a version uninstall after quarantine owner death", async () => {
    const first = makeSource("1.0.0");
    const second = makeSource("2.0.0");
    installFromDirectory(first, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    installFromDirectory(second, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    const ready = await startHolder(
      second,
      "uninstall-version-quarantined",
      null,
      "project",
      "uninstall-version",
    );
    expect(ready.phase).toBe("uninstall-version-quarantined");
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({ recovered: true, rolledBack: true });
    expect(
      listInstalledVersions("project", "durable-process", { cwd }),
    ).toEqual(["2.0.0", "1.0.0"]);
    expect(getActiveVersion("durable-process", { scope: "project", cwd })).toBe(
      "2.0.0",
    );
  }, 30_000);

  it.each(["before:uninstall-state-published", "uninstall-finalizing"])(
    "finalizes a version uninstall after owner death at %s",
    async (pauseSpec) => {
      const first = makeSource("1.0.0");
      const second = makeSource("2.0.0");
      installFromDirectory(first, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      installFromDirectory(second, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(
        second,
        pauseSpec,
        null,
        "project",
        "uninstall-version",
      );
      expect(ready.phase).toBe(pauseSpec);
      child.kill();
      await waitForExit(child);
      child = null;

      expect(
        recoverPluginTransaction("durable-process", {
          scope: "project",
          cwd,
          action: "finalize",
        }),
      ).toMatchObject({ recovered: true, removed: ["2.0.0"] });
      expect(
        listInstalledVersions("project", "durable-process", { cwd }),
      ).toEqual(["1.0.0"]);
      expect(
        getActiveVersion("durable-process", { scope: "project", cwd }),
      ).toBe("1.0.0");
    },
    30_000,
  );

  it.each(["rollback", "finalize"])(
    "%s recovers a whole-name uninstall after quarantine owner death",
    async (action) => {
      const source = makeSource("1.0.0");
      installFromDirectory(source, {
        scope: "project",
        cwd,
        allowSourceSwitch: true,
      });
      const ready = await startHolder(
        source,
        "uninstall-name-quarantined",
        null,
        "project",
        "uninstall-name",
      );
      expect(ready.phase).toBe("uninstall-name-quarantined");
      child.kill();
      await waitForExit(child);
      child = null;

      expect(
        recoverPluginTransaction("durable-process", {
          scope: "project",
          cwd,
          action,
        }),
      ).toMatchObject({ recovered: true, action });
      expect(
        listInstalledVersions("project", "durable-process", { cwd }),
      ).toEqual(action === "rollback" ? ["1.0.0"] : []);
    },
    30_000,
  );

  it("finalizes signed provenance after owner death before file publication", async () => {
    const source = makeSource("1.0.0");
    const installed = installFromDirectory(source, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    const attestation = makeProvenanceAttestationFile(installed.dir);
    const ready = await startHolder(
      attestation,
      "provenance-committing",
      null,
      "project",
      "provenance-migrate",
    );
    expect(ready.phase).toBe("provenance-committing");
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "finalize",
      }),
    ).toMatchObject({ recovered: true, migrated: true, version: "1.0.0" });
    expect(
      readSourceMetadataStrict(installed.dir, { required: true }),
    ).toMatchObject({
      migrationAttestation: { authority: { subject: { version: "1.0.0" } } },
    });
  }, 30_000);

  it("rolls back signed provenance after bytes publish but before journal publication", async () => {
    const source = makeSource("1.0.0");
    const installed = installFromDirectory(source, {
      scope: "project",
      cwd,
      allowSourceSwitch: true,
    });
    const attestation = makeProvenanceAttestationFile(installed.dir);
    const ready = await startHolder(
      attestation,
      "before:provenance-published",
      null,
      "project",
      "provenance-migrate",
    );
    expect(ready.phase).toBe("before:provenance-published");
    child.kill();
    await waitForExit(child);
    child = null;

    expect(
      recoverPluginTransaction("durable-process", {
        scope: "project",
        cwd,
        action: "rollback",
      }),
    ).toMatchObject({ recovered: true, rolledBack: true });
    expect(() =>
      readSourceMetadataStrict(installed.dir, { required: true }),
    ).toThrow(/source metadata is missing/u);
  }, 30_000);
});
