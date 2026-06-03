<template>
  <a-modal
    :open="open"
    title="远程终端 (Plan A)"
    :footer="null"
    width="900px"
    :body-style="{ padding: '0' }"
    @cancel="onClose"
    @update:open="$emit('update:open', $event)"
  >
    <div class="terminal-panel">
      <div class="terminal-header">
        <div class="header-left">
          <a-select
            v-model:value="newShell"
            size="small"
            style="width: 130px"
            :options="shellOptions"
          />
          <a-button
            type="primary"
            size="small"
            :loading="creating"
            @click="onCreate"
          >
            <template #icon>
              <PlusOutlined />
            </template>
            新会话
          </a-button>
          <a-button size="small" :loading="loadingList" @click="refreshList">
            <template #icon>
              <ReloadOutlined />
            </template>
            刷新
          </a-button>
        </div>
        <a-tag v-if="warning" color="orange">
          {{ warning }}
        </a-tag>
      </div>
      <a-alert
        v-if="error"
        :message="error"
        type="error"
        show-icon
        closable
        style="margin: 8px"
        @close="error = ''"
      />
      <div class="terminal-body">
        <div class="session-tabs">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="session-tab"
            :class="{ active: s.id === activeId, dead: !s.alive }"
            @click="activate(s.id)"
          >
            <span>{{ s.shell }} {{ shortId(s.id) }}</span>
            <CloseOutlined
              class="session-close"
              @click.stop="onCloseSession(s.id)"
            />
          </div>
          <div v-if="sessions.length === 0" class="session-empty">
            点击 "新会话" 创建第一个终端
          </div>
        </div>
        <div class="xterm-host">
          <div
            v-for="s in sessions"
            v-show="s.id === activeId"
            :key="s.id"
            ref="xtermContainers"
            :data-session-id="s.id"
            class="xterm-container"
          />
          <div v-if="sessions.length === 0" class="xterm-placeholder">
            无活跃会话
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onBeforeUnmount } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  CloseOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";

interface Props {
  open: boolean;
  prefillText?: string;
}
const props = defineProps<Props>();
defineEmits<{ (e: "update:open", v: boolean): void }>();

interface SessionRow {
  id: string;
  shell: string;
  cwd?: string;
  alive: boolean;
  lastSeq: number;
  exitCode: number | null;
  xterm: any;
  fitAddon: any;
  offs: () => void;
}

const sessions = ref<SessionRow[]>([]);
const activeId = ref<string | null>(null);
const newShell = ref("pwsh");
const creating = ref(false);
const loadingList = ref(false);
const error = ref("");
const warning = ref("");
const xtermContainers = ref<HTMLElement[]>([]);

const shellOptions = [
  { value: "pwsh", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "bash", label: "Bash" },
  { value: "wsl", label: "WSL" },
];

function shortId(id: string) {
  return id ? id.slice(0, 8) : "";
}

const electronAPI: any = (window as any).electronAPI;

if (!electronAPI?.terminal) {
  warning.value = "electronAPI.terminal 未就绪 (preload 桥未加载)";
}

// Singleton onStdout/onExit listeners install once and fan out by sessionId.
const stdoutHandlers = new Map<string, (e: any) => void>();
const exitHandlers = new Map<string, (e: any) => void>();
let detachStdout: (() => void) | null = null;
let detachExit: (() => void) | null = null;

function ensureGlobalListeners() {
  if (detachStdout || !electronAPI?.terminal) {
    return;
  }
  detachStdout = electronAPI.terminal.onStdout((evt: any) => {
    stdoutHandlers.get(evt.sessionId)?.(evt);
  });
  detachExit = electronAPI.terminal.onExit((evt: any) => {
    exitHandlers.get(evt.sessionId)?.(evt);
  });
}

let xtermModP: Promise<{ x: any; f: any }> | null = null;
function loadXterm() {
  if (!xtermModP) {
    xtermModP = (async () => {
      const x = await import("@xterm/xterm");
      const f = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");
      return { x, f };
    })().catch((e) => {
      warning.value = "xterm 加载失败：" + (e?.message || String(e));
      throw e;
    });
  }
  return xtermModP;
}

async function mountXterm(session: SessionRow) {
  await nextTick();
  const { x, f } = await loadXterm();
  const container = xtermContainers.value.find(
    (el) => (el as any)?.dataset?.sessionId === session.id,
  );
  if (!container) {
    return;
  }
  const xterm = new x.Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: { background: "#1e1e1e", foreground: "#d4d4d4" },
  });
  const fitAddon = new f.FitAddon();
  xterm.loadAddon(fitAddon);
  xterm.open(container);
  try {
    fitAddon.fit();
  } catch {
    /* container may have 0×0 pre-paint */
  }

  session.xterm = xterm;
  session.fitAddon = fitAddon;

  const offData = xterm.onData((data: string) => {
    electronAPI.terminal.stdin(session.id, data).catch((e: any) => {
      message.error("stdin 失败: " + (e?.message || e));
    });
  });

  stdoutHandlers.set(session.id, ({ data, seq }) => {
    session.lastSeq = seq;
    xterm.write(data);
  });
  exitHandlers.set(session.id, ({ exitCode, signal }) => {
    session.alive = false;
    session.exitCode = exitCode;
    xterm.writeln(
      `\r\n\x1b[33m[session exited, code=${exitCode}, signal=${signal ?? "-"}]\x1b[0m`,
    );
  });

  session.offs = () => {
    try {
      offData.dispose?.();
    } catch {
      /* idempotent */
    }
    stdoutHandlers.delete(session.id);
    exitHandlers.delete(session.id);
  };

  try {
    const { chunks, truncated } = await electronAPI.terminal.history(
      session.id,
      0,
    );
    if (truncated) {
      xterm.writeln("\x1b[2m[history truncated]\x1b[0m");
    }
    for (const c of chunks) {
      xterm.write(c.data);
      session.lastSeq = c.seq;
    }
  } catch (e: any) {
    xterm.writeln(`\x1b[31m[history failed: ${e?.message || e}]\x1b[0m`);
  }

  const ro = new ResizeObserver(() => {
    try {
      fitAddon.fit();
      electronAPI.terminal
        .resize(session.id, xterm.cols, xterm.rows)
        .catch(() => {});
    } catch {
      /* benign */
    }
  });
  ro.observe(container);
  const prev = session.offs;
  session.offs = () => {
    try {
      ro.disconnect();
    } catch {
      /* idempotent */
    }
    prev();
  };
}

