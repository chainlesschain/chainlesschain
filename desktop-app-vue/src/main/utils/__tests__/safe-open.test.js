/**
 * safe-open 单元测试 —— URL scheme 白名单 / 路径包含 / 目录校验。
 */

const path = require("path");
const {
  isSafeExternalUrl,
  safeOpenExternal,
  isPathWithin,
  safeOpenPathDir,
} = require("../safe-open.js");

describe("safe-open", () => {
  describe("isSafeExternalUrl", () => {
    test("放行 http / https", () => {
      expect(isSafeExternalUrl("http://example.com")).toBe(true);
      expect(isSafeExternalUrl("https://github.com/a/b#x")).toBe(true);
      expect(isSafeExternalUrl("https://localhost:3001")).toBe(true);
    });
    test("拒绝危险 scheme", () => {
      expect(isSafeExternalUrl("file:///c:/windows/system32/calc.exe")).toBe(
        false,
      );
      expect(isSafeExternalUrl("smb://attacker/malware.exe")).toBe(false);
      expect(isSafeExternalUrl("mailto:x@y.com")).toBe(false);
      expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeExternalUrl("vbscript:msgbox")).toBe(false);
    });
    test("拒绝非字符串 / 空 / 畸形", () => {
      expect(isSafeExternalUrl("")).toBe(false);
      expect(isSafeExternalUrl(null)).toBe(false);
      expect(isSafeExternalUrl(undefined)).toBe(false);
      expect(isSafeExternalUrl("not a url")).toBe(false);
      expect(isSafeExternalUrl(123)).toBe(false);
    });
  });

  describe("safeOpenExternal", () => {
    test("http(s) 调用注入的 opener", async () => {
      const calls = [];
      await safeOpenExternal("https://ok.com", {
        openExternal: (u) => {
          calls.push(u);
          return Promise.resolve();
        },
      });
      expect(calls).toEqual(["https://ok.com"]);
    });
    test("危险 scheme 抛错且不调用 opener", async () => {
      const calls = [];
      await expect(
        safeOpenExternal("file:///c:/evil.exe", {
          openExternal: (u) => {
            calls.push(u);
          },
        }),
      ).rejects.toThrow(/disallowed scheme/);
      expect(calls).toEqual([]);
    });
  });

  describe("isPathWithin", () => {
    const root = path.resolve("/projects/app");
    test("内部路径为真", () => {
      expect(isPathWithin(root, path.join(root, "src/index.js"))).toBe(true);
      expect(isPathWithin(root, root)).toBe(true);
      expect(isPathWithin(root, path.join(root, "a/b/c.txt"))).toBe(true);
    });
    test("`..` 逃逸为假", () => {
      expect(isPathWithin(root, path.join(root, "../../etc/passwd"))).toBe(
        false,
      );
      expect(isPathWithin(root, path.join(root, "..", "sibling"))).toBe(false);
    });
    test("无效输入为假", () => {
      expect(isPathWithin("", "/x")).toBe(false);
      expect(isPathWithin(root, "")).toBe(false);
      expect(isPathWithin(null, "/x")).toBe(false);
    });
  });

  describe("safeOpenPathDir", () => {
    const fakeFs = (kind) => ({
      statSync: (p) => {
        if (kind === "missing") {
          throw new Error("ENOENT");
        }
        return { isDirectory: () => kind === "dir" };
      },
    });
    test("目录 → 调用 opener", async () => {
      const calls = [];
      await safeOpenPathDir("/projects/app", {
        fs: fakeFs("dir"),
        openPath: (p) => {
          calls.push(p);
          return Promise.resolve();
        },
      });
      expect(calls).toEqual(["/projects/app"]);
    });
    test("文件 → 拒绝(不执行)", async () => {
      const calls = [];
      await expect(
        safeOpenPathDir("/x/evil.exe", {
          fs: fakeFs("file"),
          openPath: (p) => calls.push(p),
        }),
      ).rejects.toThrow(/non-directory/);
      expect(calls).toEqual([]);
    });
    test("不存在 → 拒绝", async () => {
      await expect(
        safeOpenPathDir("/nope", { fs: fakeFs("missing"), openPath: () => {} }),
      ).rejects.toThrow(/does not exist/);
    });
  });
});
