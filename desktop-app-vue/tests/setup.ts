/**
 * Vitest 测试环境设置
 */

import { vi, beforeEach } from 'vitest';
import { config } from '@vue/test-utils';

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
beforeEach(() => {
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

// Global mock for electron to avoid import errors in tests
vi.mock('electron', () => {
  const mockDesktopCapturer = {
    getSources: vi.fn().mockResolvedValue([]),
  };

  return {
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
    desktopCapturer: mockDesktopCapturer,
  };
});

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

// 挂载到全局
global.window = global.window || {};
(global.window as any).api = mockElectronAPI;

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
