/**
 * 国际化类型定义
 */

export interface CommonMessages {
  confirm: string;
  cancel: string;
  save: string;
  delete: string;
  edit: string;
  add: string;
  create: string;
  update: string;
  search: string;
  reset: string;
  submit: string;
  back: string;
  next: string;
  previous: string;
  finish: string;
  close: string;
  loading: string;
  noData: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  yes: string;
  no: string;
  all: string;
  select: string;
  upload: string;
  download: string;
  export: string;
  import: string;
  refresh: string;
  copy: string;
  paste: string;
  cut: string;
  rename: string;
  move: string;
  settings: string;
}

export interface AppMessages {
  title: string;
  subtitle: string;
  initializing: string;
  initializationFailed: string;
}

export interface NavMessages {
  home: string;
  knowledge: string;
  projects: string;
  chat: string;
  settings: string;
  about: string;
}

export interface AuthMessages {
  login: string;
  logout: string;
  register: string;
  username: string;
  password: string;
  confirmPassword: string;
  forgotPassword: string;
  rememberMe: string;
  loginSuccess: string;
  loginFailed: string;
  logoutSuccess: string;
}

export interface KnowledgeMessages {
  title: string;
  list: string;
  detail: string;
  create: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  search: string;
  category: string;
  tags: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  noContent: string;
}

export interface ProjectMessages {
  title: string;
  list: string;
  detail: string;
  create: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  name: string;
  description: string;
  type: string;
  status: string;
  members: string;
  files: string;
  tasks: string;
  archived: string;
  active: string;
  completed: string;
  settings: string;
  collaboration: string;
  market: string;
  categories: string;
}

export interface ChatMessages {
  title: string;
  newChat: string;
  conversations: string;
  send: string;
  inputPlaceholder: string;
  model: string;
  temperature: string;
  maxTokens: string;
  clearHistory: string;
  exportChat: string;
  stopGeneration: string;
  regenerate: string;
  copy: string;
  delete: string;
}

export interface FileMessages {
  name: string;
  type: string;
  size: string;
  createdAt: string;
  modifiedAt: string;
  upload: string;
  download: string;
  preview: string;
  rename: string;
  delete: string;
  deleteConfirm: string;
  uploadSuccess: string;
  uploadFailed: string;
  downloadSuccess: string;
  downloadFailed: string;
}

export interface EditorMessages {
  markdown: string;
  richText: string;
  codeEditor: string;
  preview: string;
  fullscreen: string;
  exitFullscreen: string;
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  heading: string;
  quote: string;
  orderedList: string;
  unorderedList: string;
  link: string;
  image: string;
  codeBlock: string;
  table: string;
  undo: string;
  redo: string;
}

export interface SettingsMessages {
  title: string;
  general: string;
  appearance: string;
  language: string;
  theme: string;
  light: string;
  dark: string;
  auto: string;
  llm: string;
  llmProvider: string;
  llmModel: string;
  apiKey: string;
  ollama: string;
  ollamaHost: string;
  cloud: string;
  local: string;
  ukey: string;
  ukeyStatus: string;
  ukeyConnected: string;
  ukeyDisconnected: string;
  database: string;
  dbPath: string;
  dbEncryption: string;
  git: string;
  gitAutoCommit: string;
  gitUsername: string;
  gitEmail: string;
  about: string;
  version: string;
  checkUpdate: string;
}

export interface UkeyMessages {
  title: string;
  status: string;
  connected: string;
  disconnected: string;
  simulation: string;
  pin: string;
  enterPin: string;
  verifyPin: string;
  changePin: string;
  pinError: string;
  pinSuccess: string;
}

export interface GitMessages {
  title: string;
  commit: string;
  push: string;
  pull: string;
  branch: string;
  merge: string;
  conflict: string;
  resolveConflict: string;
  history: string;
  diff: string;
  uncommittedChanges: string;
  commitMessage: string;
  commitSuccess: string;
  commitFailed: string;
  pushSuccess: string;
  pushFailed: string;
  pullSuccess: string;
  pullFailed: string;
}

export interface P2pMessages {
  title: string;
  status: string;
  connected: string;
  disconnected: string;
  peers: string;
  messages: string;
  send: string;
  receive: string;
  encryption: string;
}

export interface SocialMessages {
  title: string;
  friends: string;
  posts: string;
  messages: string;
  notifications: string;
  addFriend: string;
  removeFriend: string;
  sendMessage: string;
  newPost: string;
  like: string;
  comment: string;
  share: string;
}

export interface TradeMessages {
  title: string;
  market: string;
  wallet: string;
  assets: string;
  transactions: string;
  buy: string;
  sell: string;
  transfer: string;
  balance: string;
  price: string;
  amount: string;
}

export interface TemplateMessages {
  title: string;
  list: string;
  create: string;
  edit: string;
  delete: string;
  use: string;
  name: string;
  description: string;
  category: string;
  content: string;
}

export interface NotificationMessages {
  title: string;
  noNotifications: string;
  markAsRead: string;
  markAllAsRead: string;
  clear: string;
}

export interface ErrorMessages {
  networkError: string;
  serverError: string;
  unauthorized: string;
  forbidden: string;
  notFound: string;
  timeout: string;
  unknown: string;
  tryAgain: string;
}

export interface ValidationMessages {
  required: string;
  email: string;
  url: string;
  minLength: string;
  maxLength: string;
  pattern: string;
}

export interface TimeMessages {
  now: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
  weeksAgo: string;
  monthsAgo: string;
  yearsAgo: string;
  yesterday: string;
  today: string;
  tomorrow: string;
}

export interface LocaleMessages {
  [key: string]: unknown;
  common: CommonMessages;
  app: AppMessages;
  nav: NavMessages;
  auth: AuthMessages;
  knowledge: KnowledgeMessages;
  project: ProjectMessages;
  chat: ChatMessages;
  file: FileMessages;
  editor: EditorMessages;
  settings: SettingsMessages;
  ukey: UkeyMessages;
  git: GitMessages;
  p2p: P2pMessages;
  social: SocialMessages;
  trade: TradeMessages;
  template: TemplateMessages;
  notification: NotificationMessages;
  error: ErrorMessages;
  validation: ValidationMessages;
  time: TimeMessages;
}

export type SupportedLocale = 'zh-CN' | 'en-US' | 'zh-TW' | 'ja-JP' | 'ko-KR';

export interface LocaleOption {
  value: SupportedLocale;
  label: string;
  icon: string;
}