async function onCreate() {
  if (!electronAPI?.terminal) {
    return;
  }
  creating.value = true;
  error.value = "";
  try {
    ensureGlobalListeners();
    const created = await electronAPI.terminal.create({
      shell: newShell.value,
      cols: 80,
      rows: 24,
    });
    const s: SessionRow = {
      id: created.sessionId,
      shell: created.shell,
      cwd: "",
      alive: true,
      lastSeq: 0,
      exitCode: null,
      xterm: null,
      fitAddon: null,
      offs: () => {},
    };
    sessions.value.push(s);
    activeId.value = s.id;
    await mountXterm(s);
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    creating.value = false;
  }
}

async function onCloseSession(id: string) {
  try {
    await electronAPI.terminal.close(id);
  } catch (e: any) {
    error.value = e?.message || String(e);
  }
  setTimeout(() => removeSession(id), 500);
}

function removeSession(id: string) {
  const idx = sessions.value.findIndex((s) => s.id === id);
  if (idx === -1) {
    return;
  }
  const s = sessions.value[idx];
  try {
    s.offs?.();
  } catch {
    /* idempotent */
  }
  try {
    s.xterm?.dispose?.();
  } catch {
    /* idempotent */
  }
  sessions.value.splice(idx, 1);
  if (activeId.value === id) {
    activeId.value = sessions.value[0]?.id || null;
  }
}

function activate(id: string) {
  activeId.value = id;
  nextTick(() => {
    const s = sessions.value.find((x) => x.id === id);
    try {
      s?.fitAddon?.fit();
    } catch {
      /* benign */
    }
  });
}

async function refreshList() {
  if (!electronAPI?.terminal) {
    return;
  }
  loadingList.value = true;
  error.value = "";
  try {
    ensureGlobalListeners();
    const remote = await electronAPI.terminal.list();
    for (const r of remote) {
      const owned = sessions.value.find((s) => s.id === r.id);
      if (owned) {
        owned.alive = r.alive;
        owned.lastSeq = r.lastSeq;
        continue;
      }
      const s: SessionRow = {
        id: r.id,
        shell: r.shell,
        cwd: r.cwd,
        alive: r.alive,
        lastSeq: r.lastSeq,
        exitCode: null,
        xterm: null,
        fitAddon: null,
        offs: () => {},
      };
      sessions.value.push(s);
      await mountXterm(s);
    }
    if (!activeId.value && sessions.value.length > 0) {
      activeId.value = sessions.value[0].id;
    }
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    loadingList.value = false;
  }
}

function onClose() {
  // Caller controls open via v-model:open; this just emits.
}

// Refresh on open and apply prefill text (e.g. "shell=cmd").
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (props.prefillText) {
        const m = /shell=(\w+)/.exec(props.prefillText);
        if (m) {
          newShell.value = m[1];
        }
        if (props.prefillText.includes("list")) {
          // user clicked "查看会话列表" — refresh first
          refreshList();
          return;
        }
      }
      refreshList();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  for (const s of sessions.value) {
    try {
      s.offs?.();
    } catch {
      /* idempotent */
    }
    try {
      s.xterm?.dispose?.();
    } catch {
      /* idempotent */
    }
  }
  detachStdout?.();
  detachExit?.();
});
</script>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  height: 560px;
}
.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--cc-shell-border, #eee);
}
.header-left {
  display: flex;
  gap: 8px;
  align-items: center;
}
.terminal-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #1e1e1e;
  min-height: 0;
}
.session-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 6px 0;
  background: #2d2d2d;
  flex-wrap: wrap;
}
.session-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #1e1e1e;
  border-radius: 4px 4px 0 0;
  font-size: 12px;
  color: #ccc;
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  user-select: none;
}
.session-tab.active {
  color: #fff;
  border-color: #555;
}
.session-tab.dead {
  opacity: 0.5;
  font-style: italic;
}
.session-close {
  color: #888;
  cursor: pointer;
}
.session-close:hover {
  color: #ff6b6b;
}
.session-empty {
  padding: 10px 14px;
  color: #777;
  font-size: 12px;
}
.xterm-host {
  flex: 1;
  position: relative;
  min-height: 0;
}
.xterm-container {
  position: absolute;
  inset: 0;
  padding: 8px;
}
.xterm-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 14px;
}
</style>
