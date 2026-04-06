export function createAgentTurnRecord(turn = {}) {
  return {
    kind: turn.kind || null,
    sessionId: turn.sessionId || null,
    input: turn.input,
    meta: turn.meta || {},
    result: turn.result,
    startedAt: turn.startedAt || null,
    endedAt: turn.endedAt || null,
  };
}
