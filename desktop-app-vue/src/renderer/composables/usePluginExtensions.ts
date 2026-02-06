/**
 * usePluginExtensions - 插件扩展点 Composable
 *
 * 提供获取和使用插件UI扩展的Vue Composition API
 */

import { logger } from "@/utils/logger";
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  reactive,
} from "vue";
import type { Ref, ComputedRef } from "vue";
import type { Router, RouteRecordRaw } from "vue-router";

// ==================== 类型定义 ====================

/**
 * 插件插槽名称
 */
export type PluginSlotName = keyof typeof PLUGIN_SLOTS;

/**
 * 插件页面配置
 */
export interface PluginPageConfig {
  id?: string;
  path?: string;
  title?: string;
  icon?: string;
  meta?: Record<string, any>;
}

/**
 * 插件菜单配置
 */
export interface PluginMenuConfig {
  label?: string;
  icon?: string;
  path?: string;
  badge?: string | number;
  children?: PluginMenuChild[];
}

/**
 * 插件菜单子项
 */
export interface PluginMenuChild {
  id?: string;
  label: string;
  icon?: string;
  path?: string;
  onClick?: () => void;
}

/**
 * 插件组件配置
 */
export interface PluginComponentConfig {
  slot?: string;
  [key: string]: any;
}

/**
 * 插件页面扩展
 */
export interface PluginPageExtension {
  id: string;
  plugin_id: string;
  plugin_name: string;
  type: string;
  config?: PluginPageConfig;
  priority?: number;
}

/**
 * 插件菜单扩展
 */
export interface PluginMenuExtension {
  id: string;
  plugin_id: string;
  plugin_name: string;
  type: string;
  config?: PluginMenuConfig;
  priority?: number;
}

/**
 * 插件组件扩展
 */
export interface PluginComponentExtension {
  id: string;
  plugin_id: string;
  plugin_name: string;
  type: string;
  config?: PluginComponentConfig;
  priority?: number;
}

/**
 * UI 扩展集合
 */
export interface UIExtensions {
  pages: PluginPageExtension[];
  menus: PluginMenuExtension[];
  components: PluginComponentExtension[];
}

/**
 * 缓存的扩展数据
 */
export interface CachedExtensions extends UIExtensions {
  lastUpdated: number | null;
}

/**
 * 路由配置
 */
export interface PluginRouteConfig {
  path: string;
  name: string;
  meta: {
    title: string;
    icon: string;
    pluginId: string;
    isPluginPage: boolean;
    [key: string]: any;
  };
  componentConfig?: PluginPageConfig;
}

/**
 * 菜单项
 */
export interface PluginMenuItem {
  key: string;
  label: string;
  icon: string;
  path: string;
  pluginId: string;
  order: number;
  badge?: string | number;
  children: PluginMenuChild[];
}

/**
 * 插槽组件
 */
export interface SlotComponent {
  id: string;
  pluginId: string;
  pluginName: string;
  slot: string;
  componentConfig?: PluginComponentConfig;
  priority: number;
}

/**
 * 事件处理器
 */
interface EventHandler {
  event: string;
  handler: () => void;
}

// ==================== 常量 ====================

/**
 * 预定义的UI插槽位置
 * 插件可以在这些位置注册组件
 */
export const PLUGIN_SLOTS = {
  // 编辑器相关
  EDITOR_TOOLBAR: "editor-toolbar",
  EDITOR_SIDEBAR: "editor-sidebar",
  EDITOR_FOOTER: "editor-footer",
  EDITOR_CONTEXT_MENU: "editor-context-menu",

  // 笔记列表相关
  NOTE_LIST_HEADER: "note-list-header",
  NOTE_LIST_FOOTER: "note-list-footer",
  NOTE_LIST_ITEM_ACTIONS: "note-list-item-actions",

  // 项目相关
  PROJECT_HEADER: "project-header",
  PROJECT_SIDEBAR: "project-sidebar",
  PROJECT_ACTIONS: "project-actions",

  // AI 对话相关
  CHAT_INPUT_ACTIONS: "chat-input-actions",
  CHAT_MESSAGE_ACTIONS: "chat-message-actions",
  CHAT_SIDEBAR: "chat-sidebar",

  // 设置相关
  SETTINGS_SECTION: "settings-section",
  SETTINGS_GENERAL: "settings-general",

  // 全局
  GLOBAL_HEADER: "global-header",
  GLOBAL_FOOTER: "global-footer",
  SIDEBAR_BOTTOM: "sidebar-bottom",
  STATUS_BAR: "status-bar",
} as const;

/**
 * 插槽描述（用于文档和调试）
 */
