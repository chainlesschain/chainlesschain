/**
 * Interactive AI chat command
 * chainlesschain chat [--model] [--provider] [--agent]
 */

import { createAgentRuntimeFactory } from "../runtime/runtime-factory.js";

export function registerChatCommand(program) {
  program
    .command("chat")
    .description("Start an interactive AI chat session")
    .option("--model <model>", "Model name")
    .option(
      "--provider <provider>",
      "LLM provider (ollama, openai, volcengine, deepseek, ...)",
    )
    .option("--base-url <url>", "API base URL")
    .option("--api-key <key>", "API key")
    .option(
      "--agent",
      "Agentic mode - AI can read/write files and run commands (like Claude Code)",
    )
    .option("--session <id>", "Resume a previous session (agent mode)")
    .action(async (options) => {
      const factory = createAgentRuntimeFactory();
      const runtimeOptions = {
        model: options.model,
        provider: options.provider,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        sessionId: options.session,
      };

      if (options.agent) {
        await factory.createAgentRuntime(runtimeOptions).startAgentSession();
      } else {
        await factory.createChatRuntime(runtimeOptions).startChatSession();
      }
    });
}

// === Iter17 V2 governance overlay ===
export function registerChatgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "chat");
  if (!parent) return;
  const L = async () => await import("../lib/chat-core.js");
  parent
    .command("chatgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CHATGOV_PROFILE_MATURITY_V2,
            messageLifecycle: m.CHATGOV_MESSAGE_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("chatgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveChatgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingChatgovMessagesPerProfileV2(),
            idleMs: m.getChatgovProfileIdleMsV2(),
            stuckMs: m.getChatgovMessageStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("chatgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveChatgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("chatgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingChatgovMessagesPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("chatgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setChatgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("chatgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setChatgovMessageStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("chatgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--mode <v>", "mode")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerChatgovProfileV2({ id, owner, mode: o.mode }),
          null,
          2,
        ),
      );
    });
  parent
    .command("chatgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateChatgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-stale-v2 <id>")
    .description("Stale profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).staleChatgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveChatgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchChatgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getChatgovProfileV2(id), null, 2));
    });
  parent
    .command("chatgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listChatgovProfilesV2(), null, 2));
    });
  parent
    .command("chatgov-create-message-v2 <id> <profileId>")
    .description("Create message")
    .option("--role <v>", "role")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createChatgovMessageV2({ id, profileId, role: o.role }),
          null,
          2,
        ),
      );
    });
  parent
    .command("chatgov-sending-message-v2 <id>")
    .description("Mark message as sending")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).sendingChatgovMessageV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-complete-message-v2 <id>")
    .description("Complete message")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeMessageChatgovV2(id), null, 2),
      );
    });
  parent
    .command("chatgov-fail-message-v2 <id> [reason]")
    .description("Fail message")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failChatgovMessageV2(id, reason), null, 2),
      );
    });
  parent
    .command("chatgov-cancel-message-v2 <id> [reason]")
    .description("Cancel message")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelChatgovMessageV2(id, reason), null, 2),
      );
    });
  parent
    .command("chatgov-get-message-v2 <id>")
    .description("Get message")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getChatgovMessageV2(id), null, 2));
    });
  parent
    .command("chatgov-list-messages-v2")
    .description("List messages")
    .action(async () => {
      console.log(JSON.stringify((await L()).listChatgovMessagesV2(), null, 2));
    });
  parent
    .command("chatgov-auto-stale-idle-v2")
    .description("Auto-stale idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoStaleIdleChatgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("chatgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck messages")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckChatgovMessagesV2(), null, 2),
      );
    });
  parent
    .command("chatgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getChatCoreGovStatsV2(), null, 2));
    });
}
