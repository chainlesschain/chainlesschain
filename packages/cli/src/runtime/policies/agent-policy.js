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
  };
}
