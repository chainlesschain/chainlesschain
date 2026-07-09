import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { bgRequest, isBgPushFrame } from "@chainlesschain/agent-sdk/browser";
import { useWsStore } from "./ws";

const MAX_EVENTS = 200;
const MAX_LOG_CHARS = 400_000;

/**
 * Background agents panel — drives the CLI's bg-* WS protocol, which relays
 * the local background-session transport (the same channel `cc attach`
 * speaks): list sessions, live-follow a session's log, and take it over with
 * follow-up prompts / stop-turn.
 */
export const useBackgroundAgentsStore = defineStore("backgroundAgents", () => {
  const sessions = ref([]);
  const loading = ref(false);
  const showAll = ref(true);
  const attachedId = ref(null);
  const attachedHello = ref(null);
  const transportClosed = ref(false);
  const logText = ref("");
  const events = ref([]);
  let pollTimer = null;
  let unsubscribeMessages = null;

  const running = computed(() =>
    sessions.value.filter((s) => s.status === "running"),
  );

  async function fetchSessions() {
    const ws = useWsStore();
    loading.value = true;
    try {
      const result = await ws.sendRaw(bgRequest("bg-list", { all: showAll.value }));
      if (result && Array.isArray(result.sessions)) {
        sessions.value = result.sessions;
      }
    } catch {
      // Non-critical — next poll retries
    } finally {
      loading.value = false;
    }
  }

  function _pushEvent(event) {
    events.value.push(event);
    if (events.value.length > MAX_EVENTS) {
      events.value.splice(0, events.value.length - MAX_EVENTS);
    }
  }

  function _appendLog(chunk) {
    logText.value += chunk;
    if (logText.value.length > MAX_LOG_CHARS) {
      logText.value = logText.value.slice(-MAX_LOG_CHARS);
    }
  }

  function _subscribeMessages() {
    if (unsubscribeMessages) return;
    const ws = useWsStore();
    unsubscribeMessages = ws.onMessage((msg) => {
      // SDK guard: only bg-event / bg-log push frames, and only ours.
      if (!isBgPushFrame(msg) || msg.bgId !== attachedId.value) return;
      if (msg.type === "bg-log" && typeof msg.chunk === "string") {
        _appendLog(msg.chunk);
      } else if (msg.type === "bg-event" && msg.event) {
        _pushEvent(msg.event);
        if (msg.event.type === "transport-closed") {
          transportClosed.value = true;
          fetchSessions();
        } else if (
          msg.event.type === "turn-started" ||
          msg.event.type === "turn-ended" ||
          msg.event.type === "idle"
        ) {
          fetchSessions();
        }
      }
    });
  }

  async function attach(bgId) {
    const ws = useWsStore();
    if (attachedId.value && attachedId.value !== bgId) {
      await detach();
    }
    const result = await ws.sendRaw(bgRequest("bg-attach", { bgId, lines: 200 }));
    attachedId.value = bgId;
    attachedHello.value = result?.hello || null;
    transportClosed.value = false;
    if (!result?.reattached) {
      logText.value = typeof result?.log === "string" ? result.log : "";
      events.value = [];
    }
    _subscribeMessages();
    return result;
  }

  async function sendPrompt(text) {
    const ws = useWsStore();
    const trimmed = String(text || "").trim();
    if (!attachedId.value || !trimmed) return false;
    await ws.sendRaw(
      bgRequest("bg-prompt", { bgId: attachedId.value, text: trimmed }),
    );
    return true;
  }

  async function stopTurn() {
    const ws = useWsStore();
    if (!attachedId.value) return;
    await ws.sendRaw(bgRequest("bg-stop-turn", { bgId: attachedId.value }));
  }

  async function detach() {
    const ws = useWsStore();
    const bgId = attachedId.value;
    attachedId.value = null;
    attachedHello.value = null;
    transportClosed.value = false;
    if (bgId) {
      try {
        await ws.sendRaw(bgRequest("bg-detach", { bgId }));
      } catch {
        // Relay may already be gone (worker finalized) — local state is reset
      }
    }
  }

  async function renameSession(bgId, title) {
    const ws = useWsStore()
    const trimmed = String(title || '').trim()
    if (!bgId || !trimmed) return false
    await ws.sendRaw(bgRequest('bg-rename', { bgId, title: trimmed }))
    await fetchSessions()
    return true
  }

  async function resumeSession(bgId, text) {
    const ws = useWsStore()
    const trimmed = String(text || '').trim()
    if (!bgId || !trimmed) return null
    const result = await ws.sendRaw(bgRequest('bg-resume', { bgId, text: trimmed }))
    await fetchSessions()
    return result?.session || null
  }

  async function stopSession(bgId) {
    const ws = useWsStore();
    const target = bgId || attachedId.value;
    if (!target) return;
    try {
      await ws.sendRaw(bgRequest("bg-stop", { bgId: target }));
    } finally {
      if (attachedId.value === target) {
        attachedId.value = null;
        attachedHello.value = null;
      }
      await fetchSessions();
    }
  }

  function startPolling(intervalMs = 5000) {
    stopPolling();
    fetchSessions();
    pollTimer = setInterval(fetchSessions, intervalMs);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /** Full teardown when the view unmounts: relay + poll + subscription. */
  async function teardown() {
    stopPolling();
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    await detach();
  }

  function getStatusColor(status) {
    switch (status) {
      case "running":
        return "processing";
      case "completed":
        return "success";
      case "failed":
        return "error";
      case "stopped":
        return "warning";
      case "lost":
        return "error";
      default:
        return "default";
    }
  }

  function formatElapsed(session, now = Date.now()) {
    const end = session?.endedAt || now;
    const ms = Math.max(0, end - (session?.startedAt || end));
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000)
      return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  }

  return {
    sessions,
    loading,
    showAll,
    running,
    attachedId,
    attachedHello,
    transportClosed,
    logText,
    events,
    fetchSessions,
    attach,
    sendPrompt,
    stopTurn,
    detach,
    renameSession,
    resumeSession,
    stopSession,
    startPolling,
    stopPolling,
    teardown,
    getStatusColor,
    formatElapsed,
  };
});
