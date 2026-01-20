/**
 * usePluginExtensions - 插件扩展点 Composable
 *
 * 提供获取和使用插件UI扩展的Vue Composition API
 */

import { logger, createLogger } from "@/utils/logger";
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  markRaw,
  reactive,
} from "vue";

// ============================================
// 预定义插槽常量
// ============================================

/**
 * 预定义的UI插槽位置
 * 插件可以在这些位置注册组件
 */
export const PLUGIN_SLOTS = {
  // 编辑器相关
  EDITOR_TOOLBAR: "editor-toolbar", // 编辑器工具栏
  EDITOR_SIDEBAR: "editor-sidebar", // 编辑器侧边栏
  EDITOR_FOOTER: "editor-footer", // 编辑器底部
  EDITOR_CONTEXT_MENU: "editor-context-menu", // 编辑器右键菜单

  // 笔记列表相关
  NOTE_LIST_HEADER: "note-list-header", // 笔记列表头部
  NOTE_LIST_FOOTER: "note-list-footer", // 笔记列表底部
  NOTE_LIST_ITEM_ACTIONS: "note-list-item-actions", // 笔记列表项操作按钮

  // 项目相关
  PROJECT_HEADER: "project-header", // 项目页头部
  PROJECT_SIDEBAR: "project-sidebar", // 项目侧边栏
  PROJECT_ACTIONS: "project-actions", // 项目操作按钮

  // AI 对话相关
  CHAT_INPUT_ACTIONS: "chat-input-actions", // 对话输入框操作
  CHAT_MESSAGE_ACTIONS: "chat-message-actions", // 消息操作按钮
  CHAT_SIDEBAR: "chat-sidebar", // 对话侧边栏

  // 设置相关
  SETTINGS_SECTION: "settings-section", // 设置页额外区块
  SETTINGS_GENERAL: "settings-general", // 通用设置区块

  // 全局
  GLOBAL_HEADER: "global-header", // 全局头部
  GLOBAL_FOOTER: "global-footer", // 全局底部
  SIDEBAR_BOTTOM: "sidebar-bottom", // 侧边栏底部
  STATUS_BAR: "status-bar", // 状态栏
};

// 插槽描述（用于文档和调试）
export const SLOT_DESCRIPTIONS = {
  [PLUGIN_SLOTS.EDITOR_TOOLBAR]: "编辑器工具栏，用于添加格式化按钮等",
  [PLUGIN_SLOTS.EDITOR_SIDEBAR]: "编辑器侧边栏，用于添加大纲、引用等面板",
  [PLUGIN_SLOTS.EDITOR_FOOTER]: "编辑器底部，用于添加字数统计、状态等",
  [PLUGIN_SLOTS.EDITOR_CONTEXT_MENU]: "编辑器右键菜单项",
  [PLUGIN_SLOTS.NOTE_LIST_HEADER]: "笔记列表顶部区域",
  [PLUGIN_SLOTS.NOTE_LIST_FOOTER]: "笔记列表底部区域",
  [PLUGIN_SLOTS.NOTE_LIST_ITEM_ACTIONS]: "笔记列表每项的操作按钮",
  [PLUGIN_SLOTS.PROJECT_HEADER]: "项目页面头部区域",
  [PLUGIN_SLOTS.PROJECT_SIDEBAR]: "项目页面侧边栏",
  [PLUGIN_SLOTS.PROJECT_ACTIONS]: "项目操作按钮区域",
  [PLUGIN_SLOTS.CHAT_INPUT_ACTIONS]: "AI对话输入框旁的操作按钮",
  [PLUGIN_SLOTS.CHAT_MESSAGE_ACTIONS]: "AI对话消息的操作按钮",
  [PLUGIN_SLOTS.CHAT_SIDEBAR]: "AI对话侧边栏",
  [PLUGIN_SLOTS.SETTINGS_SECTION]: "设置页面的额外配置区块",
  [PLUGIN_SLOTS.SETTINGS_GENERAL]: "通用设置区块",
  [PLUGIN_SLOTS.GLOBAL_HEADER]: "全局头部区域",
  [PLUGIN_SLOTS.GLOBAL_FOOTER]: "全局底部区域",
  [PLUGIN_SLOTS.SIDEBAR_BOTTOM]: "主侧边栏底部",
  [PLUGIN_SLOTS.STATUS_BAR]: "应用状态栏",
};

// ============================================
// 缓存和状态
// ============================================

// 缓存的扩展数据
const cachedExtensions = ref({
  pages: [],
  menus: [],
  components: [],
  lastUpdated: null,
});

