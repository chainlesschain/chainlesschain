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

  it("reports the same detailed selected-device contract in both ADB readiness probes", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("probeDevices");
      expect(source).toContain("return await probeDevices({");
      expect(source).toContain("process.env.ADB_SERIAL");
      expect(source).toContain('"ADB_NOT_INSTALLED"');
      expect(source).toContain('"ADB_PROBE_FAILED"');
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

  it("wires constrained source transport for ephemeral cookie and OAuth sync in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("createJsonSourceFetch");
      expect(source).toContain("runtimeSourceAdapterClasses");
      expect(source).toContain("new Cls({ fetchFn: sourceJsonFetch })");
      const runtimeSet = source.match(
        /const runtimeSourceAdapterClasses = new Set\(\[([\s\S]*?)\]\);/u,
      );
      expect(runtimeSet).not.toBeNull();
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
        "CtripAdapter",
        "TongchengAdapter",
        "DidiAdapter",
        "DidiConsumerAdapter",
        "ZhihuAdapter",
        "XimalayaAdapter",
        "TianyanchaAdapter",
        "KugouMusicAdapter",
        "QQMusicAdapter",
        "BossZhipinAdapter",
        "DoubanAdapter",
        "CsdnAdapter",
        "DongchediAdapter",
        "IqiyiVideoAdapter",
        "TencentVideoAdapter",
        "XiguaVideoAdapter",
        "CamScannerDocAdapter",
        "BaiduNetdiskAdapter",
        "WpsDocAdapter",
      ]) {
        expect(runtimeSet[1]).toContain(`${className},`);
      }
    }
  });

  it("pins legacy cookie clients to the same official API hosts in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("createJsonResponseSourceFetch");
      expect(source).toContain("runtimeCookieHostSuffixes");
      expect(source).toContain(
        "allowedHostSuffixes: runtimeCookieHostSuffixes.get(Cls)",
      );
      for (const [className, host] of [
        ["GenshinAdapter", "api-takumi.mihoyo.com"],
        ["GenshinAdapter", "api-takumi-record.mihoyo.com"],
        ["ZuoyebangAdapter", "www.zuoyebang.com"],
        ["AlipayAdapter", "mobilegw.alipay.com"],
        ["HuaweiLearningAdapter", "educenter.hicloud.com"],
        ["NeteaseMusicAdapter", "music.163.com"],
        ["WeReadAdapter", "i.weread.qq.com"],
      ]) {
        expect(source).toContain(`${className}, [`);
        expect(source).toContain(`"${host}"`);
      }
    }
  });

  it("registers the Firefox local Places collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("BrowserHistoryFirefoxAdapter");
      expect(source).toContain("new BrowserHistoryFirefoxAdapter()");
      expect(source).toContain("registry.register(firefox)");
    }
  });

  it("registers the Brave local Chromium collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("BrowserHistoryBraveAdapter");
      expect(source).toContain("new BrowserHistoryBraveAdapter()");
      expect(source).toContain("registry.register(brave)");
    }
  });

  it.each([
    ["Opera", "BrowserHistoryOperaAdapter", "opera"],
    ["Vivaldi", "BrowserHistoryVivaldiAdapter", "vivaldi"],
    ["Safari", "BrowserHistorySafariAdapter", "safari"],
  ])(
    "registers the %s local Chromium collector in both gateways",
    (_label, className, variableName) => {
      for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
        const source = fs.readFileSync(filePath, "utf8");
        expect(source).toContain(className);
        expect(source).toContain(`new ${className}()`);
        expect(source).toContain(`registry.register(${variableName})`);
      }
    },
  );

  it("registers the Tencent Meeting local history collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("TencentMeetingAdapter");
      expect(source).toContain("new TencentMeetingAdapter()");
      expect(source).toContain("registry.register(tencentMeeting)");
    }
  });

  it("registers the JetBrains recent-project collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("JetBrainsIdeAdapter");
      expect(source).toContain("new JetBrainsIdeAdapter()");
      expect(source).toContain("registry.register(jetbrains)");
    }
  });

  it("registers the VSCodium local activity collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("VSCodiumAdapter");
      expect(source).toContain("new VSCodiumAdapter()");
      expect(source).toContain("registry.register(vscodium)");
    }
  });

  it("registers the Cursor local Agent collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("CursorAdapter");
      expect(source).toContain("new CursorAdapter()");
      expect(source).toContain("registry.register(cursor)");
    }
  });

  it("registers the Claude Code local conversation collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("ClaudeCodeAdapter");
      expect(source).toContain("new ClaudeCodeAdapter()");
      expect(source).toContain("registry.register(claudeCode)");
    }
  });

  it("registers the HBuilderX local file-activity collector in both gateways", () => {
    for (const filePath of [DESKTOP_WIRING, CLI_WIRING]) {
      const source = fs.readFileSync(filePath, "utf8");
      expect(source).toContain("HBuilderXAdapter");
      expect(source).toContain("new HBuilderXAdapter()");
      expect(source).toContain("registry.register(hbuilderx)");
    }
  });
});
