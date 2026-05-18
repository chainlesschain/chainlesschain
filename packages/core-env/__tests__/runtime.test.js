import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isElectron,
  isCLI,
  isTest,
  getRuntimeInfo,
  _resetRuntimeCache,
} from "../lib/runtime.js";

describe("core-env/runtime", () => {
  beforeEach(() => {
    _resetRuntimeCache();
  });

  afterEach(() => {
    _resetRuntimeCache();
  });

  describe("isElectron", () => {
    it("returns false in Node.js environment", () => {
      expect(isElectron()).toBe(false);
    });
  });

  describe("isCLI", () => {
    it("returns true in Node.js environment", () => {
      expect(isCLI()).toBe(true);
    });
  });

  describe("isTest", () => {
    it("returns true in Vitest environment", () => {
      expect(isTest()).toBe(true);
    });
  });

  describe("getRuntimeInfo", () => {
    it("returns correct runtime info for Node.js test", () => {
      const info = getRuntimeInfo();
      expect(info.runtime).toBe("node");
      expect(info.env).toBe("test");
      expect(info.platform).toBe(process.platform);
    });

    it("caches the result", () => {
      const info1 = getRuntimeInfo();
      const info2 = getRuntimeInfo();
      expect(info1).toBe(info2); // Same reference
    });
  });
});
