/**
 * Electron mock for vitest tests
 * This file provides a complete mock of the electron module
 */

import { vi } from 'vitest';

export const ipcMain = {
  handle: vi.fn(),
  removeHandler: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
};

export const ipcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
};

export const app = {
  getPath: vi.fn().mockReturnValue('/mock/path'),
  getName: vi.fn().mockReturnValue('test-app'),
  getVersion: vi.fn().mockReturnValue('1.0.0'),
  isReady: vi.fn().mockReturnValue(true),
  on: vi.fn(),
};

export const BrowserWindow = vi.fn().mockImplementation(() => ({
  loadURL: vi.fn(),
  webContents: {
    send: vi.fn(),
    on: vi.fn(),
  },
  on: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  close: vi.fn(),
}));

export const dialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showMessageBox: vi.fn(),
};

export const shell = {
  openExternal: vi.fn(),
  openPath: vi.fn(),
};

export const desktopCapturer = {
  getSources: vi.fn().mockResolvedValue([]),
};

// Default export for CommonJS compatibility
export default {
  ipcMain,
  ipcRenderer,
  app,
  BrowserWindow,
  dialog,
  shell,
  desktopCapturer,
};
