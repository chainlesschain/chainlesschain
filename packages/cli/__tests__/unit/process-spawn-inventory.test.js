import { describe, expect, it } from "vitest";
import {
  auditRuntimeHit,
  collectHits,
  isNonExecutableMatch,
} from "../../scripts/gen-process-spawn-inventory.mjs";

describe("process spawn inventory audit", () => {
  it("separates lexical noise from executable process calls", () => {
    expect(
      isNonExecutableMatch('import { spawn } from "node:child_process";'),
    ).toBe(true);
    expect(isNonExecutableMatch("// child_process spawn() boundary")).toBe(
      true,
    );
    expect(isNonExecutableMatch('"child_process",')).toBe(false);
    expect(isNonExecutableMatch('"node:child_process"')).toBe(false);
    expect(
      isNonExecutableMatch('require("node:child_process").spawn("cmd");'),
    ).toBe(false);
    expect(isNonExecutableMatch("const child = deps.spawn(file, args);")).toBe(
      false,
    );
  });

  it("recognizes direct and default-seam Broker routing", () => {
    expect(
      auditRuntimeHit(
        "packages/cli/src/example.js",
        "executionBroker.spawn(file, args);",
        'import executionBroker from "./lib/process-execution-broker/index.js";',
      ),
    ).toMatchObject({ disposition: "brokered" });
    expect(
      auditRuntimeHit(
        "packages/cli/src/example.js",
        "_deps.spawn(file, args);",
        'import executionBroker from "./lib/process-execution-broker/index.js";',
      ),
    ).toMatchObject({ disposition: "brokered" });
  });

  it("applies explicit host-boundary exemptions", () => {
    expect(
      auditRuntimeHit(
        "packages/agent-sdk/src/agent-session.ts",
        "const child = nodeSpawn(command, args);",
        "",
      ),
    ).toMatchObject({
      disposition: "audited-exemption",
    });
    expect(
      auditRuntimeHit(
        "packages/cli/src/lib/mcp-stdio-package-materialization.js",
        '"child_process", // spawn-inventory-audit: static-execution-context-builtin',
        "const CAPSULE_EXECUTION_CONTEXT_BUILTINS = new Set([]);",
      ),
    ).toMatchObject({ disposition: "audited-exemption" });
    expect(
      auditRuntimeHit(
        "packages/cli/src/lib/execution-location-local-supervisor.mjs",
        "child = spawn(",
        "",
      ),
    ).toMatchObject({ disposition: "audited-exemption" });
    expect(
      auditRuntimeHit(
        "packages/cli/src/lib/evolution/skill-writer-inventory-manifest.js",
        '"function execFileSync(file, args, options = {})",',
        "",
      ),
    ).toMatchObject({ disposition: "audited-exemption" });
  });

  it("does not hide a multiline dynamic child_process load behind a string literal", () => {
    const multilineLoad = [
      "const hidden = require(",
      '  "child_process",',
      ");",
      'hidden.spawn("cmd");',
    ].join("\n");
    expect(
      auditRuntimeHit(
        "packages/cli/src/example.js",
        '"child_process",',
        multilineLoad,
      ),
    ).toMatchObject({ disposition: "unreviewed" });
    expect(
      auditRuntimeHit(
        "packages/cli/src/lib/mcp-stdio-package-materialization.js",
        '"child_process",',
        multilineLoad,
      ),
    ).toMatchObject({ disposition: "unreviewed" });
  });

  it("fails the current runtime inventory closed at zero unreviewed", () => {
    const unreviewed = collectHits().filter(
      (hit) => hit.kind === "runtime" && hit.disposition === "unreviewed",
    );
    expect(unreviewed).toEqual([]);
  });
});
