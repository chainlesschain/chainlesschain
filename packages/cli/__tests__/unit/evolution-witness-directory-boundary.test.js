import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureEvolutionFileWitnessDirectoryBoundaries as capture,
  hasEvolutionFileWitnessDirectoryBoundaries as has,
  EVOLUTION_WITNESS_STATE_READ_FAILED_CODE as FAILED,
} from "../../src/lib/evolution/evolution-file-witness.js";
import {
  openWitnessBoundaryFixture,
  createWitnessBoundaryIo,
} from "../fixtures/evolution-witness-boundary.js";
import { withFileLock } from "../../src/lib/with-file-lock.js";

const temp = fs.realpathSync.native(os.tmpdir());
const fields = ["dev", "ino", "mode", "uid", "gid"];
function inside(root, target) {
  if (!path.resolve(target).startsWith(path.resolve(root) + path.sep))
    throw new Error("unsafe witness directory fixture path");
}

describe.sequential("original file witness directory capabilities", () => {
  let root, fixture, controls, boundary;
  let forbidPorts = false,
    forbiddenPorts = 0;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(temp, "cc-witness-directory-"));
    controls = createWitnessBoundaryIo();
    fixture = openWitnessBoundaryFixture(root, {
      fsImpl: controls.fsImpl,
      lock: (...args) => {
        if (forbidPorts) {
          forbiddenPorts++;
          throw new Error("lock");
        }
        return withFileLock(...args);
      },
      random: () => {
        if (forbidPorts) {
          forbiddenPorts++;
          throw new Error("random");
        }
        return randomBytes(16).toString("hex");
      },
    });
    boundary = capture(fixture.witness);
  }, 60_000);
  afterAll(() => {
    if (
      path.dirname(root) !== temp ||
      !path.basename(root).startsWith("cc-witness-directory-")
    )
      throw new Error("unsafe witness directory cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }, 60_000);

  it("captures the actual segmented witness and retains its frozen component identities", () => {
    expect(fixture.segmentFiles.length).toBeGreaterThan(0);
    expect(capture(fixture.witness)).toBe(boundary);
    expect(boundary.recheck()).toBe(boundary.descriptor);
    expect(Object.isFrozen(boundary)).toBe(true);
    expect(Object.isFrozen(boundary.recheck)).toBe(true);
    expect(boundary.descriptor).toMatchObject({
      scope: "original-witness-state-and-segment-directories",
      state: { directory: { path: path.dirname(fixture.file) } },
      segments: { directory: { path: fixture.segmentDirectory } },
      fileContentsVerified: false,
      storageInventoryVerified: false,
      retentionStorageVerified: false,
      fullPhysicalStorageGraphVerified: false,
      grantsMutationOrPromotionAuthority: false,
    });
    for (const component of [
      boundary.descriptor.state,
      boundary.descriptor.segments,
    ]) {
      const stat = fs.lstatSync(component.directory.path, { bigint: true });
      expect(Object.isFrozen(component.directory.identity)).toBe(true);
      for (const field of fields)
        expect(component.directory.identity[field]).toBe(String(stat[field]));
    }
  });

  it("does not run filesystem content, descriptor, lock, random or verifier ports", () => {
    const replaced = new Map();
    let forbidden = 0;
    for (const [name, operation] of Object.entries(controls.fsImpl)) {
      if (
        typeof operation !== "function" ||
        ["lstatSync", "realpathSync"].includes(name)
      )
        continue;
      replaced.set(name, operation);
      controls.fsImpl[name] = () => {
        forbidden++;
        throw new Error("non-metadata I/O");
      };
    }
    fixture.policy.afterVerify = () => {
      forbidden++;
      throw new Error("verifier");
    };
    forbidPorts = true;
    try {
      expect(capture(fixture.witness)).toBe(boundary);
      expect(boundary.recheck()).toBe(boundary.descriptor);
      expect(forbidden).toBe(0);
      expect(forbiddenPorts).toBe(0);
    } finally {
      delete fixture.policy.afterVerify;
      forbidPorts = false;
      for (const [name, operation] of replaced)
        controls.fsImpl[name] = operation;
    }
  });

  it("rejects forged ownership and replacement context without invoking traps", () => {
    let calls = 0;
    const handler = Object.fromEntries(
      ["get", "getPrototypeOf", "ownKeys"].map((name) => [
        name,
        () => {
          calls++;
          throw new Error("caller trap");
        },
      ]),
    );
    const revoked = Proxy.revocable(fixture.witness, handler);
    revoked.revoke();
    for (const fake of [
      null,
      {},
      { ...fixture.witness },
      new Proxy(fixture.witness, handler),
      revoked.proxy,
    ]) {
      expect(has(fake)).toBe(false);
      expect(() => capture(fake)).toThrow(TypeError);
    }
    expect(has(fixture.witness)).toBe(true);
    const context = {
      get fsImpl() {
        calls++;
        throw new Error("replacement context");
      },
    };
    expect(() => capture(fixture.witness, context)).toThrow(TypeError);
    expect(() => boundary.recheck(context)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it.each(["state", "segments"])(
    "rejects actual %s directory copies before first capture and on retained recheck",
    (role) => {
      const freshWitness = fixture.create();
      const directory = boundary.descriptor[role].directory.path;
      const saved = path.join(root, `original-${role}`);
      inside(root, directory);
      inside(root, saved);
      fs.renameSync(directory, saved);
      try {
        fs.cpSync(saved, directory, { recursive: true });
        expect(() => capture(fixture.witness)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
        expect(() => capture(freshWitness)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
        expect(() => boundary.recheck()).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        if (fs.existsSync(directory))
          fs.rmSync(directory, { recursive: true, force: true });
        fs.renameSync(saved, directory);
      }
      expect(boundary.recheck()).toBe(boundary.descriptor);
    },
  );

  it.each(["state", "segments"])(
    "rejects a missing %s directory without recreating it",
    (role) => {
      const directory = boundary.descriptor[role].directory.path;
      const saved = path.join(root, `missing-${role}`);
      inside(root, directory);
      inside(root, saved);
      fs.renameSync(directory, saved);
      try {
        expect(() => capture(fixture.witness)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
        expect(fs.existsSync(directory)).toBe(false);
      } finally {
        fs.renameSync(saved, directory);
      }
      expect(boundary.recheck()).toBe(boundary.descriptor);
    },
  );

  it.each(["state", "segments"])(
    "rejects an actual %s directory alias",
    (role) => {
      const directory = boundary.descriptor[role].directory.path;
      const saved = path.join(root, `alias-${role}`);
      inside(root, directory);
      inside(root, saved);
      fs.renameSync(directory, saved);
      try {
        fs.symlinkSync(
          saved,
          directory,
          process.platform === "win32" ? "junction" : "dir",
        );
        expect(() => capture(fixture.witness)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        if (fs.existsSync(directory)) fs.unlinkSync(directory);
        fs.renameSync(saved, directory);
      }
      expect(boundary.recheck()).toBe(boundary.descriptor);
    },
  );

  it.each(
    ["state", "segments"].flatMap((role) =>
      fields.map((field) => [role, field]),
    ),
  )("rejects Number fallback in %s %s", (role, field) => {
    const directory = boundary.descriptor[role].directory.path;
    let fired = 0;
    controls.arm(directory);
    controls.io.stat = (stat, api, target, options) => {
      if (target === directory && api === "path" && options?.bigint) {
        fired++;
        return {
          ...stat,
          [field]: Number(stat[field]),
          isDirectory: () => true,
          isSymbolicLink: () => false,
        };
      }
      return stat;
    };
    try {
      expect(() => boundary.recheck()).toThrow(
        expect.objectContaining({ code: FAILED }),
      );
      expect(fired).toBeGreaterThan(0);
    } finally {
      controls.io.armed = false;
    }
  });

  it.skipIf(process.platform === "win32").each(["state", "segments"])(
    "rejects a real FIFO at the %s directory without opening it",
    (role) => {
      const directory = boundary.descriptor[role].directory.path;
      const saved = path.join(root, `fifo-${role}`);
      inside(root, directory);
      inside(root, saved);
      fs.renameSync(directory, saved);
      try {
        execFileSync("mkfifo", [directory]);
        expect(fs.lstatSync(directory).isFIFO()).toBe(true);
        expect(() => capture(fixture.witness)).toThrow(
          expect.objectContaining({ code: FAILED }),
        );
      } finally {
        if (fs.existsSync(directory)) fs.unlinkSync(directory);
        fs.renameSync(saved, directory);
      }
    },
  );

  it("keeps directory metadata separate from signed content and survives legitimate append/reopen", () => {
    const original = fs.readFileSync(fixture.file);
    try {
      fs.writeFileSync(fixture.file, "broken witness bytes\n");
      expect(boundary.recheck()).toBe(boundary.descriptor);
      expect(() => fixture.witness.read()).toThrow();
    } finally {
      fs.writeFileSync(fixture.file, original);
    }
    const before = boundary.descriptor;
    const current = fixture.witness.read();
    fixture.witness.compareAndSwap({
      expected: current,
      next: fixture.snapshot(257),
    });
    expect(boundary.recheck()).toBe(before);
    expect(capture(fixture.create()).descriptor).toEqual(before);
  }, 60_000);

  it("does not create or adopt a legacy witness's absent segment directory", () => {
    const legacy = openWitnessBoundaryFixture(path.join(root, "legacy"), {
      segmented: false,
    });
    const original = capture(legacy.witness);
    expect(original.descriptor.scope).toBe("original-witness-state-directory");
    expect(original.descriptor.segments).toBeNull();
    expect(fs.existsSync(legacy.segmentDirectory)).toBe(false);
    fs.mkdirSync(legacy.segmentDirectory, { mode: 0o700 });
    expect(capture(legacy.witness)).toBe(original);
    expect(original.descriptor.segments).toBeNull();
    const reopened = capture(legacy.create());
    expect(reopened.descriptor.scope).toBe(
      "original-witness-state-and-segment-directories",
    );
  }, 60_000);
});
