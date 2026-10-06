import { readFileSync } from "node:fs";

/** Test-only barrier before init: release exactly one named session/nonce. */
export async function waitForInitGate(sessionId, trace) {
  const gatePath = process.env.CC_UI_INIT_GATE;
  if (!gatePath) return;
  const read = (file, partial = false) => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || (partial && error instanceof SyntaxError))
        return null;
      throw error;
    }
  };
  const gate = read(gatePath);
  if (!gate || gate.sessionId !== sessionId) return;
  if (
    typeof gate.nonce !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/u.test(gate.nonce)
  )
    throw new Error("Invalid fixture init gate nonce");
  const timeoutMs = gate.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000)
    throw new Error("Fixture init gate timeout must be 1..180000 milliseconds");
  const identity = { sessionId, nonce: gate.nonce, processId: process.pid };
  trace({ direction: "fixture", command: "init-gate-waiting", ...identity });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const release = read(`${gatePath}.release`, true);
    if (release?.sessionId === sessionId && release?.nonce === gate.nonce) {
      trace({
        direction: "fixture",
        command: "init-gate-released",
        ...identity,
      });
      if (release.exitBeforeInit === true) return "exit-before-init";
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Fixture init gate was not explicitly released within ${timeoutMs} milliseconds`,
  );
}
