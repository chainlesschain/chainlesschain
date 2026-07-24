/**
 * MobileSkillWhitelist 单元测试（M4 D2）
 *
 * 验证 pattern 匹配 / 白名单决策 / approval 通道路由。
 */

import { describe, it, expect } from "vitest";
import {
  MobileSkillWhitelist,
  matchPattern,
} from "../handlers/mobile-skill-whitelist";

describe("matchPattern", () => {
  it("exact pattern matches only itself", () => {
    expect(matchPattern("ai.chat", "ai.chat")).toBe(true);
    expect(matchPattern("ai.chat", "ai.summarize")).toBe(false);
    expect(matchPattern("ai", "ai.chat")).toBe(false);
  });

  it("wildcard pattern matches namespace prefix", () => {
    expect(matchPattern("ai.chat", "ai.*")).toBe(true);
    expect(matchPattern("ai.ragSearch", "ai.*")).toBe(true);
    expect(matchPattern("system.shutdown", "ai.*")).toBe(false);
  });

  it("wildcard namespace.* also matches namespace itself", () => {
    expect(matchPattern("ai", "ai.*")).toBe(true);
  });

  it("nested namespace wildcards work", () => {
    expect(matchPattern("system.info.getCpu", "system.info.*")).toBe(true);
    expect(matchPattern("system.shutdown", "system.info.*")).toBe(false);
    expect(matchPattern("system.shutdown", "system.*")).toBe(true);
  });

  it("global asterisk matches everything", () => {
    expect(matchPattern("ai.chat", "*")).toBe(true);
    expect(matchPattern("anything.you.want", "*")).toBe(true);
  });

  it("empty / null arguments return false", () => {
    expect(matchPattern("", "ai.*")).toBe(false);
    expect(matchPattern("ai.chat", "")).toBe(false);
    expect(matchPattern(null, "ai.*")).toBe(false);
    expect(matchPattern("ai.chat", null)).toBe(false);
  });

  it("prefix-only wildcard '.* ' is rejected", () => {
    expect(matchPattern("ai.chat", ".*")).toBe(false);
  });
});

describe("MobileSkillWhitelist", () => {
  it("defaults enabled=true when not specified", () => {
    const wl = new MobileSkillWhitelist({ exposeRemoteSkills: ["ai.*"] });
    expect(wl.enabled).toBe(true);
  });

  it("disabled instance rejects everything", () => {
    const wl = new MobileSkillWhitelist({
      enabled: false,
      exposeRemoteSkills: ["ai.*"],
    });
    expect(wl.isAllowed("ai.chat")).toBe(false);
    expect(wl.describeRejection("ai.chat")).toBe("mobileBridge.enabled=false");
  });

  it("empty exposeRemoteSkills rejects everything (fail-safe default)", () => {
    const wl = new MobileSkillWhitelist({ enabled: true });
    expect(wl.isAllowed("ai.chat")).toBe(false);
    expect(wl.describeRejection("ai.chat")).toBe(
      "mobileBridge.exposeRemoteSkills is empty",
    );
  });

  it("isAllowed honors namespace wildcards", () => {
    const wl = new MobileSkillWhitelist({
      exposeRemoteSkills: ["ai.*", "knowledge.*", "system.info.*"],
    });
    expect(wl.isAllowed("ai.chat")).toBe(true);
    expect(wl.isAllowed("knowledge.search")).toBe(true);
    expect(wl.isAllowed("system.info.getCpu")).toBe(true);
    expect(wl.isAllowed("system.shutdown")).toBe(false);
    expect(wl.isAllowed("file.delete")).toBe(false);
  });

  it("isAllowed honors exact method patterns", () => {
    const wl = new MobileSkillWhitelist({
      exposeRemoteSkills: ["marketplace.browse", "marketplace.search"],
    });
    expect(wl.isAllowed("marketplace.browse")).toBe(true);
    expect(wl.isAllowed("marketplace.purchase")).toBe(false);
  });

  it("requiresApproval matches approvalChannelsForMobile patterns", () => {
    const wl = new MobileSkillWhitelist({
      exposeRemoteSkills: ["marketplace.*", "cowork.*"],
      approvalChannelsForMobile: [
        "marketplace.purchase",
        "did.delegate",
        "cowork.spawnTeam",
      ],
    });
    expect(wl.requiresApproval("marketplace.purchase")).toBe(true);
    expect(wl.requiresApproval("cowork.spawnTeam")).toBe(true);
    expect(wl.requiresApproval("marketplace.browse")).toBe(false);
  });

  it("describeRejection returns null on allow", () => {
    const wl = new MobileSkillWhitelist({ exposeRemoteSkills: ["ai.*"] });
    expect(wl.describeRejection("ai.chat")).toBe(null);
  });

  it("describeRejection gives unmatched-pattern reason", () => {
    const wl = new MobileSkillWhitelist({ exposeRemoteSkills: ["ai.*"] });
    expect(wl.describeRejection("system.shutdown")).toMatch(
      /not matched by any whitelist pattern/,
    );
  });

  it("filters non-string / empty patterns from config", () => {
    const wl = new MobileSkillWhitelist({
      exposeRemoteSkills: ["ai.*", "", null, undefined, 123, "valid.*"],
    });
    expect(wl.exposeRemoteSkills).toEqual(["ai.*", "valid.*"]);
  });

  it("global asterisk in config allows everything (DANGER)", () => {
    const wl = new MobileSkillWhitelist({ exposeRemoteSkills: ["*"] });
    expect(wl.isAllowed("system.shutdown")).toBe(true);
    expect(wl.isAllowed("anything.at.all")).toBe(true);
  });

  it("config with non-array exposeRemoteSkills treated as empty", () => {
    const wl = new MobileSkillWhitelist({
      exposeRemoteSkills: "ai.chat", // string, not array
    });
    expect(wl.exposeRemoteSkills).toEqual([]);
    expect(wl.isAllowed("ai.chat")).toBe(false);
  });
});

