import { createRequire } from "node:module";
import { defineConfig, configDefaults } from "vitest/config";

const require = createRequire(import.meta.url);

/**
 * Probe once at config load whether the native SQLCipher driver
 * (better-sqlite3-multiple-ciphers / "bs3mc") loads on the *host* Node.
 *
 * Why this matters locally: the root node_modules bs3mc binding is built for
 * Electron (NODE_MODULE_VERSION 140) and does NOT match a plain host Node
 * (e.g. ABI 127). Any test that opens a LocalVault then throws an ABI-mismatch
 * error at construction time, which surfaces as a cascade of ~228 cryptic
 * red failures (most as `Cannot destructure property 'vault' of undefined`,
 * because per-file setup helpers swallow the throw and return undefined).
 *
 * That noise drowns out any *real* regression locally. So: when the host
 * binding doesn't load, we EXCLUDE the vault-dependent test files and print a
 * banner pointing at the sandbox runner that installs a host-ABI bs3mc.
 *
 * CI is unaffected — it rebuilds node_modules fresh for the host Node, the
 * probe succeeds, nothing is excluded, and the full suite runs.
 *
 * See: scripts/run-native-tests-sandbox.sh, memory `bs3mc_electron_abi_sandbox_workaround`.
 */
function probeNativeVault() {
  try {
    const Database = require("better-sqlite3-multiple-ciphers");
    const db = new Database(":memory:");
    db.close();
    return { available: true, reason: null };
  } catch (err) {
    return { available: false, reason: (err && err.message ? err.message : String(err)).split("\n")[0] };
  }
}

/**
 * Tests that open a LocalVault (directly or transitively via registry /
 * entity-resolver / analysis / e2e / integration pipelines). Empirically the
 * exact set that fails when bs3mc can't load on the host. Skipped locally,
 * always run in CI. Keep in sync if you add a new vault-touching test file.
 */
const NATIVE_DEPENDENT_TESTS = [
  "__tests__/vault.test.js",
  "__tests__/vault-search.test.js",
  "__tests__/registry.test.js",
  "__tests__/analysis.test.js",
  "__tests__/analysis-skills.test.js",
  "__tests__/entity-resolver.test.js",
  "__tests__/entity-resolver-stages.test.js",
  "__tests__/entity-resolver-vault.test.js",
  "__tests__/entity-resolver-ingest-hook.test.js",
  "__tests__/e2e/full-user-journey.test.js",
  "__tests__/e2e/ai-chat-cross-source-journey.test.js",
  "__tests__/integration/cross-adapter-pipelines.test.js",
  "__tests__/integration/ai-chat-history-registry.test.js",
  "__tests__/integration/social-bilibili-pipeline.test.js",
  "__tests__/integration/wechat-bootstrap-end-to-end.test.js",
];

const native = probeNativeVault();
const exclude = [...configDefaults.exclude];

if (!native.available) {
  exclude.push(...NATIVE_DEPENDENT_TESTS);
  // eslint-disable-next-line no-console
  console.warn(
    [
      "",
      "⚠️  PDH: native SQLCipher driver (bs3mc) does not load on this host Node —",
      "    " + (native.reason || "unknown load failure"),
      "    Skipping " + NATIVE_DEPENDENT_TESTS.length + " vault-dependent test file(s) so the rest stay green.",
      "    For full native coverage run:  bash scripts/run-native-tests-sandbox.sh",
      "    (CI rebuilds bs3mc for the host ABI and runs the full suite.)",
      "",
    ].join("\n"),
  );
}

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.js"],
    exclude,
    testTimeout: 10000,
  },
});
