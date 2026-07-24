"use strict";

import { describe, it, expect } from "vitest";

const { getAdapterGuide, ADAPTER_OVERRIDES } = require("../lib/adapter-guide");

describe("adapter-guide", () => {
  it("wechat-pc guide reflects the 4.0 one-click reality (no manual PyWxDump as primary)", () => {
    const g = getAdapterGuide("wechat-pc", "device");
    // primary method is the automatic one-click, not manual decryption
    const primary = g.methods[0];
    expect(primary.recommended).toBe(true);
    expect(primary.label).toMatch(/一键|自动/);
    expect(primary.steps.join(" ")).toMatch(/一键采集|自动/);
    // summary mentions the full coverage we now capture
    expect(g.summary).toMatch(/公众号/);
    expect(g.summary).toMatch(/朋友圈/);
    expect(g.summary).toMatch(/收藏/);
    // manual 3.x path is still offered as a fallback
    expect(
      g.methods.some((m) =>
        /3\.x|PyWxDump|手动/.test(m.label + m.steps.join(" ")),
      ),
    ).toBe(true);
  });

  it("the 6 social platforms all have a tailored one-click ADB guide", () => {
    for (const name of [
      "social-bilibili",
      "social-weibo",
      "social-douyin",
      "social-xiaohongshu",
      "social-toutiao",
      "social-kuaishou",
    ]) {
      expect(ADAPTER_OVERRIDES[name]).toBeTruthy();
      const g = getAdapterGuide(name, "device");
      const primary = g.methods[0];
      expect(primary.recommended).toBe(true);
      // recommended path is root-phone + one-click, not "go log in on the web"
      expect(primary.label + primary.steps.join(" ")).toMatch(
        /一键|ADB|USB|root/i,
      );
    }
  });

  it("WhatsApp guide documents direct crypt14/crypt15 collection with a user key", () => {
    const g = getAdapterGuide("messaging-whatsapp", "device");
    expect(g.methods[0].recommended).toBe(true);
    expect(g.methods[0].label).toMatch(/crypt15/i);
    expect(g.methods[0].steps.join(" ")).toMatch(/ADB|USB|自动拉取/i);
    expect(g.methods.flatMap((method) => method.steps).join(" ")).toMatch(
      /crypt14.*crypt15|crypt15.*crypt14/i,
    );
    expect(g.summary).toMatch(/本机/);
    expect(g.summary).toMatch(/密钥/);
  });

  it("documents transient cookie collection for every shopping adapter without promising a mobile entry", () => {
    for (const name of [
      "shopping-taobao",
      "shopping-jd",
      "shopping-meituan",
      "shopping-eleme",
      "shopping-pinduoduo",
      "shopping-dianping",
      "shopping-xianyu",
      "shopping-vipshop",
    ]) {
      const guide = getAdapterGuide(name, "shopping");
      const text = [
        guide.summary,
        ...guide.methods.flatMap((method) => [
          method.label,
          ...method.steps,
          method.note || "",
        ]),
      ].join(" ");

      expect(guide.methods[0].recommended).toBe(true);
      expect(text).toContain("schemaVersion 1");
      expect(text).toMatch(/若手机.*已提供.*采集入口/u);
      expect(text).toContain(`sync-adapter ${name}`);
      expect(text).toContain("--cookie-file");
      expect(text).toContain("--account-id");
      expect(text).toMatch(/不持久化|不会写入账号库/u);
      expect(text).toMatch(/非 JSON.*保留旧水位/u);
    }
  });

  it("documents stable snapshot and transient official API paths for 12306", () => {
    const guide = getAdapterGuide("travel-12306", "travel");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("kyfw.12306.cn");
    expect(text).toContain("sync-adapter travel-12306");
    expect(text).toContain("--cookie-file");
    expect(text).toContain("--account-id");
    expect(text).toMatch(/表单 POST/u);
    expect(text).toMatch(/不持久化|不写入账号库/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents snapshot-first and transient cookie collection for Zhihu", () => {
    const guide = getAdapterGuide("social-zhihu", "social");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("url_token");
    expect(text).toContain("sync-adapter social-zhihu");
    expect(text).toContain("--cookie-file");
    expect(text).toContain("--account-id");
    expect(text).toContain("x-zse-96");
    expect(text).toMatch(/不持久化|不会写入账号库/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents snapshot-first and transient official OAuth collection for Baidu Netdisk", () => {
    const guide = getAdapterGuide("doc-baidu-netdisk", "document");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("OAuth");
    expect(text).toContain(
      "pan.baidu.com/rest/2.0/xpan/multimedia?method=listall",
    );
    expect(text).toContain("sync-adapter doc-baidu-netdisk");
    expect(text).toContain("--access-token-file");
    expect(text).toContain("--account-id");
    expect(text).toContain("--dir");
    expect(text).toContain("/apps/{appname}");
    expect(text).toContain("has_more/cursor");
    expect(text).toContain("--shallow");
    expect(text).toMatch(/不把 token/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents snapshot-first and signed official OAuth collection for WPS", () => {
    const guide = getAdapterGuide("doc-wps", "document");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("schemaVersion 1");
    expect(text).toContain("kso.file.read");
    expect(text).toContain("sync-adapter doc-wps");
    expect(text).toContain("--access-token-file");
    expect(text).toContain("--drive-id");
    expect(text).toContain("--parent-id");
    expect(text).toContain("--app-key-file");
    expect(text).toContain("--shallow");
    expect(text).toContain("KSO-1");
    expect(text).toContain("page_token");
    expect(text).toContain("递归");
    expect(text).toMatch(/不写入/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents Tencent Docs export-directory collection without promising a personal OAuth API", () => {
    const guide = getAdapterGuide("doc-tencent-docs");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("sync-adapter doc-tencent-docs");
    expect(text).toContain("--export-dir");
    expect(text).toContain("--account-id");
    expect(text).toContain("--shallow");
    expect(text).toContain("--max-files");
    expect(text).toContain("schemaVersion 1");
    expect(text).toMatch(/个人版.*没有.*公开 OAuth/u);
    expect(text).toMatch(/企业版|私有化/u);
    expect(text).toMatch(/不使用.*Cookie/u);
    expect(text).toMatch(/绝对路径/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents privacy-safe bounded local-file collection", () => {
    const guide = getAdapterGuide("local-files");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("sync-adapter local-files");
    expect(text).toContain("--root <");
    expect(text).toContain("--roots");
    expect(text).toContain("\u91cd\u590d `--root`");
    expect(text).toContain("\u6b67\u4e49\u503c\u4f1a\u62d2\u7edd");
    expect(text).toContain("SHA-256");
    expect(text).toContain("raw");
    expect(text).toMatch(/\u7edd\u5bf9\u8def\u5f84/u);
    expect(text).toMatch(/\u76f8\u5bf9\u8def\u5f84/u);
    expect(text).toMatch(/\u4e0d\u8bfb\u53d6\u6587\u4ef6\u6b63\u6587/u);
    expect(text).toMatch(/\u4fdd\u7559\u65e7\u6c34\u4f4d/u);
    expect(text).toContain("Windows Hidden/System");
    expect(text).toMatch(/\u5c31\u7eea\u72b6\u6001\u4e0d\u4f1a\u8df3\u8fc7/u);
  });

  it("documents automatic and selected-profile Brave collection", () => {
    const guide = getAdapterGuide("browser-history-brave");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("Brave \u6d4f\u89c8\u5386\u53f2");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("Local State");
    expect(text).toContain("History");
    expect(text).toContain("Bookmarks");
    expect(text).toContain("下载记录");
    expect(text).toContain("路径哈希");
    expect(text).toContain("查询参数");
    expect(text).toContain("--profile-path");
    expect(text).toMatch(/\u54c8\u5e0c\u4f5c\u7528\u57df/u);
    expect(text).toMatch(/\u7edd\u5bf9\u8def\u5f84\u4e0d\u8fdb\u5165/u);
  });

  it.each([
    ["browser-history-opera", "Opera 浏览历史"],
    ["browser-history-vivaldi", "Vivaldi 浏览历史"],
  ])(
    "documents automatic and selected-profile collection for %s",
    (adapterName, expectedDisplayName) => {
      const guide = getAdapterGuide(adapterName);
      const text = [
        guide.summary,
        ...guide.methods.flatMap((method) => [
          method.label,
          ...method.steps,
          method.note || "",
        ]),
      ].join(" ");

      expect(guide.displayName).toBe(expectedDisplayName);
      expect(guide.category).toBe("local");
      expect(guide.methods[0].recommended).toBe(true);
      expect(text).toContain("History");
      expect(text).toContain("Bookmarks");
      expect(text).toContain("下载记录");
      expect(text).toContain("路径哈希");
      expect(text).toContain("--profile-path");
      expect(text).toMatch(/产品配置根目录/u);
      expect(text).toMatch(/哈希作用域/u);
      expect(text).toMatch(/绝对路径不进入/u);
    },
  );

  it("documents automatic and selected-profile Safari collection", () => {
    const guide = getAdapterGuide("browser-history-safari");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("Safari 浏览历史");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("History.db");
    expect(text).toContain("Bookmarks.plist");
    expect(text).toContain("Downloads.plist");
    expect(text).toContain("SHA-256");
    expect(text).toMatch(/一天后/u);
    expect(text).toContain("Safari 17+");
    expect(text).toContain("--profile-path");
    expect(text).toContain("完全磁盘访问权限");
    expect(text).toMatch(/哈希作用域/u);
    expect(text).toMatch(/绝对路径不会进入/u);
  });

  it("documents safe local Tencent Meeting history collection", () => {
    const guide = getAdapterGuide("meeting-tencent");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("腾讯会议历史");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("historical_meetings");
    expect(text).toContain("%APPDATA%\\Tencent\\WeMeet");
    expect(text).toContain("com.tencent.meeting");
    expect(text).toContain("--profile-path");
    expect(text).toContain("--db-path");
    expect(text).toMatch(/会议密码/u);
    expect(text).toMatch(/剔除或哈希/u);
  });

  it("documents automatic and selected-profile Firefox collection", () => {
    const guide = getAdapterGuide("browser-history-firefox");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("Firefox 浏览历史");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("places.sqlite");
    expect(text).toContain("about:profiles");
    expect(text).toContain("--profile-path");
    expect(text).toContain("--input <places.sqlite>");
    expect(text).toMatch(/下载记录/u);
    expect(text).toContain("SHA-256");
    expect(text).toMatch(/哈希作用域/u);
    expect(text).toMatch(/绝对路径不会写入/u);
  });

  it("documents privacy-minimized JetBrains recent-project collection", () => {
    const guide = getAdapterGuide("jetbrains-ide");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("JetBrains IDE");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("recentProjects.xml");
    expect(text).toContain("--profile-path");
    expect(text).toContain("SHA-256");
    expect(text).toContain("workspace UUID");
    expect(text).toMatch(/Local History 正文/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents privacy-minimized VSCodium activity collection", () => {
    const guide = getAdapterGuide("vscodium");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("VSCodium");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("workspaceStorage");
    expect(text).toContain("globalStorage/state.vscdb");
    expect(text).toContain("History/*/entries.json");
    expect(text).toContain("sync-adapter vscodium");
    expect(text).toContain("--profile-path");
    expect(text).toContain("--no-local-history");
    expect(text).toContain("SHA-256");
    expect(text).toMatch(/不打开任何历史内容文件/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents local Cursor editor, Agent, and AI tracking collection", () => {
    const guide = getAdapterGuide("cursor");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("Cursor");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("agent-transcripts");
    expect(text).toContain("ai-tracking");
    expect(text).toContain("sync-adapter cursor");
    expect(text).toContain("--profile-path");
    expect(text).toContain("--cursor-home");
    expect(text).toContain("--no-agent-transcripts");
    expect(text).toContain("--no-ai-tracking");
    expect(text).toContain("cursorAuth");
    expect(text).toContain("tracked_file_content.content");
    expect(text).toMatch(/高敏感数据/u);
    expect(text).toMatch(/保留旧水位/u);
  });

  it("documents local Claude Code conversations, aggregates, and exclusions", () => {
    const guide = getAdapterGuide("claude-code");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("Claude Code");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("projects/*/*.jsonl");
    expect(text).toContain("subagents");
    expect(text).toContain("stats-cache.json");
    expect(text).toContain("sync-adapter claude-code");
    expect(text).toContain("--claude-home");
    expect(text).toContain("--no-claude-subagents");
    expect(text).toContain("--no-claude-stats");
    expect(text).toContain(".credentials.json");
    expect(text).toContain("tool_use");
    expect(text).toContain("thinking");
    expect(text).toContain("高敏感数据");
    expect(text).toContain("保留旧水位");
  });

  it("documents privacy-minimized HBuilderX INI activity collection", () => {
    const guide = getAdapterGuide("hbuilderx");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.displayName).toBe("HBuilderX");
    expect(guide.category).toBe("local");
    expect(guide.methods[0].recommended).toBe(true);
    expect(text).toContain("INI");
    expect(text).toContain("sync-adapter hbuilderx");
    expect(text).toContain("--hbuilderx-home");
    expect(text).toContain("--profile-path");
    expect(text).toContain("--source-timezone");
    expect(text).toContain("lineText/context/value");
    expect(text).toContain("Local History");
    expect(text).toContain("AI");
  });

  it("documents graph-cursor Git collection without raw repository data", () => {
    const guide = getAdapterGuide("git-activity");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.category).toBe("local");
    expect(text).toContain("sync-adapter git-activity");
    expect(text).toContain("--profile-path");
    expect(text).toContain("HEAD");
    expect(text).toContain("author name");
    expect(text).toContain("author email");
    expect(text).toContain("commit subject");
    expect(text).toContain("repoName");
    expect(text).toContain("高敏感");
    expect(text).toContain("Git SHA");
    expect(text).toContain("remote URL");
    expect(text).toContain("diff");
    expect(text).toContain("恢复偏移");
  });

  it("documents high-sensitivity bounded shell-history collection", () => {
    const guide = getAdapterGuide("shell-history");
    const text = [
      guide.summary,
      ...guide.methods.flatMap((method) => [
        method.label,
        ...method.steps,
        method.note || "",
      ]),
    ].join(" ");

    expect(guide.category).toBe("local");
    expect(text).toContain("sync-adapter shell-history");
    expect(text).toContain("PSReadLine");
    expect(text).toContain(".bash_history");
    expect(text).toContain(".zsh_history");
    expect(text).toContain("SHA-256");
    expect(text).toContain("高敏感");
    expect(text).toContain("多行命令");
    expect(text).toContain("首次观测");
    expect(text).toContain("保留旧水位");
  });

  it("unknown adapter falls back to a category guide without throwing", () => {
    const g = getAdapterGuide("totally-unknown", "snapshot");
    expect(g.category).toBe("snapshot");
    expect(Array.isArray(g.methods)).toBe(true);
    expect(g.methods.length).toBeGreaterThan(0);
  });
});
