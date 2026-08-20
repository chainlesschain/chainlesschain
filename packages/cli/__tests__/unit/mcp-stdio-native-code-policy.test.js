import { describe, expect, it } from "vitest";
import {
  isMcpStdioCapsuleNativeCodePolicy,
  mcpStdioCapsuleNativeCodeEvidence,
  mcpStdioCapsuleNativeCodePolicyDigest,
  MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY,
  MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY_DIGEST,
} from "../../src/lib/mcp-stdio-native-code-policy.js";

describe("MCP stdio capsule native-code policy", () => {
  it("binds native-addon denial without overstating the platform runtime TCB", () => {
    expect(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY).toEqual({
      schema: "chainlesschain.mcp-stdio-native-code-policy/v1",
      contractVersion: 1,
      mode: "deny-package-native-addons",
      capsuleFormat: "single-bundled-cjs",
      nativeAddonLoading: "denied",
      nativeAddonDenialMechanism:
        "immutable-process-dlopen-guard-plus-bundled-js-only-v1",
      hostRuntimeSharedLibraries: "platform-runtime-tcb",
      anonymousExecutableMemory: "node-runtime-tcb",
      sharedLibraryClosure: false,
    });
    expect(Object.isFrozen(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY)).toBe(true);
    expect(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY_DIGEST).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      mcpStdioCapsuleNativeCodePolicyDigest(
        MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY,
      ),
    ).toBe(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY_DIGEST);
    expect(
      mcpStdioCapsuleNativeCodeEvidence(MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY),
    ).toMatchObject({
      nativeCodePolicyBound: true,
      nativeCodePolicyDigest: MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY_DIGEST,
      nativeCodePolicyMode: "deny-package-native-addons",
      nativeAddonLoading: "denied",
      hostRuntimeSharedLibraries: "platform-runtime-tcb",
    });
  });

  it("rejects missing, extra, or inflated policy claims", () => {
    for (const candidate of [
      null,
      {},
      { ...MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY, extra: true },
      {
        ...MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY,
        sharedLibraryClosure: true,
      },
      {
        ...MCP_STDIO_CAPSULE_NATIVE_CODE_POLICY,
        nativeAddonLoading: "allowed",
      },
    ]) {
      expect(isMcpStdioCapsuleNativeCodePolicy(candidate)).toBe(false);
      expect(() => mcpStdioCapsuleNativeCodePolicyDigest(candidate)).toThrow(
        "MCP capsule native-code policy is invalid",
      );
    }
  });
});
