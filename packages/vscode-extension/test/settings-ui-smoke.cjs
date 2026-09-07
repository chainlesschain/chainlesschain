"use strict";
// Browser-level smoke of real Webview HTML, scripts and host message handlers.
// The host services are explicit fixtures; this never changes user settings,
// executes skills, sends LLM traffic or treats test identity as governance.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const {
  openEvolutionWorkbenchPanel,
} = require("../src/ui/evolution-workbench-panel");
const { openLlmConfigPanel } = require("../src/ui/llm-config-panel");
const { openSkillCatalogPanel } = require("../src/ui/skill-catalog-panel");
const { PROVIDER_PRESETS } = require("../src/llm-config");
const digest = (value) => "sha256:" + value.repeat(64);
const candidate = (id, hash, status, active) => ({
  candidateId: id,
  packetDigest: digest(hash),
  candidateContentDigest: digest(hash),
  status,
  changes: {
    unifiedDiff: "- retry without checking\n+ verify permission before retry",
  },
  why: { summary: "测试数据：根据人工反馈补充权限检查。" },
  validation: { targetRuntimes: ["cli", "desktop"] },
  actualUsage: { active, completed: 8, receiptCount: 10, totalCostUsd: 0.003 },
});
const state = {
  projectionDigest: digest("a"),
  governance: {
    runStatus: "active",
    activeReleaseId: "release-current",
    lastKnownGoodReleaseId: "release-stable",
    conflictCount: 0,
    pilot: null,
  },
  candidates: [
    candidate("待审核 · 增加权限校验", "b", "pending", false),
    candidate("当前版本 · 失败重试优化", "c", "approved", true),
    candidate("稳定版本 · 基线", "d", "approved", false),
  ],
};
const records = Array.from({ length: 31 }, (_, i) => ({
  id: `skill-${i}`,
  displayName:
    ["代码安全审查", "单元测试修复", "项目文档整理", "接口性能分析"][i % 4] +
    ` ${i + 1}`,
  description: "检查项目内容并整理建议，执行前仍需确认工具权限和变更范围。",
  category: i % 2 ? "documentation" : "development",
  source: i % 3 ? "bundled" : "workspace",
  version: "1.0.0",
  tags: ["代码", "效率"],
  hasHandler: true,
}));
records[0].description += " <img src=x onerror=alert(1)>";
const retrieved = {
  id: "skill-0",
  displayName: "代码安全审查",
  namespace: "workspace",
  version: "1.0.0",
  digest: digest("f"),
  category: "development",
  contextCostTokens: 200,
  score: 0.9,
  scores: { lexical: 0.9, vector: 0, outcome: 0 },
  outcome: { samples: 0, successRate: 0, correctionRate: 0 },
  reason: "关键词匹配：代码、安全、审查",
};
const retrieval = {
  schema: "chainlesschain.skill-retrieval-result/v1",
  query: "代码安全",
  selected: retrieved,
  candidates: [retrieved],
  conflicts: [],
  rejected: [],
  vectorAvailable: false,
  vectorAuthority: {
    schema: "chainlesschain.skill-vector-authority/v1",
    status: "unavailable",
    code: "CC_SKILL_VECTOR_AUTHORITY_UNCONFIGURED",
  },
  outcomeAuthority: {
    schema: "chainlesschain.skill-outcome-transcript-authority/v1",
    status: "unavailable",
    code: "CC_SKILL_OUTCOME_UNAVAILABLE",
  },
};

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-ui-"));
  let html = "",
    origin;
  const server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    const name = req.url.slice(1);
    if (
      ![
        "settings-workbench.css",
        "evolution-workbench.js",
        "llm-config.js",
        "skill-catalog.js",
      ].includes(name)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      name.endsWith(".css") ? "text/css" : "text/javascript",
    );
    const theme =
      ":root{--vscode-foreground:#d4d4d4;--vscode-editor-background:#1f1f1f;--vscode-input-background:#303030;--vscode-input-foreground:#ddd;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-list-activeSelectionBackground:#094771;--vscode-list-activeSelectionForeground:#fff;--vscode-list-inactiveSelectionBackground:#2a2d2e;--vscode-font-family:'Segoe UI','Microsoft YaHei',sans-serif;}";
    res.end(
      (name.endsWith(".css") ? theme : "") +
        fs.readFileSync(path.join(__dirname, "../media", name), "utf8"),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    });
    async function open(factory, options) {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let handler, dispose;
      const panel = {
        reveal() {},
        onDidDispose: (fn) => {
          dispose = fn;
        },
        webview: {
          cspSource: origin,
          asWebviewUri: (file) => `${origin}/${path.basename(file)}`,
          onDidReceiveMessage: (fn) => {
            handler = fn;
          },
          postMessage: (message) =>
            page.evaluate(
              (data) =>
                window.dispatchEvent(new MessageEvent("message", { data })),
              message,
            ),
        },
      };
      const vscode = {
        Uri: { file: (p) => p },
        ViewColumn: { Active: 1 },
        window: {
          createWebviewPanel: () => panel,
          showWarningMessage: async (_text, _opts, action) => action,
          showTextDocument: async () => {},
        },
        workspace: { openTextDocument: async (input) => input },
        env: { clipboard: { writeText: async () => {} } },
      };
      await page.exposeFunction("hostMessage", (message) => handler(message));
      await page.addInitScript(() => {
        window.acquireVsCodeApi = () => ({
          postMessage: (message) => window.hostMessage(message),
        });
      });
      factory(vscode, options);
      html = panel.webview.html;
      await page.goto(origin);
      await page.waitForFunction(
        () => !document.getElementById("notice").textContent.startsWith("正在"),
      );
      return {
        page,
        async close() {
          assert.deepEqual(errors, []);
          dispose();
          await page.close();
        },
      };
    }
    async function shot(page, name) {
      await page.screenshot({
        path: path.join(output, `${name}.png`),
        fullPage: true,
      });
    }
    async function narrow(page, name) {
      await page.setViewportSize({ width: 420, height: 850 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${name} horizontal overflow`,
      );
      await shot(page, name);
    }

    let reviews = 0;
    const workbench = await open(openEvolutionWorkbenchPanel, {
      getPilot: async () => ({
        workbenchMode: "local-test",
        start: async () => ({
          evolutionWorkbench: {
            available: true,
            methods: ["list", "compare", "review", "rollback"],
          },
        }),
        evolutionWorkbenchList: async () => state,
        evolutionWorkbenchReview: async () => {
          reviews++;
          state.candidates[0].status = "approved";
          state.projectionDigest = digest("e");
          return { success: true };
        },
      }),
    });
    assert.equal(await workbench.page.locator("#detail").isVisible(), false);
    assert.match(
      await workbench.page.locator("#empty").innerText(),
      /工作台概览/,
    );
    await shot(workbench.page, "evolution-home");
    await workbench.page.locator(".candidate").first().click();
    assert.equal(await workbench.page.locator("#approve").isDisabled(), true);
    await workbench.page
      .locator("#reason")
      .fill("已核对评测及权限变更，本地测试批准。");
    await shot(workbench.page, "evolution-detail");
    await workbench.page.locator("#approve").click();
    await workbench.page.waitForFunction(() =>
      document.getElementById("notice").textContent.includes("已保存"),
    );
    assert.equal(reviews, 1);
    await narrow(workbench.page, "evolution-narrow");
    await workbench.close();

    let saved = {
        provider: "openai",
        model: "team/code-model",
        baseUrl: "https://relay.example/v1",
        visionModel: "",
        hasKey: true,
      },
      saves = 0,
      tests = 0;
    const api = {
      PROVIDER_PRESETS,
      getConfiguredProvider: async () => saved.provider,
      getConfiguredModel: async () => saved.model,
      getConfiguredBaseUrl: async () => saved.baseUrl,
      getConfiguredVisionModel: async () => saved.visionModel,
      hasConfiguredApiKey: async () => saved.hasKey,
      applyLlmConnection: async ({ answers }) => {
        saved = { ...answers, apiKey: undefined, hasKey: true };
        saves++;
        return { ok: true };
      },
      testLlm: async () => {
        tests++;
        return { ok: true, detail: "本地测试响应" };
      },
    };
    const llm = await open(openLlmConfigPanel, { api });
    assert.equal(await llm.page.locator("#apiKey").inputValue(), "");
    await llm.page.locator("#baseUrl").fill("https://new-relay.example/api/v1");
    await llm.page.locator("#apiKey").fill("fixture-key-not-real");
    await llm.page.locator("#model").fill("custom/model-alias");
    assert.equal(await llm.page.locator("#test").isDisabled(), true);
    await llm.page.locator("#save").click();
    await llm.page.waitForFunction(() =>
      document.getElementById("notice").textContent.includes("配置已保存"),
    );
    assert.equal(saves, 1);
    assert.equal(await llm.page.locator("#apiKey").inputValue(), "");
    await llm.page.locator("#test").click();
    await llm.page.waitForFunction(() =>
      document.getElementById("notice").textContent.includes("连接成功"),
    );
    assert.equal(tests, 1);
    await shot(llm.page, "llm-config");
    await narrow(llm.page, "llm-narrow");
    await llm.close();

    const calls = [];
    const skills = await open(openSkillCatalogPanel, {
      command: "cc",
      runCliResult: async ({ args }) => {
        calls.push(args);
        return {
          ok: true,
          stdout: JSON.stringify(args[1] === "list" ? records : retrieval),
        };
      },
    });
    assert.deepEqual(calls, [["skill", "list", "--json"]]);
    assert.equal(
      await skills.page.locator("#retrieval").getAttribute("open"),
      null,
    );
    assert.equal(await skills.page.locator(".skill-card").count(), 12);
    assert.equal(await skills.page.locator("img").count(), 0);
    await shot(skills.page, "skill-home");
    await skills.page.locator("#next").click();
    await skills.page.locator("#next").click();
    assert.equal(await skills.page.locator(".skill-card").count(), 7);
    await skills.page.locator("#filter").fill("skill-0");
    assert.equal(await skills.page.locator(".skill-card").count(), 1);
    await skills.page.locator(".skill-card").click();
    assert.match(await skills.page.locator("#detail").innerText(), /<img/);
    await skills.page.locator("#retrieval summary").click();
    await skills.page.locator("#query").fill("代码安全");
    await skills.page.locator("#search").click();
    await skills.page.waitForFunction(() =>
      document.getElementById("list-title").textContent.includes("检索结果"),
    );
    assert.equal(calls[1][1], "search");
    await shot(skills.page, "skill-results");
    await skills.page.locator("#back").click();
    await skills.page.waitForFunction(
      () => document.getElementById("list-title").textContent === "全部技能",
    );
    await narrow(skills.page, "skills-narrow");
    await skills.close();
    console.log(JSON.stringify({ ok: true, panels: 3, screenshots: output }));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
