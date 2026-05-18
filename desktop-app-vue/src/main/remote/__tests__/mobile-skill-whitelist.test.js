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
