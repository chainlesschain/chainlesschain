/**
 * IPC compatibility shim for renderer-side calls.
 * Normalizes window.electron.ipcRenderer / window.ipc / window.electronAPI.invoke.
 */

function createUnavailableError(channel) {
  return new Error(`[IPC] invoke unavailable for channel "${channel}"`);
}

function createFallbackIpc() {
  return {
    invoke: async (channel) => {
      throw createUnavailableError(channel);
    },
    send: () => {},
    on: () => {},
    once: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
  };
}

function safeRequireElectronIpc() {
  try {
    return window?.require?.("electron")?.ipcRenderer || null;
  } catch (_error) {
    return null;
  }
}

function normalizeIpc(candidate) {
  if (!candidate || typeof candidate.invoke !== "function") {
    return null;
  }

  return {
    invoke: candidate.invoke.bind(candidate),
    send:
      typeof candidate.send === "function"
        ? candidate.send.bind(candidate)
        : () => {},
    on:
      typeof candidate.on === "function"
        ? candidate.on.bind(candidate)
        : () => {},
    once:
      typeof candidate.once === "function"
        ? candidate.once.bind(candidate)
        : () => {},
    removeListener:
      typeof candidate.removeListener === "function"
        ? candidate.removeListener.bind(candidate)
        : () => {},
    removeAllListeners:
      typeof candidate.removeAllListeners === "function"
        ? candidate.removeAllListeners.bind(candidate)
        : () => {},
  };
}

let cachedIpc = null;

export function resolveIpcBridge() {
  if (cachedIpc) {
    return cachedIpc;
  }

  if (typeof window === "undefined") {
    cachedIpc = createFallbackIpc();
    return cachedIpc;
  }

  const rawCandidates = [
    window.electron?.ipcRenderer,
    window.ipc,
    window.electronAPI && typeof window.electronAPI.invoke === "function"
      ? window.electronAPI
      : null,
    safeRequireElectronIpc(),
  ];

  for (const candidate of rawCandidates) {
    const normalized = normalizeIpc(candidate);
    if (normalized) {
      cachedIpc = normalized;
      return cachedIpc;
    }
  }

  cachedIpc = createFallbackIpc();
  return cachedIpc;
}

export function initIpcCompatibility() {
  if (typeof window === "undefined") {
    return;
  }

  const ipc = resolveIpcBridge();

  try {
    if (!window.electron || typeof window.electron !== "object") {
      window.electron = {};
    }
    if (!window.electron.ipcRenderer) {
      window.electron.ipcRenderer = ipc;
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }

  try {
    if (!window.ipc) {
      window.ipc = ipc;
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }

  try {
    if (
      window.electronAPI &&
      typeof window.electronAPI === "object" &&
      typeof window.electronAPI.invoke !== "function"
    ) {
      window.electronAPI.invoke = ipc.invoke;
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }
}

export function getIpcBridge() {
  initIpcCompatibility();
  return resolveIpcBridge();
}

export async function invokeIPC(channel, ...args) {
  return getIpcBridge().invoke(channel, ...args);
}

// Auto-init on import so legacy calls can keep using window.electron/window.ipc.
initIpcCompatibility();
