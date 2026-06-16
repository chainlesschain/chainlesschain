import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  defaultDesktopUserDataDir,
  defaultProjectDbPath,
  newProjectId,
  openProjectsDb,
  VALID_PROJECT_TYPES,
  VALID_PROJECT_STATUSES,
} from "../../src/lib/project-runtime.js";

const PRODUCT = "chainlesschain-desktop-vue";
const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const envSnapshot = { ...process.env };

function setPlatform(p) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, "platform", origPlatform);
  // Restore any env keys the test mutated.
  for (const k of ["APPDATA", "XDG_CONFIG_HOME"]) {
    if (k in envSnapshot) process.env[k] = envSnapshot[k];
    else delete process.env[k];
  }
});

describe("project-runtime — defaultDesktopUserDataDir", () => {
  it("always ends with the product name", () => {
    expect(defaultDesktopUserDataDir().endsWith(PRODUCT)).toBe(true);
  });

  it("uses APPDATA on win32 when set", () => {
    setPlatform("win32");
    process.env.APPDATA = path.join("X:", "Custom", "Roaming");
    expect(defaultDesktopUserDataDir()).toBe(
      path.join(process.env.APPDATA, PRODUCT),
    );
  });

  it("falls back to AppData/Roaming on win32 without APPDATA", () => {
    setPlatform("win32");
    delete process.env.APPDATA;
    expect(
      defaultDesktopUserDataDir().endsWith(
        path.join("AppData", "Roaming", PRODUCT),
      ),
    ).toBe(true);
  });

  it("uses ~/Library/Application Support on darwin", () => {
    setPlatform("darwin");
    expect(defaultDesktopUserDataDir()).toBe(
      path.join(os.homedir(), "Library", "Application Support", PRODUCT),
    );
  });

  it("honours XDG_CONFIG_HOME on linux", () => {
    setPlatform("linux");
    process.env.XDG_CONFIG_HOME = path.join("/tmp", "xdg");
    expect(defaultDesktopUserDataDir()).toBe(path.join("/tmp", "xdg", PRODUCT));
  });

  it("falls back to ~/.config on linux without XDG_CONFIG_HOME", () => {
    setPlatform("linux");
    delete process.env.XDG_CONFIG_HOME;
    expect(defaultDesktopUserDataDir()).toBe(
      path.join(os.homedir(), ".config", PRODUCT),
    );
  });
});

describe("project-runtime — defaultProjectDbPath", () => {
  it("is <userDataDir>/data/chainlesschain.db", () => {
    const p = defaultProjectDbPath();
    expect(path.basename(p)).toBe("chainlesschain.db");
    expect(path.basename(path.dirname(p))).toBe("data");
    expect(path.dirname(path.dirname(p))).toBe(defaultDesktopUserDataDir());
  });
});

describe("project-runtime — newProjectId", () => {
  it("returns a UUID v4", () => {
    expect(newProjectId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns a fresh id each call", () => {
    expect(newProjectId()).not.toBe(newProjectId());
  });
});

describe("project-runtime — openProjectsDb", () => {
  it("rejects with DB_NOT_FOUND when the db file is missing", async () => {
    const missing = path.join(os.tmpdir(), "cc-nope-does-not-exist-123.db");
    await expect(openProjectsDb(missing)).rejects.toMatchObject({
      code: "DB_NOT_FOUND",
    });
  });
});

describe("project-runtime — valid value tables", () => {
  it("lists the known project types", () => {
    expect(VALID_PROJECT_TYPES).toContain("web");
    expect(VALID_PROJECT_TYPES).toContain("knowledge");
    expect(VALID_PROJECT_TYPES).toHaveLength(10);
  });

  it("lists the known project statuses", () => {
    expect(VALID_PROJECT_STATUSES).toEqual([
      "draft",
      "active",
      "completed",
      "archived",
    ]);
  });
});
