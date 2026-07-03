const { logger } = require("../utils/logger.js");

/**
 * MCP Function Executor
 *
 * Bridges MCP tools to LLM Function Calling.
 * Converts MCP tools to OpenAI function format and proxies execution.
 *
 * @module MCPFunctionExecutor
 */

/**
 * MCP 函数执行器类
 * 将 MCP 工具转换为 LLM Function Calling 格式，并代理执行
 */
class MCPFunctionExecutor {
  /**
   * @param {Object} mcpClientManager - MCP 客户端管理器
   * @param {Object} mcpToolAdapter - MCP 工具适配器
   */
  constructor(mcpClientManager, mcpToolAdapter) {
    this.mcpClientManager = mcpClientManager;
    this.mcpToolAdapter = mcpToolAdapter;
    this._cachedFunctions = null;
    this._cacheTimestamp = null;
    this._cacheTTL = 30000; // 30 seconds cache TTL
  }

  /**
   * 获取所有 MCP 工具的 OpenAI function 格式
   * @returns {Promise<Array>} OpenAI function 格式的工具列表
   */
  async getFunctions() {
    // 使用缓存避免重复查询
    const now = Date.now();
    if (
      this._cachedFunctions &&
      this._cacheTimestamp &&
      now - this._cacheTimestamp < this._cacheTTL
    ) {
      return this._cachedFunctions;
    }

    const mcpTools = this.mcpToolAdapter.getMCPTools();
    const functions = [];

    for (const toolInfo of mcpTools) {
      try {
        const func = await this._convertToOpenAIFunction(toolInfo);
        if (func) {
          functions.push(func);
        }
      } catch (error) {
        logger.warn(
          `[MCPFunctionExecutor] 转换工具失败 ${toolInfo.toolId}:`,
          error.message,
        );
      }
    }

    this._cachedFunctions = functions;
    this._cacheTimestamp = now;

    return functions;
  }

  /**
   * 清除缓存（当 MCP 服务器连接/断开时调用）
   */
  clearCache() {
    this._cachedFunctions = null;
    this._cacheTimestamp = null;
  }

  /**
   * 执行 MCP 工具
   * @param {string} functionName - 函数名称（格式: mcp_${serverName}_${toolName}）
   * @param {Object} args - 函数参数
   * @returns {Promise<Object>} 执行结果
   */
  async execute(functionName, args) {
    const info = this._parseFunctionName(functionName);
    if (!info) {
      throw new Error(`Unknown MCP function: ${functionName}`);
    }

    logger.info(
      `[MCPFunctionExecutor] 执行工具: ${info.serverName}/${info.toolName}`,
    );
    logger.info(`[MCPFunctionExecutor] 参数:`, JSON.stringify(args, null, 2));

    // Enforce the MCP security policy on the LLM-chat path too. This chokepoint
    // was previously bypassed: only mcp-tool-adapter validated path access /
    // consent, so a tool call routed through LLM function-calling reached
    // callTool() unchecked. Validate symmetrically with the adapter path,
    // using the same policy instance the adapter carries.
    const securityPolicy = this.mcpToolAdapter?.securityPolicy;
    if (
      securityPolicy &&
      typeof securityPolicy.validateToolExecution === "function"
    ) {
      // Throws SecurityError on violation (denied path / read-only / declined
      // consent); let it propagate so the tool call is refused, not executed.
      await securityPolicy.validateToolExecution(
        info.serverName,
        info.toolName,
        args || {},
      );
    } else {
      logger.warn(
        "[MCPFunctionExecutor] No security policy wired on the tool adapter — MCP tool executing without policy validation",
      );
    }

    try {
      const result = await this.mcpClientManager.callTool(
        info.serverName,
        info.toolName,
        args,
      );

      logger.info(`[MCPFunctionExecutor] 工具执行成功`);

      // MCP 返回格式: { content: [...], isError: boolean }
      // 转换为统一格式
      return this._transformResult(result);
    } catch (error) {
      logger.error(`[MCPFunctionExecutor] 工具执行失败:`, error);
      throw error;
    }
  }

  /**
   * 检查是否有可用的 MCP 工具
   * @returns {boolean}
   */
  hasTools() {
    const mcpTools = this.mcpToolAdapter.getMCPTools();
    return mcpTools.length > 0;
  }

  /**
   * 获取已连接的服务器数量
   * @returns {number}
   */
  getConnectedServerCount() {
    return this.mcpClientManager.getConnectedServers().length;
  }

