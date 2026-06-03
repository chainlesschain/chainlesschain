export function createToolContext({
  toolName = null,
  cwd = process.cwd(),
  sessionId = null,
  runtimeKind = null,
  policy = {},
  metadata = {},
} = {}) {
  return {
    toolName,
    cwd,
    sessionId,
    runtimeKind,
    policy,
    metadata,
  };
}

export function extendToolContext(context, patch = {}) {
  return {
    ...context,
    ...patch,
    metadata: {
      ...(context?.metadata || {}),
      ...(patch.metadata || {}),
    },
  };
}
