/**
 * Vitest测试环境设置
 * 为IPC API单元测试提供全局配置
 */

import { vi } from 'vitest';

// 设置测试环境变量
process.env.NODE_ENV = 'test';

// 全局测试超时时间
vi.setConfig({ testTimeout: 10000 });

// 全局 mock electron 模块
vi.mock('electron', () => {
  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    ipcRenderer: {
      send: vi.fn(),
      invoke: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    BrowserWindow: vi.fn(() => ({
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
    })),
    app: {
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
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(),
    },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn(),
      showErrorBox: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn(),
      setApplicationMenu: vi.fn(),
    },
    Tray: vi.fn(() => ({
      setContextMenu: vi.fn(),
      setToolTip: vi.fn(),
      on: vi.fn(),
    })),
    nativeImage: {
      createFromPath: vi.fn(),
      createFromDataURL: vi.fn(),
    },
  };
});

// 清理每个测试后的状态
afterEach(() => {
  vi.clearAllMocks();
});
