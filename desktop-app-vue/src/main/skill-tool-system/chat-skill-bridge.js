/**
 * 对话-技能-工具桥接器
 * 打通AI对话与技能工具系统的调用链路
 *
 * 核心功能：
 * 1. 拦截AI响应，识别工具调用意图
 * 2. 自动匹配并调度合适的技能/工具
 * 3. 执行工具并返回结果给AI
 * 4. 支持多轮对话中的工具调用
 */

const EventEmitter = require('events');
const ToolRunner = require('./tool-runner');

class ChatSkillBridge extends EventEmitter {
  constructor(skillManager, toolManager, skillExecutor, aiScheduler) {
    super();
    this.skillManager = skillManager;
    this.toolManager = toolManager;
    this.skillExecutor = skillExecutor;
    this.aiScheduler = aiScheduler;

    // 初始化工具运行器
    this.toolRunner = new ToolRunner(toolManager);

    // 工具调用模式检测规则
    this.toolCallPatterns = this.buildToolCallPatterns();
  }

  /**
   * 拦截并处理AI响应
   * @param {string} userMessage - 用户消息
   * @param {string} aiResponse - AI响应
   * @param {Object} context - 上下文信息
   * @returns {Object} 处理结果
   */
  async interceptAndProcess(userMessage, aiResponse, context = {}) {
    console.log('[ChatSkillBridge] 开始拦截处理');
    console.log('[ChatSkillBridge] 用户消息:', userMessage);
    console.log('[ChatSkillBridge] AI响应长度:', aiResponse.length);

    try {
      // 1. 检测是否包含工具调用意图
      const toolCallIntent = this.detectToolCallIntent(userMessage, aiResponse);

      if (!toolCallIntent.detected) {
        console.log('[ChatSkillBridge] 未检测到工具调用意图');
        return {
          shouldIntercept: false,
          originalResponse: aiResponse,
          toolCalls: []
        };
      }

      console.log('[ChatSkillBridge] 检测到工具调用意图:', toolCallIntent);

      // 2. 提取工具调用参数
      const toolCalls = this.extractToolCalls(aiResponse, toolCallIntent);

      if (toolCalls.length === 0) {
        console.log('[ChatSkillBridge] 未能提取工具调用');
        return {
          shouldIntercept: false,
          originalResponse: aiResponse,
          toolCalls: []
        };
      }

      console.log('[ChatSkillBridge] 提取到', toolCalls.length, '个工具调用');

      // 3. 执行工具调用
      const executionResults = await this.executeToolCalls(toolCalls, context);

      // 4. 生成增强响应
      const enhancedResponse = this.buildEnhancedResponse(
        aiResponse,
        toolCalls,
        executionResults
      );

      return {
        shouldIntercept: true,
        originalResponse: aiResponse,
        enhancedResponse: enhancedResponse.text,
        toolCalls,
        executionResults,
        summary: enhancedResponse.summary
      };

    } catch (error) {
      console.error('[ChatSkillBridge] 处理失败:', error);
      return {
        shouldIntercept: false,
        originalResponse: aiResponse,
        error: error.message
      };
    }
  }

  /**
   * 检测工具调用意图
   */
  detectToolCallIntent(userMessage, aiResponse) {
    const intent = {
      detected: false,
      confidence: 0,
      patterns: [],
      tools: []
    };

    // 检测1：用户消息中的动作关键词
    const userIntentScore = this.scoreUserIntent(userMessage);
    if (userIntentScore > 0.7) {
      intent.detected = true;
      intent.confidence = Math.max(intent.confidence, userIntentScore);
      intent.patterns.push('user_action_keywords');
    }

    // 检测2：AI响应中的JSON操作块
    const hasJSONOps = this.detectJSONOperations(aiResponse);
    if (hasJSONOps) {
      intent.detected = true;
      intent.confidence = Math.max(intent.confidence, 0.95);
      intent.patterns.push('json_operations');
    }

    // 检测3：AI响应中的工具名称提及
    const mentionedTools = this.detectToolMentions(aiResponse);
    if (mentionedTools.length > 0) {
      intent.detected = true;
      intent.confidence = Math.max(intent.confidence, 0.8);
      intent.patterns.push('tool_mentions');
      intent.tools = mentionedTools;
    }

    // 检测4：文件操作描述
    const hasFileOps = this.detectFileOperationDescription(aiResponse);
    if (hasFileOps) {
      intent.detected = true;
      intent.confidence = Math.max(intent.confidence, 0.85);
      intent.patterns.push('file_operation_description');
    }

    return intent;
  }

