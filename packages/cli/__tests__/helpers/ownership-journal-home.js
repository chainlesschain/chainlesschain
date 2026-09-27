import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, vi } from "vitest";

// An explicit test-owned authority, shared with child probes. Never let a
// deliberate orphan fixture leave a pending record in the developer's store.
export function useOwnershipJournalHome() {
  let root;
  beforeAll(() => {
    if (process.platform !== "linux") return;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-ownership-authority-"));
    vi.stubEnv("CHAINLESSCHAIN_SECURITY_ANCHOR_HOME", root);
  });
  afterAll(() => {
    if (!root) return;
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });
}
