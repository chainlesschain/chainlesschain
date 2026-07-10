/**
 * Chrome connector (browse chrome) — pure layers with injected deps. The
 * attach/capture path is covered by the live e2e (playwright chromium with
 * --remote-debugging-port); these tests pin the discovery, launch-argv and
 * executable-resolution contracts.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CDP_PORT,
  buildChromeLaunchArgs,
  chromeCandidates,
  connectorProfileDir,
  discoverCdp,
  findChromeExecutable,
  launchChrome,
} from "../../src/lib/chrome-connector.js";

function fakeDeps({
  platform = "win32",
  env = {},
  existing = [],
  spawnImpl,
} = {}) {
  return {
    fs: { existsSync: (p) => existing.includes(p) },
    spawn: spawnImpl || (() => ({ unref: () => {}, pid: 4242 })),
    homedir: () => "C:/Users/u",
    platform: () => platform,
    env: () => env,
    httpGet: async () => ({ status: 0, body: "" }),
    importPlaywright: async () => {
      throw new Error("not in this test");
    },
  };
}

describe("discoverCdp", () => {
  it("reports a listening debuggable Chrome", async () => {
    const deps = fakeDeps();
    deps.httpGet = async (url) => {
      expect(url).toBe("http://127.0.0.1:9222/json/version");
      return {
        status: 200,
        body: JSON.stringify({
          Browser: "Chrome/145.0",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x",
        }),
      };
    };
    expect(await discoverCdp({ deps })).toEqual({
      ok: true,
      port: DEFAULT_CDP_PORT,
      browser: "Chrome/145.0",
      wsUrl: "ws://127.0.0.1:9222/devtools/browser/x",
    });
  });

  it("is ok:false on connection failure or garbage", async () => {
    expect((await discoverCdp({ deps: fakeDeps() })).ok).toBe(false);
    const deps = fakeDeps();
    deps.httpGet = async () => ({ status: 200, body: "not json" });
    expect((await discoverCdp({ deps })).ok).toBe(false);
  });
});

describe("launch argv + executable resolution", () => {
  it("uses the dedicated connector profile by default", () => {
    const deps = fakeDeps();
    const args = buildChromeLaunchArgs({ port: 9300, url: "http://x", deps });
    expect(args).toContain("--remote-debugging-port=9300");
    expect(args).toContain(`--user-data-dir=${connectorProfileDir({ deps })}`);
    expect(args[args.length - 1]).toBe("http://x");
  });

  it("refuses a launch URL Chrome would parse as a switch (argv injection)", () => {
    const deps = fakeDeps();
    expect(() =>
      buildChromeLaunchArgs({ url: "--renderer-cmd-prefix=calc.exe", deps }),
    ).toThrow(/Invalid launch URL/);
    expect(() =>
      buildChromeLaunchArgs({ url: "javascript:alert(1)", deps }),
    ).toThrow(/must be http\(s\):\/\/ or about:/);
    expect(() =>
      buildChromeLaunchArgs({ url: "file:///etc/passwd", deps }),
    ).toThrow(/must be http\(s\):\/\/ or about:/);
  });

  it("refuses a non-numeric or out-of-range CDP port", () => {
    const deps = fakeDeps();
    expect(() => buildChromeLaunchArgs({ port: "9222 --evil", deps })).toThrow(
      /Invalid CDP port/,
    );
    expect(() => buildChromeLaunchArgs({ port: 0, deps })).toThrow(
      /Invalid CDP port/,
    );
    expect(() => buildChromeLaunchArgs({ port: 70000, deps })).toThrow(
      /Invalid CDP port/,
    );
  });

  it("drops --user-data-dir only when the REAL profile is opted into", () => {
    const args = buildChromeLaunchArgs({
      defaultProfile: true,
      deps: fakeDeps(),
    });
    expect(args.some((a) => a.startsWith("--user-data-dir="))).toBe(false);
  });

  it("resolves CHROME_PATH first, then well-known install paths", () => {
    const winChrome =
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const deps = fakeDeps({
      env: { PROGRAMFILES: "C:\\Program Files" },
      existing: [winChrome],
    });
    expect(findChromeExecutable({ deps })).toBe(winChrome);

    const custom = fakeDeps({
      env: { CHROME_PATH: "D:/custom/chrome.exe" },
      existing: ["D:/custom/chrome.exe"],
    });
    expect(findChromeExecutable({ deps: custom })).toBe("D:/custom/chrome.exe");
    expect(chromeCandidates({ deps: custom })[0]).toBe("D:/custom/chrome.exe");

    expect(findChromeExecutable({ deps: fakeDeps() })).toBeNull();
  });

  it("launchChrome spawns detached or explains what is missing", () => {
    let seen;
    const deps = fakeDeps({
      env: { CHROME_PATH: "D:/chrome.exe" },
      existing: ["D:/chrome.exe"],
      spawnImpl: (exe, args, opts) => {
        seen = { exe, args, opts };
        return { unref: () => {}, pid: 7 };
      },
    });
    const res = launchChrome({ port: 9400, deps });
    expect(res).toMatchObject({
      ok: true,
      executable: "D:/chrome.exe",
      pid: 7,
    });
    expect(seen.args).toContain("--remote-debugging-port=9400");
    expect(seen.opts.detached).toBe(true);

    const missing = launchChrome({ deps: fakeDeps() });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("CHROME_PATH");
  });
});