  /**
   * 评估用户意图分数
   */
  scoreUserIntent(message) {
    const actionKeywords = [
      { words: ['创建', '新建', '生成', 'create', 'generate'], weight: 0.9 },
      { words: ['写入', '保存', 'write', 'save'], weight: 0.85 },
      { words: ['读取', '查看', 'read', 'view'], weight: 0.8 },
      { words: ['修改', '更新', 'edit', 'update'], weight: 0.85 },
      { words: ['删除', 'delete', 'remove'], weight: 0.9 },
      { words: ['搜索', '查找', 'search', 'find'], weight: 0.75 },
      { words: ['分析', 'analyze'], weight: 0.7 },
      { words: ['文件', 'file'], weight: 0.6 }
    ];

    const messageLower = message.toLowerCase();
    let maxScore = 0;

    actionKeywords.forEach(({ words, weight }) => {
      const matched = words.some(word => messageLower.includes(word));
      if (matched) {
        maxScore = Math.max(maxScore, weight);
      }
    });

    return maxScore;
  }

  /**
   * 检测JSON操作块
   */
  detectJSONOperations(text) {
    // 检测 ```json ... ``` 块
    const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
    const match = jsonBlockRegex.exec(text);

    if (!match) {
      return false;
    }

    try {
      const jsonStr = match[1].trim();
      const parsed = JSON.parse(jsonStr);

      // 检查是否包含操作字段
      if (Array.isArray(parsed)) {
        return parsed.some(op => op.type && op.path);
      }

      if (parsed.operations && Array.isArray(parsed.operations)) {
        return parsed.operations.some(op => op.type && op.path);
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * 检测工具名称提及
   */
  detectToolMentions(text) {
    const builtinToolNames = [
      'file_reader', 'file_writer', 'file_deleter', 'file_searcher',
      'directory_creator', 'text_processor', 'json_processor', 'yaml_processor',
      'code_executor', 'shell_executor', 'git_operator', 'network_requester'
    ];

    const mentioned = [];
    const textLower = text.toLowerCase();

    builtinToolNames.forEach(toolName => {
      if (textLower.includes(toolName.replace(/_/g, ' ')) ||
          textLower.includes(toolName)) {
        mentioned.push(toolName);
      }
    });

    return mentioned;
  }

  /**
   * 检测文件操作描述
   */
  detectFileOperationDescription(text) {
    const fileOpPhrases = [
      '创建文件', '写入文件', '保存到文件',
      '创建一个', '会创建', '将创建',
      'create a file', 'write to', 'save to',
      'create the file', 'creating file'
    ];

    const textLower = text.toLowerCase();
    return fileOpPhrases.some(phrase => textLower.includes(phrase.toLowerCase()));
  }

  /**
   * 提取工具调用
   */
  extractToolCalls(aiResponse, intent) {
    const toolCalls = [];

    // 方法1：从JSON块提取
    if (intent.patterns.includes('json_operations')) {
      const jsonCalls = this.extractFromJSON(aiResponse);
      toolCalls.push(...jsonCalls);
    }

    // 方法2：从工具提及中推断
    if (intent.patterns.includes('tool_mentions')) {
      const mentionCalls = this.extractFromToolMentions(aiResponse, intent.tools);
      toolCalls.push(...mentionCalls);
    }

    // 方法3：从文件操作描述中推断
    if (intent.patterns.includes('file_operation_description')) {
      const descCalls = this.extractFromFileDescription(aiResponse);
      toolCalls.push(...descCalls);
    }

    return toolCalls;
  }

  /**
   * 从JSON块提取工具调用
   */
  extractFromJSON(text) {
    const calls = [];

    try {
      const jsonBlockRegex = /```json\s*([\s\S]*?)```/gi;
      const matches = text.matchAll(jsonBlockRegex);

      for (const match of matches) {
        const jsonStr = match[1].trim();
        const parsed = JSON.parse(jsonStr);

        let operations = [];
        if (Array.isArray(parsed)) {
          operations = parsed;
        } else if (parsed.operations && Array.isArray(parsed.operations)) {
          operations = parsed.operations;
        }

        operations.forEach(op => {
          const toolCall = this.mapOperationToToolCall(op);
          if (toolCall) {
            calls.push(toolCall);
          }
        });
      }
    } catch (e) {
      console.error('[ChatSkillBridge] JSON提取失败:', e);
    }

    return calls;
  }

  /**
   * 将操作映射到工具调用
   */
  mapOperationToToolCall(operation) {
    const typeMap = {
      'CREATE': 'file_writer',
      'WRITE': 'file_writer',
      'READ': 'file_reader',
      'UPDATE': 'file_writer',
      'EDIT': 'file_writer',
      'DELETE': 'file_deleter',
      'REMOVE': 'file_deleter',
      'SEARCH': 'file_searcher',
      'FIND': 'file_searcher'
    };

    const opType = (operation.type || '').toUpperCase();
    const toolName = typeMap[opType];

    if (!toolName) {
      console.warn('[ChatSkillBridge] 未知操作类型:', opType);
      return null;
    }

    // 验证必需参数
    if (!operation.path) {
      console.error('[ChatSkillBridge] 操作缺少path参数:', operation);
      return null;
    }

    // 对于写入操作，验证content参数
    if ((opType === 'CREATE' || opType === 'WRITE' || opType === 'UPDATE' || opType === 'EDIT') &&
        operation.content === undefined) {
      console.error('[ChatSkillBridge] 写入操作缺少content参数:', operation);
      return null;
    }

    return {
      toolName,
      parameters: {
        filePath: operation.path,
        content: operation.content,
        language: operation.language,
        reason: operation.reason,
        encoding: 'utf-8'
      },
      source: 'json_block',
      originalOperation: operation
    };
  }

  /**
   * 从工具提及提取
   */
  extractFromToolMentions(text, mentionedTools) {
    // 这里可以实现更复杂的逻辑
    // 暂时返回空，因为JSON块提取已经足够
    return [];
  }

  /**
   * 从文件描述提取
   */
  extractFromFileDescription(text) {
    // 这里可以用正则或NLP提取文件操作描述
    // 暂时返回空，因为JSON块提取已经足够
    return [];
  }

  /**
   * 执行工具调用
   */
  async executeToolCalls(toolCalls, context) {
    const results = [];

    for (const call of toolCalls) {
      try {
        console.log(`[ChatSkillBridge] 执行工具: ${call.toolName}`);
        console.log('[ChatSkillBridge] 参数:', call.parameters);

        // 获取工具
        const tool = await this.toolManager.getToolByName(call.toolName);
        if (!tool) {
          results.push({
            toolCall: call,
            success: false,
            error: `工具不存在: ${call.toolName}`
          });
          continue;
        }

        // 执行工具
        const result = await this.toolRunner.executeTool(
          call.toolName,
          call.parameters,
          context
        );

        results.push({
          toolCall: call,
          success: result.success,
          result: result.result,
          error: result.error
        });

        // 触发事件
        this.emit('tool-executed', {
          tool: call.toolName,
          success: result.success,
          result
        });

      } catch (error) {
        console.error(`[ChatSkillBridge] 工具执行失败:`, error);
        results.push({
          toolCall: call,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 构建增强响应
   */
  buildEnhancedResponse(originalResponse, toolCalls, executionResults) {
    const successCount = executionResults.filter(r => r.success).length;
    const failureCount = executionResults.length - successCount;

    // 构建执行摘要
    const summary = {
      totalCalls: toolCalls.length,
      successCount,
      failureCount,
      tools: toolCalls.map(c => c.toolName)
    };

    // 构建详细结果文本
    let resultText = '\n\n---\n**工具执行结果：**\n\n';

    executionResults.forEach((result, index) => {
      const call = result.toolCall;
      const status = result.success ? '✓ 成功' : '✗ 失败';

      resultText += `${index + 1}. **${call.toolName}** - ${status}\n`;
      resultText += `   - 路径: \`${call.parameters.filePath || call.parameters.path || '未知'}\`\n`;

      if (result.success) {
        if (call.toolName === 'file_reader' && result.result) {
          const preview = result.result.substring(0, 100);
          resultText += `   - 内容预览: ${preview}${result.result.length > 100 ? '...' : ''}\n`;
        } else if (call.toolName === 'file_writer') {
          resultText += `   - 已写入 ${call.parameters.content?.length || 0} 字节\n`;
        }
      } else {
        resultText += `   - 错误: ${result.error}\n`;
      }

      resultText += '\n';
    });

    // 组合响应
    const enhancedText = originalResponse + resultText;

    return {
      text: enhancedText,
      summary
    };
  }

  /**
   * 构建工具调用模式
   */
  buildToolCallPatterns() {
    return {
      file_operations: {
        keywords: ['文件', 'file', '创建', 'create', '写入', 'write'],
        tools: ['file_reader', 'file_writer', 'file_deleter']
      },
      code_execution: {
        keywords: ['运行', 'run', '执行', 'execute', '代码', 'code'],
        tools: ['code_executor', 'shell_executor']
      },
      data_processing: {
        keywords: ['解析', 'parse', '处理', 'process', 'json', 'yaml'],
        tools: ['json_processor', 'yaml_processor', 'text_processor']
      },
      git_operations: {
        keywords: ['git', '提交', 'commit', '推送', 'push', '拉取', 'pull'],
        tools: ['git_operator']
      }
    };
  }

  /**
   * 智能模式：使用AI调度器选择技能
   */
  async intelligentMode(userMessage, context) {
    console.log('[ChatSkillBridge] 使用智能模式');

    try {
      const result = await this.aiScheduler.smartSchedule(userMessage, context);
      return {
        success: true,
        mode: 'intelligent',
        skill: result.skill,
        result: result.result
      };
    } catch (error) {
      console.error('[ChatSkillBridge] 智能模式失败:', error);
      return {
        success: false,
        mode: 'intelligent',
        error: error.message
      };
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      // TODO: 实现统计
    };
  }
}

module.exports = ChatSkillBridge;
