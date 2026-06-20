/**
 * VS Code extension CLI-binary resolution: tolerate a `cc` shadowed by the C
 * compiler (also named `cc`) by falling back to chainlesschain / clc / clchain,
 * and distinguish a bare chainlesschain version from a compiler banner.
 */
import { describe, it, expect } from "vitest";
import {
  looksLikeCcVersion,
  resolveCliBinary,
  setResolvedCli,
  getResolvedCli,
} from "../../../vscode-extension/src/cli-binary.js";

describe("looksLikeCcVersion", () => {
  it("accepts a bare chainlesschain version, rejects compiler banners", () => {
    expect(looksLikeCcVersion("0.162.95")).toBe(true);
    expect(looksLikeCcVersion("0.162.95\n")).toBe(true);
    expect(looksLikeCcVersion("v1.2.3")).toBe(true);
    expect(looksLikeCcVersion("cc (GCC) 12.2.0")).toBe(false);
    expect(looksLikeCcVersion("Apple clang version 15.0.0")).toBe(false);
    expect(looksLikeCcVersion("Microsoft Windows [Version 10.0.19045]")).toBe(false);
    expect(looksLikeCcVersion("")).toBe(false);
    expect(looksLikeCcVersion(null)).toBe(false);
    expect(looksLikeCcVersion("not a version")).toBe(false);
  });
});

describe("resolveCliBinary", () => {
  it("an explicit non-cc configured path wins (no probing)", async () => {
    let probed = 0;
    const bin = await resolveCliBinary({
      configuredPath: "/opt/cc/chainlesschain",
      getVersionOf: () => {
        probed++;
        return Promise.resolve("0.162.95");
      },
    });
    expect(bin).toBe("/opt/cc/chainlesschain");
    expect(probed).toBe(0);
  });

  it("picks the first candidate that answers as chainlesschain", async () => {
    const versions = { cc: "cc (GCC) 12.2.0", chainlesschain: "0.162.95" };
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: (b) => Promise.resolve(versions[b] || null),
    });
    expect(bin).toBe("chainlesschain"); // cc is the compiler → skip to chainlesschain
  });

  it("uses cc when cc itself is chainlesschain", async () => {
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: (b) => Promise.resolve(b === "cc" ? "0.162.95" : null),
    });
    expect(bin).toBe("cc");
  });

  it("falls back to cc when nothing resolves (spawn surfaces the error)", async () => {
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: () => Promise.resolve(null),
    });
    expect(bin).toBe("cc");
  });

  it("survives a throwing probe", async () => {
    const bin = await resolveCliBinary({
      configuredPath: "cc",
      getVersionOf: (b) => {
        if (b === "cc") return Promise.reject(new Error("ENOENT"));
        return Promise.resolve(b === "clc" ? "0.162.95" : null);
      },
    });
    expect(bin).toBe("clc");
  });
});

describe("resolved-cli cache", () => {
  it("get returns cc until set, then the set value", () => {
    setResolvedCli("chainlesschain");
    expect(getResolvedCli()).toBe("chainlesschain");
    setResolvedCli(""); // ignored (keeps prior)
    expect(getResolvedCli()).toBe("chainlesschain");
    setResolvedCli("cc"); // restore default for other tests' isolation
    expect(getResolvedCli()).toBe("cc");
  });
});
