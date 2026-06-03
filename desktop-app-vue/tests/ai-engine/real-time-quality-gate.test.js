/**
 * RealTimeQualityGate Unit Tests
 *
 * 测试实时质量门禁检查器的核心功能
 */

const { RealTimeQualityGate, Severity } = require('../../src/main/ai-engine/real-time-quality-gate.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('RealTimeQualityGate', () => {
  let gate;
  let tempDir;

  beforeEach(() => {
    // 创建临时测试目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate-test-'));
  });

  afterEach(async () => {
    if (gate) {
      await gate.stop();
      gate = null;
    }

    // 清理临时目录
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('初始化', () => {
    it('应该创建质量门禁实例', () => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });

      assert.ok(gate, '应该创建实例');
      assert.strictEqual(gate.enabled, true, '应该启用');
      assert.ok(gate.rules.length > 0, '应该加载规则');
    });

    it('应该支持禁用质量门禁', () => {
      gate = new RealTimeQualityGate({ enabled: false });
      assert.strictEqual(gate.enabled, false, '应该禁用');
    });
  });

  describe('括号匹配检查', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该检测未闭合的括号', async () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'function test() {\n  return 1;\n// 缺少闭合括号');

      const issues = await gate.checkFile(filePath);

      const bracketIssues = issues.filter(i => i.ruleId === 'syntax-brackets');
      assert.ok(bracketIssues.length > 0, '应该检测到括号问题');
      assert.strictEqual(bracketIssues[0].severity, Severity.ERROR, '应该是ERROR级别');
    });

    it('应该通过正确的括号匹配', async () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'function test() {\n  return 1;\n}');

      const issues = await gate.checkFile(filePath);

      const bracketIssues = issues.filter(i => i.ruleId === 'syntax-brackets');
      assert.strictEqual(bracketIssues.length, 0, '不应该有括号问题');
    });
  });

  describe('长函数检查', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该检测过长的函数', async () => {
      const filePath = path.join(tempDir, 'long-function.js');
      let longFunction = 'function longFunc() {\n';
      for (let i = 0; i < 60; i++) {
        longFunction += `  console.log(${i});\n`;
      }
      longFunction += '}';

      fs.writeFileSync(filePath, longFunction);

      const issues = await gate.checkFile(filePath);

      const longFuncIssues = issues.filter(i => i.ruleId === 'long-function');
      assert.ok(longFuncIssues.length > 0, '应该检测到长函数');
      assert.strictEqual(longFuncIssues[0].severity, Severity.WARNING, '应该是WARNING级别');
    });

    it('应该通过正常长度的函数', async () => {
      const filePath = path.join(tempDir, 'short-function.js');
      fs.writeFileSync(filePath, 'function shortFunc() {\n  return 1;\n}');

      const issues = await gate.checkFile(filePath);

      const longFuncIssues = issues.filter(i => i.ruleId === 'long-function');
      assert.strictEqual(longFuncIssues.length, 0, '不应该有长函数问题');
    });
  });

  describe('硬编码敏感信息检查', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该检测硬编码的密码', async () => {
      const filePath = path.join(tempDir, 'secrets.js');
      fs.writeFileSync(filePath, 'const password = "secret123";');

      const issues = await gate.checkFile(filePath);

      const secretIssues = issues.filter(i => i.ruleId === 'hardcoded-secrets');
      assert.ok(secretIssues.length > 0, '应该检测到硬编码密码');
      assert.strictEqual(secretIssues[0].severity, Severity.ERROR, '应该是ERROR级别');
    });

    it('应该检测硬编码的API密钥', async () => {
      const filePath = path.join(tempDir, 'api-key.js');
      fs.writeFileSync(filePath, 'const apiKey = "sk-1234567890abcdef";');

      const issues = await gate.checkFile(filePath);

      const secretIssues = issues.filter(i => i.ruleId === 'hardcoded-secrets');
      assert.ok(secretIssues.length > 0, '应该检测到硬编码API密钥');
    });
  });

  describe('console.log检查', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该检测console.log语句', async () => {
      const filePath = path.join(tempDir, 'console.js');
      fs.writeFileSync(filePath, 'console.log("debug info");');

      const issues = await gate.checkFile(filePath);

      const consoleIssues = issues.filter(i => i.ruleId === 'console-log');
      assert.ok(consoleIssues.length > 0, '应该检测到console.log');
      assert.strictEqual(consoleIssues[0].severity, Severity.INFO, '应该是INFO级别');
    });

    it('应该忽略注释中的console', async () => {
      const filePath = path.join(tempDir, 'commented-console.js');
      fs.writeFileSync(filePath, '// console.log("this is commented")');

      const issues = await gate.checkFile(filePath);

      const consoleIssues = issues.filter(i => i.ruleId === 'console-log');
      assert.strictEqual(consoleIssues.length, 0, '不应该检测注释中的console');
    });
  });

  describe('TODO/FIXME检查', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该检测TODO注释', async () => {
      const filePath = path.join(tempDir, 'todo.js');
      fs.writeFileSync(filePath, '// TODO: implement this feature');

      const issues = await gate.checkFile(filePath);

      const todoIssues = issues.filter(i => i.ruleId === 'todo-fixme');
      assert.ok(todoIssues.length > 0, '应该检测到TODO');
      assert.strictEqual(todoIssues[0].severity, Severity.INFO, '应该是INFO级别');
    });

    it('应该检测FIXME注释', async () => {
      const filePath = path.join(tempDir, 'fixme.js');
      fs.writeFileSync(filePath, '// FIXME: this is broken');

      const issues = await gate.checkFile(filePath);

      const fixmeIssues = issues.filter(i => i.ruleId === 'todo-fixme');
      assert.ok(fixmeIssues.length > 0, '应该检测到FIXME');
    });
  });

  describe('统计信息', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该正确跟踪统计信息', async () => {
      const filePath1 = path.join(tempDir, 'file1.js');
      const filePath2 = path.join(tempDir, 'file2.js');

      fs.writeFileSync(filePath1, 'console.log("test");');
      fs.writeFileSync(filePath2, 'const password = "secret";');

      await gate.checkFile(filePath1);
      await gate.checkFile(filePath2);

      const stats = gate.getStats();

      assert.strictEqual(stats.totalChecks, 2, '应该执行2次检查');
      assert.strictEqual(stats.filesChecked, 2, '应该检查2个文件');
      assert.ok(stats.issuesFound > 0, '应该发现问题');
    });

    it('应该能够重置统计信息', async () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      await gate.checkFile(filePath);

      let stats = gate.getStats();
      assert.ok(stats.totalChecks > 0, '应该有检查记录');

      gate.resetStats();

      stats = gate.getStats();
      assert.strictEqual(stats.totalChecks, 0, '重置后应该为0');
    });
  });

  describe('缓存管理', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该缓存检查结果', async () => {
      const filePath = path.join(tempDir, 'cached.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      await gate.checkFile(filePath);

      const stats = gate.getStats();
      assert.strictEqual(stats.cachedFiles, 1, '应该有1个缓存文件');
    });

    it('应该能够清空缓存', async () => {
      const filePath = path.join(tempDir, 'cached.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      await gate.checkFile(filePath);

      gate.clearCache();

      const stats = gate.getStats();
      assert.strictEqual(stats.cachedFiles, 0, '缓存应该为空');
    });

    it('应该能够获取所有问题', async () => {
      const filePath1 = path.join(tempDir, 'file1.js');
      const filePath2 = path.join(tempDir, 'file2.js');

      fs.writeFileSync(filePath1, 'console.log("test");');
      fs.writeFileSync(filePath2, '// TODO: implement');

      await gate.checkFile(filePath1);
      await gate.checkFile(filePath2);

      const allIssues = gate.getAllIssues();
      assert.ok(allIssues.length >= 2, '应该返回所有问题');
    });
  });

  describe('禁用模式', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({ enabled: false });
    });

    it('禁用时不应启动监控', async () => {
      await gate.start();
      assert.strictEqual(gate.watcher, null, '不应该创建监控器');
    });

    it('禁用时仍可手动检查', async () => {
      const filePath = path.join(tempDir, 'test.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      const issues = await gate.checkFile(filePath);
      assert.ok(issues.length > 0, '应该能够手动检查');
    });
  });

  describe('事件发射', () => {
    beforeEach(() => {
      gate = new RealTimeQualityGate({
        enabled: true,
        projectPath: tempDir,
      });
    });

    it('应该在发现问题时发射事件', async (done) => {
      const filePath = path.join(tempDir, 'event-test.js');
      fs.writeFileSync(filePath, 'console.log("test");');

      gate.on('issues-found', (data) => {
        assert.ok(data.filePath, '应该包含文件路径');
        assert.ok(data.issues.length > 0, '应该包含问题列表');
        done();
      });

      await gate.checkFile(filePath);
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log('请使用测试框架运行此测试文件 (如 npm test)');
}
