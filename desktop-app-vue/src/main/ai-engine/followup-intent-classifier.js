/**
 * 后续输入意图分类器
 * Follow-up Intent Classifier
 *
 * 功能：判断用户在任务执行过程中的后续输入意图
 * - CONTINUE_EXECUTION: 继续执行当前任务（催促、确认）
 * - MODIFY_REQUIREMENT: 修改需求（追加功能、改变参数）
 * - CLARIFICATION: 补充说明（提供细节信息）
 * - CANCEL_TASK: 取消任务
 */

const { getLogger } = require("../logging/logger");
const logger = getLogger("FollowupIntentClassifier");

class FollowupIntentClassifier {
  constructor(llmService) {
    this.llmService = llmService;

    // 规则库：高置信度的快速判断
    this.rules = {
      CONTINUE_EXECUTION: {
        keywords: [
          "继续",
          "开始",
          "好的",
          "好",
          "嗯",
          "行",
          "ok",
          "OK",
          "快点",
          "去吧",
          "执行",
        ],
        patterns: [
          /^(继续|好的?|嗯|行|OK|ok)$/i,
          /^快点|赶紧|马上/,
          /^开始(吧|执行)/,
        ],
      },

      MODIFY_REQUIREMENT: {
        keywords: [
          "改",
          "修改",
          "换成",
          "不要",
          "去掉",
          "删除",
          "加上",
          "增加",
          "还要",
          "另外",
        ],
        patterns: [
          /(改|换)成/,
          /(加|增加|还要|另外).+(功能|页面|按钮|模块)/,
          /不要|去掉|删除/,
          /等等|等一下|先别/,
        ],
      },

      CLARIFICATION: {
        keywords: [
          "用",
          "采用",
          "使用",
          "应该是",
          "具体是",
          "颜色",
          "字体",
          "大小",
          "位置",
        ],
        patterns: [
          /^(用|采用|使用)/,
          /(颜色|字体|大小|位置)(是|用|为)/,
          /^.{1,20}(应该|具体)(是|为)/,
          /^数据(来源|是)/,
        ],
      },

      CANCEL_TASK: {
        keywords: ["算了", "不用", "停止", "取消", "暂停", "先不"],
        patterns: [
          /^(算了|不用|停止|取消|暂停)/,
          /^先不.*(了|吧)/,
          /不做了|别做了/,
        ],
      },
    };
  }

  /**
   * 分类用户的后续输入
   * @param {string} userInput - 用户输入
   * @param {Object} context - 上下文信息
   * @param {Object} context.currentTask - 当前正在执行的任务
   * @param {Array} context.conversationHistory - 对话历史
   * @param {Object} context.taskPlan - 当前任务计划
   * @returns {Promise<Object>} 分类结果
   */
  async classify(userInput, context = {}) {
    const startTime = Date.now();

    // Step 1: 快速规则匹配（覆盖80%的常见场景）
    const ruleResult = this._ruleBasedClassify(userInput);
    if (ruleResult.confidence > 0.8) {
      logger.info(
        `[规则匹配] 输入: "${userInput}" → ${ruleResult.intent} (${ruleResult.confidence})`,
      );
      return {
        ...ruleResult,
        method: "rule",
        latency: Date.now() - startTime,
      };
    }

    // Step 2: LLM 深度分析（处理模糊场景）
    try {
      const llmResult = await this._llmBasedClassify(userInput, context);
      logger.info(
        `[LLM分析] 输入: "${userInput}" → ${llmResult.intent} (${llmResult.confidence})`,
      );
      return {
        ...llmResult,
        method: "llm",
        latency: Date.now() - startTime,
      };
    } catch (error) {
      logger.error("[LLM分析失败] 降级到规则结果:", error);
      // 降级：返回规则结果或默认为 CLARIFICATION
      return ruleResult.confidence > 0
        ? {
            ...ruleResult,
            method: "rule_fallback",
            latency: Date.now() - startTime,
          }
        : {
            intent: "CLARIFICATION",
            confidence: 0.5,
            reason: "无法明确判断，默认为补充说明",
            method: "default",
            latency: Date.now() - startTime,
          };
    }
  }

