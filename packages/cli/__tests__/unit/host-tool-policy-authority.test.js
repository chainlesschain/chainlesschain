import { describe, expect, it, vi } from "vitest";
import {
  captureHostToolPolicyAuthority,
  createHostToolPolicyAuthority,
  hostToolPolicyAuthorityForChild,
} from "../../src/lib/host-tool-policy-authority.js";

describe("host tool policy authority", () => {
  it("binds execution to a private frozen snapshot and a readonly owner", () => {
    const input = { tools: { run_shell: { allowed: false } } };
    const { authority } = createHostToolPolicyAuthority(input);
    input.tools.run_shell.allowed = true;
    expect(authority.getSnapshot().policy.tools.run_shell.allowed).toBe(false);
    expect(() => {
      authority.getSnapshot().policy.tools.run_shell.allowed = true;
    }).toThrow();
    expect(Object.isFrozen(authority)).toBe(true);
    expect(authority).not.toHaveProperty("commit");
    expect(captureHostToolPolicyAuthority(authority)).toBe(authority);
    expect(() => captureHostToolPolicyAuthority({ ...authority })).toThrow();
  });

  it("commits before synchronous notification, survives throwing observers, and cleans subscriptions", () => {
    const controller = createHostToolPolicyAuthority();
    const { authority } = controller;
    const observer = vi.fn((snapshot) =>
      expect(authority.getSnapshot()).toBe(snapshot),
    );
    const removeThrower = authority.subscribePolicyRevision(() => {
      throw new Error("observer failed");
    });
    const removeObserver = authority.subscribePolicyRevision(observer);
    controller.commit({ tools: { run_shell: { allowed: false } } });
    controller.commit(null);
    expect(authority.getSnapshot()).toMatchObject({
      revision: 2,
      policy: null,
    });
    expect(observer).toHaveBeenCalledTimes(2);
    controller.commit(null);
    expect(observer).toHaveBeenCalledTimes(2);
    removeThrower();
    removeObserver();
    controller.commit({ tools: {} });
    expect(observer).toHaveBeenCalledTimes(2);
  });

  it.each([
    false,
    [],
    { tools: false },
    { tools: [] },
    { tools: { run_shell: { allowed: "false" } } },
    { toolPolicies: { run_shell: false } },
    { toolDefinitions: {} },
    { tools: undefined },
    {
      get tools() {
        throw new Error("must not execute getter");
      },
    },
    new Proxy({}, {}),
  ])(
    "rejects ambiguous policy data without replacing the accepted policy (%#)",
    (input) => {
      const controller = createHostToolPolicyAuthority({
        tools: { run_shell: { allowed: false } },
      });
      const previous = controller.authority.getSnapshot();
      expect(() => controller.commit(input)).toThrow();
      expect(controller.authority.getSnapshot()).toBe(previous);
    },
  );

  it("latches an unavailable owner until the host explicitly commits again", () => {
    const controller = createHostToolPolicyAuthority();
    const observer = vi.fn();
    controller.authority.subscribePolicyRevision(observer);
    controller.invalidate();
    expect(observer).toHaveBeenCalledOnce();
    expect(() => controller.authority.getSnapshot()).toThrow();
    controller.commit(null);
    expect(controller.authority.getSnapshot().revision).toBe(2);
  });

  it("keeps the parent's current ceiling and revisions in children without inheriting host definitions", () => {
    const controller = createHostToolPolicyAuthority({
      tools: {},
      toolDefinitions: [{ function: { name: "host_tool" } }],
    });
    const child = hostToolPolicyAuthorityForChild(controller.authority);
    expect(hostToolPolicyAuthorityForChild(controller.authority)).toBe(child);
    expect(child.getSnapshot().policy.toolDefinitions).toEqual([]);
    const observer = vi.fn();
    const remove = child.subscribePolicyRevision(observer);
    controller.commit({
      tools: { write_file: { allowed: false } },
      toolDefinitions: [{ function: { name: "new_host_tool" } }],
    });
    expect(child.getSnapshot()).toMatchObject({
      revision: 1,
      policy: {
        tools: { write_file: { allowed: false } },
        toolDefinitions: [],
      },
    });
    expect(observer).toHaveBeenCalledOnce();
    controller.invalidate();
    expect(() => child.getSnapshot()).toThrow();
    remove();
  });
});
