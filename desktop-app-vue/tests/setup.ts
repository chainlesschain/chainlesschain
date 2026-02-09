/**
 * Vitest 测试环境设置
 */

import { vi, beforeEach, afterEach } from 'vitest';
import { config } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

// ============================================================
// CRITICAL: Mock electron, logger, and vue-i18n FIRST before any other imports
// ============================================================

// Mock vue-i18n to avoid actual i18n setup (must be hoisted)
vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(() => ({
    global: {
      t: (key: string) => key,
      locale: 'zh-CN',
    },
    install: vi.fn(),
  })),
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
    locale: { value: 'zh-CN' },
  })),
}));

// Mock electron module - must be hoisted to run before any module imports
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock/path'),
    getName: vi.fn().mockReturnValue('test-app'),
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
    },
    on: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
  })),
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([]),
  },
}));

// Mock ipc module to prevent module-level initialization errors
// (social.js calls createRetryableIPC at module load time)
vi.mock('@/utils/ipc', () => ({
  createRetryableIPC: vi.fn(() => ({
    invoke: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  ipcWithRetry: vi.fn((fn) => fn()),
  ukeyAPI: {
    detect: vi.fn().mockResolvedValue({ detected: false }),
    verifyPIN: vi.fn().mockResolvedValue({ success: true }),
  },
  authAPI: {
    verifyPassword: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Also mock relative path versions of ipc
vi.mock('../src/renderer/utils/ipc', () => ({
  createRetryableIPC: vi.fn(() => ({
    invoke: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  ipcWithRetry: vi.fn((fn) => fn()),
  ukeyAPI: {
    detect: vi.fn().mockResolvedValue({ detected: false }),
    verifyPIN: vi.fn().mockResolvedValue({ success: true }),
  },
  authAPI: {
    verifyPassword: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../../src/renderer/utils/ipc', () => ({
  createRetryableIPC: vi.fn(() => ({
    invoke: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn(),
  })),
  ipcWithRetry: vi.fn((fn) => fn()),
  ukeyAPI: {
    detect: vi.fn().mockResolvedValue({ detected: false }),
    verifyPIN: vi.fn().mockResolvedValue({ success: true }),
  },
  authAPI: {
    verifyPassword: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock logger module to prevent electron imports
const mockLoggerInstance = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
};

vi.mock('@main/utils/logger.js', () => ({
  logger: mockLoggerInstance,
  createLogger: vi.fn().mockReturnValue(mockLoggerInstance),
}));

vi.mock('../src/main/utils/logger.js', () => ({
  logger: mockLoggerInstance,
  createLogger: vi.fn().mockReturnValue(mockLoggerInstance),
}));

vi.mock('../../src/main/utils/logger.js', () => ({
  logger: mockLoggerInstance,
  createLogger: vi.fn().mockReturnValue(mockLoggerInstance),
}));

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: mockLoggerInstance,
  createLogger: vi.fn().mockReturnValue(mockLoggerInstance),
}));

// Centralized mocks that WordEngine reads via global overrides to avoid actual FS access.
const createDefaultWordStat = () => ({
  size: 1024,
  birthtime: new Date(0),
  mtime: new Date(0),
  isFile: () => true,
});

const ensureWordEngineFsMock = () => {
  const globalTarget = globalThis as any;
  const fsMock = globalTarget.__WORD_ENGINE_FS__ || {};
  fsMock.writeFile = vi.fn().mockResolvedValue(undefined);
  fsMock.stat = vi.fn().mockResolvedValue(createDefaultWordStat());
  fsMock.mkdir = vi.fn().mockResolvedValue(undefined);
  globalTarget.__WORD_ENGINE_FS__ = fsMock;
  return fsMock;
};

const ensureWordEngineFileHandlerMock = () => {
  const globalTarget = globalThis as any;
  const handler = globalTarget.__WORD_ENGINE_FILE_HANDLER__ || {};
  handler.getFileSize = vi.fn().mockResolvedValue(1024 * 1024);
  handler.checkAvailableMemory = vi.fn().mockReturnValue({
    freeMem: 2 * 1024 * 1024,
    totalMem: 4 * 1024 * 1024,
    usageRatio: 0.5,
    isAvailable: true,
  });
  handler.waitForMemory = vi.fn().mockResolvedValue(undefined);
  handler.writeFileStream = vi.fn().mockResolvedValue(undefined);
  globalTarget.__WORD_ENGINE_FILE_HANDLER__ = handler;
  return handler;
};

const ensureWordEngineDocxMock = () => {
  const globalTarget = globalThis as any;
  const docxMock = globalTarget.__WORD_ENGINE_DOCX__ || {};
  docxMock.Document = vi.fn((config) => ({ type: 'document', config }));
  docxMock.Packer = docxMock.Packer || { toBuffer: vi.fn() };
  docxMock.Packer.toBuffer = vi.fn();
  docxMock.Paragraph = vi.fn((config) => ({ type: 'paragraph', config }));
  docxMock.TextRun = vi.fn((config) => ({ config }));
  docxMock.HeadingLevel = {
    TITLE: 'TITLE',
    HEADING_1: 'H1',
    HEADING_2: 'H2',
    HEADING_3: 'H3',
    HEADING_4: 'H4',
    HEADING_5: 'H5',
    HEADING_6: 'H6',
  };
  docxMock.AlignmentType = {
    LEFT: 'LEFT',
    CENTER: 'CENTER',
    RIGHT: 'RIGHT',
    JUSTIFIED: 'JUSTIFIED',
  };
  docxMock.UnderlineType = {
    SINGLE: 'SINGLE',
  };
  globalTarget.__WORD_ENGINE_DOCX__ = docxMock;
  return docxMock;
};

const ensureWordEngineMammothMock = () => {
  const globalTarget = globalThis as any;
  const mammothMock = globalTarget.__WORD_ENGINE_MAMMOTH__ || {};
  mammothMock.convertToHtml = vi.fn();
  mammothMock.extractRawText = vi.fn();
  globalTarget.__WORD_ENGINE_MAMMOTH__ = mammothMock;
  return mammothMock;
};

const ensureWordEngineMarkedMock = () => {
  const globalTarget = globalThis as any;
  const markedMock = globalTarget.__WORD_ENGINE_MARKED__ || {};
  markedMock.marked = vi.fn();
  globalTarget.__WORD_ENGINE_MARKED__ = markedMock;
  return markedMock;
};

const resetWordEngineMocks = () => {
  ensureWordEngineFsMock();
  ensureWordEngineFileHandlerMock();
  ensureWordEngineDocxMock();
  ensureWordEngineMammothMock();
  ensureWordEngineMarkedMock();
};

resetWordEngineMocks();

// Create a fresh Pinia instance for each test
let testPinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  resetWordEngineMocks();
  // Create and activate a new Pinia instance before each test
  testPinia = createPinia();
  setActivePinia(testPinia);
});

// Global cleanup after each test to prevent resource leaks and timeout errors
afterEach(() => {
  // Clear all timers (setTimeout, setInterval)
  vi.clearAllTimers();

  // Clear all mock call history
  vi.clearAllMocks();

  // Force garbage collection if available (Node.js --expose-gc flag)
  if (global.gc) {
    try {
      global.gc();
    } catch (e) {
      // GC not available, continue
    }
  }

  // Reset WordEngine mocks to prevent state leakage between tests
  resetWordEngineMocks();
});

// Global mock for ipc-guard to prevent IPC registration blocking in tests
vi.mock('@main/ipc-guard', () => ({
  isModuleRegistered: vi.fn().mockReturnValue(false),
  markModuleRegistered: vi.fn(),
  isChannelRegistered: vi.fn().mockReturnValue(false),
  markChannelRegistered: vi.fn(),
  resetAll: vi.fn(),
  safeRegisterHandler: vi.fn().mockReturnValue(true),
  safeRegisterHandlers: vi.fn().mockReturnValue({ registered: 0, skipped: 0 }),
  safeRegisterModule: vi.fn().mockReturnValue(true),
  unregisterChannel: vi.fn(),
  unregisterModule: vi.fn(),
  getStats: vi.fn().mockReturnValue({ totalChannels: 0, totalModules: 0, channels: [], modules: [] }),
  printStats: vi.fn(),
}));

// Also mock the relative path version
vi.mock('../../../src/main/ipc-guard', () => ({
  isModuleRegistered: vi.fn().mockReturnValue(false),
  markModuleRegistered: vi.fn(),
  isChannelRegistered: vi.fn().mockReturnValue(false),
  markChannelRegistered: vi.fn(),
  resetAll: vi.fn(),
  safeRegisterHandler: vi.fn().mockReturnValue(true),
  safeRegisterHandlers: vi.fn().mockReturnValue({ registered: 0, skipped: 0 }),
  safeRegisterModule: vi.fn().mockReturnValue(true),
  unregisterChannel: vi.fn(),
  unregisterModule: vi.fn(),
  getStats: vi.fn().mockReturnValue({ totalChannels: 0, totalModules: 0, channels: [], modules: [] }),
  printStats: vi.fn(),
}));

// Mock wrtc compatibility layer to avoid native dependencies in tests
const createWrtcMock = () => {
  class MockPeerConnection {
    public localDescription: any;
    public remoteDescription: any;
    public connectionState = 'connected';
    public onicecandidate: ((event: any) => void) | null = null;
    public onconnectionstatechange: (() => void) | null = null;
    public ontrack: ((event: any) => void) | null = null;

    async createOffer() {
      return { type: 'offer', sdp: 'mock-offer-sdp' };
    }

    async createAnswer() {
      return { type: 'answer', sdp: 'mock-answer-sdp' };
    }

    async setLocalDescription(desc: any) {
      this.localDescription = desc;
    }

    async setRemoteDescription(desc: any) {
      this.remoteDescription = desc;
    }

    addTrack() {}

    async addIceCandidate() {}

    close() {}

    async getStats() {
      return new Map();
    }
  }

  class MockMediaStream {
    private tracks: any[] = [];
    public id = `mock-stream-${Math.random().toString(36).slice(2)}`;

    getTracks() {
      return this.tracks;
    }

    getAudioTracks() {
      return [{ enabled: true, stop: vi.fn() }];
    }

    getVideoTracks() {
      return [{ enabled: true, stop: vi.fn() }];
    }

    addTrack(track: any) {
      this.tracks.push(track);
    }

    stop() {
      this.tracks.forEach((track) => track.stop?.());
    }
  }

  const mockModule = {
    available: true,
    loadError: null,
    RTCPeerConnection: MockPeerConnection,
    RTCSessionDescription: class {
      type: string;
      sdp: string;
      constructor(init: { type?: string; sdp?: string } = {}) {
        this.type = init.type || '';
        this.sdp = init.sdp || '';
      }
    },
    RTCIceCandidate: class {
      candidate?: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      constructor(init: { candidate?: string; sdpMid?: string; sdpMLineIndex?: number } = {}) {
        this.candidate = init.candidate;
        this.sdpMid = init.sdpMid ?? null;
        this.sdpMLineIndex = init.sdpMLineIndex ?? null;
      }
    },
    MediaStream: MockMediaStream,
  };

  return mockModule;
};

vi.mock('../src/main/p2p/wrtc-compat.js', () => createWrtcMock());
vi.mock('../src/main/p2p/wrtc-compat', () => createWrtcMock());
vi.mock('wrtc', () => {
  const mock = createWrtcMock();
  return {
    ...mock,
    default: mock,
  };
});

// 全局测试配置
config.global.mocks = {
  $t: (key: string) => key, // i18n mock
};

// Add Pinia plugin to Vue Test Utils global config
// Note: Each test also gets a fresh Pinia via beforeEach/setActivePinia
config.global.plugins = config.global.plugins || [];
config.global.plugins.push(createPinia());

// 全局 Ant Design Vue 组件 stubs
// 这些 stubs 用于避免组件未注册的警告，同时保持测试的稳定性
config.global.stubs = {
  // 布局组件
  'a-layout': { template: '<div class="a-layout"><slot /></div>' },
  'a-layout-header': { template: '<header class="a-layout-header"><slot /></header>' },
  'a-layout-content': { template: '<main class="a-layout-content"><slot /></main>' },
  'a-layout-sider': { template: '<aside class="a-layout-sider"><slot /></aside>' },
  'a-layout-footer': { template: '<footer class="a-layout-footer"><slot /></footer>' },
  // 表单组件
  'a-form': { template: '<form class="a-form"><slot /></form>' },
  'a-form-item': { template: '<div class="a-form-item"><slot /></div>' },
  'a-input': { template: '<input class="a-input" />' },
  'a-input-password': { template: '<input class="a-input-password" type="password" />' },
  'a-input-search': { template: '<input class="a-input-search" />' },
  'a-textarea': { template: '<textarea class="a-textarea" />' },
  'a-select': { template: '<select class="a-select"><slot /></select>' },
  'a-select-option': { template: '<option class="a-select-option"><slot /></option>' },
  'a-checkbox': { template: '<input type="checkbox" class="a-checkbox" />' },
  'a-radio': { template: '<input type="radio" class="a-radio" />' },
  'a-radio-group': { template: '<div class="a-radio-group"><slot /></div>' },
  'a-switch': { template: '<input type="checkbox" class="a-switch" />' },
  'a-slider': { template: '<input type="range" class="a-slider" />' },
  'a-date-picker': { template: '<input class="a-date-picker" />' },
  'a-time-picker': { template: '<input class="a-time-picker" />' },
  'a-range-picker': { template: '<div class="a-range-picker" />' },
  'a-upload': { template: '<div class="a-upload"><slot /></div>' },
  'a-rate': { template: '<div class="a-rate" />' },
  // 按钮和链接
  'a-button': { template: '<button class="a-button"><slot /></button>' },
  'a-link': { template: '<a class="a-link"><slot /></a>' },
  // 数据展示
  'a-table': { template: '<table class="a-table"><slot /></table>' },
  'a-list': { template: '<div class="a-list"><slot /></div>' },
  'a-list-item': { template: '<div class="a-list-item"><slot /></div>' },
  'a-list-item-meta': { template: '<div class="a-list-item-meta"><slot name="title" /><slot name="description" /></div>' },
  'a-card': { template: '<div class="a-card"><slot /><slot name="extra" /><slot name="actions" /></div>' },
  'a-descriptions': { template: '<div class="a-descriptions"><slot /></div>' },
  'a-descriptions-item': { template: '<div class="a-descriptions-item"><slot /></div>' },
  'a-statistic': { template: '<div class="a-statistic" />' },
  'a-tree': { template: '<div class="a-tree" />' },
  'a-tree-select': { template: '<div class="a-tree-select" />' },
  'a-tag': { template: '<span class="a-tag"><slot /></span>' },
  'a-badge': { template: '<span class="a-badge"><slot /></span>' },
  'a-avatar': { template: '<span class="a-avatar"><slot /></span>' },
  'a-image': { template: '<img class="a-image" />' },
  'a-empty': { template: '<div class="a-empty" />' },
  'a-result': { template: '<div class="a-result"><slot /></div>' },
  'a-progress': { template: '<div class="a-progress" />' },
  'a-spin': { template: '<div class="a-spin"><slot /></div>' },
  'a-skeleton': { template: '<div class="a-skeleton" />' },
  'a-collapse': { template: '<div class="a-collapse"><slot /></div>' },
  'a-collapse-panel': { template: '<div class="a-collapse-panel"><slot /></div>' },
  'a-timeline': { template: '<div class="a-timeline"><slot /></div>' },
  'a-timeline-item': { template: '<div class="a-timeline-item"><slot /></div>' },
  'a-tabs': { template: '<div class="a-tabs"><slot /></div>' },
  'a-tab-pane': { template: '<div class="a-tab-pane"><slot /></div>' },
  // 导航
  'a-menu': { template: '<nav class="a-menu"><slot /></nav>' },
  'a-menu-item': { template: '<div class="a-menu-item"><slot /></div>' },
  'a-menu-sub-menu': { template: '<div class="a-menu-sub-menu"><slot /></div>' },
  'a-menu-item-group': { template: '<div class="a-menu-item-group"><slot /></div>' },
  'a-menu-divider': { template: '<div class="a-menu-divider" />' },
  'a-breadcrumb': { template: '<nav class="a-breadcrumb"><slot /></nav>' },
  'a-breadcrumb-item': { template: '<span class="a-breadcrumb-item"><slot /></span>' },
  'a-pagination': { template: '<div class="a-pagination" />' },
  'a-steps': { template: '<div class="a-steps"><slot /></div>' },
  'a-step': { template: '<div class="a-step"><slot /></div>' },
  'a-dropdown': { template: '<div class="a-dropdown"><slot /></div>' },
  // 反馈
  'a-modal': { template: '<div class="a-modal"><slot /></div>' },
  'a-drawer': { template: '<div class="a-drawer"><slot /></div>' },
  'a-tooltip': { template: '<span class="a-tooltip"><slot /></span>' },
  'a-popover': { template: '<span class="a-popover"><slot /></span>' },
  'a-popconfirm': { template: '<span class="a-popconfirm"><slot /></span>' },
  'a-alert': { template: '<div class="a-alert"><slot /></div>' },
  // 布局辅助
  'a-row': { template: '<div class="a-row"><slot /></div>' },
  'a-col': { template: '<div class="a-col"><slot /></div>' },
  'a-space': { template: '<div class="a-space"><slot /></div>' },
  'a-divider': { template: '<div class="a-divider" />' },
  'a-affix': { template: '<div class="a-affix"><slot /></div>' },
  'a-anchor': { template: '<div class="a-anchor"><slot /></div>' },
  'a-anchor-link': { template: '<div class="a-anchor-link"><slot /></div>' },
  'a-back-top': { template: '<div class="a-back-top" />' },
  // 图标
  'a-icon': { template: '<span class="a-icon" />' },
};

// Mock Electron API
const mockElectronAPI = {
  // 代码执行相关
  code: {
    executePython: vi.fn(),
    executeFile: vi.fn(),
    checkSafety: vi.fn(),
    generate: vi.fn(),
    generateTests: vi.fn(),
    review: vi.fn(),
    refactor: vi.fn(),
    explain: vi.fn(),
    fixBug: vi.fn(),
    generateScaffold: vi.fn(),
  },

  // 项目管理相关
  project: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    addFile: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    getFile: vi.fn(),
    getFileContent: vi.fn(),
    saveFileContent: vi.fn(),
  },

  // 数据库相关
  db: {
    execute: vi.fn(),
    query: vi.fn(),
    run: vi.fn(),
  },

  // 文件系统相关
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
  },

  // U-Key相关
  ukey: {
    detect: vi.fn(),
    verifyPIN: vi.fn(),
    sign: vi.fn(),
    verify: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  },

  // LLM服务相关
  llm: {
    query: vi.fn(),
    stream: vi.fn(),
    checkStatus: vi.fn(),
  },

  // Git同步相关
  git: {
    init: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    status: vi.fn(),
  },
};

// Mock IPC renderer for window.electron.ipcRenderer (used by stores like social.js)
const mockIpcRenderer = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn().mockReturnValue(() => {}),
  once: vi.fn(),
  send: vi.fn(),
  removeListener: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Mock window.electronAPI for IPC calls (used by src/renderer/utils/ipc.js)
const mockElectronIpcAPI = {
  ...mockIpcRenderer,
  // Add common IPC channel handlers
  ukey: {
    detect: vi.fn().mockResolvedValue({ detected: false }),
    verifyPIN: vi.fn().mockResolvedValue({ success: true }),
  },
  auth: {
    verifyPassword: vi.fn().mockResolvedValue({ success: true }),
  },
};

// NOTE: In Vitest v3 with jsdom, custom window properties set here do NOT
// persist to test files. Each test file that needs window.electronAPI must
// define its own mock (e.g., globalThis.electronAPI = { ... }).

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

global.localStorage = localStorageMock as any;

// Mock sessionStorage
global.sessionStorage = localStorageMock as any;

// Mock console 方法避免测试输出污染
global.console = {
  ...console,
  log: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 导出 mock API 供测试使用
export { mockElectronAPI };
