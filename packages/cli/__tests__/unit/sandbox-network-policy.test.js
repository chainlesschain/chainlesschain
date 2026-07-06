import { describe, it, expect } from "vitest";
import {
  extractHost,
  matchesDomain,
  isPrivateHost,
  evaluateNetworkAccess,
} from "../../src/lib/sandbox-network-policy.js";

describe("extractHost", () => {
  it("pulls the host from URLs and bare host:port", () => {
    expect(extractHost("https://api.example.com/v1?x=1")).toBe(
      "api.example.com",
    );
    expect(extractHost("example.com:8080")).toBe("example.com");
    expect(extractHost("http://user:pass@Example.COM/")).toBe("example.com");
    expect(extractHost("  Example.com  ")).toBe("example.com");
  });

  it("normalizes IPv6 brackets (the SSRF gotcha)", () => {
    expect(extractHost("http://[::1]:9000/")).toBe("::1");
    expect(extractHost("[fe80::1]")).toBe("fe80::1");
  });

  it("strips the trailing DNS root dot (bypass gotcha)", () => {
    // "localhost." / "example.com." resolve to the same host but the extra dot
    // slips past the deny/allow matcher and the loopback guard.
    expect(extractHost("http://example.com./path")).toBe("example.com");
    expect(extractHost("localhost.")).toBe("localhost");
    expect(extractHost("http://SUB.Example.COM.")).toBe("sub.example.com");
  });

  it("returns null for empty/garbage", () => {
    expect(extractHost("")).toBe(null);
    expect(extractHost(null)).toBe(null);
  });
});

