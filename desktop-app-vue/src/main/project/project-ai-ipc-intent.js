/**
 * Project AI IPC handlers — intent group.
 * Split verbatim from project-ai-ipc.js registerProjectAIIPC(); ipcMain + deps via ctx.
 *
 * @module project/project-ai-ipc-intent
 */
const { logger } = require("../utils/logger.js");

function registerIntentHandlers(ctx) {
  const { ipcMain, llmManager } = ctx;

  // ============================================================
  // 意图理解功能 (Intent Understanding)
  // ============================================================

  /**
   * 理解用户意图 - 纠错 + 意图识别
   * Channel: 'project:understandIntent'
   */
  ipcMain.handle("project:understandIntent", async (_event, data) => {
    try {
      logger.info("[Main] 开始理解用户意图:", data);

      const { userInput, projectId: _projectId, contextMode } = data;

      if (!userInput || !userInput.trim()) {
        throw new Error("用户输入不能为空");
      }

      // 检查LLM管理器
      if (!llmManager) {
        throw new Error("LLM管理器未初始化");
      }

      // 构建意图理解的提示词
      const systemPrompt = `你是一个智能的意图理解助手。你的任务是：

1. **纠错处理**：识别并纠正用户输入中的打字错误、拼写错误、语法错误等问题
2. **意图识别**：理解用户的真实意图和需求
3. **要点提取**：提取用户需求的关键要点

请以JSON格式返回结果，格式如下：
\`\`\`json
{
  "correctedInput": "纠错后的输入（如果没有错误，则与原输入相同）",
  "intent": "用户的意图描述（简短的一句话）",
  "keyPoints": ["关键要点1", "关键要点2", "关键要点3"]
}
\`\`\`

**注意事项：**
- 如果输入没有错误，correctedInput应该与原输入完全相同
- intent应该简洁明了，不超过30个字
- keyPoints应该提取3-5个核心要点
- 必须返回有效的JSON格式`;

      const userPrompt = `请理解以下用户输入：

用户输入：${userInput}

上下文模式：${contextMode || "project"}`;

      // 调用LLM进行意图理解
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      logger.info("[Main] 调用LLM进行意图理解...");
      const llmResult = await llmManager.chat(messages, {
        temperature: 0.3, // 较低的温度以获得更准确的结果
        maxTokens: 500,
      });

      logger.info("[Main] LLM响应:", llmResult.content);

      // 解析LLM响应
      let understanding;
      try {
        // 提取JSON部分
        const jsonMatch =
          llmResult.content.match(/```json\s*([\s\S]*?)```/) ||
          llmResult.content.match(/```\s*([\s\S]*?)```/) ||
          llmResult.content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw new Error("LLM响应中未找到JSON格式的理解结果");
        }

        const jsonText = jsonMatch[1] || jsonMatch[0];
        understanding = JSON.parse(jsonText);

        // 验证必要字段
        if (!understanding.correctedInput) {
          understanding.correctedInput = userInput;
        }
        if (!understanding.intent) {
          understanding.intent = "未能识别意图";
        }
        if (!Array.isArray(understanding.keyPoints)) {
          understanding.keyPoints = [];
        }

        logger.info("[Main] 意图理解成功:", understanding);

        return {
          success: true,
          ...understanding,
        };
      } catch (parseError) {
        logger.error("[Main] 解析LLM响应失败:", parseError);

        // 如果解析失败，返回默认结果
        return {
          success: true,
          correctedInput: userInput,
          intent: "理解用户需求并提供帮助",
          keyPoints: [
            userInput.slice(0, 50) + (userInput.length > 50 ? "..." : ""),
          ],
        };
      }
    } catch (error) {
      logger.error("[Main] 意图理解失败:", error);
      throw error;
    }
  });
}

module.exports = { registerIntentHandlers };
