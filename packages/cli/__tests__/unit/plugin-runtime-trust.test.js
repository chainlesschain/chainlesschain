import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  isPluginTrusted,
  trustPlugin,
  untrustPlugin,
  listTrust,
  partitionByTrust,
  _deps as trustDeps,
} from "../../src/lib/plugin-runtime/trust.js";

let dir;
let storeFile;
let workspaceTrustStore;
let originalDeps;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-trust-"));
  storeFile = path.join(dir, "plugin-trust.json");
  workspaceTrustStore = path.join(dir, "workspace-trust.json");
  originalDeps = { ...trustDeps };
  trustDeps.storePath = () => storeFile;
  trustDeps.workspaceTrustStorePath = () => workspaceTrustStore;
});
afterEach(() => {
  Object.assign(trustDeps, originalDeps);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const P = (scope, name, version) => ({ scope, name, version });

describe("isPluginTrusted — scope defaults", () => {
  it("auto-trusts user and local scope plugins", () => {
    expect(isPluginTrusted(P("user", "a", "1.0.0"))).toBe(true);
    expect(isPluginTrusted(P("local", "b", "1.0.0"))).toBe(true);
  });

  it("does NOT auto-trust project scope plugins", () => {
    expect(isPluginTrusted(P("project", "c", "1.0.0"))).toBe(false);
  });

  it("rejects a null/anonymous plugin", () => {
    expect(isPluginTrusted(null)).toBe(false);
    expect(isPluginTrusted({})).toBe(false);
  });
});

describe("trust / untrust store", () => {
  it("trusting a project plugin makes it trusted at that exact version", () => {
    trustPlugin("c", { scope: "project", version: "1.0.0" });
    expect(isPluginTrusted(P("project", "c", "1.0.0"))).toBe(true);
  });

  it("a version bump re-requires trust", () => {
    trustPlugin("c", { scope: "project", version: "1.0.0" });
    expect(isPluginTrusted(P("project", "c", "2.0.0"))).toBe(false);
  });

  it("untrust revokes it", () => {
    trustPlugin("c", { scope: "project", version: "1.0.0" });
    expect(isPluginTrusted(P("project", "c", "1.0.0"))).toBe(true);
    const res = untrustPlugin("c", { scope: "project" });
    expect(res.removed).toBe(true);
    expect(isPluginTrusted(P("project", "c", "1.0.0"))).toBe(false);
  });

  it("trustPlugin requires a version", () => {
    expect(() => trustPlugin("c", { scope: "project" })).toThrow(
      /requires a version/,
    );
  });

  it("listTrust reflects the store", () => {
    trustPlugin("c", { scope: "project", version: "1.0.0" });
    const list = listTrust();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      scope: "project",
      name: "c",
      version: "1.0.0",
    });
  });

  it("persists across reloads (written to disk)", () => {
    trustPlugin("c", { scope: "project", version: "1.0.0" });
    expect(fs.existsSync(storeFile)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    expect(Object.values(raw)).toContainEqual(
      expect.objectContaining({ name: "c", version: "1.0.0" }),
    );
  });

  it("holds a fail-closed lock around the complete mutation", () => {
    const realLock = trustDeps.withFileLock;
    trustDeps.withFileLock = vi.fn((target, body, options) =>
      realLock(target, body, options),
    );

    trustPlugin("c", { scope: "project", version: "1.0.0" });

    expect(trustDeps.withFileLock).toHaveBeenCalledWith(
      storeFile,
      expect.any(Function),
      expect.objectContaining({ failIfUnavailable: true }),
    );
  });

  it("fails closed and preserves a corrupt trust store", () => {
    fs.writeFileSync(storeFile, "{broken", "utf8");
    expect(isPluginTrusted(P("project", "c", "1.0.0"))).toBe(false);
    expect(() =>
      trustPlugin("c", { scope: "project", version: "1.0.0" }),
    ).toThrow(/corrupt/i);
    expect(fs.readFileSync(storeFile, "utf8")).toBe("{broken");
  });

  it("propagates lock failure without writing trust", () => {
    const error = Object.assign(new Error("busy"), {
      code: "STATE_LOCK_UNAVAILABLE",
    });
    trustDeps.withFileLock = vi.fn(() => {
      throw error;
    });

    expect(() =>
      trustPlugin("c", { scope: "project", version: "1.0.0" }),
    ).toThrow(error);
    expect(fs.existsSync(storeFile)).toBe(false);
  });
});

describe("partitionByTrust", () => {
  it("splits plugins into trusted (user/local + explicitly trusted project) and skipped", () => {
    trustPlugin("p3", { scope: "project", version: "1.0.0" });
    const plugins = [
      P("user", "p1", "1.0.0"),
      P("project", "p2", "1.0.0"), // untrusted
      P("project", "p3", "1.0.0"), // trusted above
    ];
    const { trusted, skipped } = partitionByTrust(plugins);
    expect(trusted.map((p) => p.name).sort()).toEqual(["p1", "p3"]);
    expect(skipped.map((p) => p.name)).toEqual(["p2"]);
  });
});
