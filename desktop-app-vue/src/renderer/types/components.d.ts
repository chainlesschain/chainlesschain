/**
 * Vue 组件 Props 类型定义
 *
 * @description 定义通用组件的 Props 类型
 */

import type { VNode, Component, DefineComponent } from 'vue';

// ==================== 通用组件 Props ====================

/**
 * 基础按钮 Props
 */
export interface ButtonProps {
  type?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  size?: 'large' | 'middle' | 'small';
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  ghost?: boolean;
  block?: boolean;
  icon?: string | VNode;
  htmlType?: 'button' | 'submit' | 'reset';
}

/**
 * 输入框 Props
 */
export interface InputProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  maxlength?: number;
  showCount?: boolean;
  allowClear?: boolean;
  prefix?: string | VNode;
  suffix?: string | VNode;
  size?: 'large' | 'middle' | 'small';
  status?: 'error' | 'warning';
}

/**
 * 模态框 Props
 */
export interface ModalProps {
  visible?: boolean;
  title?: string | VNode;
  width?: string | number;
  centered?: boolean;
  closable?: boolean;
  maskClosable?: boolean;
  keyboard?: boolean;
  okText?: string;
  cancelText?: string;
  okButtonProps?: ButtonProps;
  cancelButtonProps?: ButtonProps;
  confirmLoading?: boolean;
  destroyOnClose?: boolean;
  footer?: VNode | null;
  zIndex?: number;
}

/**
 * 表格列定义
 */
export interface TableColumn<T = any> {
  title: string;
  dataIndex?: string;
  key?: string;
  width?: string | number;
  fixed?: 'left' | 'right';
  align?: 'left' | 'center' | 'right';
  ellipsis?: boolean;
  sorter?: boolean | ((a: T, b: T) => number);
  filters?: { text: string; value: any }[];
  customRender?: (options: { text: any; record: T; index: number }) => VNode | string;
  slots?: { customRender?: string };
}

/**
 * 表格 Props
 */
export interface TableProps<T = any> {
  columns: TableColumn<T>[];
  dataSource: T[];
  rowKey?: string | ((record: T) => string);
  loading?: boolean;
  pagination?: boolean | PaginationProps;
  bordered?: boolean;
  size?: 'large' | 'middle' | 'small';
  scroll?: { x?: number | string; y?: number | string };
  rowSelection?: RowSelectionProps<T>;
  expandable?: ExpandableProps<T>;
}

/**
 * 分页 Props
 */
export interface PaginationProps {
  current?: number;
  pageSize?: number;
  total?: number;
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: (total: number, range: [number, number]) => string;
  pageSizeOptions?: string[];
  simple?: boolean;
  size?: 'default' | 'small';
}

/**
 * 行选择 Props
 */
export interface RowSelectionProps<T = any> {
  type?: 'checkbox' | 'radio';
  selectedRowKeys?: string[];
  onChange?: (selectedRowKeys: string[], selectedRows: T[]) => void;
  getCheckboxProps?: (record: T) => any;
  selections?: boolean | any[];
  fixed?: boolean;
}

/**
 * 展开配置 Props
 */
export interface ExpandableProps<T = any> {
  expandedRowKeys?: string[];
  expandedRowRender?: (record: T) => VNode;
  rowExpandable?: (record: T) => boolean;
  onExpand?: (expanded: boolean, record: T) => void;
  onExpandedRowsChange?: (expandedRows: string[]) => void;
}

/**
 * 表单项 Props
 */
export interface FormItemProps {
  label?: string | VNode;
  name?: string | string[];
  rules?: FormRule[];
  required?: boolean;
  labelCol?: { span?: number; offset?: number };
  wrapperCol?: { span?: number; offset?: number };
  help?: string | VNode;
  extra?: string | VNode;
  validateStatus?: 'success' | 'warning' | 'error' | 'validating';
  hasFeedback?: boolean;
  colon?: boolean;
}

/**
 * 表单验证规则
 */
export interface FormRule {
  required?: boolean;
  message?: string;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url';
  min?: number;
  max?: number;
  len?: number;
  pattern?: RegExp;
  validator?: (rule: FormRule, value: any) => Promise<void>;
  trigger?: 'blur' | 'change' | string[];
}

/**
 * 表单 Props
 */
export interface FormProps {
  model?: Record<string, any>;
  rules?: Record<string, FormRule | FormRule[]>;
  layout?: 'horizontal' | 'vertical' | 'inline';
  labelCol?: { span?: number; offset?: number };
  wrapperCol?: { span?: number; offset?: number };
  labelAlign?: 'left' | 'right';
  colon?: boolean;
  disabled?: boolean;
  scrollToFirstError?: boolean;
  validateTrigger?: string | string[];
}

/**
 * 选择器选项
 */
export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  children?: SelectOption[];
}

/**
 * 选择器 Props
 */
export interface SelectProps {
  value?: any;
  options?: SelectOption[];
  mode?: 'multiple' | 'tags';
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowClear?: boolean;
  showSearch?: boolean;
  filterOption?: boolean | ((input: string, option: SelectOption) => boolean);
  notFoundContent?: string | VNode;
  size?: 'large' | 'middle' | 'small';
  maxTagCount?: number | 'responsive';
  dropdownMatchSelectWidth?: boolean | number;
}

/**
 * 树节点
 */
