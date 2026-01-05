/**
 * E2E测试 - AI助手交互
 *
 * 注意：这些测试需要实际的UI元素和功能实现
 * 当前标记为跳过，待UI实现后启用
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login } from './helpers';

test.describe.skip('AI助手交互', () => {
  test('应该能够发送消息并获得回复', async () => {
    const { app, window } = await launchElectronApp();

    try {
      // 登录
      await login(window);
      await window.waitForTimeout(1000);

      // 1. 打开AI聊天页面
      await window.click('[data-testid="ai-chat-menu"]');
      await window.waitForSelector('[data-testid="chat-panel"]', { timeout: 5000 });

      // 2. 输入消息
      const message = '你好,介绍一下你自己';
      await window.fill('[data-testid="chat-input"]', message);

      // 3. 发送消息
      await window.click('[data-testid="send-btn"]');

      // 4. 验证用户消息显示
      await window.waitForSelector(`text="${message}"`, { timeout: 5000 });

      // 5. 等待AI回复
      await window.waitForSelector('[data-testid="ai-response"]', { timeout: 30000 });

      // 6. 验证回复存在
      const response = await window.textContent('[data-testid="ai-response"]');
      expect(response).toBeTruthy();
      expect(response!.length).toBeGreaterThan(10);

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够开始新对话', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="ai-chat-menu"]');
      await window.waitForSelector('[data-testid="chat-panel"]', { timeout: 5000 });

      // 发送第一条消息
      await window.fill('[data-testid="chat-input"]', '第一条消息');
      await window.click('[data-testid="send-btn"]');
      await window.waitForSelector('[data-testid="ai-response"]', { timeout: 30000 });

      // 点击新对话按钮
      await window.click('[data-testid="new-conversation-btn"]');

      // 验证聊天历史被清空
      const messages = await window.$$('[data-testid="chat-message"]');
      expect(messages.length).toBe(0);

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该显示对话历史', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="ai-chat-menu"]');
      await window.waitForSelector('[data-testid="chat-panel"]', { timeout: 5000 });

      // 发送多条消息
      for (let i = 0; i < 3; i++) {
        await window.fill('[data-testid="chat-input"]', `消息 ${i + 1}`);
        await window.click('[data-testid="send-btn"]');
        await window.waitForTimeout(1000);
      }

      // 打开对话历史
      await window.click('[data-testid="history-btn"]');
      await window.waitForSelector('[data-testid="conversation-list"]', { timeout: 2000 });

      // 验证对话存在
      const conversations = await window.$$('[data-testid="conversation-item"]');
      expect(conversations.length).toBeGreaterThan(0);

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够切换LLM模型', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="ai-chat-menu"]');
      await window.waitForSelector('[data-testid="chat-panel"]', { timeout: 5000 });

      // 打开设置
      await window.click('[data-testid="settings-btn"]');
      await window.waitForSelector('[data-testid="llm-settings"]', { timeout: 5000 });

      // 切换模型
      await window.selectOption('[data-testid="model-select"]', 'gpt-4');

      // 保存设置
      await window.click('[data-testid="save-settings-btn"]');

      // 验证设置已保存
      await window.waitForSelector('text="设置已保存"', { timeout: 5000 });

      // 发送消息验证模型切换
      await window.fill('[data-testid="chat-input"]', '测试消息');
      await window.click('[data-testid="send-btn"]');

      // 验证模型标识
      const modelBadge = await window.textContent('[data-testid="current-model"]');
      expect(modelBadge).toContain('GPT-4');

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe.skip('AI代码生成', () => {
  test('应该能够生成代码', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      // 打开项目
      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 打开AI助手面板
      await window.click('[data-testid="ai-assistant-btn"]');
      await window.waitForSelector('[data-testid="ai-panel"]', { timeout: 5000 });

      // 请求生成代码
      const prompt = '生成一个Python函数,计算斐波那契数列';
      await window.fill('[data-testid="ai-prompt"]', prompt);
      await window.click('[data-testid="generate-code-btn"]');

      // 等待代码生成
      await window.waitForSelector('[data-testid="generated-code"]', { timeout: 30000 });

      // 验证生成的代码
      const code = await window.textContent('[data-testid="generated-code"]');
      expect(code).toContain('fibonacci');
      expect(code).toContain('def');

      // 插入代码到编辑器
      await window.click('[data-testid="insert-code-btn"]');

      // 验证代码已插入
      const editorContent = await window.inputValue('[data-testid="code-editor"]');
      expect(editorContent).toContain('fibonacci');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够解释代码', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入一段代码
      const code = `
def factorial(n):
    if n == 0:
        return 1
    return n * factorial(n-1)
      `;
      await window.fill('[data-testid="code-editor"]', code);

      // 选中代码
      await window.press('[data-testid="code-editor"]', 'Control+A');

      // 请求解释
      await window.click('[data-testid="explain-code-btn"]');

      // 等待解释生成
      await window.waitForSelector('[data-testid="code-explanation"]', { timeout: 30000 });

      // 验证解释内容
      const explanation = await window.textContent('[data-testid="code-explanation"]');
      expect(explanation).toContain('阶乘');
      expect(explanation).toContain('递归');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够重构代码', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="project-card"]');
      await window.waitForSelector('[data-testid="code-editor"]', { timeout: 5000 });

      // 输入需要重构的代码
      const messyCode = `
x=1
y=2
z=x+y
print(z)
      `;
      await window.fill('[data-testid="code-editor"]', messyCode);

      // 选中代码并请求重构
      await window.press('[data-testid="code-editor"]', 'Control+A');
      await window.click('[data-testid="refactor-code-btn"]');

      // 等待重构建议
      await window.waitForSelector('[data-testid="refactored-code"]', { timeout: 30000 });

      // 验证重构后的代码更规范
      const refactoredCode = await window.textContent('[data-testid="refactored-code"]');
      expect(refactoredCode).toContain('# '); // 应该有注释
      expect(refactoredCode).toMatch(/\n\s+/); // 应该有适当的缩进

    } finally {
      await closeElectronApp(app);
    }
  });
});

test.describe.skip('RAG知识库检索', () => {
  test('应该能够检索相关文档', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      await window.click('[data-testid="ai-chat-menu"]');
      await window.waitForSelector('[data-testid="chat-panel"]', { timeout: 5000 });

      // 启用RAG检索
      await window.check('[data-testid="enable-rag-checkbox"]');

      // 发送查询
      const query = '如何使用Python处理CSV文件?';
      await window.fill('[data-testid="chat-input"]', query);
      await window.click('[data-testid="send-btn"]');

      // 等待回复
      await window.waitForSelector('[data-testid="ai-response"]', { timeout: 30000 });

      // 验证回复包含检索到的内容
      const response = await window.textContent('[data-testid="ai-response"]');
      expect(response).toContain('CSV');

      // 验证显示了参考文档
      const references = await window.$$('[data-testid="reference-doc"]');
      expect(references.length).toBeGreaterThan(0);

    } finally {
      await closeElectronApp(app);
    }
  });
});