describe("matchesDomain", () => {
  it("matches exact, wildcard-subdomain (incl apex), and *", () => {
    expect(matchesDomain("example.com", "example.com")).toBe(true);
    expect(matchesDomain("api.example.com", "*.example.com")).toBe(true);
    expect(matchesDomain("example.com", "*.example.com")).toBe(true); // apex
    expect(matchesDomain("a.b.example.com", "*.example.com")).toBe(true);
    expect(matchesDomain("evil.com", "*.example.com")).toBe(false);
    expect(matchesDomain("anything", "*")).toBe(true);
  });

  it("does not let a suffix trick match (notexample.com)", () => {
    expect(matchesDomain("notexample.com", "*.example.com")).toBe(false);
    expect(matchesDomain("example.com.evil.com", "example.com")).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("flags loopback / private / link-local / metadata", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.9.9",
      "169.254.1.1",
      "::1",
      "fe80::1",
      "169.254.169.254", // cloud metadata
      "::ffff:127.0.0.1", // IPv4-mapped loopback
    ]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });

  it("does not flag public hosts", () => {
    for (const h of ["example.com", "8.8.8.8", "172.32.0.1", "9.9.9.9"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it("flags IPv4-mapped IPv6 in COMPRESSED-HEX form (Node URL serialization)", () => {
    // "[::ffff:127.0.0.1]" parsed through a URL serializes to "::ffff:7f00:1",
    // never dotted — the dotted-only guard was dead code for URL/bracketed input,
    // an SSRF bypass reaching loopback, private ranges, AND cloud metadata.
    for (const h of [
      "::ffff:7f00:1", // 127.0.0.1
      "::ffff:a9fe:a9fe", // 169.254.169.254 (metadata)
      "::ffff:c0a8:101", // 192.168.1.1
      "::ffff:a00:5", // 10.0.0.5
      "::ffff:ac10:1", // 172.16.0.1
    ]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    // A public mapped address is still NOT private.
    expect(isPrivateHost("::ffff:808:808")).toBe(false); // 8.8.8.8
  });

  it("flags the FULL fe80::/10 link-local range, not just fe80:", () => {
    for (const h of ["fe80::1", "fe90::1", "fea0::1", "febf::1"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    // fec0::/10 is deprecated site-local, not link-local — must stay false.
    expect(isPrivateHost("fec0::1")).toBe(false);
  });
});

describe("evaluateNetworkAccess", () => {
  it("denies anything not on a present allowlist (default-deny)", () => {
    const policy = { allowedDomains: ["*.github.com", "registry.npmjs.org"] };
    expect(
      evaluateNetworkAccess("https://api.github.com/repos", policy).allowed,
    ).toBe(true);
    expect(
      evaluateNetworkAccess("https://registry.npmjs.org/x", policy).allowed,
    ).toBe(true);
    const blocked = evaluateNetworkAccess("https://evil.com/steal", policy);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/default-deny/);
  });

  it("lets deny override allow", () => {
    const policy = {
      allowedDomains: ["*"],
      deniedDomains: ["ads.example.com"],
    };
    expect(
      evaluateNetworkAccess("https://ads.example.com/x", policy).allowed,
    ).toBe(false);
    expect(
      evaluateNetworkAccess("https://ok.example.com/x", policy).allowed,
    ).toBe(true);
  });

  it("blocks private/loopback/metadata targets by default (SSRF guard)", () => {
    const policy = { allowedDomains: ["*"] };
    // Even with `*`, private targets are blocked unless explicitly listed.
    expect(
      evaluateNetworkAccess("http://169.254.169.254/latest/meta-data", policy)
        .allowed,
    ).toBe(false);
    expect(evaluateNetworkAccess("http://[::1]:9000/", policy).allowed).toBe(
      false,
    );
    expect(
      evaluateNetworkAccess("http://127.0.0.1:5432/", policy).allowed,
    ).toBe(false);
    // IPv4-mapped IPv6 bracketed URLs must NOT slip past — the metadata endpoint
    // and loopback via "[::ffff:...]" were both reachable before the fix.
    expect(
      evaluateNetworkAccess("http://[::ffff:169.254.169.254]/latest", policy)
        .allowed,
    ).toBe(false);
    expect(
      evaluateNetworkAccess("http://[::ffff:127.0.0.1]:5432/", policy).allowed,
    ).toBe(false);
  });

  it("a trailing-dot host cannot bypass the loopback or deny guard", () => {
    // SSRF guard: "localhost." must still be blocked (permissive policy).
    expect(evaluateNetworkAccess("http://localhost./", {}).allowed).toBe(false);
    expect(evaluateNetworkAccess("http://127.0.0.1./", {}).allowed).toBe(false);
    // Deny-list: appending a dot must not slip past a deniedDomains entry.
    expect(
      evaluateNetworkAccess("https://ads.example.com./x", {
        deniedDomains: ["ads.example.com"],
      }).allowed,
    ).toBe(false);
  });

  it("allows an explicitly-listed private host (dev use)", () => {
    const policy = { allowedDomains: ["localhost", "127.0.0.1"] };
    expect(
      evaluateNetworkAccess("http://localhost:3000/", policy).allowed,
    ).toBe(true);
    expect(
      evaluateNetworkAccess("http://127.0.0.1:8080/", policy).allowed,
    ).toBe(true);
  });

  it("allowPrivate opens the loopback guard", () => {
    expect(
      evaluateNetworkAccess("http://127.0.0.1/", { allowPrivate: true })
        .allowed,
    ).toBe(true);
  });

  it("is permissive with no allowlist, but still applies deny + private guard", () => {
    expect(evaluateNetworkAccess("https://example.com/", {}).allowed).toBe(
      true,
    );
    expect(
      evaluateNetworkAccess("https://x.com/", { deniedDomains: ["x.com"] })
        .allowed,
    ).toBe(false);
    expect(evaluateNetworkAccess("http://10.0.0.1/", {}).allowed).toBe(false);
  });

  it("rejects an unparseable target", () => {
    expect(evaluateNetworkAccess("", {}).allowed).toBe(false);
  });

  it("flags a SPECIFIC (non-`*`) allow so the egress proxy can exempt it from the rebinding re-check", () => {
    // Exact + subdomain allows are user-vetted names → `specific: true`.
    expect(
      evaluateNetworkAccess("https://api.internal/x", {
        allowedDomains: ["api.internal"],
      }).specific,
    ).toBe(true);
    expect(
      evaluateNetworkAccess("https://a.example.com/x", {
        allowedDomains: ["*.example.com"],
      }).specific,
    ).toBe(true);
    // A bare `*` or permissive allow is NOT specific → proxy still re-checks the
    // resolved IP for rebinding.
    expect(
      evaluateNetworkAccess("https://x.com/", { allowedDomains: ["*"] })
        .specific,
    ).toBeFalsy();
    expect(evaluateNetworkAccess("https://x.com/", {}).specific).toBeFalsy();
  });
});
