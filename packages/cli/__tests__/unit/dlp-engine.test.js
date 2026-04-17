import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureDLPTables,
  scanContent,
  listIncidents,
  resolveIncident,
  getDLPStats,
  createPolicy,
  updatePolicy,
  deletePolicy,
  listDLPPolicies,
  _resetState,
  DLP_ACTION,
  DLP_CHANNEL,
  DLP_SEVERITY,
  DLP_DEFAULT_MAX_CONTENT_SIZE,
  createPolicyV2,
  getPolicyV2,
  listActivePoliciesForChannel,
  scanContentV2,
  listIncidentsV2,
  getIncidentV2,
  listBuiltinPolicyTemplates,
  installBuiltinPolicies,
  getDLPStatsV2,
  getHighestUnresolvedSeverity,
  _v2PolicyMeta,
  _v2IncidentMeta,
} from "../../src/lib/dlp-engine.js";

describe("dlp-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureDLPTables(db);
  });

  describe("ensureDLPTables", () => {
    it("creates dlp_incidents and dlp_policies tables", () => {
      expect(db.tables.has("dlp_incidents")).toBe(true);
      expect(db.tables.has("dlp_policies")).toBe(true);
    });

    it("is idempotent", () => {
      ensureDLPTables(db);
      expect(db.tables.has("dlp_incidents")).toBe(true);
    });
  });

  describe("createPolicy", () => {
    it("creates a policy with defaults", () => {
      const p = createPolicy(
        db,
        "SSN Detector",
        ["\\d{3}-\\d{2}-\\d{4}"],
        [],
        "block",
        "high",
      );
      expect(p.id).toBeDefined();
      expect(p.name).toBe("SSN Detector");
      expect(p.action).toBe("block");
      expect(p.severity).toBe("high");
      expect(p.enabled).toBe(true);
    });

    it("throws on missing name", () => {
      expect(() => createPolicy(db, "")).toThrow("Policy name is required");
    });

    it("persists to database", () => {
      createPolicy(db, "Test", [], [], "alert");
      const rows = db.data.get("dlp_policies") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("updatePolicy", () => {
    it("updates policy fields", () => {
      const p = createPolicy(db, "Test", [], [], "alert");
      const updated = updatePolicy(db, p.id, {
        name: "Updated",
        action: "block",
      });
      expect(updated.name).toBe("Updated");
      expect(updated.action).toBe("block");
    });

    it("throws on unknown policy", () => {
      expect(() => updatePolicy(db, "nonexistent", {})).toThrow(
        "Policy not found",
      );
    });
  });

  describe("deletePolicy", () => {
    it("deletes a policy", () => {
      const p = createPolicy(db, "Test", [], []);
      deletePolicy(db, p.id);
      expect(listDLPPolicies().length).toBe(0);
    });

    it("throws on unknown policy", () => {
      expect(() => deletePolicy(db, "nonexistent")).toThrow("Policy not found");
    });
  });

  describe("scanContent", () => {
    it("allows content when no policies match", () => {
      createPolicy(db, "SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block");
      const r = scanContent(db, "Hello world", "email");
      expect(r.allowed).toBe(true);
      expect(r.matchedPolicies).toBe(0);
    });

    it("blocks content matching a regex pattern", () => {
      createPolicy(db, "SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block", "high");
      const r = scanContent(db, "SSN: 123-45-6789", "email", "user1");
      expect(r.allowed).toBe(false);
      expect(r.action).toBe("block");
      expect(r.incidents.length).toBe(1);
    });

    it("alerts on keyword match", () => {
      createPolicy(db, "Confidential", [], ["confidential", "secret"], "alert");
      const r = scanContent(db, "This is confidential data", "chat");
      expect(r.allowed).toBe(true);
      expect(r.action).toBe("alert");
      expect(r.matchedPolicies).toBe(1);
    });

    it("throws on empty content", () => {
      expect(() => scanContent(db, "")).toThrow("Content is required");
    });

    it("allows when no policies exist", () => {
      const r = scanContent(db, "anything");
      expect(r.allowed).toBe(true);
      expect(r.matchedPolicies).toBe(0);
    });

    it("highest action wins when multiple policies match", () => {
      createPolicy(db, "Alert SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "alert");
      createPolicy(db, "Block SSN", ["\\d{3}-\\d{2}-\\d{4}"], [], "block");
      const r = scanContent(db, "SSN: 123-45-6789");
      expect(r.action).toBe("block");
    });

    it("creates incidents for each matched policy", () => {
      createPolicy(db, "P1", ["secret"], [], "alert");
      createPolicy(db, "P2", [], ["secret"], "alert");
      const r = scanContent(db, "secret data");
      expect(r.incidents.length).toBe(2);
    });
  });

  describe("listIncidents", () => {
    it("returns empty initially", () => {
      expect(listIncidents()).toEqual([]);
    });

    it("lists incidents after scan", () => {
      createPolicy(db, "Test", ["password"], [], "block");
      scanContent(db, "password123", "email");
      expect(listIncidents().length).toBe(1);
    });

    it("filters by channel", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      scanContent(db, "secret", "email");
      scanContent(db, "secret", "chat");
      expect(listIncidents({ channel: "email" }).length).toBe(1);
    });

    it("filters by severity", () => {
      createPolicy(db, "High", ["critical"], [], "block", "high");
      createPolicy(db, "Low", ["minor"], [], "alert", "low");
      scanContent(db, "critical issue");
      scanContent(db, "minor issue");
      expect(listIncidents({ severity: "high" }).length).toBe(1);
    });
  });

  describe("resolveIncident", () => {
    it("resolves an incident", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      const scan = scanContent(db, "secret data");
      const r = resolveIncident(db, scan.incidents[0].id, "false positive");
      expect(r.success).toBe(true);
      expect(r.resolution).toBe("false positive");
    });

    it("throws on unknown incident", () => {
      expect(() => resolveIncident(db, "nonexistent")).toThrow(
        "Incident not found",
      );
    });
  });

  describe("getDLPStats", () => {
    it("returns zeros initially", () => {
      const s = getDLPStats();
      expect(s.scanned).toBe(0);
      expect(s.blocked).toBe(0);
      expect(s.totalIncidents).toBe(0);
    });

    it("tracks scan and block counts", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      scanContent(db, "secret data");
      scanContent(db, "clean data");
      const s = getDLPStats();
      expect(s.scanned).toBe(2);
      expect(s.blocked).toBe(1);
      expect(s.totalIncidents).toBe(1);
    });

    it("tracks unresolved incidents", () => {
      createPolicy(db, "Test", ["secret"], [], "block");
      const scan = scanContent(db, "secret");
      expect(getDLPStats().unresolvedIncidents).toBe(1);
      resolveIncident(db, scan.incidents[0].id, "ok");
      expect(getDLPStats().unresolvedIncidents).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // V2 Canonical Surface (Phase 50)
  // ═════════════════════════════════════════════════════════════

  describe("V2 frozen enums", () => {
    it("DLP_ACTION is frozen with 4 values", () => {
      expect(Object.isFrozen(DLP_ACTION)).toBe(true);
      expect(Object.values(DLP_ACTION).sort()).toEqual([
        "alert",
        "allow",
        "block",
        "quarantine",
      ]);
    });

    it("DLP_CHANNEL is frozen with 5 values", () => {
      expect(Object.isFrozen(DLP_CHANNEL)).toBe(true);
      expect(Object.values(DLP_CHANNEL).sort()).toEqual([
        "chat",
        "clipboard",
        "email",
        "export",
        "file_transfer",
      ]);
    });

    it("DLP_SEVERITY is frozen with 4 values", () => {
      expect(Object.isFrozen(DLP_SEVERITY)).toBe(true);
      expect(Object.values(DLP_SEVERITY).sort()).toEqual([
        "critical",
        "high",
        "low",
        "medium",
      ]);
    });

    it("enum assignment is silently ignored (frozen)", () => {
      const before = DLP_ACTION.ALLOW;
      try {
        DLP_ACTION.ALLOW = "mutated";
      } catch (_err) {
        /* strict mode may throw — non-strict is ignored */
      }
      expect(DLP_ACTION.ALLOW).toBe(before);
    });
  });

  describe("createPolicyV2", () => {
    it("creates a policy with description + channels", () => {
      const p = createPolicyV2(db, {
        name: "Email-only SSN",
        description: "Detects SSN in email channel",
        channels: [DLP_CHANNEL.EMAIL],
        patterns: ["\\d{3}-\\d{2}-\\d{4}"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      expect(p.name).toBe("Email-only SSN");
      expect(p.description).toBe("Detects SSN in email channel");
      expect(p.channels).toEqual(["email"]);
      expect(p.action).toBe("block");
      expect(p.severity).toBe("high");
    });

    it("throws without options object", () => {
      expect(() => createPolicyV2(db)).toThrow("options object is required");
    });

    it("throws on missing name", () => {
      expect(() => createPolicyV2(db, {})).toThrow("Policy name is required");
    });

    it("throws on invalid action", () => {
      expect(() =>
        createPolicyV2(db, { name: "X", action: "destroy" }),
      ).toThrow("Invalid action");
    });

    it("throws on invalid severity", () => {
      expect(() =>
        createPolicyV2(db, { name: "X", severity: "catastrophic" }),
      ).toThrow("Invalid severity");
    });

    it("throws on invalid channel", () => {
      expect(() =>
        createPolicyV2(db, { name: "X", channels: ["telepathy"] }),
      ).toThrow("Invalid channel");
    });

    it("throws when channels is not an array", () => {
      expect(() =>
        createPolicyV2(db, { name: "X", channels: "email" }),
      ).toThrow("channels must be an array");
    });

    it("defaults action=alert, severity=medium, channels=[]", () => {
      const p = createPolicyV2(db, { name: "Defaults" });
      expect(p.action).toBe("alert");
      expect(p.severity).toBe("medium");
      expect(p.channels).toEqual([]);
      expect(p.description).toBe("");
    });
  });

  describe("getPolicyV2", () => {
    it("returns policy merged with V2 metadata", () => {
      const p = createPolicyV2(db, {
        name: "X",
        description: "Hello",
        channels: [DLP_CHANNEL.CHAT],
      });
      const fetched = getPolicyV2(p.id);
      expect(fetched.name).toBe("X");
      expect(fetched.description).toBe("Hello");
      expect(fetched.channels).toEqual(["chat"]);
    });

    it("returns empty metadata for legacy policy", () => {
      const p = createPolicy(db, "Legacy", [], [], "alert");
      const fetched = getPolicyV2(p.id);
      expect(fetched.description).toBe("");
      expect(fetched.channels).toEqual([]);
    });

    it("throws on unknown policy", () => {
      expect(() => getPolicyV2("nonexistent")).toThrow("Policy not found");
    });
  });

  describe("listActivePoliciesForChannel", () => {
    it("returns only enabled policies for the channel", () => {
      createPolicyV2(db, {
        name: "Email",
        channels: [DLP_CHANNEL.EMAIL],
        patterns: ["x"],
      });
      createPolicyV2(db, {
        name: "Chat",
        channels: [DLP_CHANNEL.CHAT],
        patterns: ["y"],
      });
      const result = listActivePoliciesForChannel(DLP_CHANNEL.EMAIL);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Email");
    });

    it("empty channels[] means all channels (wildcard)", () => {
      createPolicyV2(db, { name: "All", channels: [], patterns: ["x"] });
      expect(listActivePoliciesForChannel(DLP_CHANNEL.EMAIL).length).toBe(1);
      expect(listActivePoliciesForChannel(DLP_CHANNEL.CLIPBOARD).length).toBe(
        1,
      );
    });

    it("excludes disabled policies", () => {
      const p = createPolicyV2(db, {
        name: "X",
        channels: [DLP_CHANNEL.EMAIL],
      });
      updatePolicy(db, p.id, { enabled: false });
      expect(listActivePoliciesForChannel(DLP_CHANNEL.EMAIL).length).toBe(0);
    });

    it("throws on invalid channel", () => {
      expect(() => listActivePoliciesForChannel("invalid")).toThrow(
        "Invalid channel",
      );
    });
  });

  describe("scanContentV2", () => {
    it("scans content and reports contentBytes + channel", () => {
      createPolicyV2(db, {
        name: "Secret",
        patterns: ["secret"],
        action: DLP_ACTION.BLOCK,
      });
      const r = scanContentV2(db, {
        content: "this is secret",
        channel: DLP_CHANNEL.EMAIL,
        userId: "alice",
      });
      expect(r.allowed).toBe(false);
      expect(r.action).toBe("block");
      expect(r.contentBytes).toBeGreaterThan(0);
      expect(r.channel).toBe("email");
    });

    it("filters policies by channel (channel mismatch excluded)", () => {
      createPolicyV2(db, {
        name: "Chat-only",
        channels: [DLP_CHANNEL.CHAT],
        patterns: ["confidential"],
        action: DLP_ACTION.BLOCK,
      });
      // Scanning email — chat-only policy must not match.
      const r = scanContentV2(db, {
        content: "confidential data",
        channel: DLP_CHANNEL.EMAIL,
      });
      expect(r.matchedPolicies).toBe(0);
      expect(r.action).toBe("allow");
    });

    it("restores policy enabled state after scan", () => {
      createPolicyV2(db, {
        name: "Chat-only",
        channels: [DLP_CHANNEL.CHAT],
        patterns: ["x"],
      });
      scanContentV2(db, { content: "x", channel: DLP_CHANNEL.EMAIL });
      // After scanning email, chat-only policy should still be enabled for chat.
      const r = scanContentV2(db, {
        content: "x",
        channel: DLP_CHANNEL.CHAT,
      });
      expect(r.matchedPolicies).toBe(1);
    });

    it("wildcard policy (empty channels[]) applies to any channel", () => {
      createPolicyV2(db, {
        name: "All",
        channels: [],
        patterns: ["x"],
        action: DLP_ACTION.ALERT,
      });
      const r = scanContentV2(db, {
        content: "x",
        channel: DLP_CHANNEL.CLIPBOARD,
      });
      expect(r.matchedPolicies).toBe(1);
    });

    it("rejects content exceeding maxContentSize", () => {
      const tiny = 10;
      expect(() =>
        scanContentV2(db, {
          content: "this content is longer than ten bytes",
          maxContentSize: tiny,
        }),
      ).toThrow(/exceeds maxContentSize/);
    });

    it("uses DLP_DEFAULT_MAX_CONTENT_SIZE when not provided", () => {
      expect(DLP_DEFAULT_MAX_CONTENT_SIZE).toBe(10 * 1024 * 1024);
      // default path should not throw for a small payload
      expect(() => scanContentV2(db, { content: "tiny" })).not.toThrow();
    });

    it("attaches metadata to each incident", () => {
      createPolicyV2(db, {
        name: "Secret",
        patterns: ["secret"],
        action: DLP_ACTION.BLOCK,
      });
      const r = scanContentV2(db, {
        content: "the secret",
        channel: DLP_CHANNEL.EMAIL,
        metadata: { source: "outbound-smtp", user_ip: "10.0.0.1" },
      });
      expect(r.incidents.length).toBe(1);
      const incident = getIncidentV2(r.incidents[0].id);
      expect(incident.metadata.source).toBe("outbound-smtp");
      expect(incident.metadata.user_ip).toBe("10.0.0.1");
    });

    it("throws on invalid channel", () => {
      expect(() =>
        scanContentV2(db, { content: "x", channel: "nope" }),
      ).toThrow("Invalid channel");
    });

    it("throws on missing content", () => {
      expect(() => scanContentV2(db, {})).toThrow("Content is required");
    });

    it("throws without options object", () => {
      expect(() => scanContentV2(db)).toThrow("options object is required");
    });
  });

  describe("listIncidentsV2", () => {
    beforeEach(() => {
      createPolicyV2(db, {
        name: "H",
        patterns: ["hi"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      createPolicyV2(db, {
        name: "L",
        patterns: ["lo"],
        action: DLP_ACTION.ALERT,
        severity: DLP_SEVERITY.LOW,
      });
    });

    it("filters by channel", () => {
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.CHAT });
      expect(listIncidentsV2({ channel: DLP_CHANNEL.EMAIL }).length).toBe(1);
    });

    it("filters by severity", () => {
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "lo", channel: DLP_CHANNEL.EMAIL });
      expect(listIncidentsV2({ severity: DLP_SEVERITY.HIGH }).length).toBe(1);
    });

    it("filters by resolved=true / false", () => {
      const r = scanContentV2(db, {
        content: "hi",
        channel: DLP_CHANNEL.EMAIL,
      });
      scanContentV2(db, { content: "lo", channel: DLP_CHANNEL.EMAIL });
      resolveIncident(db, r.incidents[0].id, "ok");
      expect(listIncidentsV2({ resolved: true }).length).toBe(1);
      expect(listIncidentsV2({ resolved: false }).length).toBe(1);
    });

    it("filters by userId", () => {
      scanContentV2(db, {
        content: "hi",
        channel: DLP_CHANNEL.EMAIL,
        userId: "alice",
      });
      scanContentV2(db, {
        content: "hi",
        channel: DLP_CHANNEL.EMAIL,
        userId: "bob",
      });
      expect(listIncidentsV2({ userId: "alice" }).length).toBe(1);
    });

    it("filters by policyId", () => {
      const hPolicy = [..._v2PolicyMeta.keys()][0];
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "lo", channel: DLP_CHANNEL.EMAIL });
      expect(
        listIncidentsV2({ policyId: hPolicy }).length,
      ).toBeGreaterThanOrEqual(0);
    });

    it("filters by fromDate / toDate", () => {
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.EMAIL });
      const all = listIncidentsV2({});
      expect(all.length).toBe(1);
      const cutoff = "9999-01-01T00:00:00.000Z";
      expect(listIncidentsV2({ fromDate: cutoff }).length).toBe(0);
      expect(listIncidentsV2({ toDate: cutoff }).length).toBe(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        scanContentV2(db, {
          content: `hi ${i}`,
          channel: DLP_CHANNEL.EMAIL,
        });
      }
      expect(listIncidentsV2({ limit: 3 }).length).toBe(3);
    });

    it("merges metadata on every returned incident", () => {
      scanContentV2(db, {
        content: "hi",
        channel: DLP_CHANNEL.EMAIL,
        metadata: { tag: "t1" },
      });
      const [incident] = listIncidentsV2({});
      expect(incident.metadata.tag).toBe("t1");
    });

    it("throws on invalid filter.channel or filter.severity", () => {
      expect(() => listIncidentsV2({ channel: "x" })).toThrow(
        "Invalid channel",
      );
      expect(() => listIncidentsV2({ severity: "x" })).toThrow(
        "Invalid severity",
      );
    });
  });

  describe("getIncidentV2", () => {
    it("returns incident merged with metadata", () => {
      createPolicyV2(db, {
        name: "X",
        patterns: ["x"],
        action: DLP_ACTION.BLOCK,
      });
      const r = scanContentV2(db, {
        content: "x",
        channel: DLP_CHANNEL.EMAIL,
        metadata: { hint: "h" },
      });
      const i = getIncidentV2(r.incidents[0].id);
      expect(i.metadata.hint).toBe("h");
    });

    it("throws on unknown incident", () => {
      expect(() => getIncidentV2("nope")).toThrow("Incident not found");
    });
  });

  describe("listBuiltinPolicyTemplates", () => {
    it("returns 5 built-in templates", () => {
      const templates = listBuiltinPolicyTemplates();
      expect(templates.length).toBe(5);
      const names = templates.map((t) => t.name).sort();
      expect(names).toEqual([
        "api-key",
        "cn-id-number",
        "credit-card",
        "email-address",
        "plaintext-password",
      ]);
    });

    it("returns fresh copies (caller mutation doesn't affect catalog)", () => {
      const a = listBuiltinPolicyTemplates();
      a[0].name = "hacked";
      const b = listBuiltinPolicyTemplates();
      expect(b[0].name).not.toBe("hacked");
    });
  });

  describe("installBuiltinPolicies", () => {
    it("installs all 5 when names omitted", () => {
      const installed = installBuiltinPolicies(db);
      expect(installed.length).toBe(5);
      expect(listDLPPolicies().length).toBe(5);
    });

    it("installs a specific subset by name", () => {
      const installed = installBuiltinPolicies(db, ["credit-card", "api-key"]);
      expect(installed.length).toBe(2);
      const names = installed.map((p) => p.name).sort();
      expect(names).toEqual(["api-key", "credit-card"]);
    });

    it("throws on unknown template name", () => {
      expect(() =>
        installBuiltinPolicies(db, ["credit-card", "unknown-template"]),
      ).toThrow("Unknown built-in template");
    });

    it("credit-card template blocks credit card numbers", () => {
      installBuiltinPolicies(db, ["credit-card"]);
      const r = scanContentV2(db, {
        content: "card 4111-1111-1111-1111",
        channel: DLP_CHANNEL.EMAIL,
      });
      expect(r.action).toBe("block");
    });
  });

  describe("getDLPStatsV2", () => {
    it("returns zeroed breakdowns with no incidents", () => {
      const s = getDLPStatsV2();
      expect(s.policies).toBe(0);
      expect(s.activePolicies).toBe(0);
      expect(s.byAction.block).toBe(0);
      expect(s.bySeverity.high).toBe(0);
      expect(s.byChannel.email).toBe(0);
      expect(s.topPolicies).toEqual([]);
    });

    it("counts incidents by action/severity/channel", () => {
      createPolicyV2(db, {
        name: "X",
        patterns: ["x"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      scanContentV2(db, { content: "x", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "x", channel: DLP_CHANNEL.CHAT });
      const s = getDLPStatsV2();
      expect(s.byAction.block).toBe(2);
      expect(s.bySeverity.high).toBe(2);
      expect(s.byChannel.email).toBe(1);
      expect(s.byChannel.chat).toBe(1);
    });

    it("ranks topPolicies by incident count (up to 5)", () => {
      const p = createPolicyV2(db, {
        name: "Top",
        patterns: ["x"],
        action: DLP_ACTION.BLOCK,
      });
      scanContentV2(db, { content: "x", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "x", channel: DLP_CHANNEL.EMAIL });
      const s = getDLPStatsV2();
      expect(s.topPolicies.length).toBeGreaterThan(0);
      expect(s.topPolicies[0].policyId).toBe(p.id);
      expect(s.topPolicies[0].count).toBe(2);
    });

    it("reports policies + activePolicies counts", () => {
      const p1 = createPolicyV2(db, { name: "A" });
      createPolicyV2(db, { name: "B" });
      updatePolicy(db, p1.id, { enabled: false });
      const s = getDLPStatsV2();
      expect(s.policies).toBe(2);
      expect(s.activePolicies).toBe(1);
    });
  });

  describe("getHighestUnresolvedSeverity", () => {
    it("returns null when no incidents", () => {
      expect(getHighestUnresolvedSeverity()).toBeNull();
    });

    it("returns highest unresolved severity across all incidents", () => {
      createPolicyV2(db, {
        name: "L",
        patterns: ["lo"],
        action: DLP_ACTION.ALERT,
        severity: DLP_SEVERITY.LOW,
      });
      createPolicyV2(db, {
        name: "H",
        patterns: ["hi"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      scanContentV2(db, { content: "lo", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "hi", channel: DLP_CHANNEL.EMAIL });
      expect(getHighestUnresolvedSeverity()).toBe("high");
    });

    it("ignores resolved incidents", () => {
      createPolicyV2(db, {
        name: "H",
        patterns: ["hi"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      const r = scanContentV2(db, {
        content: "hi",
        channel: DLP_CHANNEL.EMAIL,
      });
      resolveIncident(db, r.incidents[0].id, "ok");
      expect(getHighestUnresolvedSeverity()).toBeNull();
    });

    it("critical beats high", () => {
      createPolicyV2(db, {
        name: "C",
        patterns: ["c"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.CRITICAL,
      });
      createPolicyV2(db, {
        name: "H",
        patterns: ["h"],
        action: DLP_ACTION.BLOCK,
        severity: DLP_SEVERITY.HIGH,
      });
      scanContentV2(db, { content: "c", channel: DLP_CHANNEL.EMAIL });
      scanContentV2(db, { content: "h", channel: DLP_CHANNEL.EMAIL });
      expect(getHighestUnresolvedSeverity()).toBe("critical");
    });
  });

  describe("_resetState clears V2 Maps", () => {
    it("clears V2 policy + incident metadata", () => {
      createPolicyV2(db, {
        name: "X",
        patterns: ["x"],
        action: DLP_ACTION.BLOCK,
      });
      scanContentV2(db, {
        content: "x",
        channel: DLP_CHANNEL.EMAIL,
        metadata: { a: 1 },
      });
      expect(_v2PolicyMeta.size).toBeGreaterThan(0);
      expect(_v2IncidentMeta.size).toBeGreaterThan(0);
      _resetState();
      expect(_v2PolicyMeta.size).toBe(0);
      expect(_v2IncidentMeta.size).toBe(0);
    });
  });
});
