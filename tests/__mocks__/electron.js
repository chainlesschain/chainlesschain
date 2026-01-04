/**
 * Electron mock for unit tests
 * 提供 electron 模块的 mock 实现，用于单元测试
 */
import { vi } from 'vitest';

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  emit: vi.fn(),
  removeHandler: vi.fn(),
  removeAllListeners: vi.fn(),
};

export const ipcRenderer = {
  send: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
};

export const BrowserWindow = vi.fn(() => ({
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  webContents: {
    send: vi.fn(),
    openDevTools: vi.fn(),
    on: vi.fn(),
  },
  isDestroyed: vi.fn(() => false),
  isMaximized: vi.fn(() => false),
  isMinimized: vi.fn(() => false),
  isFullScreen: vi.fn(() => false),
  isFocused: vi.fn(() => true),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  minimize: vi.fn(),
  close: vi.fn(),
  setAlwaysOnTop: vi.fn(),
}));

export const app = {
  getVersion: vi.fn(() => '0.1.0'),
  getName: vi.fn(() => 'chainlesschain-desktop-vue'),
  getPath: vi.fn((name) => `/path/to/${name}`),
  getAppPath: vi.fn(() => '/app/path'),
  isPackaged: false,
  relaunch: vi.fn(),
  exit: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

export const shell = {
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(),
};

export const dialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showErrorBox: vi.fn(),
};

export const Menu = {
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn(),
};

export const Tray = vi.fn(() => ({
  setContextMenu: vi.fn(),
  setToolTip: vi.fn(),
  on: vi.fn(),
}));

export const nativeImage = {
  createFromPath: vi.fn(),
  createFromDataURL: vi.fn(),
};

// Default export for require() compatibility
export default {
  ipcMain,
  ipcRenderer,
  BrowserWindow,
  app,
  shell,
  dialog,
  Menu,
  Tray,
  nativeImage,
};
