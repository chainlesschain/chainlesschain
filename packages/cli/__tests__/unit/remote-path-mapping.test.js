/**
 * Remote URI ↔ path mapping (src/lib/remote-path-mapping.js): fold an IDE's
 * foreign file representation (file://, vscode-remote://wsl|ssh|dev-container,
 * \\wsl.localhost\… UNC, C:\ under WSL) into the path cc can open on THIS host,
 * and back. Pure string transforms; spaces + 中文 round-trip losslessly.
 */
import { describe, it, expect } from "vitest";
import {
  looksLikeUri,
  looksLikeWindowsPath,
  parseRemoteUri,
  wslUncToPosix,
  posixToWslUnc,
  winDriveToWslMount,
  wslMountToWinDrive,
  detectWsl,
  normalizeIdePathForCli,
  cliPathToIdeUri,
} from "../../src/lib/remote-path-mapping.js";

const WIN = { platform: "win32" };
const WSL = { platform: "linux", wsl: { isWsl: true, distro: "Ubuntu" } };
const LINUX = { platform: "linux", wsl: { isWsl: false } };

describe("predicates", () => {
  it("recognizes URIs and Windows paths", () => {
    expect(looksLikeUri("file:///home/u/x")).toBe(true);
    expect(looksLikeUri("vscode-remote://wsl+Ubuntu/home/u")).toBe(true);
    expect(looksLikeUri("/home/u/x")).toBe(false);
    expect(looksLikeWindowsPath("C:\\code\\x")).toBe(true);
    expect(looksLikeWindowsPath("c:/code/x")).toBe(true);
    expect(looksLikeWindowsPath("/mnt/c/code")).toBe(false);
  });
});

describe("parseRemoteUri", () => {
  it("file:// POSIX path", () => {
    expect(parseRemoteUri("file:///home/u/x.ts")).toMatchObject({
      scheme: "file",
      remoteKind: null,
      fsPath: "/home/u/x.ts",
    });
  });

  it("file:// Windows drive path", () => {
    expect(parseRemoteUri("file:///c:/code/x.ts").fsPath).toBe(
      "c:\\code\\x.ts",
    );
  });

  it("decodes spaces and 中文 in the path", () => {
    expect(
      parseRemoteUri("file:///home/u/my%20proj/%E6%96%87%E4%BB%B6.ts").fsPath,
    ).toBe("/home/u/my proj/文件.ts");
  });

  it("file://server/share → UNC", () => {
    expect(parseRemoteUri("file://server/share/x").fsPath).toBe(
      "\\\\server\\share\\x",
    );
  });

  it("vscode-remote wsl / ssh / dev-container authorities", () => {
    expect(parseRemoteUri("vscode-remote://wsl+Ubuntu/home/u/x")).toMatchObject(
      {
        remoteKind: "wsl",
        remoteParam: "Ubuntu",
        fsPath: "/home/u/x",
      },
    );
    expect(
      parseRemoteUri("vscode-remote://ssh-remote+myhost/srv/app"),
    ).toMatchObject({ remoteKind: "ssh-remote", remoteParam: "myhost" });
    expect(
      parseRemoteUri("vscode-remote://dev-container+abc123/workspaces/p"),
    ).toMatchObject({ remoteKind: "dev-container", fsPath: "/workspaces/p" });
  });

  it("tolerates a percent-encoded + in the authority", () => {
    expect(
      parseRemoteUri("vscode-remote://wsl%2BUbuntu-22.04/home/u/x"),
    ).toMatchObject({ remoteKind: "wsl", remoteParam: "Ubuntu-22.04" });
  });

  it("returns null for a non-URI or unknown scheme", () => {
    expect(parseRemoteUri("/home/u/x")).toBeNull();
    expect(parseRemoteUri("C:\\code\\x")).toBeNull();
    expect(parseRemoteUri("https://example.com/x")).toBeNull();
  });
});

describe("WSL UNC / mount transforms", () => {
  it("wslUncToPosix accepts wsl.localhost, wsl$, and forward slashes", () => {
    expect(wslUncToPosix("\\\\wsl.localhost\\Ubuntu\\home\\u\\x")).toEqual({
      distro: "Ubuntu",
      posix: "/home/u/x",
    });
    expect(wslUncToPosix("\\\\wsl$\\Debian\\srv\\app")).toEqual({
      distro: "Debian",
      posix: "/srv/app",
    });
    expect(wslUncToPosix("//wsl.localhost/Ubuntu/home/u")).toEqual({
      distro: "Ubuntu",
      posix: "/home/u",
    });
    expect(wslUncToPosix("\\\\server\\share\\x")).toBeNull();
  });

  it("posixToWslUnc round-trips with wslUncToPosix", () => {
    const unc = posixToWslUnc("/home/u/my proj", "Ubuntu");
    expect(unc).toBe("\\\\wsl.localhost\\Ubuntu\\home\\u\\my proj");
    expect(wslUncToPosix(unc)).toEqual({
      distro: "Ubuntu",
      posix: "/home/u/my proj",
    });
  });

  it("drive ↔ /mnt round-trip", () => {
    expect(winDriveToWslMount("C:\\code\\my proj")).toBe("/mnt/c/code/my proj");
    expect(wslMountToWinDrive("/mnt/c/code/my proj")).toBe("C:\\code\\my proj");
    expect(winDriveToWslMount("/home/u")).toBeNull();
    expect(wslMountToWinDrive("/home/u")).toBeNull();
  });
});

