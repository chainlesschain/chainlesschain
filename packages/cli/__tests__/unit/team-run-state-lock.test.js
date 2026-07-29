import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  _deps,
  TEAM_RUN_STATE_LOCK_ERROR,
  TeamRunStateLock,
} from "../../src/lib/agent-team/team-run-state-lock.js";

let tempDir;
const originalIsProcessAlive = _deps.isProcessAlive;
const originalOwnerToken = _deps.ownerToken;
const originalWriteMarker = _deps.writeMarker;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-state-lock-"));
});

afterEach(() => {
  _deps.isProcessAlive = originalIsProcessAlive;
  _deps.ownerToken = originalOwnerToken;
  _deps.writeMarker = originalWriteMarker;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("TeamRunStateLock", () => {
  it("holds exclusive ownership until release", () => {
    const statePath = path.join(tempDir, "run.json");
    const first = TeamRunStateLock.acquire(statePath);
    expect(() => TeamRunStateLock.acquire(statePath)).toThrowError(
      expect.objectContaining({
        code: TEAM_RUN_STATE_LOCK_ERROR,
        ownerPid: process.pid,
      }),
    );
    expect(first.release()).toBe(true);
    expect(first.release()).toBe(false);
    const second = TeamRunStateLock.acquire(statePath);
    expect(second.release()).toBe(true);
  });

  it("reclaims a lock only when its valid recorded owner is dead", () => {
    const statePath = path.join(tempDir, "run.json");
    const lockDir = `${path.resolve(statePath)}.run-lock`;
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, "owner.json"),
      JSON.stringify({ pid: 424242, startedAt: 1 }),
      "utf8",
    );
    _deps.isProcessAlive = () => false;

    const lock = TeamRunStateLock.acquire(statePath);
    expect(lock.release()).toBe(true);
  });

  it("fails closed on corrupt owner metadata", () => {
    const statePath = path.join(tempDir, "run.json");
    const lockDir = `${path.resolve(statePath)}.run-lock`;
    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "owner.json"), "{broken", "utf8");

    expect(() => TeamRunStateLock.acquire(statePath)).toThrowError(
      expect.objectContaining({ code: TEAM_RUN_STATE_LOCK_ERROR }),
    );
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it("canonicalizes parent aliases so one state cannot acquire two locks", () => {
    const realDir = path.join(tempDir, "real");
    const aliasDir = path.join(tempDir, "alias");
    fs.mkdirSync(realDir);
    fs.symlinkSync(
      realDir,
      aliasDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    const first = TeamRunStateLock.acquire(path.join(realDir, "run.json"));
    expect(() =>
      TeamRunStateLock.acquire(path.join(aliasDir, "run.json")),
    ).toThrowError(
      expect.objectContaining({ code: TEAM_RUN_STATE_LOCK_ERROR }),
    );
    first.release();
  });

  it("rejects hard-linked state authority", () => {
    const statePath = path.join(tempDir, "run.json");
    const aliasPath = path.join(tempDir, "alias.json");
    fs.writeFileSync(statePath, "{}", "utf8");
    fs.linkSync(statePath, aliasPath);

    expect(() => TeamRunStateLock.acquire(aliasPath)).toThrow(
      /hard links are not allowed/,
    );
  });

  it("a delayed stale reclaimer never deletes a replacement owner", () => {
    const statePath = path.join(tempDir, "run.json");
    const lockDir = `${path.resolve(statePath)}.run-lock`;
    const ownerPath = path.join(lockDir, "owner.json");
    const deadOwner = {
      pid: 424242,
      startedAt: 1,
      token: "dead-owner-token-0001",
    };
    const replacement = {
      pid: process.pid,
      startedAt: 2,
      token: "replacement-token-0001",
    };
    fs.mkdirSync(lockDir);
    fs.writeFileSync(ownerPath, JSON.stringify(deadOwner), "utf8");
    _deps.isProcessAlive = (pid) => pid === replacement.pid;
    _deps.ownerToken = () => "contender-token-0001";
    let replaced = false;
    _deps.writeMarker = (markerPath, owner) => {
      originalWriteMarker(markerPath, owner);
      if (!replaced && markerPath.includes(`.reclaim-${deadOwner.token}`)) {
        replaced = true;
        fs.rmSync(lockDir, { recursive: true, force: true });
        fs.mkdirSync(lockDir);
        fs.writeFileSync(ownerPath, JSON.stringify(replacement), "utf8");
      }
    };

    expect(() => TeamRunStateLock.acquire(statePath)).toThrowError(
      expect.objectContaining({
        code: TEAM_RUN_STATE_LOCK_ERROR,
        ownerPid: process.pid,
      }),
    );
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toEqual(replacement);
    expect(fs.existsSync(lockDir)).toBe(true);
  });

  it("release refuses to delete a lock whose owner token changed", () => {
    const statePath = path.join(tempDir, "run.json");
    _deps.ownerToken = () => "original-owner-token-0001";
    const lock = TeamRunStateLock.acquire(statePath);
    const ownerPath = path.join(lock.lockDir, "owner.json");
    const replacement = {
      pid: process.pid,
      startedAt: Date.now() + 1,
      token: "replacement-token-0002",
    };
    fs.writeFileSync(ownerPath, JSON.stringify(replacement), "utf8");

    expect(lock.release()).toBe(false);
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toEqual(replacement);
    expect(fs.existsSync(lock.lockDir)).toBe(true);
  });
});
