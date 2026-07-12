/**
 * Plugin capability-consent ENFORCEMENT at the load-path chokepoint.
 * `capabilityConsentRequired` decides whether to gate; `filterByCapabilityConsent`
 * drops a plugin that declared capabilities but was never consented (opt-in;
 * legacy no-declaration plugins are unaffected; default byte-identical).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  capabilityConsentRequired,
  filterByCapabilityConsent,
} from "../../src/lib/plugin-runtime/policy.js";
import { _deps as consentDeps } from "../../src/lib/plugin-runtime/capability-consent.js";
import { normalizeCapabilities } from "../../src/lib/plugin-runtime/capabilities.js";

const DECLARED = normalizeCapabilities({ network: ["api.example.com"] });

let store;
beforeEach(() => {
  store = {};
  consentDeps.existsSync = () => true;
  consentDeps.readFileSync = () => JSON.stringify(store);
  consentDeps.storePath = () => "/virtual/consent.json";
});

function plugin(
  name,
  { declared = true, caps = DECLARED, scope = "project" } = {},
) {
  return {
    name,
    scope,
    manifest: { capabilitiesDeclared: declared, capabilities: caps },
  };
}

function grant(name, scope, caps) {
  store[`${scope}:${name}`] = { version: "1.0.0", capabilities: caps };
}

describe("capabilityConsentRequired", () => {
  it("is off by default (byte-identical)", () => {
    expect(capabilityConsentRequired(null, {})).toBe(false);
    expect(capabilityConsentRequired({}, {})).toBe(false);
  });

  it("turns on via the env opt-in", () => {
    expect(
      capabilityConsentRequired(null, { CC_REQUIRE_PLUGIN_CONSENT: "1" }),
    ).toBe(true);
    expect(
      capabilityConsentRequired(null, { CC_REQUIRE_PLUGIN_CONSENT: "true" }),
    ).toBe(true);
    expect(
      capabilityConsentRequired(null, { CC_REQUIRE_PLUGIN_CONSENT: "0" }),
    ).toBe(false);
  });

  it("turns on via managed settings (true or 'require')", () => {
    expect(
      capabilityConsentRequired({ requirePluginCapabilityConsent: true }, {}),
    ).toBe(true);
    expect(
      capabilityConsentRequired(
        { requirePluginCapabilityConsent: "require" },
        {},
      ),
    ).toBe(true);
  });
});

describe("filterByCapabilityConsent", () => {
  it("keeps a legacy plugin that declares no permissions block", () => {
    const { kept, dropped } = filterByCapabilityConsent([
      plugin("legacy", { declared: false }),
    ]);
    expect(kept.map((p) => p.name)).toEqual(["legacy"]);
    expect(dropped).toEqual([]);
  });

  it("drops a declared-but-unconsented plugin and keeps a consented one", () => {
    grant("blessed", "project", DECLARED);
    const { kept, dropped } = filterByCapabilityConsent([
      plugin("blessed"),
      plugin("stranger"),
    ]);
    expect(kept.map((p) => p.name)).toEqual(["blessed"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].name).toBe("stranger");
    expect(dropped[0].reason).toMatch(/consent .*--grant/);
  });

  it("re-drops after a capability WIDENING (consent covers only the old set)", () => {
    grant("widener", "project", normalizeCapabilities({})); // consented to nothing
    const { kept, dropped } = filterByCapabilityConsent([
      plugin("widener", { caps: DECLARED }), // now wants network
    ]);
    expect(kept).toEqual([]);
    expect(dropped[0].name).toBe("widener");
  });

  it("keeps a plugin that declares an EMPTY (all-deny) capability set", () => {
    const { kept } = filterByCapabilityConsent([
      plugin("harmless", { caps: normalizeCapabilities({}) }),
    ]);
    expect(kept.map((p) => p.name)).toEqual(["harmless"]);
  });

  it("consent is scoped — a user-scope grant does not consent the project copy", () => {
    grant("dual", "user", DECLARED);
    const { kept, dropped } = filterByCapabilityConsent([
      plugin("dual", { scope: "project" }),
    ]);
    expect(kept).toEqual([]);
    expect(dropped[0].name).toBe("dual");
  });

  it("fails closed when the consent lookup throws", () => {
    consentDeps.readFileSync = () => {
      throw new Error("io error");
    };
    // loadConsentStore swallows the read error → {} → no entry → not consented.
    const { kept, dropped } = filterByCapabilityConsent([plugin("x")]);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});
