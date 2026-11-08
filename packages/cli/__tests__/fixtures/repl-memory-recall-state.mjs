import { fileURLToPath } from "node:url";

export const OLD_MARKER = "REPL_RECALL_OLD_51947";
export const NEW_MARKER = "REPL_RECALL_NEW_86253";
const [mode, endpoint, recall, sessionId, resume] = process.argv.slice(2);
const emit = (receipt) =>
  console.log(JSON.stringify({ fixture: "repl-memory-recall", ...receipt }));

if (mode === "repl") {
  // Input-terminal emulation selects the real interactive branch; this is not
  // an OS PTY test. Readline, CLI/Evolution, persistence and HTTP stay real.
  Object.defineProperty(process.stdin, "isTTY", { value: true });
  process.stdin.setRawMode = () => {};
  const bin = new URL("../../bin/chainlesschain.js", import.meta.url);
  process.argv = [
    process.execPath,
    fileURLToPath(bin),
    "agent",
    "--provider",
    "ollama",
    "--model",
    "qwen2.5:7b",
    "--base-url",
    endpoint,
    "--no-stream",
    "--no-mcp",
    "--no-ide",
    "--no-pdh",
    "--no-jetbrains",
    "--no-checkpoint",
    "--sandbox-mode",
    "off",
  ];
  if (recall === "deny") process.argv.push("--no-recall-memory");
  if (sessionId)
    process.argv.push(
      resume === "resume" ? "--resume" : "--session",
      sessionId,
    );
  await import(bin.href);
} else if (mode === "seed" || mode === "replace") {
  const { createCliContextMemoryRuntime } =
    await import("../../src/lib/context-memory-kernel/runtime.js");
  const { CliCanonicalMemoryService } =
    await import("../../src/lib/context-memory-kernel/memory-service.js");
  const runtime = createCliContextMemoryRuntime({ purgePorts: [] });
  const service = new CliCanonicalMemoryService({ runtime });
  let deleted = null;
  if (mode === "replace") deleted = await service.delete("repl-original");
  await service.addScoped(
    `REPL_TOPIC ${mode === "seed" ? OLD_MARKER : NEW_MARKER}`,
    {
      memoryId: mode === "seed" ? "repl-original" : "repl-replacement",
      scope: "user",
      scopeId: "local-user",
      allowedSinks: ["provider.ollama"],
      importance: 0.95,
    },
  );
  emit({
    stage: mode,
    deletedStatus: deleted?.status ?? null,
    revision: await runtime.memoryPort.getRevision(),
  });
} else if (mode === "inspect") {
  const { listSessionIds, readVerifiedTranscriptBytes, readVerifiedMessages } =
    await import("../../src/harness/jsonl-session-store.js");
  const sessions = [];
  for (const id of listSessionIds()) {
    const text = await readVerifiedTranscriptBytes(id);
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const messages = await readVerifiedMessages(id);
    sessions.push({
      id,
      verified: true,
      eventCount: events.length,
      hasOldMarker: text.includes(OLD_MARKER),
      hasNewMarker: text.includes(NEW_MARKER),
      userTurns: messages.filter((message) => message.role === "user").length,
      assistantTurns: messages.filter((message) => message.role === "assistant")
        .length,
    });
  }
  emit({ stage: "inspect", sessions });
} else if (mode !== undefined) {
  throw new Error("Unknown recall-state fixture mode");
}
