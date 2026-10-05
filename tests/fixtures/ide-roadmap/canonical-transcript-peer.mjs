// Test peer only: deterministic model output, production canonical persistence
// and the actual CLI history/receipt command. Never use the user's CLI home.
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function canonicalTranscriptPeer(root, trace) {
  if (!root || !isAbsolute(root) || !existsSync(root))
    throw new Error(
      "Canonical host fixture requires an existing absolute isolated root",
    );
  root = realpathSync(root);
  const repository = realpathSync(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const child = relative(repository, root);
  if (
    !child ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  )
    throw new Error("Canonical host fixture root must be outside the worktree");
  process.env.CHAINLESSCHAIN_HOME = join(root, "home");
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(root, "security");
  const store =
    await import("../../../packages/cli/src/harness/jsonl-session-store.js");
  const { readSessionTranscriptHistory } =
    await import("../../../packages/cli/src/lib/session-transcript-history.js");
  const { appendSessionInputWithReceipt } =
    await import("../../../packages/cli/src/lib/session-input-receipt.js");
  return {
    async command(argv) {
      if (
        argv[0] !== "session" ||
        argv[1] !== "show" ||
        (!argv.includes("--history") && !argv.includes("--input-receipt"))
      )
        return false;
      const commandId = randomUUID();
      trace({
        direction: "command",
        command: "canonical-session-show",
        commandId,
        args: argv,
      });
      const cli = fileURLToPath(
        new URL("../../../packages/cli/bin/chainlesschain.js", import.meta.url),
      );
      const processChild = spawn(process.execPath, [cli, ...argv], {
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "inherit", "inherit"],
      });
      const result = await new Promise((done, reject) => {
        processChild.once("error", reject);
        processChild.once("close", (code, signal) => done({ code, signal }));
      });
      trace({
        direction: "command",
        command: "canonical-session-show-complete",
        commandId,
        processId: processChild.pid,
        ...result,
      });
      process.exitCode = result.code === 0 && result.signal === null ? 0 : 1;
      return true;
    },
    start(sessionId) {
      const page = readSessionTranscriptHistory(sessionId, { limit: 1 });
      if (page.eventCount === 0)
        store.startSession(sessionId, {
          provider: "fixture",
          model: "deterministic-host-peer",
        });
      const messages = store.readVerifiedMessages(sessionId);
      return {
        turns: messages.filter((message) => message.role === "user").length,
        messages: messages.length,
      };
    },
    accept(sessionId, event, emit) {
      const text = String(event.text || "");
      if (event.client_message_id) {
        const receipt = appendSessionInputWithReceipt(
          sessionId,
          text,
          event.client_message_id,
          { text, images: event.images || [] },
        );
        emit({
          type: "system",
          subtype: "input_accepted",
          session_id: sessionId,
          client_message_id: event.client_message_id,
          receipt,
        });
        return {
          userEventId: receipt.eventHash,
          clientMessageId: event.client_message_id,
          duplicate: receipt.duplicate,
        };
      }
      return {
        userEventId: store.appendUserMessage(sessionId, text).hash,
        duplicate: false,
      };
    },
    finish(sessionId, result, input) {
      const committed = store.appendAssistantMessage(sessionId, result);
      if (committed.commitState !== "committed")
        throw new Error("Fixture assistant was not committed");
      const refs = {
        schema: "chainlesschain.session-transcript-references/v1",
        sessionId,
        assistantEventId: committed.hash,
      };
      if (input?.userEventId) refs.userEventId = input.userEventId;
      if (input?.clientMessageId) refs.clientMessageId = input.clientMessageId;
      trace({
        direction: "canonical",
        command: "assistant-committed",
        sessionId,
        refs,
      });
      return refs;
    },
  };
}
