import { captureAgentEvolutionIngress } from "./agent-evolution-ingress.js";

export const AGENT_EVOLUTION_SESSION_SCHEMA = "agent-evolution-session/v1";
const sessions = new WeakMap();

// readline startup returns before the interactive session ends. Its owner must
// finish the durable Run during teardown, before process.exit can terminate it.
// The runtime receives only an opaque waiter, never the ability to close early.
export function createAgentEvolutionSessionLifecycle(value) {
  const ingress = captureAgentEvolutionIngress(value);
  let resolveFinished;
  let rejectFinished;
  const finished = new Promise((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  // Teardown can fail before startup has returned the handle to its consumer.
  void finished.catch(() => {});
  const handle = Object.freeze({ schema: AGENT_EVOLUTION_SESSION_SCHEMA });
  sessions.set(handle, { ingress, finished });
  let closing = null;
  return Object.freeze({
    handle,
    close(error = null) {
      if (closing === null) {
        closing = (async () => {
          if (error !== null) throw error;
          await ingress.complete();
        })();
        void closing.then(resolveFinished, rejectFinished);
      }
      return closing;
    },
  });
}

export function waitForAgentEvolutionSession(handle, value) {
  const ingress = captureAgentEvolutionIngress(value);
  const session = sessions.get(handle);
  if (!session || session.ingress !== ingress) {
    throw Object.assign(new Error("Agent evolution session is unbound"), {
      code: "CC_AGENT_EVOLUTION_INGRESS_FAILED",
    });
  }
  return session.finished;
}
