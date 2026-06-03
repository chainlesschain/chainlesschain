/**
 * Browser Automation Type Definitions
 *
 * @module browser
 * @description 浏览器自动化系统类型定义 - 元素定位、录制回放、智能诊断
 */

import { EventEmitter } from 'events';

// ==================== 元素定位相关 ====================

/**
 * 元素定位策略
 */
export type LocatorStrategy = 'xpath' | 'css' | 'text' | 'visual' | 'auto';

/**
 * 元素定位器
 */
export interface ElementLocator {
  /** 定位策略 */
  strategy: LocatorStrategy;
  /** 选择器 */
  selector: string;
  /** 备用定位器 */
  fallback?: ElementLocator[];
}

/**
 * 元素信息
 */
export interface ElementInfo {
  /** 标签名 */
  tagName: string;
  /** ID */
  id?: string;
  /** 类名 */
  className?: string;
  /** 文本内容 */
  textContent?: string;
  /** 属性 */
  attributes?: Record<string, string>;
  /** 位置和大小 */
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// ==================== 浏览器引擎配置 ====================

/**
 * 浏览器引擎配置
 */
export interface BrowserEngineOptions {
  /** 无头模式（默认 false） */
  headless?: boolean;
  /** 浏览器路径 */
  executablePath?: string;
  /** 用户数据目录 */
  userDataDir?: string;
  /** 窗口大小 */
  viewport?: { width: number; height: number };
  /** 启用开发者工具（默认 false） */
  devtools?: boolean;
  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;
}

/**
 * 页面导航选项
 */
export interface NavigationOptions {
  /** 等待条件 */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** 超时时间 */
  timeout?: number;
}

// ==================== 自动化操作相关 ====================

/**
 * 点击选项
 */
export interface ClickOptions {
  /** 点击类型 */
  button?: 'left' | 'right' | 'middle';
  /** 点击次数 */
  clickCount?: number;
  /** 延迟（毫秒） */
  delay?: number;
}

/**
 * 输入选项
 */
export interface TypeOptions {
  /** 输入延迟（毫秒） */
  delay?: number;
  /** 是否清空原有内容 */
  clear?: boolean;
}

/**
 * 等待选项
 */
export interface WaitOptions {
  /** 超时时间 */
  timeout?: number;
  /** 可见性 */
  visible?: boolean;
  /** 隐藏性 */
  hidden?: boolean;
}

// ==================== 录制回放相关 ====================

/**
 * 录制动作类型
 */
export type ActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'custom';

/**
 * 录制动作
 */
export interface RecordedAction {
  /** 动作类型 */
  type: ActionType;
  /** 目标元素定位器 */
  locator?: ElementLocator;
  /** 动作参数 */
  params?: Record<string, any>;
  /** 时间戳 */
  timestamp: number;
  /** 截图数据（Base64） */
  screenshot?: string;
}

/**
 * 录制会话
 */
export interface RecordingSession {
  /** 会话 ID */
  id: string;
  /** 标题 */
  title: string;
  /** 起始 URL */
  startUrl: string;
  /** 动作列表 */
  actions: RecordedAction[];
  /** 创建时间 */
  created_at: string;
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 回放选项
 */
export interface PlaybackOptions {
  /** 慢放倍数（1.0 = 正常速度） */
  speed?: number;
  /** 是否在失败时停止（默认 true） */
  stopOnError?: boolean;
  /** 是否截图（默认 false） */
  screenshot?: boolean;
  /** 重试次数（默认 0） */
  retries?: number;
}

// ==================== 快照和诊断相关 ====================

/**
 * 页面快照
 */
export interface PageSnapshot {
  /** 快照 ID */
  id: string;
  /** URL */
  url: string;
  /** 标题 */
  title: string;
  /** HTML 内容 */
  html: string;
  /** 截图（Base64） */
  screenshot?: string;
  /** DOM 树摘要 */
  domSummary?: any;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 诊断结果
 */
export interface DiagnosticResult {
  /** 是否成功 */
  success: boolean;
  /** 问题类型 */
  issueType?: 'element_not_found' | 'timeout' | 'selector_invalid' | 'network_error' | 'unknown';
  /** 问题描述 */
  description?: string;
  /** 建议修复方案 */
  suggestions?: string[];
  /** 备用定位器 */
  alternativeLocators?: ElementLocator[];
}

// ==================== 工作流相关 ====================

/**
 * 工作流步骤
 */
export interface WorkflowStep {
  /** 步骤 ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 动作 */
  action: RecordedAction;
  /** 是否必需 */
  required?: boolean;
  /** 重试次数 */
  retries?: number;
}

/**
 * 工作流定义
 */
export interface Workflow {
  /** 工作流 ID */
  id: string;
  /** 工作流名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 步骤列表 */
  steps: WorkflowStep[];
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 工作流执行结果
 */
export interface WorkflowExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 已执行步骤数 */
  stepsExecuted: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 失败步骤 */
  failedStep?: WorkflowStep;
  /** 错误信息 */
  error?: string;
  /** 执行时间（毫秒） */
  duration: number;
}

// ==================== BrowserEngine 类 ====================

/**
 * 浏览器引擎类
 */
export declare class BrowserEngine extends EventEmitter {
  /** 配置选项 */
  options: BrowserEngineOptions;
  /** Playwright 浏览器实例 */
  browser: any;
  /** 当前页面 */
  currentPage: any;
  /** 是否已初始化 */
  initialized: boolean;

