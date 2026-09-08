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
  total: 3,
  offset: 0,
  limit: 500,
  hasMore: false,
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
  const output = process.env.CC_SETTINGS_UI_REPORT_DIRECTORY
    ? path.resolve(process.env.CC_SETTINGS_UI_REPORT_DIRECTORY)
    : fs.mkdtempSync(path.join(os.tmpdir(), "cc-settings-ui-"));
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, "result.json");
  const sourceCommit = process.env.IDE_RELEASE_COMMIT || null;
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ ok: false, mode: "local-test", sourceCommit }),
  );
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
    context.setDefaultTimeout(30_000);
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
        () =>
          !document.getElementById("notice").textContent.startsWith("正在") &&
          document.getElementById("mode")?.textContent !== "连接中",
        null,
        { timeout: 60_000 },
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
    let stalled = true;
    const reconnectPilot = {
      workbenchMode: "local-test",
      start: async () => ({
        evolutionWorkbench: { available: true, methods: ["list"] },
      }),
      evolutionWorkbenchList: async () => state,
    };
    const reconnect = await open(openEvolutionWorkbenchPanel, {
      getPilot: () =>
        stalled ? new Promise(() => {}) : Promise.resolve(reconnectPilot),
      readTimeoutMs: 150,
    });
    assert.match(await reconnect.page.locator("#notice").innerText(), /超时/);
    assert.equal(await reconnect.page.locator("#total").innerText(), "—");
    assert.equal(await reconnect.page.locator("#setup").isDisabled(), false);
    await shot(reconnect.page, "evolution-connection-timeout");
    stalled = false;
    await reconnect.page.locator("#refresh").click();
    await reconnect.page.waitForFunction(
      () => document.getElementById("mode").textContent === "本地测试",
    );
    assert.equal(await reconnect.page.locator(".candidate").count(), 3);
    await reconnect.close();

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

    const manyCandidates = Array.from({ length: 501 }, (_, i) => ({
      ...state.candidates[0],
      candidateId: `candidate-${i}`,
      packetDigest: "sha256:" + i.toString(16).padStart(64, "0"),
    }));
    const large = await open(openEvolutionWorkbenchPanel, {
      getPilot: async () => ({
        ...reconnectPilot,
        evolutionWorkbenchList: async ({ offset, limit }) => ({
          ...state,
          total: manyCandidates.length,
          offset,
          limit,
          hasMore: offset + limit < manyCandidates.length,
          candidates: manyCandidates.slice(offset, offset + limit),
        }),
      }),
    });
    assert.equal(await large.page.locator("#total").innerText(), "501");
    assert.equal(await large.page.locator(".candidate").count(), 25);
    await large.page.locator("#next-page").click();
    assert.match(
      await large.page.locator("#page-label").innerText(),
      /2 \/ 21/,
    );
    await large.page.locator("#search").fill("candidate-500");
    assert.equal(await large.page.locator(".candidate").count(), 1);
    await large.page.locator(".candidate").click();
    assert.equal(
      await large.page.locator("#candidate-name").innerText(),
      "candidate-500",
    );
    await narrow(large.page, "evolution-large-catalog");
    await large.close();

    let liveEvolution = false;
    if (process.argv.includes("--live-evolution")) {
      const { pathToFileURL } = require("node:url");
      const { createLocalWorkbenchTest } = await import(
        pathToFileURL(
          path.resolve(
            __dirname,
            "../../cli/scripts/evolution-workbench-local-test.mjs",
          ),
        ).href
      );
      const {
        createWorkbenchProfileManager,
      } = require("../src/evolution-workbench-profile");
      const created = await createLocalWorkbenchTest({
        root: path.join(output, "local-deployment"),
      });
      const manager = createWorkbenchProfileManager();
      let cliStderr = "";
      const captureStderr = (chunk) => {
        // This process uses only the local test deployment. Keep a bounded
        // failure diagnostic so a native/loader error is not reduced to exit 1.
        cliStderr = (cliStderr + String(chunk)).slice(-16_384);
      };
      let live;
      try {
        const pilot = await manager.get(created.profilePath);
        pilot.on("stderr", captureStderr);
        const before = await pilot.evolutionWorkbenchList({ limit: 500 });
        const pending = before.candidates.find(
          (item) => item.status === "pending",
        );
        const previous = before.candidates.find(
          (item) => item.status === "approved" && !item.actualUsage.active,
        );
        assert.ok(pending && previous);
        live = await open(openEvolutionWorkbenchPanel, {
          getPilot: () => manager.get(created.profilePath),
        });
        assert.equal(await live.page.locator("#mode").innerText(), "本地测试");
        assert.equal(await live.page.locator("#total").innerText(), "3");
        await live.page
          .locator(".candidate .name")
          .getByText(pending.candidateId, { exact: true })
          .click();
        await live.page
          .locator("#reason")
          .fill("本地浏览器旅程：核对测试候选证据并批准。");
        await live.page.locator("#approve").click();
        await live.page.waitForFunction(
          () =>
            document
              .getElementById("notice")
              .textContent.includes("审核决定已保存"),
          null,
          { timeout: 120_000 },
        );
        await live.page
          .locator(".candidate .name")
          .getByText(previous.candidateId, { exact: true })
          .click();
        await live.page
          .locator("#reason")
          .fill("本地浏览器旅程：回滚至已批准的测试基线。");
        await live.page.locator("#rollback").click();
        await live.page.waitForFunction(
          () =>
            document
              .getElementById("notice")
              .textContent.includes("回滚已完成"),
          null,
          { timeout: 120_000 },
        );
        await shot(live.page, "evolution-live-cli-rollback");
        const after = await pilot.evolutionWorkbenchList({ limit: 500 });
        assert.equal(
          after.candidates.find(
            (item) => item.packetDigest === pending.packetDigest,
          ).status,
          "approved",
        );
        assert.equal(
          after.candidates.find(
            (item) => item.packetDigest === previous.packetDigest,
          ).actualUsage.active,
          true,
        );
        await live.close();
        live = null;
        await manager.close();
        const reopened = await manager.get(created.profilePath);
        reopened.on("stderr", captureStderr);
        assert.deepEqual(
          await reopened.evolutionWorkbenchList({ limit: 500 }),
          after,
        );
        liveEvolution = true;
      } catch (error) {
        if (cliStderr) console.error("Local test CLI stderr:", cliStderr);
        throw error;
      } finally {
        await live?.close();
        await manager.close();
      }
    }

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
    const report = {
      ok: true,
      mode: "local-test",
      sourceCommit,
      panels: 3,
      liveEvolution,
      screenshots: output,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
