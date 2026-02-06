/**
 * IPC compatibility shim for renderer-side calls.
 * Normalizes window.electron.ipcRenderer / window.ipc / window.electronAPI.invoke.
 */

// ==================== 类型定义 ====================

/**
 * IPC 事件监听器类型
 */
export type IpcListener = (event: any, ...args: any[]) => void;

/**
 * IPC 桥接口
 */
export interface IpcBridge {
  invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>;
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, listener: IpcListener) => void;
  once: (channel: string, listener: IpcListener) => void;
  removeListener: (channel: string, listener: IpcListener) => void;
  removeAllListeners: (channel: string) => void;
}

/**
 * IPC 兼容层的 Window 类型
 * 注意：主类型定义在 electron.d.ts 中，这里只做运行时检查
 */
interface IpcWindow {
  electron?: {
    ipcRenderer?: Partial<IpcBridge>;
  };
  ipc?: Partial<IpcBridge>;
  electronAPI?: {
    invoke?: <T = any>(channel: string, ...args: any[]) => Promise<T>;
    [key: string]: any;
  };
  require?: (module: string) => any;
}

// 类型断言辅助
const getWindow = (): IpcWindow => (typeof window !== 'undefined' ? window as unknown as IpcWindow : {} as IpcWindow);

// ==================== 实现 ====================

function createUnavailableError(channel: string): Error {
  return new Error(`[IPC] invoke unavailable for channel "${channel}"`);
}

function createFallbackIpc(): IpcBridge {
  return {
    invoke: async <T = any>(channel: string): Promise<T> => {
      throw createUnavailableError(channel);
    },
    send: () => {},
    on: () => {},
    once: () => {},
    removeListener: () => {},
    removeAllListeners: () => {},
  };
}

function safeRequireElectronIpc(): Partial<IpcBridge> | null {
  try {
    return window?.require?.("electron")?.ipcRenderer || null;
  } catch (_error) {
    return null;
  }
}

function normalizeIpc(candidate: Partial<IpcBridge> | null | undefined): IpcBridge | null {
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

let cachedIpc: IpcBridge | null = null;

export function resolveIpcBridge(): IpcBridge {
  if (cachedIpc) {
    return cachedIpc;
  }

  if (typeof window === "undefined") {
    cachedIpc = createFallbackIpc();
    return cachedIpc;
  }

  const win = getWindow();
  const rawCandidates: (Partial<IpcBridge> | null | undefined)[] = [
    win.electron?.ipcRenderer,
    win.ipc,
    win.electronAPI && typeof win.electronAPI.invoke === "function"
      ? (win.electronAPI as Partial<IpcBridge>)
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

export function initIpcCompatibility(): void {
  if (typeof window === "undefined") {
    return;
  }

  const ipc = resolveIpcBridge();
  const win = getWindow();

  try {
    if (!win.electron || typeof win.electron !== "object") {
      (window as any).electron = {};
    }
    if (!win.electron?.ipcRenderer) {
      (window as any).electron = { ...(window as any).electron, ipcRenderer: ipc };
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }

  try {
    if (!win.ipc) {
      (window as any).ipc = ipc;
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }

  try {
    if (
      win.electronAPI &&
      typeof win.electronAPI === "object" &&
      typeof win.electronAPI.invoke !== "function"
    ) {
      (window as any).electronAPI.invoke = ipc.invoke;
    }
  } catch (_error) {
    // Ignore assignment failures in hardened contexts.
  }
}

export function getIpcBridge(): IpcBridge {
  initIpcCompatibility();
  return resolveIpcBridge();
}

export async function invokeIPC<T = any>(channel: string, ...args: any[]): Promise<T> {
  return getIpcBridge().invoke<T>(channel, ...args);
}

// Auto-init on import so legacy calls can keep using window.electron/window.ipc.
initIpcCompatibility();
