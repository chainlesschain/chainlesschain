/**
 * E2E测试 - AI助手交互
 */

import { test, expect } from '@playwright/test';
import { launchApp, closeApp, waitForElement, waitForText } from './helpers';

test.describe('AI助手交互', () => {
  test('应该能够发送消息并获得回复', async () => {
    const { app, page } = await launchApp();

    try {
      // 1. 打开AI聊天页面
      await page.click('[data-testid="ai-chat-menu"]');
      await waitForElement(page, '[data-testid="chat-panel"]');

      // 2. 输入消息
      const message = '你好,介绍一下你自己';
      await page.fill('[data-testid="chat-input"]', message);

      // 3. 发送消息
      await page.click('[data-testid="send-btn"]');

      // 4. 验证用户消息显示
      await waitForText(page, message);

      // 5. 等待AI回复
      await waitForElement(page, '[data-testid="ai-response"]', 30000);

      // 6. 验证回复存在
      const response = await page.textContent('[data-testid="ai-response"]');
      expect(response).toBeTruthy();
      expect(response!.length).toBeGreaterThan(10);

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够开始新对话', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="ai-chat-menu"]');
      await waitForElement(page, '[data-testid="chat-panel"]');

      // 发送第一条消息
      await page.fill('[data-testid="chat-input"]', '第一条消息');
      await page.click('[data-testid="send-btn"]');
      await waitForElement(page, '[data-testid="ai-response"]');

      // 点击新对话按钮
      await page.click('[data-testid="new-conversation-btn"]');

      // 验证聊天历史被清空
      const messages = await page.$$('[data-testid="chat-message"]');
      expect(messages.length).toBe(0);

    } finally {
      await closeApp(app);
    }
  });

  test('应该显示对话历史', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="ai-chat-menu"]');
      await waitForElement(page, '[data-testid="chat-panel"]');

      // 发送多条消息
      for (let i = 0; i < 3; i++) {
        await page.fill('[data-testid="chat-input"]', `消息 ${i + 1}`);
        await page.click('[data-testid="send-btn"]');
        await page.waitForTimeout(1000);
      }

      // 打开对话历史
      await page.click('[data-testid="history-btn"]');
      await waitForElement(page, '[data-testid="conversation-list"]');

      // 验证对话存在
      const conversations = await page.$$('[data-testid="conversation-item"]');
      expect(conversations.length).toBeGreaterThan(0);

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够切换LLM模型', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="ai-chat-menu"]');
      await waitForElement(page, '[data-testid="chat-panel"]');

      // 打开设置
      await page.click('[data-testid="settings-btn"]');
      await waitForElement(page, '[data-testid="llm-settings"]');

      // 切换模型
      await page.selectOption('[data-testid="model-select"]', 'gpt-4');

      // 保存设置
      await page.click('[data-testid="save-settings-btn"]');

      // 验证设置已保存
      await waitForText(page, '设置已保存');

      // 发送消息验证模型切换
      await page.fill('[data-testid="chat-input"]', '测试消息');
      await page.click('[data-testid="send-btn"]');

      // 验证模型标识
      const modelBadge = await page.textContent('[data-testid="current-model"]');
      expect(modelBadge).toContain('GPT-4');

    } finally {
      await closeApp(app);
    }
  });
});

test.describe('AI代码生成', () => {
  test('应该能够生成代码', async () => {
    const { app, page } = await launchApp();

    try {
      // 打开项目
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 打开AI助手面板
      await page.click('[data-testid="ai-assistant-btn"]');
      await waitForElement(page, '[data-testid="ai-panel"]');

      // 请求生成代码
      const prompt = '生成一个Python函数,计算斐波那契数列';
      await page.fill('[data-testid="ai-prompt"]', prompt);
      await page.click('[data-testid="generate-code-btn"]');

      // 等待代码生成
      await waitForElement(page, '[data-testid="generated-code"]', 30000);

      // 验证生成的代码
      const code = await page.textContent('[data-testid="generated-code"]');
      expect(code).toContain('fibonacci');
      expect(code).toContain('def');

      // 插入代码到编辑器
      await page.click('[data-testid="insert-code-btn"]');

      // 验证代码已插入
      const editorContent = await page.inputValue('[data-testid="code-editor"]');
      expect(editorContent).toContain('fibonacci');

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够解释代码', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入一段代码
      const code = `
def factorial(n):
    if n == 0:
        return 1
    return n * factorial(n-1)
      `;
      await page.fill('[data-testid="code-editor"]', code);

      // 选中代码
      await page.press('[data-testid="code-editor"]', 'Control+A');

      // 请求解释
      await page.click('[data-testid="explain-code-btn"]');

      // 等待解释生成
      await waitForElement(page, '[data-testid="code-explanation"]', 30000);

      // 验证解释内容
      const explanation = await page.textContent('[data-testid="code-explanation"]');
      expect(explanation).toContain('阶乘');
      expect(explanation).toContain('递归');

    } finally {
      await closeApp(app);
    }
  });

  test('应该能够重构代码', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="project-card"]');
      await waitForElement(page, '[data-testid="code-editor"]');

      // 输入需要重构的代码
      const messyCode = `
x=1
y=2
z=x+y
print(z)
      `;
      await page.fill('[data-testid="code-editor"]', messyCode);

      // 选中代码并请求重构
      await page.press('[data-testid="code-editor"]', 'Control+A');
      await page.click('[data-testid="refactor-code-btn"]');

      // 等待重构建议
      await waitForElement(page, '[data-testid="refactored-code"]', 30000);

      // 验证重构后的代码更规范
      const refactoredCode = await page.textContent('[data-testid="refactored-code"]');
      expect(refactoredCode).toContain('# '); // 应该有注释
      expect(refactoredCode).toMatch(/\n\s+/); // 应该有适当的缩进

    } finally {
      await closeApp(app);
    }
  });
});

test.describe('RAG知识库检索', () => {
  test('应该能够检索相关文档', async () => {
    const { app, page } = await launchApp();

    try {
      await page.click('[data-testid="ai-chat-menu"]');
      await waitForElement(page, '[data-testid="chat-panel"]');

      // 启用RAG检索
      await page.check('[data-testid="enable-rag-checkbox"]');

      // 发送查询
      const query = '如何使用Python处理CSV文件?';
      await page.fill('[data-testid="chat-input"]', query);
      await page.click('[data-testid="send-btn"]');

      // 等待回复
      await waitForElement(page, '[data-testid="ai-response"]', 30000);

      // 验证回复包含检索到的内容
      const response = await page.textContent('[data-testid="ai-response"]');
      expect(response).toContain('CSV');

      // 验证显示了参考文档
      const references = await page.$$('[data-testid="reference-doc"]');
      expect(references.length).toBeGreaterThan(0);

    } finally {
      await closeApp(app);
    }
  });
});
