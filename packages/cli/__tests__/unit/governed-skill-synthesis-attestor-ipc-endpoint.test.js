import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_UNIX_SOCKET_MAX_BYTES,
  createGovernedSkillSynthesisAttestorIpcEndpoint,
  isGovernedSkillSynthesisAttestorIpcEndpoint,
} from "../../src/lib/evolution/governed-skill-synthesis-attestor-ipc-endpoint.js";

const id = "0123456789abcdef01234567";

describe("governed skill synthesis attestor IPC endpoints", () => {
  it.each([
    ["external", "cc-att-"],
    ["trust-operations", "cc-ato-"],
    ["trust-approval", "cc-atp-"],
  ])("creates a short Unix endpoint for %s", (kind, prefix) => {
    const endpoint = createGovernedSkillSynthesisAttestorIpcEndpoint({
      kind,
      id,
      platform: "darwin",
      temporaryDirectory:
        "/private/var/folders/aa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/T",
    });

    expect(path.basename(endpoint)).toBe(`${prefix}${id}.sock`);
    expect(Buffer.byteLength(endpoint, "utf8")).toBeLessThanOrEqual(
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_UNIX_SOCKET_MAX_BYTES,
    );
    expect(
      isGovernedSkillSynthesisAttestorIpcEndpoint(endpoint, {
        kind,
        platform: "darwin",
      }),
    ).toBe(true);
  });

  it("falls back to /tmp when the preferred Unix directory is too long", () => {
    const endpoint = createGovernedSkillSynthesisAttestorIpcEndpoint({
      kind: "trust-approval",
      id,
      platform: "darwin",
      temporaryDirectory: `/${"long-directory/".repeat(12)}`,
    });

    expect(endpoint).toBe(`/tmp/cc-atp-${id}.sock`);
  });

  it("preserves the dedicated Windows named pipe format", () => {
    const endpoint = createGovernedSkillSynthesisAttestorIpcEndpoint({
      kind: "trust-operations",
      id,
      platform: "win32",
    });

    expect(endpoint).toBe(`\\\\.\\pipe\\cc-evolution-attestor-trust-ops-${id}`);
    expect(
      isGovernedSkillSynthesisAttestorIpcEndpoint(endpoint, {
        kind: "trust-operations",
        platform: "win32",
      }),
    ).toBe(true);
  });

  it("rejects long or non-dedicated Unix endpoints", () => {
    const longEndpoint = path.join(
      `/${"long-directory/".repeat(12)}`,
      `cc-atp-${id}.sock`,
    );
    expect(
      isGovernedSkillSynthesisAttestorIpcEndpoint(longEndpoint, {
        kind: "trust-approval",
        platform: "darwin",
      }),
    ).toBe(false);
    expect(
      isGovernedSkillSynthesisAttestorIpcEndpoint(`/tmp/arbitrary-${id}.sock`, {
        kind: "trust-approval",
        platform: "darwin",
      }),
    ).toBe(false);
  });
});
