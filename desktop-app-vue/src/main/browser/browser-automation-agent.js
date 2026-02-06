/**
 * BrowserAutomationAgent - AI 浏览器自动化代理
 * 实现自然语言驱动的浏览器自动化
 *
 * @module browser/browser-automation-agent
 * @author ChainlessChain Team
 * @since v0.27.0 Phase 3
 */

const { EventEmitter } = require('events');

/**
 * AI 浏览器自动化代理类
 */
class BrowserAutomationAgent extends EventEmitter {
  constructor(llmService, browserEngine) {
    super();
    this.llmService = llmService;
    this.browserEngine = browserEngine;
    this.executionHistory = [];
  }

  /**
   * 执行自然语言指令
   * @param {string} targetId - 标签页 ID
   * @param {string} prompt - 自然语言指令
   * @param {Object} options - 执行选项
   * @returns {Promise<Object>} 执行结果
   */
  async execute(targetId, prompt, options = {}) {
    const {
      autoSnapshot = true,
      maxRetries = 2,
      stream = false
    } = options;

    try {
      this.emit('execution:started', { targetId, prompt });

      // 1. 获取当前页面快照（如果需要）
      let snapshot = null;
      if (autoSnapshot) {
        snapshot = await this.browserEngine.takeSnapshot(targetId, {
          interactive: true,
          visible: true,
          roleRefs: true
        });
      }

      // 2. 解析指令为操作序列
      const steps = await this.parseCommand(prompt, snapshot);

      this.emit('steps:generated', {
        targetId,
        stepsCount: steps.length,
        steps
      });

      // 3. 执行操作序列
      const results = await this.executeSteps(targetId, steps, {
        maxRetries,
        onProgress: (step, index) => {
          this.emit('step:progress', {
            targetId,
            step,
            index,
            total: steps.length
          });
        }
      });

      // 4. 记录执行历史
      this.executionHistory.push({
        prompt,
        steps,
        results,
        timestamp: Date.now(),
        success: true
      });

      this.emit('execution:completed', {
        targetId,
        prompt,
        stepsCount: steps.length,
        results
      });

      return {
        success: true,
        prompt,
        steps,
        results
      };
    } catch (error) {
      this.executionHistory.push({
        prompt,
        error: error.message,
        timestamp: Date.now(),
        success: false
      });

      this.emit('execution:failed', {
        targetId,
        prompt,
        error: error.message
      });

      throw new Error(`Failed to execute AI command: ${error.message}`);
    }
  }