// Phase 14.1 — Personal Data Hub mobile entry routing
// See docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md §9
describe("MobileSkillWhitelist — Personal Data Hub (Phase 14.1)", () => {
  const PDH_RECOMMENDED_CONFIG = {
    enabled: true,
    exposeRemoteSkills: [
      "ai.*",
      "knowledge.*",
      "personal-data-hub.*",
      "system.info.*",
    ],
    approvalChannelsForMobile: [
      "personal-data-hub.register-email",
      "personal-data-hub.activate-email",
      "personal-data-hub.unregister-email",
      "personal-data-hub.register-alipay",
      "personal-data-hub.activate-alipay",
      "personal-data-hub.unregister-alipay",
      "personal-data-hub.unregister",
    ],
  };

  it("namespace wildcard allows all 26 PDH methods", () => {
    const wl = new MobileSkillWhitelist(PDH_RECOMMENDED_CONFIG);
    const PDH_METHODS = [
      "personal-data-hub.ask",
      "personal-data-hub.retrieve-context",
      "personal-data-hub.ingest-system-data-android",
      "personal-data-hub.stats",
      "personal-data-hub.health",
      "personal-data-hub.list-adapters",
      "personal-data-hub.adapter-readiness",
      "personal-data-hub.sync-adapter",
      "personal-data-hub.sync-all",
      "personal-data-hub.sync-adapter-stream",
      "personal-data-hub.query-events",
      "personal-data-hub.recent-audit",
      "personal-data-hub.event-detail",
      "personal-data-hub.register-email",
      "personal-data-hub.activate-email",
      "personal-data-hub.unregister-email",
      "personal-data-hub.test-email-auth",
      "personal-data-hub.list-email-accounts",
      "personal-data-hub.register-alipay",
      "personal-data-hub.activate-alipay",
      "personal-data-hub.unregister-alipay",
      "personal-data-hub.import-alipay-bill",
      "personal-data-hub.list-alipay-accounts",
      "personal-data-hub.sync-all-stream",
      "personal-data-hub.register-mock",
      "personal-data-hub.unregister",
    ];
    for (const method of PDH_METHODS) {
      expect(wl.isAllowed(method)).toBe(true);
    }
    expect(PDH_METHODS).toHaveLength(26);
  });

  it("7 Privileged PDH methods require approval", () => {
    const wl = new MobileSkillWhitelist(PDH_RECOMMENDED_CONFIG);
    const PRIVILEGED = [
      "personal-data-hub.register-email",
      "personal-data-hub.activate-email",
      "personal-data-hub.unregister-email",
      "personal-data-hub.register-alipay",
      "personal-data-hub.activate-alipay",
      "personal-data-hub.unregister-alipay",
      "personal-data-hub.unregister",
    ];
    for (const method of PRIVILEGED) {
      expect(wl.requiresApproval(method)).toBe(true);
    }
  });

  it("Safe PDH methods do NOT require approval", () => {
    const wl = new MobileSkillWhitelist(PDH_RECOMMENDED_CONFIG);
    const SAFE = [
      "personal-data-hub.ask",
      "personal-data-hub.stats",
      "personal-data-hub.health",
      "personal-data-hub.query-events",
      "personal-data-hub.recent-audit",
      "personal-data-hub.event-detail",
    ];
    for (const method of SAFE) {
      expect(wl.requiresApproval(method)).toBe(false);
    }
  });

  it("dropping personal-data-hub.* from whitelist disables Hub access entirely", () => {
    const wl = new MobileSkillWhitelist({
      ...PDH_RECOMMENDED_CONFIG,
      exposeRemoteSkills: PDH_RECOMMENDED_CONFIG.exposeRemoteSkills.filter(
        (p) => p !== "personal-data-hub.*",
      ),
    });
    expect(wl.isAllowed("personal-data-hub.ask")).toBe(false);
    expect(wl.describeRejection("personal-data-hub.ask")).toMatch(
      /not matched by any whitelist pattern/,
    );
  });

  it("unknown PDH method (typo) is allowed by wildcard but caught later by handler", () => {
    // Whitelist is namespace-level; runtime handler validates method name.
    const wl = new MobileSkillWhitelist(PDH_RECOMMENDED_CONFIG);
    expect(wl.isAllowed("personal-data-hub.askkk")).toBe(true);
    // Handler-level rejection is the responsibility of personal-data-hub-ipc.js.
  });

  // Phase 14.1.2 — Guard against kebab/camelCase drift between
  // unified-config-manager's `approvalChannelsForMobile` defaults and the
  // actual WS dispatch keys in personal-data-hub-protocol.js. A camelCase
  // entry would silently bypass the approval gate for that method.
  it("DEFAULT unified-config approval list uses kebab-case (matches WS dispatch)", async () => {
    const { UnifiedConfigManager } =
      await import("../../config/unified-config-manager.js");
    const mgr = new UnifiedConfigManager();
    const defaults = mgr.getDefaultConfig();
    const list = defaults.mobileBridge?.approvalChannelsForMobile || [];
    // Every PDH approval entry must be kebab-case (no uppercase letters
    // between the `personal-data-hub.` namespace and the next dot/end).
    const pdhEntries = list.filter((s) => s.startsWith("personal-data-hub."));
    expect(pdhEntries.length).toBeGreaterThan(0);
    for (const entry of pdhEntries) {
      const method = entry.slice("personal-data-hub.".length);
      expect(
        method,
        `approval channel "${entry}" must be kebab-case to match the WS dispatch key in personal-data-hub-protocol.js`,
      ).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    // The known Privileged methods must each be present in kebab form.
    // When a new privileged PDH method is added (e.g. aichat-register-vendor
    // in d41a48bf3, destroy earlier), append it here so a silent removal
    // during refactors is caught at unit-test time rather than only via
    // post-release security review.
    const required = [
      "personal-data-hub.register-email",
      "personal-data-hub.activate-email",
      "personal-data-hub.unregister-email",
      "personal-data-hub.register-alipay",
      "personal-data-hub.activate-alipay",
      "personal-data-hub.unregister-alipay",
      "personal-data-hub.unregister",
      "personal-data-hub.destroy",
      "personal-data-hub.aichat-register-vendor",
      "personal-data-hub.unregister-aichat",
      "personal-data-hub.register-wechat",
      "personal-data-hub.activate-wechat",
      "personal-data-hub.unregister-wechat",
    ];
    for (const method of required) {
      expect(list).toContain(method);
    }
  });

  it("DEFAULT unified-config personal-data-hub.* is in exposeRemoteSkills", async () => {
    const { UnifiedConfigManager } =
      await import("../../config/unified-config-manager.js");
    const mgr = new UnifiedConfigManager();
    const defaults = mgr.getDefaultConfig();
    const expose = defaults.mobileBridge?.exposeRemoteSkills || [];
    expect(expose).toContain("personal-data-hub.*");
    // Construct a whitelist from the actual defaults and verify the
    // Privileged methods route to ApprovalUI as designed.
    const wl = new MobileSkillWhitelist(defaults.mobileBridge);
    for (const method of [
      "personal-data-hub.register-email",
      "personal-data-hub.activate-email",
      "personal-data-hub.unregister-email",
      "personal-data-hub.register-alipay",
      "personal-data-hub.activate-alipay",
      "personal-data-hub.unregister-alipay",
      "personal-data-hub.unregister",
      "personal-data-hub.destroy",
      "personal-data-hub.aichat-register-vendor",
      "personal-data-hub.unregister-aichat",
      "personal-data-hub.register-wechat",
      "personal-data-hub.activate-wechat",
      "personal-data-hub.unregister-wechat",
    ]) {
      expect(wl.isAllowed(method)).toBe(true);
      expect(
        wl.requiresApproval(method),
        `${method} must require approval per default config`,
      ).toBe(true);
    }
    // Safe (non-Privileged) PDH methods must NOT require approval
    expect(wl.requiresApproval("personal-data-hub.ask")).toBe(false);
    expect(wl.requiresApproval("personal-data-hub.stats")).toBe(false);
  });
});
