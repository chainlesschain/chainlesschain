import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentHostHooksV2WorkspaceBinding,
  currentHostHooksV2WorkspaceRoot,
  registerHostHooksV2Workspace,
  releaseRegisteredHostHooksV2Workspace,
  resolveRegisteredHostHooksV2Workspace,
  runWithHostHooksV2Workspace,
} from "../../src/lib/hooks-v2-workspace-context.js";

describe("Hooks v2 trusted host workspace context", () => {
  const temporaryParents = [];

  function createWorkspace(name = "workspace") {
    const parent = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-hooks-v2-workspace-"),
    );
    temporaryParents.push(parent);
    const workspaceRoot = path.join(parent, name);
    fs.mkdirSync(workspaceRoot);
    return { parent, workspaceRoot };
  }

  function expectedWorkspaceBindingId(workspaceRoot) {
    const canonicalRoot = fs.realpathSync.native(workspaceRoot);
    const stats = fs.statSync(canonicalRoot, { bigint: true });
    return createHash("sha256")
      .update("chainlesschain.hooks-v2-host-workspace.v2\0")
      .update(
        JSON.stringify([
          canonicalRoot,
          stats.dev.toString(),
          stats.ino.toString(),
        ]),
        "utf8",
      )
      .digest("hex");
  }

  afterEach(() => {
    for (const temporaryParent of temporaryParents.splice(0)) {
      fs.rmSync(temporaryParent, { recursive: true, force: true });
    }
  });

  it("keeps concurrent and nested workspace roots async-scoped", async () => {
    const rootA = createWorkspace("host-workspace-a").workspaceRoot;
    const rootB = createWorkspace("host-workspace-b").workspaceRoot;

    const [scopeA, scopeB] = await Promise.all([
      runWithHostHooksV2Workspace(rootA, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        const beforeNested = currentHostHooksV2WorkspaceRoot();
        const nested = await runWithHostHooksV2Workspace(rootB, async () => {
          await Promise.resolve();
          return currentHostHooksV2WorkspaceRoot();
        });
        return {
          beforeNested,
          nested,
          afterNested: currentHostHooksV2WorkspaceRoot(),
        };
      }),
      runWithHostHooksV2Workspace(rootB, async () => {
        await Promise.resolve();
        return currentHostHooksV2WorkspaceRoot();
      }),
    ]);

    expect(scopeA).toEqual({
      beforeNested: fs.realpathSync.native(rootA),
      nested: fs.realpathSync.native(rootB),
      afterNested: fs.realpathSync.native(rootA),
    });
    expect(scopeB).toBe(fs.realpathSync.native(rootB));
    expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
  });

  it("rejects invalid roots before entering a trusted scope", () => {
    expect(() => runWithHostHooksV2Workspace("", () => {})).toThrow(
      expect.objectContaining({
        code: "CC_HOOK_TRUSTED_WORKSPACE_INVALID",
      }),
    );
    expect(() => runWithHostHooksV2Workspace("workspace", null)).toThrowError(
      TypeError,
    );
    expect(() =>
      registerHostHooksV2Workspace(
        path.join(os.tmpdir(), `cc-hooks-v2-missing-${process.pid}`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "CC_HOOK_TRUSTED_WORKSPACE_INVALID",
      }),
    );
  });

  it("canonicalizes symlink aliases and reuses one directory binding", () => {
    const { parent, workspaceRoot: root } = createWorkspace(
      "canonical-host-workspace",
    );
    const alias = path.join(parent, "workspace-alias");
    fs.symlinkSync(
      root,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );

    const directBinding = registerHostHooksV2Workspace(root);
    const aliasBinding = registerHostHooksV2Workspace(alias);

    expect(aliasBinding).toBe(directBinding);
    expect(aliasBinding.workspaceRoot).toBe(fs.realpathSync.native(root));
  });

  it("uses stable opaque durable IDs in the process-local registry", () => {
    const root = createWorkspace("durable-host-workspace").workspaceRoot;
    const otherRoot = createWorkspace(
      "other-durable-host-workspace",
    ).workspaceRoot;
    const binding = registerHostHooksV2Workspace(root);
    const duplicate = registerHostHooksV2Workspace(root);
    const otherBinding = registerHostHooksV2Workspace(otherRoot);
    const expectedStableBindingId = expectedWorkspaceBindingId(root);

    expect(binding).toEqual({
      bindingId: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceRoot: fs.realpathSync.native(root),
    });
    expect(duplicate).toBe(binding);
    expect(otherBinding.bindingId).not.toBe(binding.bindingId);
    expect(binding.bindingId).toBe(expectedStableBindingId);
    expect(binding.bindingId).not.toContain(root);
    expect(resolveRegisteredHostHooksV2Workspace(binding.bindingId)).toBe(
      binding,
    );
    expect(resolveRegisteredHostHooksV2Workspace("0".repeat(64))).toBeNull();
    expect(resolveRegisteredHostHooksV2Workspace(root)).toBeNull();
  });

  it("fails closed when a registered workspace is deleted", async () => {
    const root = createWorkspace("deleted-host-workspace").workspaceRoot;
    const binding = registerHostHooksV2Workspace(root);

    await runWithHostHooksV2Workspace(root, async () => {
      expect(currentHostHooksV2WorkspaceBinding()).toBe(binding);
      fs.rmSync(root, { recursive: true });
      expect(currentHostHooksV2WorkspaceBinding()).toBeNull();
      expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
    });

    expect(resolveRegisteredHostHooksV2Workspace(binding.bindingId)).toBeNull();
  });

  it("fails closed across same-path directory replacement", async () => {
    const root = createWorkspace("replaced-host-workspace").workspaceRoot;
    const originalBinding = registerHostHooksV2Workspace(root);

    await runWithHostHooksV2Workspace(root, async () => {
      fs.rmSync(root, { recursive: true });
      fs.mkdirSync(root);
      expect(
        resolveRegisteredHostHooksV2Workspace(originalBinding.bindingId),
      ).toBeNull();
      expect(currentHostHooksV2WorkspaceBinding()).toBeNull();
      expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
    });

    const replacementBinding = registerHostHooksV2Workspace(root);
    expect(replacementBinding).not.toBe(originalBinding);
    expect(replacementBinding.bindingId).toBe(expectedWorkspaceBindingId(root));
    expect(replacementBinding.bindingId).not.toBe(originalBinding.bindingId);
    expect(
      resolveRegisteredHostHooksV2Workspace(originalBinding.bindingId),
    ).toBeNull();
  });

  it("exposes the immutable binding only inside its async host scope", async () => {
    const root = createWorkspace("binding-scope-workspace").workspaceRoot;
    await runWithHostHooksV2Workspace(root, async () => {
      await Promise.resolve();
      expect(currentHostHooksV2WorkspaceBinding()).toEqual({
        bindingId: expect.stringMatching(/^[a-f0-9]{64}$/),
        workspaceRoot: fs.realpathSync.native(root),
      });
      expect(Object.isFrozen(currentHostHooksV2WorkspaceBinding())).toBe(true);
    });
    expect(currentHostHooksV2WorkspaceBinding()).toBeNull();
  });

  it("revokes a binding immediately, including from an active async scope", async () => {
    const root = createWorkspace("released-host-workspace").workspaceRoot;

    await runWithHostHooksV2Workspace(root, async () => {
      const binding = currentHostHooksV2WorkspaceBinding();
      expect(binding).not.toBeNull();
      expect(releaseRegisteredHostHooksV2Workspace(binding.bindingId)).toBe(
        true,
      );
      expect(currentHostHooksV2WorkspaceBinding()).toBeNull();
      expect(currentHostHooksV2WorkspaceRoot()).toBeNull();
      expect(
        resolveRegisteredHostHooksV2Workspace(binding.bindingId),
      ).toBeNull();
      expect(releaseRegisteredHostHooksV2Workspace(binding.bindingId)).toBe(
        false,
      );
    });
  });

  it("sweeps deleted roots before enforcing registry capacity", () => {
    const capacityRoot = createWorkspace(
      "registry-capacity-workspaces",
    ).workspaceRoot;
    const workspaceRoots = [];
    for (let index = 0; index < 1024; index += 1) {
      const workspaceRoot = path.join(
        capacityRoot,
        `workspace-${String(index).padStart(4, "0")}`,
      );
      fs.mkdirSync(workspaceRoot);
      workspaceRoots.push(workspaceRoot);
      registerHostHooksV2Workspace(workspaceRoot);
    }

    const overflowRoot = path.join(capacityRoot, "workspace-overflow");
    fs.mkdirSync(overflowRoot);
    expect(() => registerHostHooksV2Workspace(overflowRoot)).toThrow(
      expect.objectContaining({
        code: "CC_HOOK_TRUSTED_WORKSPACE_LIMIT",
      }),
    );

    fs.rmSync(workspaceRoots[0], { recursive: true });
    expect(registerHostHooksV2Workspace(overflowRoot)).toEqual({
      bindingId: expect.stringMatching(/^[a-f0-9]{64}$/),
      workspaceRoot: fs.realpathSync.native(overflowRoot),
    });
  }, 20_000);
});
