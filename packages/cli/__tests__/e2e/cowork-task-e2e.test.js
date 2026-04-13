/**
 * E2E tests: Cowork task system
 *
 * Verifies module loading and integration by running node directly
 * against the source modules.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..", "..");

function nodeEval(code) {
  return execSync(
    `node --input-type=module -e "${code.replace(/"/g, '\\"')}"`,
    {
      encoding: "utf-8",
      timeout: 20000,
      stdio: "pipe",
      cwd: cliRoot,
    },
  ).trim();
}

// ─── Module loading verification ──────────────────────────────────

describe("E2E: cowork module loading", () => {
  it("cowork-task-templates.js loads and exports 10 templates", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => console.log(JSON.stringify(Object.keys(m.TASK_TEMPLATES))))",
    );
    const ids = JSON.parse(out);
    expect(ids).toHaveLength(10);
    expect(ids).toContain("doc-convert");
    expect(ids).toContain("media-process");
    expect(ids).toContain("learning-assist");
  });

  it("cowork-task-runner.js loads and exports runCoworkTask", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-runner.js').then(m => console.log(typeof m.runCoworkTask))",
    );
    expect(out).toBe("function");
  });

  it("action-protocol.js exports handleCoworkTask", () => {
    const out = nodeEval(
      "import('./src/gateways/ws/action-protocol.js').then(m => console.log(typeof m.handleCoworkTask))",
    );
    expect(out).toBe("function");
  });

  it("getTemplate returns free mode for unknown ID", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => { const t = m.getTemplate('xxx'); console.log(t.id + '|' + t.name); })",
    );
    expect(out).toBe("free|自由模式");
  });

  it("listTemplateIds returns array of 10", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => console.log(m.listTemplateIds().length))",
    );
    expect(out).toBe("10");
  });
});

// ─── Template content spot-checks ─────────────────────────────────

describe("E2E: template content verification", () => {
  it("doc-convert template references pandoc", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => console.log(m.TASK_TEMPLATES['doc-convert'].systemPromptExtension.includes('pandoc')))",
    );
    expect(out).toBe("true");
  });

  it("media-process template references ffmpeg", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => console.log(m.TASK_TEMPLATES['media-process'].systemPromptExtension.includes('ffmpeg')))",
    );
    expect(out).toBe("true");
  });

  it("all templates have non-empty systemPromptExtension", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => { const lens = Object.values(m.TASK_TEMPLATES).map(t => t.systemPromptExtension.length); console.log(Math.min(...lens)); })",
    );
    const minLen = parseInt(out, 10);
    expect(minLen).toBeGreaterThan(500);
  });

  it("all templates include cli-anything in prompt", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => { const ok = Object.values(m.TASK_TEMPLATES).every(t => t.systemPromptExtension.includes('cli-anything')); console.log(ok); })",
    );
    expect(out).toBe("true");
  });

  it("all template IDs match between frontend and backend", () => {
    const out = nodeEval(
      "import('./src/lib/cowork-task-templates.js').then(m => console.log(JSON.stringify(m.listTemplateIds().sort())))",
    );
    const backendIds = JSON.parse(out);
    const expectedFrontendIds = [
      "code-helper",
      "data-analysis",
      "doc-convert",
      "file-organize",
      "image-process",
      "learning-assist",
      "media-process",
      "network-tools",
      "system-admin",
      "web-research",
    ];
    expect(backendIds).toEqual(expectedFrontendIds);
  });
});

// ─── WS dispatcher route verification ─────────────────────────────

describe("E2E: message-dispatcher cowork-task route", () => {
  it("dispatcher recognizes cowork-task type", () => {
    const out = nodeEval(
      "import('./src/gateways/ws/message-dispatcher.js').then(m => { let called = false; const s = { _send: () => {}, _handleCoworkTask: () => { called = true; }, clients: new Map([['c1', { authenticated: true }]]), token: null }; const d = m.createWsMessageDispatcher(s); d.dispatch('c1', {}, { id: 't1', type: 'cowork-task' }); console.log(called); })",
    );
    expect(out).toBe("true");
  });
});