export interface TreeNode {
  key: string;
  title: string | VNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  disabled?: boolean;
  disableCheckbox?: boolean;
  selectable?: boolean;
  checkable?: boolean;
  icon?: VNode;
}

/**
 * 树 Props
 */
export interface TreeProps {
  treeData: TreeNode[];
  selectedKeys?: string[];
  checkedKeys?: string[];
  expandedKeys?: string[];
  checkable?: boolean;
  selectable?: boolean;
  multiple?: boolean;
  showLine?: boolean;
  showIcon?: boolean;
  draggable?: boolean;
  blockNode?: boolean;
  defaultExpandAll?: boolean;
  defaultExpandParent?: boolean;
  filterTreeNode?: (node: TreeNode) => boolean;
}

/**
 * 标签页 Props
 */
export interface TabsProps {
  activeKey?: string;
  type?: 'line' | 'card' | 'editable-card';
  size?: 'large' | 'middle' | 'small';
  tabPosition?: 'top' | 'right' | 'bottom' | 'left';
  centered?: boolean;
  animated?: boolean | { inkBar?: boolean; tabPane?: boolean };
  hideAdd?: boolean;
  tabBarGutter?: number;
  tabBarStyle?: Record<string, string>;
}

/**
 * 标签页项 Props
 */
export interface TabPaneProps {
  key: string;
  tab: string | VNode;
  disabled?: boolean;
  closable?: boolean;
  forceRender?: boolean;
}

/**
 * 抽屉 Props
 */
export interface DrawerProps {
  visible?: boolean;
  title?: string | VNode;
  width?: string | number;
  height?: string | number;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  closable?: boolean;
  maskClosable?: boolean;
  keyboard?: boolean;
  destroyOnClose?: boolean;
  footer?: VNode;
  footerStyle?: Record<string, string>;
  zIndex?: number;
  push?: boolean | { distance?: number };
}

/**
 * 消息提示 Props
 */
export interface MessageProps {
  content: string | VNode;
  duration?: number;
  icon?: VNode;
  key?: string;
  style?: Record<string, string>;
  onClick?: () => void;
  onClose?: () => void;
}

/**
 * 通知 Props
 */
export interface NotificationProps {
  message: string | VNode;
  description?: string | VNode;
  duration?: number | null;
  icon?: VNode;
  key?: string;
  placement?: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  style?: Record<string, string>;
  onClick?: () => void;
  onClose?: () => void;
  btn?: VNode;
}

// ==================== 业务组件 Props ====================

/**
 * 聊天消息组件 Props
 */
export interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  };
  showAvatar?: boolean;
  showTimestamp?: boolean;
  editable?: boolean;
}

/**
 * 代码编辑器 Props
 */
export interface CodeEditorProps {
  value?: string;
  language?: string;
  theme?: 'vs' | 'vs-dark' | 'hc-black';
  readOnly?: boolean;
  minimap?: boolean;
  lineNumbers?: 'on' | 'off' | 'relative';
  wordWrap?: 'on' | 'off' | 'wordWrapColumn';
  fontSize?: number;
  tabSize?: number;
}

/**
 * Markdown 编辑器 Props
 */
export interface MarkdownEditorProps {
  value?: string;
  placeholder?: string;
  readOnly?: boolean;
  preview?: boolean;
  toolbar?: boolean | string[];
  height?: string | number;
  autofocus?: boolean;
}

/**
 * 文件上传 Props
 */
export interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number;
  maxCount?: number;
  directory?: boolean;
  drag?: boolean;
  disabled?: boolean;
  showUploadList?: boolean;
  listType?: 'text' | 'picture' | 'picture-card';
  beforeUpload?: (file: File) => boolean | Promise<boolean>;
  customRequest?: (options: any) => void;
}

/**
 * 进度监控器 Props
 */
export interface ProgressMonitorProps {
  maxCompletedTasks?: number;
  showDetails?: boolean;
  position?: 'top-right' | 'bottom-right' | 'bottom-left';
}

/**
 * 知识图谱 Props
 */
export interface KnowledgeGraphProps {
  data: {
    nodes: { id: string; label: string; [key: string]: any }[];
    edges: { source: string; target: string; [key: string]: any }[];
  };
  width?: number;
  height?: number;
  layout?: 'force' | 'circular' | 'radial' | 'dagre';
  nodeSize?: number;
  edgeWidth?: number;
  interactive?: boolean;
}

/**
 * 视频播放器 Props
 */
export interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  width?: string | number;
  height?: string | number;
  preload?: 'auto' | 'metadata' | 'none';
}

/**
 * 音频播放器 Props
 */
export interface AudioPlayerProps {
  src: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  showWaveform?: boolean;
}

// ==================== 事件类型 ====================

/**
 * 表单提交事件
 */
export interface FormSubmitEvent<T = Record<string, any>> {
  values: T;
  errors?: Record<string, string[]>;
}

/**
 * 分页变化事件
 */
export interface PaginationChangeEvent {
  current: number;
  pageSize: number;
}

/**
 * 表格变化事件
 */
export interface TableChangeEvent {
  pagination: PaginationProps;
  filters: Record<string, any[]>;
  sorter: {
    field?: string;
    order?: 'ascend' | 'descend';
  };
}

/**
 * 上传变化事件
 */
export interface UploadChangeEvent {
  file: File;
  fileList: File[];
  event?: ProgressEvent;
}
