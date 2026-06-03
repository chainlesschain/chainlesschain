/**
 * 测试环境设置
 * Mock Electron 和其他依赖
 */

import { vi } from 'vitest';
import path from 'path';

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name) => {
      const paths = {
        userData: path.join(process.cwd(), 'test-data'),
        home: path.join(process.cwd(), 'test-home'),
        documents: path.join(process.cwd(), 'test-documents'),
      };
      return paths[name] || '/tmp/test';
    }),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock DocGenerator
vi.mock('../doc-generator.js', () => ({
  default: class MockDocGenerator {
    constructor() {
      this.docsDir = path.join(process.cwd(), 'test-docs');
    }

    async generateSkillDoc(skill) {
      return {
        success: true,
        path: path.join(this.docsDir, `${skill.name}.md`),
      };
    }

    async generateToolDoc(tool) {
      return {
        success: true,
        path: path.join(this.docsDir, `${tool.name}.md`),
      };
    }
  },
}));
