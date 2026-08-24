/**
 * Canonical hosted-tool execution port for the Desktop Coding Agent.
 *
 * Policy/approval stays owned by CodingAgentSessionService. Once authorized,
 * every managed or MCP tool is executed through this broker so provider API
 * differences cannot leak into the session loop.
 */
class CodingAgentToolBroker {
  constructor(options = {}) {
    this.toolManager = options.toolManager || null;
    this.mcpManager = options.mcpManager || null;
  }

  async execute(descriptor, args = {}, context = {}) {
    if (!descriptor?.name) {
      throw new Error("ToolBroker.execute requires a tool descriptor");
    }

    if (descriptor.mcpMetadata?.serverName) {
      return this._executeMcp(descriptor, args, context);
    }
    return this._executeManaged(descriptor, args, context);
  }

  async _executeMcp(descriptor, args, context) {
    if (!this.mcpManager || typeof this.mcpManager.callTool !== "function") {
      throw new Error(
        `MCP manager is unavailable for tool "${descriptor.name}".`,
      );
    }

    const result = await this.mcpManager.callTool(
      descriptor.mcpMetadata.serverName,
      descriptor.mcpMetadata.originalToolName,
      args,
      context,
    );
    return result && typeof result === "object"
      ? { ...result, toolName: descriptor.name }
      : { result, toolName: descriptor.name };
  }

  async _executeManaged(descriptor, args, context) {
    const functionCaller = this.toolManager?.functionCaller || null;
    if (!functionCaller || typeof functionCaller.call !== "function") {
      throw new Error(
        `Tool manager function caller is unavailable for tool "${descriptor.name}".`,
      );
    }

    if (
      typeof functionCaller.hasTool === "function" &&
      !functionCaller.hasTool(descriptor.name)
    ) {
      throw new Error(`Hosted tool is not registered: ${descriptor.name}`);
    }

    const result = await functionCaller.call(descriptor.name, args, context);
    return result && typeof result === "object"
      ? result
      : {
          result,
          toolName: descriptor.name,
          sessionId: context.sessionId || null,
        };
  }
}

module.exports = {
  CodingAgentToolBroker,
};