  /**
   * 构造函数
   */
  constructor(options?: BrowserEngineOptions);

  /**
   * 初始化浏览器
   */
  initialize(): Promise<void>;

  /**
   * 打开新页面
   */
  newPage(): Promise<any>;

  /**
   * 导航到 URL
   */
  goto(url: string, options?: NavigationOptions): Promise<void>;

  /**
   * 点击元素
   */
  click(locator: ElementLocator | string, options?: ClickOptions): Promise<void>;

  /**
   * 输入文本
   */
  type(locator: ElementLocator | string, text: string, options?: TypeOptions): Promise<void>;

  /**
   * 选择下拉选项
   */
  select(locator: ElementLocator | string, value: string | string[]): Promise<void>;

  /**
   * 等待元素
   */
  waitForElement(locator: ElementLocator | string, options?: WaitOptions): Promise<void>;

  /**
   * 获取元素信息
   */
  getElementInfo(locator: ElementLocator | string): Promise<ElementInfo>;

  /**
   * 截图
   */
  screenshot(options?: { fullPage?: boolean; path?: string }): Promise<Buffer | string>;

  /**
   * 执行 JavaScript
   */
  evaluate<T = any>(script: string | Function, ...args: any[]): Promise<T>;

  /**
   * 关闭浏览器
   */
  close(): Promise<void>;

  // ==================== 事件 ====================

