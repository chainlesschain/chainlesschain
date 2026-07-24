"use strict";

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_WIRING = path.resolve(HERE, "../wiring.js");
const CLI_WIRING = path.resolve(
  HERE,
  "../../../../../packages/cli/src/lib/personal-data-hub-wiring.js",
);

function statelessAdapterClassNames(source, filePath) {
  const marker = "for (const Cls of [";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`stateless adapter registry loop not found in ${filePath}`);
  }
  const end = source.indexOf("]) {", start);
  if (end < 0) {
    throw new Error(
      `stateless adapter registry loop is unterminated in ${filePath}`,
    );
  }

  return source
    .slice(start + marker.length, end)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\/\/.*$/u, "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/,$/u, ""));
}

describe("Personal Data Hub default registry parity", () => {
  it("registers the same stateless app collectors in Electron and CLI", () => {
    const desktop = statelessAdapterClassNames(
      fs.readFileSync(DESKTOP_WIRING, "utf8"),
      DESKTOP_WIRING,
    );
    const cli = statelessAdapterClassNames(
      fs.readFileSync(CLI_WIRING, "utf8"),
      CLI_WIRING,
    );

    expect(desktop).toEqual(cli);
    expect(desktop).toEqual(
      expect.arrayContaining([
        "GenshinAdapter",
        "HonorOfKingsAdapter",
        "ZuoyebangAdapter",
        "AlipayAdapter",
        "HuaweiLearningAdapter",
      ]),
    );
  });

  it("wires WhatsApp public-backup ADB pull in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("WhatsAppAdapter");
      expect(source).toContain("createWhatsAppBackupExtension");
      expect(source).toContain(
        '"whatsapp.backup": createWhatsAppBackupExtension()',
      );
      expect(source).toMatch(/Cls === WhatsAppAdapter[\s\S]+bridgeProvider:/u);
    }
  });

  it("restores and registers the multi-vendor AI chat collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("AIChatHistoryAdapter");
      expect(source).toContain("new AIChatHistoryAdapter()");
      expect(source).toContain("restoreSessions(persistedAccounts)");
      expect(source).toContain("runtimeAdapter: aiChatAdapter");
      expect(source).toContain("registry.register(aiChatAdapter)");
      expect(source).toContain("aiChatAdapter.clearSession(vendor)");
    }
  });

  it("uses the same active-account fallback policy in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("registerNewestValidAccount");
      expect(source).toContain("accountRowsNewestFirst");
      expect(source).toContain("sameAccountIdentity");
      expect(source).toContain("const removingActive");
      expect(source).toContain("active: sameAccountIdentity");
      expect(source).toContain("activatePersistedAdapter");
      expect(source).toContain("activateEmailAdapter");
      expect(source).toContain("activateAlipayAdapter");
      expect(source).toContain("activateWechatAdapter");
    }
  });

  it("wires the constrained source transport for ephemeral shopping and travel cookie sync in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("createJsonSourceFetch");
      expect(source).toContain("runtimeCookieAdapterClasses");
      expect(source).toContain("new Cls({ fetchFn: sourceJsonFetch })");
      for (const className of [
        "TaobaoAdapter",
        "JdAdapter",
        "MeituanAdapter",
        "ElemeAdapter",
        "PinduoduoAdapter",
        "DianpingAdapter",
        "XianyuAdapter",
        "VipshopAdapter",
        "Train12306Adapter",
        "ZhihuAdapter",
      ]) {
        expect(source).toMatch(
          new RegExp(`runtimeCookieAdapterClasses[\\s\\S]+${className}`),
        );
      }
    }
  });
});
