import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("IPFS production wiring", () => {
  it("registers the initialized singleton through the explicit manager port", () => {
    const source = read("src/main/ipc/phases/phase-21-30-enterprise.js");
    expect(source).toContain("const ipfsManager = getIPFSManager()");
    expect(source).toMatch(/ipfsManager\s*\.initialize\(/);
    expect(source).toContain("registerIPFSIPC({ manager: ipfsManager })");
    expect(source).toContain("registeredModules.ipfsManager = ipfsManager");
    expect(source).not.toContain("registerIPFSIPC({ ipfsManager })");
  });

  it("keeps both IPC retrieval paths behind bounded reads and encoding", () => {
    const source = read("src/main/ipfs/ipfs-ipc.js");
    expect(source).toContain("boundedReadOptions(manager, options || {})");
    expect(source).toContain("boundedReadOptions(manager)");
    expect(
      source.match(/encodeContentForIPC\(manager, result\.content\)/g),
    ).toHaveLength(2);
    expect(source).toMatch(/new IPFSBoundaryError\(\s*"PAYLOAD_TOO_LARGE"/);
    expect(source).toContain("retryAfterMs");
  });
});
