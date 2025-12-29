/**
 * 国际化配置
 */

import { reactive, computed } from 'vue';

// 支持的语言
export const LOCALES = {
  ZH_CN: 'zh-CN',
  EN_US: 'en-US',
};

// 当前语言
const state = reactive({
  currentLocale: LOCALES.ZH_CN,
});

// 语言包
const messages = {
  [LOCALES.ZH_CN]: {
    // 通用
    common: {
      search: '搜索',
      create: '创建',
      edit: '编辑',
      delete: '删除',
      save: '保存',
      cancel: '取消',
      confirm: '确认',
      close: '关闭',
      refresh: '刷新',
      loading: '加载中...',
      success: '成功',
      error: '错误',
      warning: '警告',
      info: '信息',
      yes: '是',
      no: '否',
      all: '全部',
      enable: '启用',
      disable: '禁用',
      enabled: '已启用',
      disabled: '已禁用',
      details: '详情',
      documentation: '文档',
      help: '帮助',
    },

    // 技能
    skill: {
      title: '技能管理',
      subtitle: '管理和配置 AI 助手的技能集',
      create: '创建技能',
      name: '技能名称',
      displayName: '显示名称',
      description: '描述',
      category: '分类',
      tags: '标签',
      tools: '工具',
      totalCount: '总技能数',
      enabledCount: '已启用',
      disabledCount: '已禁用',
      usageCount: '使用次数',
      successRate: '成功率',
      statistics: '统计分析',
      dependencyGraph: '依赖关系图',
      searchPlaceholder: '搜索技能...',
      filterCategory: '分类筛选',
    },

    // 工具
    tool: {
      title: '工具管理',
      subtitle: '管理和测试 AI 助手的工具库',
      create: '创建工具',
      name: '工具名称',
      displayName: '显示名称',
      description: '描述',
      type: '类型',
      category: '分类',
      riskLevel: '风险等级',
      totalCount: '总工具数',
      enabledCount: '已启用',
      builtinCount: '内置工具',
      pluginCount: '插件工具',
      usageCount: '调用次数',
      successRate: '成功率',
      avgExecutionTime: '平均执行时间',
      statistics: '使用统计',
      dependencyGraph: '依赖关系图',
      test: '测试',
      searchPlaceholder: '搜索工具...',
      filterCategory: '分类筛选',
      filterStatus: '状态筛选',
    },

    // 批量操作
    batch: {
      selected: '已选择',
      items: '项',
      enable: '批量启用',
      disable: '批量禁用',
      delete: '批量删除',
      clearSelection: '清空选择',
      confirmEnable: '确认批量启用？',
      confirmDisable: '确认批量禁用？',
      confirmDelete: '确认批量删除？',
      willEnable: '将启用',
      willDisable: '将禁用',
      willDelete: '将删除',
      cannotUndo: '此操作不可恢复，是否继续？',
      deleteList: '将删除以下项目：',
    },

    // 历史记录
    history: {
      title: '操作历史',
      total: '总记录',
      skills: '技能',
      tools: '工具',
      clear: '清空',
      confirmClear: '确认清空所有历史记录？',
      noRecords: '暂无操作记录',
      allEntities: '全部',
      allActions: '所有操作',
      actionCreate: '创建',
      actionUpdate: '更新',
      actionDelete: '删除',
      actionEnable: '启用',
      actionDisable: '禁用',
    },

    // 帮助
    help: {
      title: '帮助中心',
      quickStart: '快速开始',
      userManual: '用户手册',
      community: '社区论坛',
      support: '技术支持',
      search: '搜索帮助...',
      noResults: '未找到相关内容',
      needMoreHelp: '需要更多帮助？',
    },

    // 主题
    theme: {
      light: '浅色模式',
      dark: '深色模式',
      auto: '跟随系统',
    },

    // 快捷键
    shortcuts: {
      title: '键盘快捷键',
      search: '快速搜索',
      new: '新建',
      save: '保存',
      refresh: '刷新',
      delete: '删除',
      selectAll: '全选',
      deselect: '取消选择',
      close: '关闭',
      help: '帮助',
    },

    // 消息
    message: {
      createSuccess: '创建成功',
      updateSuccess: '更新成功',
      deleteSuccess: '删除成功',
      saveSuccess: '保存成功',
      enableSuccess: '启用成功',
      disableSuccess: '禁用成功',
      refreshSuccess: '刷新成功',
      operationSuccess: '操作成功',
      operationFailed: '操作失败',
      loadError: '加载失败',
      networkError: '网络错误',
    },
  },

  [LOCALES.EN_US]: {
    common: {
      search: 'Search',
      create: 'Create',
      edit: 'Edit',
      delete: 'Delete',
      save: 'Save',
      cancel: 'Cancel',
      confirm: 'Confirm',
      close: 'Close',
      refresh: 'Refresh',
      loading: 'Loading...',
      success: 'Success',
      error: 'Error',
      warning: 'Warning',
      info: 'Info',
      yes: 'Yes',
      no: 'No',
      all: 'All',
      enable: 'Enable',
      disable: 'Disable',
      enabled: 'Enabled',
      disabled: 'Disabled',
      details: 'Details',
      documentation: 'Documentation',
      help: 'Help',
    },

    skill: {
      title: 'Skill Management',
      subtitle: 'Manage and configure AI assistant skills',
      create: 'Create Skill',
      name: 'Skill Name',
      displayName: 'Display Name',
      description: 'Description',
      category: 'Category',
      tags: 'Tags',
      tools: 'Tools',
      totalCount: 'Total Skills',
      enabledCount: 'Enabled',
      disabledCount: 'Disabled',
      usageCount: 'Usage Count',
      successRate: 'Success Rate',
      statistics: 'Statistics',
      dependencyGraph: 'Dependency Graph',
      searchPlaceholder: 'Search skills...',
      filterCategory: 'Filter Category',
    },

    tool: {
      title: 'Tool Management',
      subtitle: 'Manage and test AI assistant tools',
      create: 'Create Tool',
      name: 'Tool Name',
      displayName: 'Display Name',
      description: 'Description',
      type: 'Type',
      category: 'Category',
      riskLevel: 'Risk Level',
      totalCount: 'Total Tools',
      enabledCount: 'Enabled',
      builtinCount: 'Builtin',
      pluginCount: 'Plugin',
      usageCount: 'Usage Count',
      successRate: 'Success Rate',
      avgExecutionTime: 'Avg Execution Time',
      statistics: 'Statistics',
      dependencyGraph: 'Dependency Graph',
      test: 'Test',
      searchPlaceholder: 'Search tools...',
      filterCategory: 'Filter Category',
      filterStatus: 'Filter Status',
    },

    batch: {
      selected: 'Selected',
      items: 'items',
      enable: 'Batch Enable',
      disable: 'Batch Disable',
      delete: 'Batch Delete',
      clearSelection: 'Clear Selection',
      confirmEnable: 'Confirm batch enable?',
      confirmDisable: 'Confirm batch disable?',
      confirmDelete: 'Confirm batch delete?',
      willEnable: 'Will enable',
      willDisable: 'Will disable',
      willDelete: 'Will delete',
      cannotUndo: 'This operation cannot be undone. Continue?',
      deleteList: 'The following items will be deleted:',
    },

    history: {
      title: 'Operation History',
      total: 'Total',
      skills: 'Skills',
      tools: 'Tools',
      clear: 'Clear',
      confirmClear: 'Confirm clear all history?',
      noRecords: 'No records',
      allEntities: 'All',
      allActions: 'All Actions',
      actionCreate: 'Create',
      actionUpdate: 'Update',
      actionDelete: 'Delete',
      actionEnable: 'Enable',
      actionDisable: 'Disable',
    },

    help: {
      title: 'Help Center',
      quickStart: 'Quick Start',
      userManual: 'User Manual',
      community: 'Community',
      support: 'Support',
      search: 'Search help...',
      noResults: 'No results found',
      needMoreHelp: 'Need more help?',
    },

    theme: {
      light: 'Light Mode',
      dark: 'Dark Mode',
      auto: 'Auto',
    },

    shortcuts: {
      title: 'Keyboard Shortcuts',
      search: 'Quick Search',
      new: 'New',
      save: 'Save',
      refresh: 'Refresh',
      delete: 'Delete',
      selectAll: 'Select All',
      deselect: 'Deselect',
      close: 'Close',
      help: 'Help',
    },

    message: {
      createSuccess: 'Created successfully',
      updateSuccess: 'Updated successfully',
      deleteSuccess: 'Deleted successfully',
      saveSuccess: 'Saved successfully',
      enableSuccess: 'Enabled successfully',
      disableSuccess: 'Disabled successfully',
      refreshSuccess: 'Refreshed',
      operationSuccess: 'Operation successful',
      operationFailed: 'Operation failed',
      loadError: 'Load failed',
      networkError: 'Network error',
    },
  },
};

// 获取翻译文本
export function t(key) {
  const keys = key.split('.');
  let value = messages[state.currentLocale];

  for (const k of keys) {
    if (value && typeof value === 'object') {
      value = value[k];
    } else {
      return key; // 如果找不到，返回key本身
    }
  }

  return value || key;
}

// 设置语言
export function setLocale(locale) {
  if (Object.values(LOCALES).includes(locale)) {
    state.currentLocale = locale;
    localStorage.setItem('skill-tool-locale', locale);
  }
}

// 获取当前语言
export function getCurrentLocale() {
  return state.currentLocale;
}

// 初始化语言设置
export function initLocale() {
  const saved = localStorage.getItem('skill-tool-locale');
  if (saved && Object.values(LOCALES).includes(saved)) {
    state.currentLocale = saved;
  }
}

// 使用国际化
export function useI18n() {
  initLocale();

  return {
    t,
    setLocale,
    getCurrentLocale,
    currentLocale: computed(() => state.currentLocale),
    LOCALES,
  };
}

export default {
  t,
  setLocale,
  getCurrentLocale,
  useI18n,
  LOCALES,
};
