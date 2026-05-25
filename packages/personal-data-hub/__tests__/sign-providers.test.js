"use strict";

/**
 * Phase 6a — SignProvider abstract + NullSignProvider unit cover.
 */

import { describe, it, expect } from "vitest";

const {
  SignProvider,
  NullSignProvider,
  NULL_SIGN_PROVIDER,
} = require("../lib/sign-providers");

describe("SignProvider abstract base", () => {
  it("signUrl returns null by default", async () => {
    const p = new SignProvider();
    expect(await p.signUrl("https://example.com", "purpose")).toBe(null);
  });

  it("signedHeaders returns {} by default", async () => {
    const p = new SignProvider();
    const r = await p.signedHeaders("https://example.com", "purpose");
    expect(r).toEqual({});
  });

  it("shutdown is no-op (no throw)", async () => {
    const p = new SignProvider();
    await expect(p.shutdown()).resolves.toBeUndefined();
  });
});

describe("NullSignProvider", () => {
  it("extends SignProvider", () => {
    const p = new NullSignProvider();
    expect(p).toBeInstanceOf(SignProvider);
  });

  it("inherits stub signUrl / signedHeaders / shutdown", async () => {
    const p = new NullSignProvider();
    expect(await p.signUrl("x", "y")).toBe(null);
    expect(await p.signedHeaders("x", "y")).toEqual({});
    await expect(p.shutdown()).resolves.toBeUndefined();
  });

  it("NULL_SIGN_PROVIDER is a frozen singleton", () => {
    expect(NULL_SIGN_PROVIDER).toBeInstanceOf(NullSignProvider);
    expect(Object.isFrozen(NULL_SIGN_PROVIDER)).toBe(true);
  });

  it("api-client pattern: call signUrl + signedHeaders without crash", async () => {
    // Simulates api-client usage — signProvider.signUrl(url, purpose) ||
    // fall back to unsigned URL; spread signedHeaders into request headers.
    const provider = NULL_SIGN_PROVIDER;
    const url = "https://api.example.com/x";
    const signedUrl = (await provider.signUrl(url, "test")) || url;
    expect(signedUrl).toBe(url); // null → fall back to original
    const extraHeaders = await provider.signedHeaders(url, "test");
    const finalHeaders = { Cookie: "x=y", ...extraHeaders };
    expect(finalHeaders).toEqual({ Cookie: "x=y" }); // no extras from null provider
  });
});
