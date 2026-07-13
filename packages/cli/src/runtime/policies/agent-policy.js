export function resolveAgentPolicy({
  config = null,
  overrides = {},
  defaults = {},
} = {}) {
  const llm = config?.llm || {};

  return {
    model: overrides.model || llm.model || defaults.model || "qwen2:7b",
    provider:
      overrides.provider || llm.provider || defaults.provider || "ollama",
    baseUrl:
      overrides.baseUrl !== undefined
        ? overrides.baseUrl
        : llm.baseUrl || defaults.baseUrl,
    apiKey:
      overrides.apiKey !== undefined
        ? overrides.apiKey
        : llm.apiKey || defaults.apiKey || null,
    sessionId: overrides.sessionId || null,
    agentId: overrides.agentId || null,
    recallMemory:
      overrides.recallMemory === false ? false : overrides.recallMemory,
    recallLimit: overrides.recallLimit,
    recallQuery: overrides.recallQuery,
    noStream: overrides.noStream === true,
    parkOnExit: overrides.parkOnExit === false ? false : true,
    bundlePath: overrides.bundlePath || null,
    remoteSessionRelayUrl: overrides.remoteSessionRelayUrl || null,
    remoteSessionPeerId: overrides.remoteSessionPeerId || null,
    additionalDirectories: Array.isArray(overrides.additionalDirectories)
      ? overrides.additionalDirectories
      : [],
    sandbox: overrides.sandbox || null,
    autoCheckpoint: overrides.autoCheckpoint === true,
    systemPrompt: overrides.systemPrompt || null,
    appendSystemPrompt: overrides.appendSystemPrompt || null,
    fallbackModel: overrides.fallbackModel || null,
    mcpConfig: overrides.mcpConfig || null,
    useRegisteredMcp: overrides.useRegisteredMcp !== false,
    // IDE bridge tri-state (undefined=auto / true=--ide / false=--no-ide); the
    // REPL forwards it to resolveAgentMcp so --ide/--no-ide work interactively.
    ide: overrides.ide,
    // IDEA built-in MCP tri-state (undefined=auto when the JetBrains plugin
    // injected the endpoint / true=--jetbrains / false=--no-jetbrains).
    jetbrains: overrides.jetbrains,
    // Consumed by the interactive REPL (startAgentRepl) — plain passthrough
    // (undefined = unset). These were silently dropped by this allowlist
    // before 2026-07-09, breaking --vim/--think/--thinking-budget/
    // --fallback-model/--pdh/--permission-mode for interactive sessions.
    permissionMode: overrides.permissionMode,
    // --no-project-memory tri-state (undefined=default-on / false=lean prompt).
    // Plain passthrough consumed by startAgentRepl → composeSystemPrompt /
    // buildSystemPrompt; without this allowlist entry the flag would be silently
    // dropped for interactive sessions (same class as the vim/think/pdh fixes).
    projectMemory: overrides.projectMemory,
    vimMode: overrides.vimMode,
    thinking: overrides.thinking,
    thinkingBudget: overrides.thinkingBudget,
    fallbackModels: overrides.fallbackModels,
    pdh: overrides.pdh,
    outputStyle: overrides.outputStyle,
    disableSlashCommands: overrides.disableSlashCommands === true,
    // --remote-control also applies interactively: the REPL starts the
    // paired-device approval bridge at startup (批26).
    remoteControl: overrides.remoteControl === true,
    // --channels: inbound channel listeners (webhook/telegram) whose events
    // become user turns in the interactive session (gap-2026-07-11 P0#5).
    channels: overrides.channels || null,
  };
}

export function resolveServerPolicy(overrides = {}) {
  return {
    port: overrides.port,
    host: overrides.host,
    token: overrides.token || null,
    maxConnections: overrides.maxConnections,
    timeout: overrides.timeout,
    allowRemote: Boolean(overrides.allowRemote),
    project: overrides.project || process.cwd(),
    httpPort: overrides.httpPort || null,
    bundlePath: overrides.bundlePath || null,
    // startServer() reads these for the Remote Session E2EE relay. They were
    // silently dropped by this allowlist before 2026-07-09 — `cc serve
    // --remote-session-relay-url` never actually enabled the relay (same
    // allowlist-drop class as the batch-9 resolveAgentPolicy fix).
    remoteSessionRelayUrl: overrides.remoteSessionRelayUrl || null,
    remoteSessionPeerId: overrides.remoteSessionPeerId || null,
  };
}

export function resolveUiPolicy(overrides = {}) {
  return {
    port: overrides.port,
    wsPort: overrides.wsPort,
    host: overrides.host,
    open: overrides.open !== false,
    token: overrides.token || null,
    webPanelDir: overrides.webPanelDir || null,
    uiMode: overrides.uiMode || "auto",
  };
}
