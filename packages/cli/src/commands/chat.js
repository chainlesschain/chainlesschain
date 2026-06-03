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

// === Iter26 V2 governance overlay ===
export function registerIagovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "chat");
  if (!parent) return;
  const L = async () => await import("../lib/interaction-adapter.js");
  parent
    .command("iagov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.IAGOV_PROFILE_MATURITY_V2,
            turnLifecycle: m.IAGOV_TURN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("iagov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveIagovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingIagovTurnsPerProfileV2(),
            idleMs: m.getIagovProfileIdleMsV2(),
            stuckMs: m.getIagovTurnStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("iagov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveIagovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("iagov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingIagovTurnsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("iagov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setIagovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("iagov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setIagovTurnStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("iagov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--adapter <v>", "adapter")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerIagovProfileV2({ id, owner, adapter: o.adapter }),
          null,
          2,
        ),
      );
    });
  parent
    .command("iagov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateIagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("iagov-idle-v2 <id>")
    .description("Idle profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).idleIagovProfileV2(id), null, 2));
    });
  parent
    .command("iagov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveIagovProfileV2(id), null, 2),
      );
    });
  parent
    .command("iagov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchIagovProfileV2(id), null, 2));
    });
  parent
    .command("iagov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getIagovProfileV2(id), null, 2));
    });
  parent
    .command("iagov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listIagovProfilesV2(), null, 2));
    });
  parent
    .command("iagov-create-turn-v2 <id> <profileId>")
    .description("Create turn")
    .option("--input <v>", "input")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createIagovTurnV2({ id, profileId, input: o.input }),
          null,
          2,
        ),
      );
    });
  parent
    .command("iagov-responding-turn-v2 <id>")
    .description("Mark turn as responding")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).respondingIagovTurnV2(id), null, 2),
      );
    });
  parent
    .command("iagov-complete-turn-v2 <id>")
    .description("Complete turn")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeTurnIagovV2(id), null, 2));
    });
  parent
    .command("iagov-fail-turn-v2 <id> [reason]")
    .description("Fail turn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failIagovTurnV2(id, reason), null, 2),
      );
    });
  parent
    .command("iagov-cancel-turn-v2 <id> [reason]")
    .description("Cancel turn")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelIagovTurnV2(id, reason), null, 2),
      );
    });
  parent
    .command("iagov-get-turn-v2 <id>")
    .description("Get turn")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getIagovTurnV2(id), null, 2));
    });
  parent
    .command("iagov-list-turns-v2")
    .description("List turns")
    .action(async () => {
      console.log(JSON.stringify((await L()).listIagovTurnsV2(), null, 2));
    });
  parent
    .command("iagov-auto-idle-idle-v2")
    .description("Auto-idle idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoIdleIdleIagovProfilesV2(), null, 2),
      );
    });
  parent
    .command("iagov-auto-fail-stuck-v2")
    .description("Auto-fail stuck turns")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckIagovTurnsV2(), null, 2),
      );
    });
  parent
    .command("iagov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getInteractionAdapterGovStatsV2(), null, 2),
      );
    });
}

// === Iter27 V2 governance overlay ===
export function registerWscgovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "chat");
  if (!parent) return;
  const L = async () => await import("../lib/ws-chat-handler.js");
  parent
    .command("wscgov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.WSCGOV_PROFILE_MATURITY_V2,
            msgLifecycle: m.WSCGOV_MSG_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("wscgov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveWscgovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingWscgovMsgsPerProfileV2(),
            idleMs: m.getWscgovProfileIdleMsV2(),
            stuckMs: m.getWscgovMsgStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("wscgov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveWscgovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wscgov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingWscgovMsgsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wscgov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setWscgovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wscgov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setWscgovMsgStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("wscgov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--connection <v>", "connection")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerWscgovProfileV2({ id, owner, connection: o.connection }),
          null,
          2,
        ),
      );
    });
  parent
    .command("wscgov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateWscgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("wscgov-idle-v2 <id>")
    .description("Idle profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).idleWscgovProfileV2(id), null, 2));
    });
  parent
    .command("wscgov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveWscgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("wscgov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchWscgovProfileV2(id), null, 2),
      );
    });
  parent
    .command("wscgov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getWscgovProfileV2(id), null, 2));
    });
  parent
    .command("wscgov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listWscgovProfilesV2(), null, 2));
    });
  parent
    .command("wscgov-create-msg-v2 <id> <profileId>")
    .description("Create msg")
    .option("--payload <v>", "payload")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createWscgovMsgV2({ id, profileId, payload: o.payload }),
          null,
          2,
        ),
      );
    });
  parent
    .command("wscgov-handling-msg-v2 <id>")
    .description("Mark msg as handling")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).handlingWscgovMsgV2(id), null, 2));
    });
  parent
    .command("wscgov-complete-msg-v2 <id>")
    .description("Complete msg")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeMsgWscgovV2(id), null, 2));
    });
  parent
    .command("wscgov-fail-msg-v2 <id> [reason]")
    .description("Fail msg")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failWscgovMsgV2(id, reason), null, 2),
      );
    });
  parent
    .command("wscgov-cancel-msg-v2 <id> [reason]")
    .description("Cancel msg")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelWscgovMsgV2(id, reason), null, 2),
      );
    });
  parent
    .command("wscgov-get-msg-v2 <id>")
    .description("Get msg")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getWscgovMsgV2(id), null, 2));
    });
  parent
    .command("wscgov-list-msgs-v2")
    .description("List msgs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listWscgovMsgsV2(), null, 2));
    });
  parent
    .command("wscgov-auto-idle-idle-v2")
    .description("Auto-idle idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoIdleIdleWscgovProfilesV2(), null, 2),
      );
    });
  parent
    .command("wscgov-auto-fail-stuck-v2")
    .description("Auto-fail stuck msgs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckWscgovMsgsV2(), null, 2),
      );
    });
  parent
    .command("wscgov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getWsChatHandlerGovStatsV2(), null, 2),
      );
    });
}