  /**
   * 规则引擎分类
   */
  _ruleBasedClassify(userInput) {
    const input = userInput.trim();

    // 空输入或过短输入 → 继续执行
    if (input.length === 0 || input.length <= 2) {
      return {
        intent: "CONTINUE_EXECUTION",
        confidence: 0.9,
        reason: "输入过短，判定为确认继续",
      };
    }

    const scores = {
      CONTINUE_EXECUTION: 0,
      MODIFY_REQUIREMENT: 0,
      CLARIFICATION: 0,
      CANCEL_TASK: 0,
    };

    // 遍历每个意图类型，计算匹配分数
    for (const [intent, config] of Object.entries(this.rules)) {
      // 关键词匹配 (每个匹配 +0.3)
      for (const keyword of config.keywords) {
        if (input.includes(keyword)) {
          scores[intent] += 0.3;
        }
      }

      // 正则模式匹配 (每个匹配 +0.5)
      for (const pattern of config.patterns) {
        if (pattern.test(input)) {
          scores[intent] += 0.5;
        }
      }
    }

    // 特殊规则：完全匹配
    if (/^(好的?|嗯|行|OK|ok|继续)$/i.test(input)) {
      scores.CONTINUE_EXECUTION = 1.0;
    }

    // 找到最高分数的意图
    const maxIntent = Object.keys(scores).reduce((a, b) =>
      scores[a] > scores[b] ? a : b,
    );

    const maxScore = scores[maxIntent];

    return {
      intent: maxIntent,
      confidence: Math.min(maxScore, 1.0),
      reason: `规则匹配分数: ${JSON.stringify(scores)}`,
      scores,
    };
  }

  /**
   * LLM 深度分析
   */
  async _llmBasedClassify(userInput, context) {
    const { currentTask, conversationHistory, taskPlan } = context;

    const systemPrompt = `你是一个专业的意图分类器，负责分析用户在任务执行过程中的后续输入意图。

# 你的任务
判断用户输入属于以下哪一种意图类型：

1. **CONTINUE_EXECUTION (继续执行)**
   - 用户在催促、确认、同意继续当前任务
   - 示例: "继续"、"好的"、"快点"、"开始吧"、"行"

2. **MODIFY_REQUIREMENT (修改需求)**
   - 用户想要修改、追加、删除需求
   - 示例: "改成红色"、"还要加一个登录页"、"去掉导航栏"、"换个字体"

3. **CLARIFICATION (补充说明)**
   - 用户提供额外的细节信息或参数
   - 示例: "标题用宋体"、"数据来源是 users.csv"、"颜色用 #FF5733"

4. **CANCEL_TASK (取消任务)**
   - 用户想要停止、取消当前任务
   - 示例: "算了"、"不用了"、"停止"、"先不做了"

# 输出格式
严格返回 JSON 格式：
{
  "intent": "CONTINUE_EXECUTION | MODIFY_REQUIREMENT | CLARIFICATION | CANCEL_TASK",
  "confidence": 0.0-1.0,
  "reason": "判断理由（1-2句话）",
  "extractedInfo": "如果是 MODIFY_REQUIREMENT 或 CLARIFICATION，提取关键信息"
}`;

    const userPrompt = `
# 上下文信息
${currentTask ? `**当前任务**: ${JSON.stringify(currentTask, null, 2)}` : ""}

${taskPlan ? `**任务计划**: ${JSON.stringify(taskPlan, null, 2)}` : ""}

${
  conversationHistory && conversationHistory.length > 0
    ? `**对话历史**:\n${conversationHistory
        .slice(-5)
        .map((m) => `- ${m.role}: ${m.content}`)
        .join("\n")}`
    : ""
}

# 用户输入
"${userInput}"

# 请分析并返回 JSON 结果`;

    const response = await this.llmService.complete({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // 低温度确保一致性
      max_tokens: 300,
    });

    // 解析 JSON
    const content = response.content || response;
    return this._parseJSON(content);
  }

  /**
   * 解析 JSON（容错处理）
   */
  _parseJSON(text) {
    try {
      // 移除可能的 markdown 代码块
      const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      // 验证必要字段
      if (
        !parsed.intent ||
        ![
          "CONTINUE_EXECUTION",
          "MODIFY_REQUIREMENT",
          "CLARIFICATION",
          "CANCEL_TASK",
        ].includes(parsed.intent)
      ) {
        throw new Error("Invalid intent type");
      }

      return {
        intent: parsed.intent,
        confidence: parsed.confidence || 0.7,
        reason: parsed.reason || "无理由",
        extractedInfo: parsed.extractedInfo,
      };
    } catch (error) {
      logger.error("[JSON解析失败]", error);
      throw new Error(`Failed to parse LLM response: ${text}`);
    }
  }

  /**
   * 批量分类（优化性能）
   */
  async classifyBatch(inputs, context = {}) {
    const results = [];
    for (const input of inputs) {
      const result = await this.classify(input, context);
      results.push({ input, result });
    }
    return results;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      rulesCount: Object.keys(this.rules).length,
      keywordsCount: Object.values(this.rules).reduce(
        (sum, r) => sum + r.keywords.length,
        0,
      ),
      patternsCount: Object.values(this.rules).reduce(
        (sum, r) => sum + r.patterns.length,
        0,
      ),
    };
  }
}

module.exports = FollowupIntentClassifier;
