import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  consumeMcpStdioExecutionAuthority,
  issueMcpStdioExecutionAuthority,
  materializeApprovedMcpStdioInvocation,
  resolveMcpStdioExecutionApproval,
} from "../../src/lib/mcp-stdio-execution-authority.js";
import {
  consumeMcpStdioCapsuleSandboxExecutionContract,
  MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
  nanosecondsToSafeMilliseconds,
  prepareMcpStdioExecutableIdentity,
} from "../../src/lib/mcp-stdio-executable-identity.js";
import {
  _deps,
  materializeMcpStdioNpmPackage,
} from "../../src/lib/mcp-stdio-package-materialization.js";

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function brokerSpawnSync(command, args, options) {
  return spawnSync(command, args, options);
}

function fakeInstall({ directory }) {
  writeJson(path.join(directory, "package-lock.json"), {
    name: "chainlesschain-mcp-materialization",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "capsule-contract-fixture": "1.2.3" } },
      "node_modules/capsule-contract-fixture": {
        version: "1.2.3",
        resolved:
          "https://registry.npmjs.org/capsule-contract-fixture/-/capsule-contract-fixture-1.2.3.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    },
  });
  const packageRoot = path.join(
    directory,
    "node_modules",
    "capsule-contract-fixture",
  );
  writeJson(path.join(packageRoot, "package.json"), {
    name: "capsule-contract-fixture",
    version: "1.2.3",
    bin: { "capsule-contract": "server.js" },
  });
  fs.writeFileSync(
    path.join(packageRoot, "server.js"),
    "process.stdin.resume();\n",
    "utf8",
  );
}

it("rejects nanosecond timestamps just outside the safe millisecond boundary", () => {
  const maximumSafeNanoseconds = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n;
  expect(nanosecondsToSafeMilliseconds(maximumSafeNanoseconds)).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  expect(nanosecondsToSafeMilliseconds(-maximumSafeNanoseconds)).toBe(
    -Number.MAX_SAFE_INTEGER,
  );
  expect(() =>
    nanosecondsToSafeMilliseconds(maximumSafeNanoseconds + 1n),
  ).toThrow(RangeError);
  expect(() =>
    nanosecondsToSafeMilliseconds(-maximumSafeNanoseconds - 1n),
  ).toThrow(RangeError);
});

describe("MCP stdio capsule host boundary floor", () => {
  let root;
  let approval;
  let config;
  let indexPath;
  let materializationRoot;
  let storePath;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mcp-capsule-contract-"));
    indexPath = path.join(root, "security", "index.json");
    materializationRoot = path.join(root, "materializations");
    storePath = path.join(root, "security", "executable-identities.json");
    const npmCli = path.join(root, "npm-cli.js");
    fs.writeFileSync(npmCli, "// fixture npm cli\n", "utf8");
    const sourceConfig = {
      command: "npx",
      args: ["capsule-contract-fixture@1.2.3"],
      sandboxPolicy: { requiredBoundaries: ["network"] },
      transport: "stdio",
    };
    const token = issueMcpStdioExecutionAuthority({
      serverName: "capsule-contract",
      config: sourceConfig,
      approvalKind: "explicit-config",
      approvalSource: "test:capsule-contract",
    });
    approval = consumeMcpStdioExecutionAuthority(token, {
      serverName: "capsule-contract",
      config: sourceConfig,
    });
    config = materializeApprovedMcpStdioInvocation(approval);
    _deps.processBrokerRunSync = brokerSpawnSync;
    await materializeMcpStdioNpmPackage({
      approvalRecord: resolveMcpStdioExecutionApproval(approval),
      config,
      packageSpec: "capsule-contract-fixture@1.2.3",
      binName: "capsule-contract",
      root: materializationRoot,
      indexPath,
      npmCli,
      installRunner: fakeInstall,
      now: Date.parse("2026-08-10T00:00:00.000Z"),
    });
  });

  afterEach(() => {
    _deps.processBrokerRunSync = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function issueContract() {
    return prepareMcpStdioExecutableIdentity({
      serverName: "capsule-contract",
      config,
      approval,
      retrust: true,
      storePath,
      materializationRoot,
      materializationIndexPath: indexPath,
    });
  }

  function provenance(prepared, requiredBoundaries) {
    return {
      origin: "mcp:server:capsule-contract",
      command: prepared.command,
      args: prepared.args,
      cwd: prepared.workingDirectory,
      shell: false,
      sync: false,
      identityDigest: prepared.identityDigest,
      requiredBoundaries,
    };
  }

  it("binds the complete frozen host floor and rejects missing boundaries or replay", () => {
    expect(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES).toEqual([
      "code-snapshot",
      "filesystem",
      "network",
      "process-tree",
    ]);
    expect(Object.isFrozen(MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES)).toBe(true);

    const accepted = issueContract();
    const acceptedProvenance = provenance(
      accepted,
      MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES,
    );
    const acceptedContract = accepted.sandboxExecutionContract;
    expect(acceptedContract.entryIdentity.mtimeMs).toBe(
      fs.statSync(acceptedContract.entryIdentity.realPath).mtimeMs,
    );
    expect(acceptedContract.runtimeIdentity.mtimeMs).toBe(
      fs.statSync(acceptedContract.runtimeIdentity.realPath).mtimeMs,
    );
    expect(
      consumeMcpStdioCapsuleSandboxExecutionContract(
        acceptedContract,
        acceptedProvenance,
      ),
    ).toBe(true);
    expect(
      consumeMcpStdioCapsuleSandboxExecutionContract(
        acceptedContract,
        acceptedProvenance,
      ),
    ).toBe(false);

    for (const missing of MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES) {
      const prepared = issueContract();
      const contract = prepared.sandboxExecutionContract;
      expect(
        consumeMcpStdioCapsuleSandboxExecutionContract(
          contract,
          provenance(
            prepared,
            MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES.filter(
              (boundary) => boundary !== missing,
            ),
          ),
        ),
      ).toBe(false);
      expect(
        consumeMcpStdioCapsuleSandboxExecutionContract(
          contract,
          provenance(prepared, MCP_STDIO_CAPSULE_REQUIRED_BOUNDARIES),
        ),
      ).toBe(false);
    }
  });
});
