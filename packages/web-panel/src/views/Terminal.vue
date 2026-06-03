<template>
  <div class="terminal-page">
    <div class="terminal-header">
      <div>
        <h2 class="page-title">远程终端</h2>
        <p class="page-sub">
          桌面端托管的 PTY 会话；Android 端可远程操控同一通道
          <a-tag v-if="warning" color="orange" style="margin-left: 8px;">{{ warning }}</a-tag>
        </p>
      </div>
      <a-space>
        <a-select
          v-model:value="newShell"
          style="width: 130px;"
          size="small"
          :options="shellOptions"
        />
        <a-button type="primary" size="small" :loading="creating" @click="onCreate">
          <template #icon><PlusOutlined /></template>
          新会话
        </a-button>
        <a-button size="small" :loading="loadingList" @click="refreshList">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-alert
      v-if="error"
      :message="error"
      type="error"
      show-icon
      closable
      style="margin-bottom: 12px;"
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
          <span class="session-shell">{{ s.shell }}</span>
          <span class="session-id">{{ shortId(s.id) }}</span>
          <CloseOutlined class="session-close" @click.stop="onClose(s.id)" />
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
          <span>无活跃会话</span>
        </div>
      </div>
    </div>

    <div v-if="active" class="terminal-footer">
      <span>{{ active.shell }} · {{ active.cwd || '(默认 cwd)' }} · seq {{ active.lastSeq }}</span>
      <span v-if="!active.alive" class="footer-exit">已退出 (code={{ active.exitCode ?? '-' }})</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  PlusOutlined, CloseOutlined, ReloadOutlined,
} from '@ant-design/icons-vue'
import { useTerminal } from '../composables/useTerminal.js'

const term = useTerminal()

const sessions = ref([]) // { id, shell, cwd, alive, lastSeq, exitCode, xterm, fitAddon, offs }
const activeId = ref(null)
const newShell = ref('pwsh')
const creating = ref(false)
const loadingList = ref(false)
const error = ref('')
const warning = ref('')

const xtermContainers = ref([])

const shellOptions = [
  { value: 'pwsh', label: 'PowerShell' },
  { value: 'cmd', label: 'CMD' },
  { value: 'bash', label: 'Bash' },
  { value: 'wsl', label: 'WSL' },
]

const active = computed(() => sessions.value.find((s) => s.id === activeId.value))

function shortId(id) {
  return id ? id.slice(0, 8) : ''
}

let xtermMod = null
let fitAddonMod = null
async function loadXterm() {
  if (xtermMod) return { xtermMod, fitAddonMod }
  try {
    // Lazy import — xterm.js is heavy + only needed on this route. Vite
    // splits this into its own chunk so the default bundle stays slim.
    xtermMod = await import('@xterm/xterm')
    fitAddonMod = await import('@xterm/addon-fit')
    // CSS for xterm — same lazy path so the global build doesn't pull it
    // when no Terminal page ever opens.
    await import('@xterm/xterm/css/xterm.css')
  } catch (e) {
    warning.value = 'xterm 资源加载失败：' + (e?.message || '未知错误')
    throw e
  }
  return { xtermMod, fitAddonMod }
}

async function mountXterm(session) {
  await nextTick()
  const { xtermMod: x, fitAddonMod: f } = await loadXterm()
  const container = xtermContainers.value.find(
    (el) => el?.dataset?.sessionId === session.id,
  )
  if (!container) return
  const xterm = new x.Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 13,
    theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
    convertEol: false,
  })
  const fitAddon = new f.FitAddon()
  xterm.loadAddon(fitAddon)
  xterm.open(container)
  try { fitAddon.fit() } catch { /* container may be 0×0 pre-paint */ }

  session.xterm = xterm
  session.fitAddon = fitAddon

  // stdin: xterm.onData → terminal.stdin
  const offData = xterm.onData((data) => {
    term.stdin(session.id, data).catch((e) => {
      // Dangerous-keyword blocks return error envelopes; surface as toast
      // instead of throwing into the keystroke loop.
      if (String(e?.message || '').includes('dangerous_keyword_blocked')) {
        message.warning('该命令被桌面端拦截（高危关键字）')
      } else {
        message.error('stdin 失败: ' + (e?.message || e))
      }
    })
  })

  // Subscribe stdout fan-out → xterm.write
  const offStdout = term.onStdout(session.id, ({ data, seq }) => {
    session.lastSeq = seq
    xterm.write(data)
  })
  const offExit = term.onExit(session.id, ({ exitCode, signal }) => {
    session.alive = false
    session.exitCode = exitCode
    session.signal = signal
    xterm.writeln(`\r\n\x1b[33m[session exited, code=${exitCode}, signal=${signal ?? '-'}]\x1b[0m`)
  })

  session.offs = () => {
    try { offData.dispose?.() } catch { /* dispose may fail post-disposal */ }
    offStdout()
    offExit()
  }

  // History backfill — replays everything the server retained since seq 0.
  // For freshly created sessions this is empty, but for sessions joined via
  // refreshList() this brings the buffer up to date.
  try {
    const { chunks, truncated } = await term.history(session.id, 0)
    if (truncated) {
      xterm.writeln('\x1b[2m[history truncated — earlier output was evicted]\x1b[0m')
    }
    for (const c of chunks) {
      xterm.write(c.data)
      session.lastSeq = c.seq
    }
  } catch (e) {
    xterm.writeln(`\x1b[31m[history fetch failed: ${e?.message || e}]\x1b[0m`)
  }

  // Wire resize → terminal.resize on user-driven xterm fit changes.
  const ro = new ResizeObserver(() => {
    try {
      fitAddon.fit()
      term.resize(session.id, xterm.cols, xterm.rows).catch(() => {})
    } catch { /* benign during teardown */ }
  })
  ro.observe(container)
  const prevOffs = session.offs
  session.offs = () => {
    try { ro.disconnect() } catch { /* observer already disposed */ }
    prevOffs()
  }
}

