import { describe, it, expect } from "vitest";
import {
  buildDefaultServerConfig,
  getSecurityColor,
  getSecurityLabel,
} from "@renderer/components/mcpSettingsUtils";

describe("mcpSettingsUtils", () => {
  describe("buildDefaultServerConfig", () => {
    it("applies the shared base config to every server", () => {
      const cfg = buildDefaultServerConfig("filesystem");
      expect(cfg.enabled).toBe(false);
      expect(cfg.autoConnect).toBe(false);
      expect(cfg.transport).toBe("stdio");
      expect(cfg.command).toBe("npx");
    });

    it("filesystem: derives paths from userDataPath and normalizes backslashes", () => {
      const cfg = buildDefaultServerConfig("filesystem", {
        userDataPath: "C:\\Users\\me\\AppData",
      });
      expect(cfg.rootPath).toBe("C:/Users/me/AppData/data");
      expect(cfg.args).toEqual([
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:/Users/me/AppData/data",
      ]);
      expect(cfg.permissions.allowedPaths).toContain("notes/");
      expect(cfg.permissions.forbiddenPaths).toContain("chainlesschain.db");
      expect(cfg.permissions.maxFileSizeMB).toBe(100);
    });

    it("filesystem: falls back to '.' when userDataPath is empty", () => {
      const cfg = buildDefaultServerConfig("filesystem");
      expect(cfg.args[2]).toBe(".");
      expect(cfg.rootPath).toBe("");
    });

    it("sqlite: points databasePath at the derived db file", () => {
      const cfg = buildDefaultServerConfig("sqlite", {
        userDataPath: "/home/u",
      });
      expect(cfg.databasePath).toBe("/home/u/data/chainlesschain.db");
      expect(cfg.args).toContain("@modelcontextprotocol/server-sqlite");
      expect(cfg.permissions.readOnly).toBe(true);
    });

    it("git: uses projectPath for the repository path", () => {
      const cfg = buildDefaultServerConfig("git", {
        projectPath: "/repo/x",
      });
      expect(cfg.repositoryPath).toBe("/repo/x");
      expect(cfg.repositoryPath).not.toBe("");
    });

    it("unknown server: produces the generic npx template", () => {
      const cfg = buildDefaultServerConfig("weather");
      expect(cfg.args).toEqual(["-y", "@modelcontextprotocol/server-weather"]);
    });
  });

  describe("getSecurityColor / getSecurityLabel", () => {
    it("maps known levels", () => {
      expect(getSecurityColor("low")).toBe("green");
      expect(getSecurityColor("medium")).toBe("orange");
      expect(getSecurityColor("high")).toBe("red");
      expect(getSecurityLabel("low")).toBe("低");
      expect(getSecurityLabel("high")).toBe("高");
    });
    it("falls back for unknown levels", () => {
      expect(getSecurityColor("weird")).toBe("default");
      expect(getSecurityLabel("weird")).toBe("weird");
    });
  });
});