  // ===================================
  // Private Methods
  // ===================================

  /**
   * 解析函数名获取服务器和工具名
   * @private
   * @param {string} name - 函数名称（格式: mcp_${serverName}_${toolName}）
   * @returns {Object|null} { serverName, toolName } 或 null
   */
  _parseFunctionName(name) {
    // 格式: mcp_${serverName}_${toolName}
    // 优先用 adapter 的权威注册表精确解析——serverName 本身也可能含下划线（如
    // github_mcp / my_server），下面的正则 [^_]+ 会把它截断（github_mcp → "github"），
    // 导致 callTool 路由到不存在的服务器。注册表里存的就是 LLM 看到的 toolId。
    const info =
      this.mcpToolAdapter &&
      typeof this.mcpToolAdapter.getToolInfo === "function"
        ? this.mcpToolAdapter.getToolInfo(name)
        : null;
    if (info) {
      return {
        serverName: info.serverName,
        toolName: info.originalToolName,
      };
    }

    // 兜底：注册表未命中时按首个下划线切分（仅对无下划线的 serverName 正确）。
    const match = name.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) {
      return null;
    }
    return {
      serverName: match[1],
      toolName: match[2],
    };
  }

  /**
   * 将 MCP 工具转换为 OpenAI function 格式
   * @private
   * @param {Object} mcpToolInfo - MCP 工具信息
   * @returns {Promise<Object|null>} OpenAI function 格式
   */
  async _convertToOpenAIFunction(mcpToolInfo) {
    try {
      // 从 ToolManager 获取完整工具定义
      const tool = await this.mcpToolAdapter.toolManager.getTool(
        mcpToolInfo.toolId,
      );

      if (!tool) {
        logger.warn(`[MCPFunctionExecutor] 工具未找到: ${mcpToolInfo.toolId}`);
        return null;
      }

      // 构建 OpenAI function 格式
      const openAIFunction = {
        name: tool.name,
        description:
          tool.description || `MCP tool from ${mcpToolInfo.serverName}`,
        parameters: tool.parameters_schema || {
          type: "object",
          properties: {},
          required: [],
        },
      };

      return openAIFunction;
    } catch (error) {
      logger.warn(
        `[MCPFunctionExecutor] 转换工具失败 ${mcpToolInfo.toolId}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * 转换 MCP 结果为统一格式
   * @private
   * @param {Object} mcpResult - MCP 工具返回结果
   * @returns {Object} 统一格式的结果
   */
  _transformResult(mcpResult) {
    // MCP 结果格式: { content: [{ type, text/data }], isError }

    // A tool/server can resolve to null/undefined; dereferencing .isError on it
    // would throw a TypeError up to the LLM function-calling caller.
    if (mcpResult == null) {
      return {
        success: false,
        error: "MCP tool returned no result",
        content: [],
      };
    }
    if (mcpResult.isError) {
      const errorMessage = this._extractTextContent(mcpResult.content);
      return {
        success: false,
        error: errorMessage || "MCP tool execution failed",
        content: mcpResult.content,
      };
    }

    // 提取内容
    const content = this._extractContent(mcpResult.content);

    return {
      success: true,
      data: content,
      content: mcpResult.content,
    };
  }

  /**
   * 从 MCP content 数组中提取内容
   * @private
   * @param {Array} content - MCP content 数组
   * @returns {*} 提取的内容
   */
  _extractContent(content) {
    if (!Array.isArray(content)) {
      return content;
    }

    // 如果只有一个元素，直接返回其内容
    if (content.length === 1) {
      const item = content[0];
      if (item.type === "text") {
        return item.text;
      } else if (item.type === "image") {
        return item.data;
      }
      return item.text || item.data || item;
    }

    // 多个元素时，尝试合并文本
    const texts = content.filter((c) => c.type === "text").map((c) => c.text);

    if (texts.length > 0) {
      return texts.join("\n");
    }

    // 返回原始数组
    return content.map((c) => c.text || c.data || c);
  }

  /**
   * 从 MCP content 数组中提取文本内容
   * @private
   * @param {Array} content - MCP content 数组
   * @returns {string} 提取的文本
   */
  _extractTextContent(content) {
    if (!Array.isArray(content)) {
      return String(content);
    }

    return content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
}

module.exports = MCPFunctionExecutor;
