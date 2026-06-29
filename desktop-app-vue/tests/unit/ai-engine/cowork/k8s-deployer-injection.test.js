/**
 * Security regression: k8s-deployer interpolates the skill's target (deployment /
 * app name) into execSync (a shell) — `kubectl get deployment ${target}`,
 * `kubectl rollout restart deployment/${target}`. isSafeK8sName must reject shell
 * metacharacters, and the handlers must NOT exec when the name is unsafe.
 */
import { describe, it, expect, vi } from "vitest";

const handler = require("../../../../src/main/ai-engine/cowork/skills/builtin/k8s-deployer/handler.js");

describe("k8s-deployer isSafeK8sName (command injection guard)", () => {
  it("accepts valid resource names", () => {
    expect(handler.isSafeK8sName("my-app")).toBe(true);
    expect(handler.isSafeK8sName("nginx.v2")).toBe(true);
    expect(handler.isSafeK8sName("frontend_1")).toBe(true);
  });

  it("rejects shell metacharacters / spaces / empties", () => {
    expect(handler.isSafeK8sName("x; rm -rf ~")).toBe(false);
    expect(handler.isSafeK8sName("x;rm")).toBe(false);
    expect(handler.isSafeK8sName("$(whoami)")).toBe(false);
    expect(handler.isSafeK8sName("a|b")).toBe(false);
    expect(handler.isSafeK8sName("-leading")).toBe(false); // must start alnum
    expect(handler.isSafeK8sName("")).toBe(false);
    expect(handler.isSafeK8sName(undefined)).toBe(false);
  });

  it("does NOT execute when the target is unsafe", async () => {
    const spy = vi.fn(() => "");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const status = await handler.execute({ input: "status x;rm" });
      expect(status.success).toBe(false);
      const rollout = await handler.execute({ input: "rollout restart x;rm" });
      expect(rollout.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      handler._deps.execSync = orig;
    }
  });

  it("does execute for a safe target", async () => {
    const spy = vi.fn(() => "deployment ok");
    const orig = handler._deps.execSync;
    handler._deps.execSync = spy;
    try {
      const res = await handler.execute({ input: "status my-app" });
      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalled();
    } finally {
      handler._deps.execSync = orig;
    }
  });
});
