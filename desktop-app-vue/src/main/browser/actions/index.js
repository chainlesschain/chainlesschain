/**
 * Browser Actions - Extended action handlers
 *
 * @module browser/actions
 * @author ChainlessChain Team
 * @since v0.30.0
 * @updated v0.33.0 - Added Computer Use capabilities
 */

const {
  ScrollAction,
  ScrollDirection,
  ScrollBehavior,
} = require("./scroll-action");
const {
  KeyboardAction,
  ModifierKey,
  ShortcutPresets,
} = require("./keyboard-action");
const { UploadAction, UploadMethod } = require("./upload-action");
const { MultiTabAction, TabAction } = require("./multi-tab-action");

// v0.33.0: Computer Use capabilities
const {
  CoordinateAction,
  MouseButton,
  GestureType,
} = require("./coordinate-action");
const {
  VisionAction,
  VisionModel,
  VisionTaskType,
} = require("./vision-action");
const {
  NetworkInterceptor,
  NetworkCondition,
  InterceptType,
} = require("./network-interceptor");
const { DesktopAction, SpecialKey, Modifier } = require("./desktop-action");

// v0.33.0: Audit and Recording
const {
  AuditLogger,
  AuditEntry,
  OperationType,
  RiskLevel,
  getAuditLogger,
} = require("./audit-logger");
const {
  ScreenRecorder,
  RecordingState,
  RecordingMode,
  getScreenRecorder,
} = require("./screen-recorder");

// v0.33.0: Advanced features
const {
  ActionReplay,
  ReplayState,
  ReplayMode,
  getActionReplay,
} = require("./action-replay");
const {
  SafeMode,
  SafetyLevel,
  ActionCategory,
  getSafeMode,
} = require("./safe-mode");
const {
  WorkflowEngine,
  WorkflowState,
  StepType,
  getWorkflowEngine,
} = require("./workflow-engine");

// v0.33.0: Visual feedback and templates
const {
  ElementHighlighter,
  HighlightStyle,
  getElementHighlighter,
} = require("./element-highlighter");
const {
  TemplateActions,
  TemplateCategory,
  getTemplateActions,
} = require("./template-actions");
const {
  ComputerUseMetrics,
  TimeRange,
  MetricType,
  getComputerUseMetrics,
} = require("./computer-use-metrics");

// v0.33.0: Smart detection and recovery
const {
  SmartElementDetector,
  DetectionStrategy,
  ElementType,
  CONFIDENCE_THRESHOLD,
  getSmartElementDetector,
} = require("./smart-element-detector");
const {
  ErrorRecoveryManager,
  ErrorType,
  RecoveryStrategy,
  getErrorRecoveryManager,
} = require("./error-recovery-manager");
const {
  ContextMemory,
  MemoryType,
  PersistenceStrategy,
  getContextMemory,
} = require("./context-memory");

// v0.33.0: Policy, Analysis, and Suggestions
const {
  AutomationPolicy,
  PolicyType,
  PolicyAction,
  getAutomationPolicy,
} = require("./automation-policy");
const {
  ScreenAnalyzer,
  RegionType,
  AnalysisMode,
  getScreenAnalyzer,
} = require("./screen-analyzer");
const {
  ActionSuggestion,
  SuggestionType,
  SuggestionPriority,
  getActionSuggestion,
} = require("./action-suggestion");

// v0.33.0: Clipboard, Files, and Notifications
const {
  ClipboardManager,
  ClipboardType,
  getClipboardManager,
} = require("./clipboard-manager");
const {
  FileHandler,
  DownloadState,
  FileCategory,
  getFileHandler,
} = require("./file-handler");
const {
  NotificationManager,
  NotificationLevel,
  NotificationType,
  getNotificationManager,
} = require("./notification-manager");

// v0.33.0: Session and Console management
const {
  SessionManager,
  SameSitePolicy,
  StorageType,
  SessionState,
  getSessionManager,
} = require("./session-manager");
const {
  ConsoleCapture,
  LogLevel,
  LogSource,
  getConsoleCapture,
} = require("./console-capture");

module.exports = {
  // Scroll
  ScrollAction,
  ScrollDirection,
  ScrollBehavior,

  // Keyboard
  KeyboardAction,
  ModifierKey,
  ShortcutPresets,

  // Upload
  UploadAction,
  UploadMethod,

  // Multi-tab
  MultiTabAction,
  TabAction,

  // v0.33.0: Coordinate-level operations (like Claude Computer Use)
  CoordinateAction,
  MouseButton,
  GestureType,

  // v0.33.0: Vision AI capabilities
  VisionAction,
  VisionModel,
  VisionTaskType,

  // v0.33.0: Network interception
  NetworkInterceptor,
  NetworkCondition,
  InterceptType,

  // v0.33.0: Desktop-level operations
  DesktopAction,
  SpecialKey,
  Modifier,

  // v0.33.0: Audit logging
  AuditLogger,
  AuditEntry,
  OperationType,
  RiskLevel,
  getAuditLogger,

  // v0.33.0: Screen recording
  ScreenRecorder,
  RecordingState,
  RecordingMode,
  getScreenRecorder,

  // v0.33.0: Action replay
  ActionReplay,
  ReplayState,
  ReplayMode,
  getActionReplay,

  // v0.33.0: Safe mode
  SafeMode,
  SafetyLevel,
  ActionCategory,
  getSafeMode,

  // v0.33.0: Workflow engine
  WorkflowEngine,
  WorkflowState,
  StepType,
  getWorkflowEngine,

  // v0.33.0: Element highlighting
  ElementHighlighter,
  HighlightStyle,
  getElementHighlighter,

  // v0.33.0: Template actions
  TemplateActions,
  TemplateCategory,
  getTemplateActions,

  // v0.33.0: Metrics collection
  ComputerUseMetrics,
  TimeRange,
  MetricType,
  getComputerUseMetrics,

  // v0.33.0: Smart element detection
  SmartElementDetector,
  DetectionStrategy,
  ElementType,
  CONFIDENCE_THRESHOLD,
  getSmartElementDetector,

  // v0.33.0: Error recovery
  ErrorRecoveryManager,
  ErrorType,
  RecoveryStrategy,
  getErrorRecoveryManager,

  // v0.33.0: Context memory
  ContextMemory,
  MemoryType,
  PersistenceStrategy,
  getContextMemory,

  // v0.33.0: Automation policy
  AutomationPolicy,
  PolicyType,
  PolicyAction,
  getAutomationPolicy,

  // v0.33.0: Screen analyzer
  ScreenAnalyzer,
  RegionType,
  AnalysisMode,
  getScreenAnalyzer,

  // v0.33.0: Action suggestions
  ActionSuggestion,
  SuggestionType,
  SuggestionPriority,
  getActionSuggestion,

  // v0.33.0: Clipboard manager
  ClipboardManager,
  ClipboardType,
  getClipboardManager,

  // v0.33.0: File handler
  FileHandler,
  DownloadState,
  FileCategory,
  getFileHandler,

  // v0.33.0: Notification manager
  NotificationManager,
  NotificationLevel,
  NotificationType,
  getNotificationManager,

  // v0.33.0: Session manager
  SessionManager,
  SameSitePolicy,
  StorageType,
  SessionState,
  getSessionManager,

  // v0.33.0: Console capture
  ConsoleCapture,
  LogLevel,
  LogSource,
  getConsoleCapture,
};
