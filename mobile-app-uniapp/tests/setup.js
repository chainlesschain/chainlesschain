/**
 * Vitest 测试环境配置
 */

import { vi } from 'vitest'

// Mock uni-app API
global.uni = {
  // 存储 API
  getStorageSync: vi.fn((key) => {
    const storage = global.__uniStorage || {}
    return storage[key]
  }),
  setStorageSync: vi.fn((key, value) => {
    if (!global.__uniStorage) {
      global.__uniStorage = {}
    }
    global.__uniStorage[key] = value
  }),
  removeStorageSync: vi.fn((key) => {
    if (global.__uniStorage) {
      delete global.__uniStorage[key]
    }
  }),
  clearStorageSync: vi.fn(() => {
    global.__uniStorage = {}
  }),

  // 网络请求 API
  request: vi.fn((options) => {
    return Promise.resolve({
      statusCode: 200,
      data: { success: true }
    })
  }),

  // 提示 API
  showToast: vi.fn(),
  showModal: vi.fn((options) => {
    return Promise.resolve({ confirm: true })
  }),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),

  // 导航 API
  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  switchTab: vi.fn(),
  navigateBack: vi.fn(),

  // 文件系统 API
  getFileSystemManager: vi.fn(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn()
  })),

  // 其他 API
  getSystemInfoSync: vi.fn(() => ({
    platform: 'devtools',
    system: 'iOS 14.0',
    version: '8.0.0',
    SDKVersion: '3.0.0',
    windowWidth: 375,
    windowHeight: 667
  }))
}

// Mock plus API (App平台)
global.plus = {
  sqlite: {
    openDatabase: vi.fn(() => ({
      executeSql: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn()
    }))
  },
  io: {
    resolveLocalFileSystemURL: vi.fn()
  }
}

// 清理函数
afterEach(() => {
  // 清理存储
  global.__uniStorage = {}

  // 清理所有 mock
  vi.clearAllMocks()
})