export const SLOT_DESCRIPTIONS: Record<string, string> = {
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

// ==================== 状态 ====================

// 缓存的扩展数据
const cachedExtensions = ref<CachedExtensions>({
  pages: [],
  menus: [],
  components: [],
  lastUpdated: null,
});

// 是否正在加载
const isLoading = ref(false);

// 错误状态
const error = ref<string | null>(null);

// 已注册的插件路由
const registeredRoutes = reactive(new Set<string>());

// ==================== Composables ====================

/**
 * 获取插件UI扩展
 */
export function usePluginExtensions() {
  // 事件处理器
  let eventHandlers: EventHandler[] = [];

  /**
   * 加载所有UI扩展
   */
  async function loadExtensions(): Promise<void> {
    if (!(window as any).electronAPI?.plugin?.getUIExtensions) {
      logger.warn("[usePluginExtensions] Plugin API not available");
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const result = await (window as any).electronAPI.plugin.getUIExtensions();

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
      logger.error("[usePluginExtensions] Failed to load extensions:", err as any);
      error.value = (err as Error).message;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 获取页面扩展路由配置
   */
  const pageRoutes: ComputedRef<PluginRouteConfig[]> = computed(() => {
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
      componentConfig: page.config,
    }));
  });

  /**
   * 获取菜单扩展配置
   */
  const menuItems: ComputedRef<PluginMenuItem[]> = computed(() => {
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
  const componentsBySlot: ComputedRef<Record<string, SlotComponent[]>> = computed(() => {
    const grouped: Record<string, SlotComponent[]> = {};

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
   */
  function getSlotComponents(slotName: string): SlotComponent[] {
    return componentsBySlot.value[slotName] || [];
  }

  /**
   * 设置事件监听
   */
  function setupEventListeners(): void {
    if (!(window as any).electronAPI?.plugin) {
      return;
    }

    const handlePluginInstalled = () => loadExtensions();
    const handlePluginUninstalled = () => loadExtensions();
    const handlePluginEnabled = () => loadExtensions();
    const handlePluginDisabled = () => loadExtensions();

    (window as any).electronAPI.plugin.on("plugin:installed", handlePluginInstalled);
    (window as any).electronAPI.plugin.on("plugin:uninstalled", handlePluginUninstalled);
    (window as any).electronAPI.plugin.on("plugin:enabled", handlePluginEnabled);
    (window as any).electronAPI.plugin.on("plugin:disabled", handlePluginDisabled);

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
  function cleanupEventListeners(): void {
    if (!(window as any).electronAPI?.plugin) {
      return;
    }

    for (const { event, handler } of eventHandlers) {
      (window as any).electronAPI.plugin.off(event, handler);
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
 */
export async function getSlotExtensions(slotName: string): Promise<PluginComponentExtension[]> {
  if (!(window as any).electronAPI?.plugin?.getSlotExtensions) {
    logger.warn("[getSlotExtensions] Plugin API not available");
    return [];
  }

  try {
    const result = await (window as any).electronAPI.plugin.getSlotExtensions(slotName);

    if (result.success) {
      return result.extensions || [];
    } else {
      throw new Error(result.error || "获取插槽扩展失败");
    }
  } catch (err) {
    logger.error(`[getSlotExtensions] Failed to get slot ${slotName}:`, err as any);
    return [];
  }
}

/**
 * 生成插件页面的动态路由
 */
export async function registerPluginRoutes(router: Router): Promise<void> {
  if (!(window as any).electronAPI?.plugin?.getUIExtensions) {
    logger.warn("[registerPluginRoutes] Plugin API not available");
    return;
  }

  try {
    const result = await (window as any).electronAPI.plugin.getUIExtensions();

    if (!result.success) {
      throw new Error(result.error || "获取UI扩展失败");
    }

    const pages: PluginPageExtension[] = result.extensions?.pages || [];

    for (const page of pages) {
      const config = page.config || {};
      const routePath = `/plugin${config.path || `/${page.plugin_id}`}`;
      const routeName = `plugin-${page.plugin_id}-${config.id || "main"}`;

      // 检查路由是否已存在
      if (router.hasRoute(routeName)) {
        continue;
      }

      const route: RouteRecordRaw = {
        path: routePath,
        name: routeName,
        meta: {
          title: config.title || page.plugin_name,
          icon: config.icon || "AppstoreOutlined",
          pluginId: page.plugin_id,
          isPluginPage: true,
          ...config.meta,
        },
        component: () =>
          import("../components/plugins/PluginPageWrapper.vue").then(
            (module) => {
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
    logger.error("[registerPluginRoutes] Failed to register routes:", err as any);
  }
}

/**
 * 调用插件方法
 */
export async function callPluginMethod<T = any>(
  pluginId: string,
  methodName: string,
  ...args: any[]
): Promise<T | null> {
  if (!(window as any).electronAPI?.plugin?.callPluginMethod) {
    logger.warn("[callPluginMethod] Plugin API not available");
    return null;
  }

  try {
    const result = await (window as any).electronAPI.plugin.callPluginMethod(
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
    logger.error(`[callPluginMethod] ${pluginId}.${methodName} 失败:`, err as any);
    throw err;
  }
}

/**
 * 获取插件提供的页面内容
 */
export async function getPluginPageContent(
  pluginId: string,
  pageId: string = "main"
): Promise<{ success: boolean; error?: string; content?: any }> {
  if (!(window as any).electronAPI?.plugin?.getPluginPageContent) {
    return { success: false, error: "API not available" };
  }

  try {
    return await (window as any).electronAPI.plugin.getPluginPageContent(
      pluginId,
      pageId,
    );
  } catch (err) {
    logger.error(`[getPluginPageContent] ${pluginId}/${pageId} 失败:`, err as any);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * 获取插件菜单项（用于侧边栏集成）
 */
export async function getPluginMenuItems(): Promise<PluginMenuItem[]> {
  if (!(window as any).electronAPI?.plugin?.getUIExtensions) {
    return [];
  }

  try {
    const result = await (window as any).electronAPI.plugin.getUIExtensions();
    if (!result.success) {
      return [];
    }

    const menus = result.extensions?.menus || [];

    if (!Array.isArray(menus)) {
      logger.warn("[getPluginMenuItems] menus is not an array:", typeof menus);
      return [];
    }

    return menus.map((menu: PluginMenuExtension) => ({
      key: `plugin-${menu.plugin_id}`,
      label: menu.config?.label || menu.plugin_name,
      icon: menu.config?.icon || "AppstoreOutlined",
      path: `/plugin${menu.config?.path || `/${menu.plugin_id}`}`,
      pluginId: menu.plugin_id,
      order: menu.priority || 1000,
      badge: menu.config?.badge,
      children: (Array.isArray(menu.config?.children)
        ? menu.config!.children
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
    if ((err as Error).message?.includes("No handler registered")) {
      return [];
    }
    logger.error("[getPluginMenuItems] 失败:", err as any);
    return [];
  }
}

/**
 * 使用插件菜单的 Composable
 */
export function usePluginMenus() {
  const menuItems = ref<PluginMenuItem[]>([]);
  const loading = ref(true);

  async function loadMenus(): Promise<void> {
    loading.value = true;
    try {
      menuItems.value = await getPluginMenuItems();
    } catch (err) {
      logger.error("[usePluginMenus] 加载失败:", err as any);
      menuItems.value = [];
    } finally {
      loading.value = false;
    }
  }

  onMounted(() => {
    loadMenus();

    if ((window as any).electronAPI?.plugin?.on) {
      const events = [
        "plugin:installed",
        "plugin:uninstalled",
        "plugin:enabled",
        "plugin:disabled",
      ];
      for (const event of events) {
        (window as any).electronAPI.plugin.on(event, loadMenus);
      }
    }
  });

  onUnmounted(() => {
    if ((window as any).electronAPI?.plugin?.off) {
      const events = [
        "plugin:installed",
        "plugin:uninstalled",
        "plugin:enabled",
        "plugin:disabled",
      ];
      for (const event of events) {
        (window as any).electronAPI.plugin.off(event, loadMenus);
      }
    }
  });

  return {
    menuItems,
    loading,
    refresh: loadMenus,
  };
}

/**
 * 使用特定插槽的 Composable
 */
export function usePluginSlot(slotName: string) {
  const extensions = ref<SlotComponent[]>([]);
  const loading = ref(true);
  const slotError = ref<string | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    slotError.value = null;

    if (!(window as any).electronAPI?.plugin?.getSlotExtensions) {
      extensions.value = [];
      loading.value = false;
      return;
    }

    try {
      const result = await (window as any).electronAPI.plugin.getSlotExtensions(slotName);

      if (result?.success) {
        extensions.value = (result.extensions || [])
          .map((ext: PluginComponentExtension) => ({
            id: ext.id,
            pluginId: ext.plugin_id,
            pluginName: ext.plugin_name,
            slot: ext.config?.slot || slotName,
            componentConfig: ext.config,
            priority: ext.priority || 100,
          }))
          .sort((a: SlotComponent, b: SlotComponent) => a.priority - b.priority);
      } else {
        extensions.value = [];
        if (result?.error && !result.error.includes("No handler registered")) {
          logger.warn(`[usePluginSlot:${slotName}] 获取扩展失败:`, result.error);
        }
      }
    } catch (err) {
      if ((err as Error).message?.includes("No handler registered")) {
        extensions.value = [];
      } else {
        logger.error(`[usePluginSlot:${slotName}]`, err as any);
        slotError.value = (err as Error).message;
      }
    } finally {
      loading.value = false;
    }
  }

  onMounted(load);

  return {
    extensions,
    loading,
    error: slotError,
    refresh: load,
    hasExtensions: computed(() => extensions.value.length > 0),
  };
}

export default usePluginExtensions;