// === Iter28 V2 governance overlay: Ccoregov ===
export function registerCcoreV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "chat");
  if (!parent) return;
  const L = async () => await import("../lib/chat-core.js");
  parent
    .command("ccoregov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.CCOREGOV_PROFILE_MATURITY_V2,
            msgLifecycle: m.CCOREGOV_MSG_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ccoregov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveCcoreProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingCcoreMsgsPerProfileV2(),
            idleMs: m.getCcoreProfileIdleMsV2(),
            stuckMs: m.getCcoreMsgStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ccoregov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveCcoreProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ccoregov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingCcoreMsgsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ccoregov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setCcoreProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ccoregov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setCcoreMsgStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ccoregov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--channel <v>", "channel")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerCcoreProfileV2({ id, owner, channel: o.channel }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ccoregov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateCcoreProfileV2(id), null, 2),
      );
    });
  parent
    .command("ccoregov-idle-v2 <id>")
    .description("Idle profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).idleCcoreProfileV2(id), null, 2));
    });
  parent
    .command("ccoregov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveCcoreProfileV2(id), null, 2),
      );
    });
  parent
    .command("ccoregov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).touchCcoreProfileV2(id), null, 2));
    });
  parent
    .command("ccoregov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCcoreProfileV2(id), null, 2));
    });
  parent
    .command("ccoregov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCcoreProfilesV2(), null, 2));
    });
  parent
    .command("ccoregov-create-msg-v2 <id> <profileId>")
    .description("Create msg")
    .option("--messageId <v>", "messageId")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createCcoreMsgV2({ id, profileId, messageId: o.messageId }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ccoregov-sending-msg-v2 <id>")
    .description("Mark msg as sending")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).sendingCcoreMsgV2(id), null, 2));
    });
  parent
    .command("ccoregov-complete-msg-v2 <id>")
    .description("Complete msg")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).completeMsgCcoreV2(id), null, 2));
    });
  parent
    .command("ccoregov-fail-msg-v2 <id> [reason]")
    .description("Fail msg")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failCcoreMsgV2(id, reason), null, 2),
      );
    });
  parent
    .command("ccoregov-cancel-msg-v2 <id> [reason]")
    .description("Cancel msg")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelCcoreMsgV2(id, reason), null, 2),
      );
    });
  parent
    .command("ccoregov-get-msg-v2 <id>")
    .description("Get msg")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getCcoreMsgV2(id), null, 2));
    });
  parent
    .command("ccoregov-list-msgs-v2")
    .description("List msgs")
    .action(async () => {
      console.log(JSON.stringify((await L()).listCcoreMsgsV2(), null, 2));
    });
  parent
    .command("ccoregov-auto-idle-idle-v2")
    .description("Auto-idle idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoIdleIdleCcoreProfilesV2(), null, 2),
      );
    });
  parent
    .command("ccoregov-auto-fail-stuck-v2")
    .description("Auto-fail stuck msgs")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckCcoreMsgsV2(), null, 2),
      );
    });
  parent
    .command("ccoregov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(JSON.stringify((await L()).getCcoregovStatsV2(), null, 2));
    });
}
