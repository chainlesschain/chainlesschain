export function createSessionRecord(session = {}, extras = {}) {
  const history = Array.isArray(extras.history)
    ? extras.history
    : Array.isArray(session.messages)
      ? session.messages.filter((item) => item.role !== "system")
      : [];

  return {
    id: session.id || extras.sessionId || null,
    type: session.type || extras.sessionType || null,
    provider: session.provider || extras.provider || null,
    model: session.model || extras.model || null,
    projectRoot: session.projectRoot || extras.projectRoot || null,
    messageCount: extras.messageCount ?? history.length,
    history,
    status: extras.status || null,
  };
}
