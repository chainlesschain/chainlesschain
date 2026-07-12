/**
 * plugin-runtime capability consent — pins the capability SET a plugin may
 * request (distinct from version trust). Verifies the pure consent-status logic
 * (empty / never / widened / covered / narrowed) and the injected store
 * round-trip (grant → isConsented → widen revokes → revoke → list).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  capabilitiesAreEmpty,
  capabilityConsentStatus,
  isPluginCapabilityConsented,
  consentPluginCapabilities,
  revokeCapabilityConsent,
  listCapabilityConsent,
  _deps,
} from "../../src/lib/plugin-runtime/capability-consent.js";

let dir, store, origStorePath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-capconsent-"));
  store = path.join(dir, "consent.json");
  origStorePath = _deps.storePath;
  _deps.storePath = () => store;
});

afterEach(() => {
  _deps.storePath = origStorePath;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

describe("capabilitiesAreEmpty", () => {
  it("is true for an all-deny set, false once anything is granted", () => {
    expect(capabilitiesAreEmpty(null)).toBe(true);
    expect(capabilitiesAreEmpty({})).toBe(true);
    expect(capabilitiesAreEmpty({ process: true })).toBe(false);
    expect(capabilitiesAreEmpty({ network: ["api.x.com"] })).toBe(false);
  });
});

describe("capabilityConsentStatus (pure)", () => {
  it("needs no consent when nothing is declared", () => {
    expect(capabilityConsentStatus({}, null)).toMatchObject({
      consented: true,
    });
  });

  it("is unconsented with the added tokens when there is no entry", () => {
    const s = capabilityConsentStatus({ process: true, network: "*" }, null);
    expect(s.consented).toBe(false);
    expect(s.added).toEqual(expect.arrayContaining(["process", "network:*"]));
  });

  it("is consented when the entry covers the declared set exactly", () => {
    const entry = { version: "1.0.0", capabilities: { process: true } };
    expect(capabilityConsentStatus({ process: true }, entry).consented).toBe(
      true,
    );
  });

  it("re-prompts (widened) when the declared set adds a grant", () => {
    const entry = { version: "1.0.0", capabilities: { process: true } };
    const s = capabilityConsentStatus(
      { process: true, credential: ["GH_TOKEN"] },
      entry,
    );
    expect(s.consented).toBe(false);
    expect(s.added).toEqual(["credential:GH_TOKEN"]);
  });

  it("stays consented when the declared set NARROWS", () => {
    const entry = {
      version: "1.0.0",
      capabilities: { process: true, network: "*" },
    };
    expect(capabilityConsentStatus({ process: true }, entry).consented).toBe(
      true,
    );
  });

  it("does not re-prompt on a version bump alone (trust handles versions)", () => {
    const entry = { version: "1.0.0", capabilities: { process: true } };
    // Declared caps identical, only the plugin version differs → still consented.
    expect(capabilityConsentStatus({ process: true }, entry).consented).toBe(
      true,
    );
  });
});

describe("consent store round-trip", () => {
  const plugin = { name: "greeter", scope: "project", version: "1.0.0" };

  it("grant → isConsented, widening revokes, revoke clears", () => {
    expect(isPluginCapabilityConsented(plugin, { process: true })).toBe(false);

    consentPluginCapabilities("greeter", {
      scope: "project",
      version: "1.0.0",
      capabilities: { process: true },
    });
    expect(isPluginCapabilityConsented(plugin, { process: true })).toBe(true);

    // A newer version that WIDENS capabilities is no longer consented.
    expect(
      isPluginCapabilityConsented(plugin, { process: true, network: "*" }),
    ).toBe(false);
    // …but the same-or-narrower set stays consented across versions.
    expect(
      isPluginCapabilityConsented(
        { ...plugin, version: "2.0.0" },
        { process: true },
      ),
    ).toBe(true);

    const res = revokeCapabilityConsent("greeter", { scope: "project" });
    expect(res.removed).toBe(true);
    expect(isPluginCapabilityConsented(plugin, { process: true })).toBe(false);
  });

  it("lists consent entries with human-readable capabilities", () => {
    consentPluginCapabilities("net-plugin", {
      scope: "user",
      version: "3.1.0",
      capabilities: { network: ["api.example.com"], mcp: true },
    });
    const rows = listCapabilityConsent();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "net-plugin",
      scope: "user",
      version: "3.1.0",
    });
    expect(rows[0].capabilities.join(" ")).toMatch(/api\.example\.com/);
    expect(rows[0].capabilities.join(" ")).toMatch(/mcp/);
  });

  it("rejects consent without a version", () => {
    expect(() => consentPluginCapabilities("x", { scope: "project" })).toThrow(
      /version/,
    );
  });
});
