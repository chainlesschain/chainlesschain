import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Regression: `cc did sign <msg>` without --did is documented to use the
// default identity, but it resolved the signer via getIdentity(db,
// "did:chainless:") — an unordered LIKE 'did:chainless:%' that returns the
// first row the planner yields (a lexicographic extreme), IGNORING is_default.
// So it silently signed with the WRONG key. Fix: getDefaultIdentity (WHERE
// is_default = 1). Determinism: create 3 identities and make the MIDDLE-sorted
// DID the default — any first-row-by-index result is an extreme != middle, so
// the buggy path reliably signs with the wrong key.

const CLI_DIR = fileURLToPath(new URL("../..", import.meta.url));
const BIN = join(CLI_DIR, "bin", "chainlesschain.js");

describe("cc did sign uses the default identity, not a prefix-first row", () => {
  let home;

  function cli(args) {
    return execSync(`node "${BIN}" ${args}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      env: { ...process.env, CHAINLESSCHAIN_HOME: home },
    });
  }

  // Strip bootstrap log lines (e.g. "[AppConfig] …") that precede the --json
  // payload on stdout, then extract the JSON object.
  function parseJson(out) {
    const cleaned = out
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("["))
      .join("\n");
    return JSON.parse(
      cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1),
    );
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cc-did-home-"));
  });

  afterEach(() => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it("signs with the is_default identity even when it is not the first-sorted DID", () => {
    const dids = [];
    for (const name of ["A", "B", "C"]) {
      const out = cli(`did create --name ${name} --json`);
      dids.push(parseJson(out).did);
    }
    // Pick the lexicographically MIDDLE DID as the default. The buggy resolver
    // returns an extreme (smallest or largest), never the middle.
    const middle = [...dids].sort()[1];
    cli(`did set-default ${middle}`);

    const signed = parseJson(cli(`did sign "hello" --json`));
    expect(signed.did).toBe(middle);
  });
});