// 是否正在加载
const isLoading = ref(false);

// 错误状态
const error = ref(null);

// 刷新间隔（毫秒）
const REFRESH_INTERVAL = 30000;

// 已注册的插件路由
const registeredRoutes = reactive(new Set());

/**
 * 获取插件UI扩展
 * @returns {Object} Composable 返回值
 */
export function usePluginExtensions() {
  // 事件处理器
  let eventHandlers = [];

  /**
   * 加载所有UI扩展
   */
  async function loadExtensions() {
    if (!window.electronAPI?.plugin?.getUIExtensions) {
      logger.warn("[usePluginExtensions] Plugin API not available");
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const result = await window.electronAPI.plugin.getUIExtensions();

      if (result.success) {
        cachedExtensions.value = {
          pages: result.extensions?.pages || [],
          menus: result.extensions?.menus || [],
          components: result.extensions?.components || [],
          lastUpdated: Date.now(),
        };
      } else {
        throw new Error(result.error || "获取UI扩展失败");
      }
    } catch (err) {
      logger.error("[usePluginExtensions] Failed to load extensions:", err);
      error.value = err.message;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取页面扩展路由配置
   */
  const pageRoutes = computed(() => {
    return cachedExtensions.value.pages.map((page) => ({
      path: `/plugin${page.config?.path || `/${page.plugin_id}`}`,
      name: `plugin-${page.plugin_id}-${page.config?.id || "main"}`,
      meta: {
        title: page.config?.title || page.plugin_name,
        icon: page.config?.icon || "AppstoreOutlined",
        pluginId: page.plugin_id,
        isPluginPage: true,
        ...page.config?.meta,
      },
      // 组件将在渲染时动态加载
      componentConfig: page.config,
    }));
  });

  /**
   * 获取菜单扩展配置
   */
  const menuItems = computed(() => {
    return cachedExtensions.value.menus.map((menu) => ({
      key: menu.config?.path || `plugin-${menu.plugin_id}`,
      label: menu.config?.label || menu.plugin_name,
      icon: menu.config?.icon || "AppstoreOutlined",
      path: `/plugin${menu.config?.path || `/${menu.plugin_id}`}`,
      pluginId: menu.plugin_id,
      order: menu.priority || 100,
      badge: menu.config?.badge,
      children: menu.config?.children || [],
    }));
  });

  /**
   * 获取组件扩展（按插槽分组）
   */
  const componentsBySlot = computed(() => {
    const grouped = {};

    for (const component of cachedExtensions.value.components) {
      const slot = component.config?.slot || "default";

      if (!grouped[slot]) {
        grouped[slot] = [];
      }

      grouped[slot].push({
        id: component.id,
        pluginId: component.plugin_id,
        pluginName: component.plugin_name,
        slot,
        componentConfig: component.config,
        priority: component.priority || 100,
      });
    }

    // 按优先级排序
    for (const slot of Object.keys(grouped)) {
      grouped[slot].sort((a, b) => a.priority - b.priority);
    }

    return grouped;
  });

  /**
   * 获取指定插槽的组件
   * @param {string} slotName - 插槽名称
   */
  function getSlotComponents(slotName) {
    return componentsBySlot.value[slotName] || [];
  }

  /**
   * 设置事件监听
   */
  function setupEventListeners() {
    if (!window.electronAPI?.plugin) {
      return;
    }

    const handlePluginInstalled = () => loadExtensions();
    const handlePluginUninstalled = () => loadExtensions();
    const handlePluginEnabled = () => loadExtensions();
    const handlePluginDisabled = () => loadExtensions();

    window.electronAPI.plugin.on("plugin:installed", handlePluginInstalled);
    window.electronAPI.plugin.on("plugin:uninstalled", handlePluginUninstalled);
    window.electronAPI.plugin.on("plugin:enabled", handlePluginEnabled);
    window.electronAPI.plugin.on("plugin:disabled", handlePluginDisabled);

    eventHandlers = [
      { event: "plugin:installed", handler: handlePluginInstalled },
      { event: "plugin:uninstalled", handler: handlePluginUninstalled },
      { event: "plugin:enabled", handler: handlePluginEnabled },
      { event: "plugin:disabled", handler: handlePluginDisabled },
    ];
  }

  /**
   * 清理事件监听
   */
  function cleanupEventListeners() {
    if (!window.electronAPI?.plugin) {
      return;
    }

    for (const { event, handler } of eventHandlers) {
      window.electronAPI.plugin.off(event, handler);
    }

    eventHandlers = [];
  }

  // 生命周期
  onMounted(() => {
    loadExtensions();
    setupEventListeners();
  });

  onUnmounted(() => {
    cleanupEventListeners();
  });

  return {
    // 状态
    isLoading,
    error,
    extensions: cachedExtensions,

    // 计算属性
    pageRoutes,
    menuItems,
    componentsBySlot,

    // 方法
    loadExtensions,
    getSlotComponents,
  };
}

/**
 * 获取指定插槽的组件扩展（不需要setup上下文）
 * @param {string} slotName - 插槽名称
 */
export async function getSlotExtensions(slotName) {
  if (!window.electronAPI?.plugin?.getSlotExtensions) {
    logger.warn("[getSlotExtensions] Plugin API not available");
    return [];
  }

  try {
    const result = await window.electronAPI.plugin.getSlotExtensions(slotName);

    if (result.success) {
      return result.extensions || [];
    } else {
      throw new Error(result.error || "获取插槽扩展失败");
    }
  } catch (err) {
    logger.error(`[getSlotExtensions] Failed to get slot ${slotName}:`, err);
    return [];
  }
}

/**
 * 生成插件页面的动态路由
 * @param {Object} router - Vue Router 实例
 */
export async function registerPluginRoutes(router) {
  if (!window.electronAPI?.plugin?.getUIExtensions) {
    logger.warn("[registerPluginRoutes] Plugin API not available");
    return;
  }

  try {
    const result = await window.electronAPI.plugin.getUIExtensions();

    if (!result.success) {
      throw new Error(result.error || "获取UI扩展失败");
    }

    const pages = result.extensions?.pages || [];

    for (const page of pages) {
      const config = page.config || {};
      const routePath = `/plugin${config.path || `/${page.plugin_id}`}`;
      const routeName = `plugin-${page.plugin_id}-${config.id || "main"}`;

      // 检查路由是否已存在
      if (router.hasRoute(routeName)) {
        continue;
      }

      const route = {
        path: routePath,
        name: routeName,
        meta: {
          title: config.title || page.plugin_name,
          icon: config.icon || "AppstoreOutlined",
          pluginId: page.plugin_id,
          isPluginPage: true,
          ...config.meta,
        },
        // 使用一个包装组件来加载插件内容
        component: () =>
          import("../components/plugins/PluginPageWrapper.vue").then(
            (module) => {
              // 将配置传递给组件
              const Component = module.default;
              return {
                ...Component,
                props: {
                  ...Component.props,
                  pageConfig: {
                    default: () => config,
                  },
                  pluginId: {
                    default: page.plugin_id,
                  },
                },
              };
            },
          ),
      };

      router.addRoute(route);
      logger.info(`[registerPluginRoutes] Route registered: ${routePath}`);
    }
  } catch (err) {
    logger.error("[registerPluginRoutes] Failed to register routes:", err);
  }
}

// ============================================
// 插件方法调用
// ============================================

/**
 * 调用插件方法
 * @param {string} pluginId - 插件ID
 * @param {string} methodName - 方法名
 * @param {any} args - 参数
 * @returns {Promise<any>} 方法返回值
 */
export async function callPluginMethod(pluginId, methodName, ...args) {
  if (!window.electronAPI?.plugin?.callPluginMethod) {
    logger.warn("[callPluginMethod] Plugin API not available");
    return null;
  }

  try {
    const result = await window.electronAPI.plugin.callPluginMethod(
      pluginId,
      methodName,
      args,
    );

    if (result.success) {
      return result.result;
    } else {
      throw new Error(result.error || "调用插件方法失败");
    }
  } catch (err) {
    logger.error(`[callPluginMethod] ${pluginId}.${methodName} 失败:`, err);
    throw err;
  }
}

/**
 * 获取插件提供的页面内容
 * @param {string} pluginId - 插件ID
 * @param {string} pageId - 页面ID
 * @returns {Promise<Object>} 页面内容配置
 */
export async function getPluginPageContent(pluginId, pageId = "main") {
  if (!window.electronAPI?.plugin?.getPluginPageContent) {
    return { success: false, error: "API not available" };
  }

  try {
    return await window.electronAPI.plugin.getPluginPageContent(
      pluginId,
      pageId,
    );
  } catch (err) {
    logger.error(`[getPluginPageContent] ${pluginId}/${pageId} 失败:`, err);
    return { success: false, error: err.message };
  }
}

// ============================================
// 插件菜单集成
// ============================================

/**
 * 获取插件菜单项（用于侧边栏集成）
 * @returns {Promise<Array>} 菜单项数组
 */
export async function getPluginMenuItems() {
  if (!window.electronAPI?.plugin?.getUIExtensions) {
    // API 未就绪时静默返回空数组
    return [];
  }

  try {
    const result = await window.electronAPI.plugin.getUIExtensions();
    if (!result.success) {
      // IPC 返回失败但不记录为错误（可能是正常的初始化时序）
      return [];
    }

    const menus = result.extensions?.menus || [];

    // Ensure menus is an array
    if (!Array.isArray(menus)) {
      logger.warn("[getPluginMenuItems] menus is not an array:", typeof menus);
      return [];
    }

    return menus.map((menu) => ({
      key: `plugin-${menu.plugin_id}`,
      label: menu.config?.label || menu.plugin_name,
      icon: menu.config?.icon || "AppstoreOutlined",
      path: `/plugin${menu.config?.path || `/${menu.plugin_id}`}`,
      pluginId: menu.plugin_id,
      order: menu.priority || 1000,
      badge: menu.config?.badge,
      children: (Array.isArray(menu.config?.children)
        ? menu.config.children
        : []
      ).map((child, idx) => ({
        key: `plugin-${menu.plugin_id}-${child.id || idx}`,
        label: child.label,
        icon: child.icon,
        path: child.path ? `/plugin${child.path}` : undefined,
        onClick: child.onClick,
      })),
    }));
  } catch (err) {
    // 区分 IPC 未注册错误和其他错误
    if (err.message?.includes("No handler registered")) {
      // IPC 处理器未就绪，静默处理
      return [];
    }
    logger.error("[getPluginMenuItems] 失败:", err);
    return [];
  }
}

/**
 * 使用插件菜单的 Composable
 */
export function usePluginMenus() {
  const menuItems = ref([]);
  const loading = ref(true);

  async function loadMenus() {
    loading.value = true;
    try {
      menuItems.value = await getPluginMenuItems();
    } catch (err) {
      logger.error("[usePluginMenus] 加载失败:", err);
      menuItems.value = [];
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    loadMenus();

    // 监听插件变化
    if (window.electronAPI?.plugin?.on) {
      const events = [
        "plugin:installed",
        "plugin:uninstalled",
        "plugin:enabled",
        "plugin:disabled",
      ];
      for (const event of events) {
        window.electronAPI.plugin.on(event, loadMenus);
      }
    }
  });

  onUnmounted(() => {
    if (window.electronAPI?.plugin?.off) {
      const events = [
        "plugin:installed",
        "plugin:uninstalled",
        "plugin:enabled",
        "plugin:disabled",
      ];
      for (const event of events) {
        window.electronAPI.plugin.off(event, loadMenus);
      }
    }
  });

  return {
    menuItems,
    loading,
    refresh: loadMenus,
  };
}

// ============================================
// 插槽扩展的快捷方法
// ============================================

/**
 * 使用特定插槽的 Composable
 * @param {string} slotName - 插槽名称
 * @returns {Object} 插槽相关的响应式数据和方法
 */
export function usePluginSlot(slotName) {
  const extensions = ref([]);
  const loading = ref(true);
  const error = ref(null);

  async function load() {
    loading.value = true;
    error.value = null;

    // 检查 API 是否可用
    if (!window.electronAPI?.plugin?.getSlotExtensions) {
      extensions.value = [];
      loading.value = false;
      return;
    }

    try {
      const result =
        await window.electronAPI.plugin.getSlotExtensions(slotName);

      if (result?.success) {
        extensions.value = (result.extensions || [])
          .map((ext) => ({
            id: ext.id,
            pluginId: ext.plugin_id,
            pluginName: ext.plugin_name,
            config: ext.config,
            priority: ext.priority || 100,
          }))
          .sort((a, b) => a.priority - b.priority);
      } else {
        // IPC 返回失败但不是致命错误
        extensions.value = [];
        if (result?.error && !result.error.includes("No handler registered")) {
          logger.warn(
            `[usePluginSlot:${slotName}] 获取扩展失败:`,
            result.error,
          );
        }
      }
    } catch (err) {
      // 区分 IPC 未注册错误和其他错误
      if (err.message?.includes("No handler registered")) {
        extensions.value = [];
      } else {
        logger.error(`[usePluginSlot:${slotName}]`, err);
        error.value = err.message;
      }
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);

  return {
    extensions,
    loading,
    error,
    refresh: load,
    hasExtensions: computed(() => extensions.value.length > 0),
  };
}

// ============================================
// 导出
// ============================================

export default usePluginExtensions;