  on(event: 'page-loaded', listener: (url: string) => void): this;
  on(event: 'action-performed', listener: (action: RecordedAction) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== ElementLocator 类 ====================

/**
 * 元素定位器类
 */
export declare class ElementLocatorService {
  /** 浏览器引擎 */
  browserEngine: BrowserEngine;

  /**
   * 构造函数
   */
  constructor(browserEngine: BrowserEngine);

  /**
   * 智能定位元素
   */
  locate(element: ElementInfo): ElementLocator[];

  /**
   * 验证定位器
   */
  validateLocator(locator: ElementLocator): Promise<boolean>;

  /**
   * 生成 XPath
   */
  generateXPath(element: ElementInfo): string;

  /**
   * 生成 CSS 选择器
   */
  generateCssSelector(element: ElementInfo): string;

  /**
   * 生成文本定位器
   */
  generateTextLocator(element: ElementInfo): string;

  /**
   * 查找最佳定位器
   */
  findBestLocator(element: ElementInfo): Promise<ElementLocator>;
}

// ==================== RecordingEngine 类 ====================

/**
 * 录制引擎类
 */
export declare class RecordingEngine extends EventEmitter {
  /** 浏览器引擎 */
  browserEngine: BrowserEngine;
  /** 当前录制会话 */
  currentSession: RecordingSession | null;
  /** 是否正在录制 */
  isRecording: boolean;

  /**
   * 构造函数
   */
  constructor(browserEngine: BrowserEngine);

  /**
   * 开始录制
   */
  startRecording(title: string, startUrl: string): RecordingSession;

  /**
   * 停止录制
   */
  stopRecording(): RecordingSession;

  /**
   * 记录动作
   */
  recordAction(action: RecordedAction): void;

  /**
   * 回放录制
   */
  playback(session: RecordingSession, options?: PlaybackOptions): Promise<WorkflowExecutionResult>;

  /**
   * 保存录制
   */
  saveRecording(session: RecordingSession, filePath: string): Promise<void>;

  /**
   * 加载录制
   */
  loadRecording(filePath: string): Promise<RecordingSession>;

  // ==================== 事件 ====================

  on(event: 'recording-started', listener: (session: RecordingSession) => void): this;
  on(event: 'recording-stopped', listener: (session: RecordingSession) => void): this;
  on(event: 'action-recorded', listener: (action: RecordedAction) => void): this;
  on(event: 'playback-completed', listener: (result: WorkflowExecutionResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// ==================== SnapshotEngine 类 ====================

/**
 * 快照引擎类
 */
export declare class SnapshotEngine {
  /** 浏览器引擎 */
  browserEngine: BrowserEngine;

  /**
   * 构造函数
   */
  constructor(browserEngine: BrowserEngine);

  /**
   * 捕获快照
   */
  captureSnapshot(): Promise<PageSnapshot>;

  /**
   * 比较快照
   */
  compareSnapshots(snapshot1: PageSnapshot, snapshot2: PageSnapshot): {
    identical: boolean;
    differences: Array<{ type: string; description: string }>;
  };

  /**
   * 保存快照
   */
  saveSnapshot(snapshot: PageSnapshot, filePath: string): Promise<void>;

  /**
   * 加载快照
   */
  loadSnapshot(filePath: string): Promise<PageSnapshot>;
}

// ==================== SmartDiagnostics 类 ====================

/**
 * 智能诊断类
 */
export declare class SmartDiagnostics {
  /** 浏览器引擎 */
  browserEngine: BrowserEngine;
  /** 元素定位服务 */
  locatorService: ElementLocatorService;

  /**
   * 构造函数
   */
  constructor(browserEngine: BrowserEngine, locatorService: ElementLocatorService);

  /**
   * 诊断问题
   */
  diagnose(error: Error, context?: any): Promise<DiagnosticResult>;

  /**
   * 生成修复建议
   */
  generateFixSuggestions(diagnosticResult: DiagnosticResult): string[];

  /**
   * 自动修复
   */
  autoFix(diagnosticResult: DiagnosticResult): Promise<boolean>;
}

// ==================== 导出函数 ====================

/**
 * 创建浏览器引擎
 */
export function createBrowserEngine(options?: BrowserEngineOptions): BrowserEngine;

/**
 * 创建元素定位服务
 */
export function createElementLocatorService(browserEngine: BrowserEngine): ElementLocatorService;

/**
 * 创建录制引擎
 */
export function createRecordingEngine(browserEngine: BrowserEngine): RecordingEngine;

/**
 * 创建快照引擎
 */
export function createSnapshotEngine(browserEngine: BrowserEngine): SnapshotEngine;

/**
 * 创建智能诊断
 */
export function createSmartDiagnostics(
  browserEngine: BrowserEngine,
  locatorService: ElementLocatorService
): SmartDiagnostics;
