/**
 * Computer Use Tools — canonical descriptor tests
 *
 * Verifies that every tool in `ComputerUseTools` carries the canonical
 * descriptor shape expected by the unified tool registry / permission gate:
 *  - `inputSchema` mirrors `parameters`
 *  - read-only tools (screenshots, analyze_page) are tagged `isReadOnly: true`
 *    with `availableInPlanMode: true`
 *  - write/action tools are tagged `riskLevel: "high"` and
 *    `requiresPlanApproval: true`
 */

import { describe, it, expect } from 'vitest';

// Mock logger to silence info/debug output during tests
import { vi } from 'vitest';
vi.mock('../../../src/main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  ComputerUseTools,
  ComputerUseToolExecutor,
} = require('../../../src/main/ai-engine/tools/computer-use-tools');

describe('ComputerUseTools canonical descriptor', () => {
  const readOnlyTools = new Set([
    'browser_screenshot',
    'desktop_screenshot',
    'analyze_page',
  ]);

  it('mirrors parameters into inputSchema for every tool', () => {
    for (const [name, tool] of Object.entries(ComputerUseTools)) {
      expect(tool.inputSchema, `${name}.inputSchema missing`).toBeDefined();
      expect(tool.parameters, `${name}.parameters missing`).toBeDefined();
      expect(tool.inputSchema).toEqual(tool.parameters);
    }
  });

  it('marks screenshot / analyze tools as read-only and plan-mode safe', () => {
    for (const name of readOnlyTools) {
      const tool = ComputerUseTools[name];
      expect(tool, `${name} missing from ComputerUseTools`).toBeDefined();
      expect(tool.isReadOnly).toBe(true);
      expect(tool.availableInPlanMode).toBe(true);
      expect(tool.riskLevel).toBe('medium');
      expect(tool.requiresPlanApproval).toBe(false);
    }
  });

  it('marks write/action tools as high risk and plan-mode blocked', () => {
    for (const [name, tool] of Object.entries(ComputerUseTools)) {
      if (readOnlyTools.has(name)) continue;
      expect(tool.isReadOnly, `${name} should not be read-only`).toBe(false);
      expect(tool.riskLevel).toBe('high');
      expect(tool.availableInPlanMode).toBe(false);
      expect(tool.requiresPlanApproval).toBe(true);
    }
  });

  it('carries canonical kind/source metadata', () => {
    for (const [name, tool] of Object.entries(ComputerUseTools)) {
      expect(tool.kind, `${name}.kind`).toBe('builtin');
      expect(tool.source, `${name}.source`).toBe('computer-use');
    }
  });

  it('ComputerUseToolExecutor.getOpenAITools emits inputSchema-backed parameters', () => {
    const openai = ComputerUseToolExecutor.getOpenAITools();
    expect(openai.length).toBeGreaterThan(0);
    for (const entry of openai) {
      expect(entry.type).toBe('function');
      expect(entry.function.parameters).toBeDefined();
      // Must match the canonical inputSchema on the source tool
      const sourceTool = ComputerUseTools[entry.function.name];
      expect(entry.function.parameters).toEqual(sourceTool.inputSchema);
    }
  });

  it('ComputerUseToolExecutor.getClaudeTools emits input_schema from canonical source', () => {
    const claude = ComputerUseToolExecutor.getClaudeTools();
    expect(claude.length).toBeGreaterThan(0);
    for (const entry of claude) {
      expect(entry.input_schema).toBeDefined();
      const sourceTool = ComputerUseTools[entry.name];
      expect(entry.input_schema).toEqual(sourceTool.inputSchema);
    }
  });
});