  /**
   * 解析自然语言指令为操作序列
   * @param {string} prompt - 自然语言指令
   * @param {Object} snapshot - 页面快照（可选）
   * @returns {Promise<Array>} 操作步骤数组
   */
  async parseCommand(prompt, snapshot = null) {
    try {
      const systemPrompt = this._buildSystemPrompt(snapshot);
      const userPrompt = this._buildUserPrompt(prompt, snapshot);

      // 调用 LLM 服务
      const response = await this.llmService.chat({
        model: 'gpt-4', // 或使用配置的默认模型
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // 低温度，更确定性
        response_format: { type: 'json_object' }
      });

      // 解析 JSON 响应
      const parsed = JSON.parse(response.content);

      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error('Invalid response format: missing steps array');
      }

      return parsed.steps;
    } catch (error) {
      throw new Error(`Failed to parse command: ${error.message}`);
    }
  }

  /**
   * 执行操作序列
   * @param {string} targetId - 标签页 ID
   * @param {Array} steps - 操作步骤
   * @param {Object} options - 执行选项
   * @returns {Promise<Array>} 执行结果数组
   */
  async executeSteps(targetId, steps, options = {}) {
    const { maxRetries = 2, onProgress } = options;
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let attempts = 0;
      let success = false;
      let lastError = null;

      // 通知进度
      if (onProgress) {
        onProgress(step, i);
      }

      // 重试逻辑
      while (attempts <= maxRetries && !success) {
        try {
          const result = await this._executeStep(targetId, step);
          results.push({
            step: step.description,
            action: step.action,
            success: true,
            result,
            attempts: attempts + 1
          });
          success = true;
        } catch (error) {
          lastError = error;
          attempts++;

          if (attempts <= maxRetries) {
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));

            // 如果是元素未找到错误，重新获取快照
            if (error.message.includes('not found in snapshot')) {
              await this.browserEngine.takeSnapshot(targetId);
            }
          }
        }
      }

      // 所有重试失败
      if (!success) {
        results.push({
          step: step.description,
          action: step.action,
          success: false,
          error: lastError.message,
          attempts
        });

        // 根据策略决定是否继续
        if (step.critical !== false) {
          throw new Error(`Critical step failed: ${step.description}`);
        }
      }
    }

    return results;
  }

  /**
   * 执行单个步骤
   * @param {string} targetId - 标签页 ID
   * @param {Object} step - 操作步骤
   * @returns {Promise<Object>} 执行结果
   * @private
   */
  async _executeStep(targetId, step) {
    const { action, ...params } = step;

    switch (action) {
      case 'navigate':
        return await this.browserEngine.navigate(targetId, params.url, params.options);

      case 'snapshot':
        return await this.browserEngine.takeSnapshot(targetId, params.options);

      case 'click':
        return await this.browserEngine.act(targetId, 'click', params.ref, params.options);

      case 'type':
        return await this.browserEngine.act(targetId, 'type', params.ref, {
          text: params.text,
          ...params.options
        });

      case 'select':
        return await this.browserEngine.act(targetId, 'select', params.ref, {
          value: params.value,
          ...params.options
        });

      case 'wait':
        const page = this.browserEngine.getPage(targetId);
        await page.waitForLoadState(params.state || 'networkidle', {
          timeout: params.timeout || 30000
        });
        return { waited: true, state: params.state };

      case 'screenshot':
        return await this.browserEngine.screenshot(targetId, params.options);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 构建 System Prompt
   * @param {Object} snapshot - 页面快照
   * @returns {string}
   * @private
   */
  _buildSystemPrompt(snapshot) {
    const elementsInfo = snapshot ? `

当前页面元素：
${snapshot.elements.slice(0, 50).map(el =>
  `- ${el.ref}: ${el.role} "${el.label}" (tag: ${el.tag})`
).join('\n')}

${snapshot.elementsCount > 50 ? `... 还有 ${snapshot.elementsCount - 50} 个元素` : ''}
` : '';

    return `你是一个浏览器自动化 AI 助手。用户会用自然语言描述他们想执行的浏览器操作，你需要将其转换为结构化的操作步骤。

可用操作类型：
- navigate: 跳转到 URL
  参数: { url: string, options?: { waitUntil: 'load' | 'domcontentloaded' | 'networkidle' } }

- snapshot: 获取页面元素快照
  参数: { options?: { interactive: boolean, visible: boolean, roleRefs: boolean } }

- click: 点击元素
  参数: { ref: string, options?: { double: boolean, waitFor: string } }

- type: 输入文本
  参数: { ref: string, text: string, options?: { delay: number } }

- select: 选择下拉框
  参数: { ref: string, value: string }

- wait: 等待页面状态
  参数: { state: 'load' | 'domcontentloaded' | 'networkidle', timeout?: number }

- screenshot: 截图
  参数: { options?: { fullPage: boolean, type: 'png' | 'jpeg' } }

${elementsInfo}

输出格式要求：
{
  "steps": [
    {
      "action": "navigate",
      "url": "https://example.com",
      "description": "打开示例网站",
      "critical": true
    },
    {
      "action": "snapshot",
      "options": { "interactive": true },
      "description": "获取页面元素",
      "critical": false
    },
    {
      "action": "type",
      "ref": "e2",
      "text": "搜索内容",
      "description": "在搜索框输入文本",
      "critical": true
    },
    {
      "action": "click",
      "ref": "e3",
      "options": { "waitFor": "networkidle" },
      "description": "点击搜索按钮",
      "critical": true
    }
  ]
}

注意事项：
1. 每个步骤必须包含 action、description 字段
2. critical 为 true 表示步骤失败时停止执行，false 表示继续
3. 使用元素引用时（ref），确保该引用存在于当前快照中
4. 如果没有快照，先执行 snapshot 操作
5. 对于搜索类操作，通常需要：navigate → snapshot → type → click
6. 导航后建议等待页面加载完成（waitFor: 'networkidle'）
7. 描述要清晰明确，说明操作的目的

只返回 JSON 格式，不要包含任何其他文本。`;
  }

  /**
   * 构建 User Prompt
   * @param {string} prompt - 用户指令
   * @param {Object} snapshot - 页面快照
   * @returns {string}
   * @private
   */
  _buildUserPrompt(prompt, snapshot) {
    if (snapshot) {
      return `用户指令：${prompt}

当前页面信息：
- URL: ${snapshot.url}
- 标题: ${snapshot.title}
- 元素数量: ${snapshot.elementsCount}

请生成操作步骤（JSON 格式）：`;
    } else {
      return `用户指令：${prompt}

当前没有页面快照。请生成操作步骤（JSON 格式），如果需要与页面元素交互，请先包含 snapshot 步骤。`;
    }
  }

  /**
   * 获取执行历史
   * @param {number} limit - 返回数量限制
   * @returns {Array}
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * 清除执行历史
   */
  clearHistory() {
    this.executionHistory = [];
  }
}

module.exports = { BrowserAutomationAgent };
