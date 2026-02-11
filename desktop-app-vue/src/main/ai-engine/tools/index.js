/**
 * AI Engine Tools - 工具集合
 *
 * @module ai-engine/tools
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { ComputerUseTools, ComputerUseToolExecutor } = require('./computer-use-tools');

module.exports = {
  // Computer Use 工具
  ComputerUseTools,
  ComputerUseToolExecutor,

  /**
   * 获取所有可用工具
   * @returns {Array}
   */
  getAllTools() {
    return [
      ...ComputerUseToolExecutor.getToolDefinitions()
    ];
  },

  /**
   * 获取所有工具（OpenAI 格式）
   * @returns {Array}
   */
  getAllToolsOpenAI() {
    return [
      ...ComputerUseToolExecutor.getOpenAITools()
    ];
  },

  /**
   * 获取所有工具（Claude 格式）
   * @returns {Array}
   */
  getAllToolsClaude() {
    return [
      ...ComputerUseToolExecutor.getClaudeTools()
    ];
  }
};