describe("detectWsl", () => {
  it("reads WSL_DISTRO_NAME / WSL_INTEROP", () => {
    expect(detectWsl({ WSL_DISTRO_NAME: "Ubuntu" })).toEqual({
      isWsl: true,
      distro: "Ubuntu",
    });
    expect(detectWsl({ WSL_INTEROP: "/run/x" })).toMatchObject({ isWsl: true });
    expect(detectWsl({})).toEqual({ isWsl: false, distro: null });
  });
});

describe("normalizeIdePathForCli — CLI inside WSL / Linux (POSIX native)", () => {
  it("wsl-remote URI → POSIX path", () => {
    expect(
      normalizeIdePathForCli("vscode-remote://wsl+Ubuntu/home/u/x.ts", WSL),
    ).toBe("/home/u/x.ts");
  });

  it("wsl.localhost UNC → POSIX path", () => {
    expect(
      normalizeIdePathForCli("\\\\wsl.localhost\\Ubuntu\\home\\u\\x", WSL),
    ).toBe("/home/u/x");
  });

  it("Windows drive path (under WSL) → /mnt/<drive>", () => {
    expect(normalizeIdePathForCli("C:\\code\\proj\\x.ts", WSL)).toBe(
      "/mnt/c/code/proj/x.ts",
    );
  });

  it("a native POSIX path passes through unchanged", () => {
    expect(normalizeIdePathForCli("/home/u/x.ts", WSL)).toBe("/home/u/x.ts");
    expect(normalizeIdePathForCli("/home/u/x.ts", LINUX)).toBe("/home/u/x.ts");
  });

  it("file:// POSIX URI with spaces + 中文 → decoded POSIX path", () => {
    expect(
      normalizeIdePathForCli("file:///home/u/my%20proj/%E6%96%87.ts", WSL),
    ).toBe("/home/u/my proj/文.ts");
  });

  it("a plain Windows drive path is NOT rewritten when not in WSL", () => {
    // Linux host that isn't WSL can't reach C:\ — leave it (nothing better).
    expect(normalizeIdePathForCli("C:\\code\\x", LINUX)).toBe("C:\\code\\x");
  });
});

describe("normalizeIdePathForCli — CLI on Windows (Windows native)", () => {
  it("wsl-remote URI → \\\\wsl.localhost UNC the Windows host can open", () => {
    expect(
      normalizeIdePathForCli("vscode-remote://wsl+Ubuntu/home/u/x", WIN),
    ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\u\\x");
  });

  it("file:// drive URI → native drive path", () => {
    expect(normalizeIdePathForCli("file:///c:/code/x.ts", WIN)).toBe(
      "c:\\code\\x.ts",
    );
  });

  it("a native Windows path passes through unchanged", () => {
    expect(normalizeIdePathForCli("C:\\code\\x", WIN)).toBe("C:\\code\\x");
  });
});

describe("normalizeIdePathForCli — safety", () => {
  it("unknown scheme / non-string / empty are left untouched", () => {
    expect(normalizeIdePathForCli("https://example.com/x", WSL)).toBe(
      "https://example.com/x",
    );
    expect(normalizeIdePathForCli("", WSL)).toBe("");
    expect(normalizeIdePathForCli(null, WSL)).toBe(null);
    expect(normalizeIdePathForCli(undefined, WSL)).toBe(undefined);
  });

  it("multi-root: each path maps independently of the others", () => {
    expect(
      normalizeIdePathForCli("vscode-remote://wsl+Ubuntu/repo-a/x", WSL),
    ).toBe("/repo-a/x");
    expect(
      normalizeIdePathForCli("vscode-remote://wsl+Ubuntu/srv/repo-b/y", WSL),
    ).toBe("/srv/repo-b/y");
  });

  it("a symlinked path is preserved as-is (fs-level resolution is out of scope)", () => {
    // Mapping is lexical: a symlink path maps like any path, losslessly.
    expect(
      normalizeIdePathForCli("vscode-remote://wsl+Ubuntu/home/u/link/x", WSL),
    ).toBe("/home/u/link/x");
  });
});

describe("cliPathToIdeUri", () => {
  it("POSIX path → file:// URI, encoding spaces + 中文", () => {
    expect(cliPathToIdeUri("/home/u/my proj/文.ts")).toBe(
      "file:///home/u/my%20proj/%E6%96%87.ts",
    );
  });

  it("Windows drive path → file:///c:/… (drive segment left literal)", () => {
    expect(cliPathToIdeUri("C:\\code\\my proj\\x.ts")).toBe(
      "file:///C:/code/my%20proj/x.ts",
    );
  });

  it("with a remoteAuthority → vscode-remote URI", () => {
    expect(
      cliPathToIdeUri("/home/u/x", { remoteAuthority: "wsl+Ubuntu" }),
    ).toBe("vscode-remote://wsl+Ubuntu/home/u/x");
  });

  it("round-trips through normalizeIdePathForCli (POSIX under WSL)", () => {
    const uri = cliPathToIdeUri("/home/u/my proj/文.ts", {
      remoteAuthority: "wsl+Ubuntu",
    });
    expect(normalizeIdePathForCli(uri, WSL)).toBe("/home/u/my proj/文.ts");
  });
});
