/**
 * Jest 全局设置文件
 * 配置全局 mock 和测试环境
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';

// Mock electron 模块
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    removeHandler: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  ipcRenderer: {
    send: jest.fn(),
    invoke: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  BrowserWindow: jest.fn(() => ({
    loadURL: jest.fn(),
    loadFile: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    webContents: {
      send: jest.fn(),
      openDevTools: jest.fn(),
      on: jest.fn(),
    },
    isDestroyed: jest.fn(() => false),
    isMaximized: jest.fn(() => false),
    isMinimized: jest.fn(() => false),
    isFullScreen: jest.fn(() => false),
    isFocused: jest.fn(() => true),
    maximize: jest.fn(),
    unmaximize: jest.fn(),
    minimize: jest.fn(),
    close: jest.fn(),
    setAlwaysOnTop: jest.fn(),
  })),
  app: {
    getVersion: jest.fn(() => '0.1.0'),
    getName: jest.fn(() => 'chainlesschain-desktop-vue'),
    getPath: jest.fn((name) => `/path/to/${name}`),
    getAppPath: jest.fn(() => '/app/path'),
    isPackaged: false,
    relaunch: jest.fn(),
    exit: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    whenReady: jest.fn(() => Promise.resolve()),
  },
  shell: {
    openExternal: jest.fn(),
    showItemInFolder: jest.fn(),
    openPath: jest.fn(),
  },
  dialog: {
    showOpenDialog: jest.fn(),
    showSaveDialog: jest.fn(),
    showMessageBox: jest.fn(),
    showErrorBox: jest.fn(),
  },
  Menu: {
    buildFromTemplate: jest.fn(),
    setApplicationMenu: jest.fn(),
  },
  Tray: jest.fn(() => ({
    setContextMenu: jest.fn(),
    setToolTip: jest.fn(),
    on: jest.fn(),
  })),
  nativeImage: {
    createFromPath: jest.fn(),
    createFromDataURL: jest.fn(),
  },
}));

// Mock crypto 模块
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-1234'),
  randomBytes: jest.fn((size = 16) => Buffer.alloc(size, 1)),
  createHash: jest.fn(() => ({
    update: jest.fn(() => ({
      digest: jest.fn(() => 'test-hash-1234'),
    })),
  })),
}));

// Mock axios
const createMockAxiosInstance = () => ({
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
  put: jest.fn(() => Promise.resolve({ data: {} })),
  delete: jest.fn(() => Promise.resolve({ data: {} })),
  patch: jest.fn(() => Promise.resolve({ data: {} })),
  request: jest.fn(() => Promise.resolve({ data: {} })),
  interceptors: {
    request: {
      use: jest.fn((onFulfilled, onRejected) => {
        // 返回拦截器ID
        return 0;
      }),
      eject: jest.fn(),
    },
    response: {
      use: jest.fn((onFulfilled, onRejected) => {
        // 返回拦截器ID
        return 0;
      }),
      eject: jest.fn(),
    },
  },
  defaults: {
    headers: {
      common: {},
      get: {},
      post: {},
      put: {},
      delete: {},
      patch: {},
    },
  },
});

jest.mock('axios', () => ({
  default: {
    create: jest.fn(() => createMockAxiosInstance()),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    get: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    patch: jest.fn(() => Promise.resolve({ data: {} })),
  },
  create: jest.fn(() => createMockAxiosInstance()),
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
  put: jest.fn(() => Promise.resolve({ data: {} })),
  delete: jest.fn(() => Promise.resolve({ data: {} })),
  patch: jest.fn(() => Promise.resolve({ data: {} })),
}));

// Mock os 模块
jest.mock('os', () => ({
  type: jest.fn(() => 'Darwin'),
  release: jest.fn(() => '21.6.0'),
  platform: jest.fn(() => 'darwin'),
  totalmem: jest.fn(() => 16000000000),
  freemem: jest.fn(() => 8000000000),
  cpus: jest.fn(() => [1, 2, 3, 4]),
}));

// 全局超时设置
jest.setTimeout(10000);