async function onCreate() {
  creating.value = true
  error.value = ''
  try {
    const created = await term.create({ shell: newShell.value, cols: 80, rows: 24 })
    const session = {
      id: created.sessionId,
      shell: created.shell,
      cwd: '',
      alive: true,
      lastSeq: 0,
      exitCode: null,
      xterm: null,
      fitAddon: null,
      offs: () => {},
    }
    sessions.value.push(session)
    activeId.value = session.id
    await mountXterm(session)
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    creating.value = false
  }
}

async function onClose(id) {
  try {
    await term.close(id)
  } catch (e) {
    // Even if close fails, drop from list — server-side exit will likely
    // arrive separately and reconcile.
    error.value = e?.message || String(e)
  }
  // Wait briefly for terminal.exit to mark alive=false, then remove tab.
  setTimeout(() => removeSession(id), 500)
}

function removeSession(id) {
  const idx = sessions.value.findIndex((s) => s.id === id)
  if (idx === -1) return
  const s = sessions.value[idx]
  try { s.offs?.() } catch { /* idempotent */ }
  try { s.xterm?.dispose?.() } catch { /* idempotent */ }
  sessions.value.splice(idx, 1)
  if (activeId.value === id) {
    activeId.value = sessions.value[0]?.id || null
  }
}

function activate(id) {
  activeId.value = id
  // Force refit after tab switch — the hidden xterm has zero size while
  // v-show=false and only gets real dimensions once re-shown.
  nextTick(() => {
    const s = sessions.value.find((x) => x.id === id)
    try { s?.fitAddon?.fit() } catch { /* benign */ }
  })
}

async function refreshList() {
  loadingList.value = true
  error.value = ''
  try {
    const remote = await term.list()
    // Adopt any server-side sessions we don't already track. Skip ones we
    // own (id match) — they keep their xterm + subscriptions.
    for (const r of remote) {
      const owned = sessions.value.find((s) => s.id === r.id)
      if (owned) {
        owned.alive = r.alive
        owned.lastSeq = r.lastSeq
        continue
      }
      const session = {
        id: r.id,
        shell: r.shell,
        cwd: r.cwd,
        alive: r.alive,
        lastSeq: r.lastSeq,
        exitCode: null,
        xterm: null,
        fitAddon: null,
        offs: () => {},
      }
      sessions.value.push(session)
      await mountXterm(session)
    }
    if (!activeId.value && sessions.value.length > 0) {
      activeId.value = sessions.value[0].id
    }
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loadingList.value = false
  }
}

onMounted(async () => {
  await refreshList()
})

onBeforeUnmount(() => {
  for (const s of sessions.value) {
    try { s.offs?.() } catch { /* idempotent */ }
    try { s.xterm?.dispose?.() } catch { /* idempotent */ }
  }
})

// When activeId changes, re-fit the newly visible xterm
watch(activeId, () => {
  nextTick(() => {
    const s = active.value
    try { s?.fitAddon?.fit() } catch { /* benign */ }
  })
})
</script>

<style scoped>
.terminal-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 110px);
}
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.terminal-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border, #d9d9d9);
  border-radius: 6px;
  overflow: hidden;
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
  background: #1e1e1e;
  color: #fff;
  border-color: #555;
}
.session-tab.dead {
  opacity: 0.5;
  font-style: italic;
}
.session-shell {
  font-weight: 500;
}
.session-id {
  font-family: Consolas, monospace;
  color: #888;
  font-size: 11px;
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
.terminal-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted, #999);
  background: var(--bg-secondary, #fafafa);
  border-top: 1px solid var(--border, #eee);
}
.footer-exit {
  color: #ff7a45;
  font-style: italic;
}
</style>
