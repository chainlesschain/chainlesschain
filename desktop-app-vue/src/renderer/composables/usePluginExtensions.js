/**
 * usePluginExtensions - 插件扩展点 Composable
 *
 * 提供获取和使用插件UI扩展的Vue Composition API
 */

import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  shallowRef,
  markRaw,
} from "vue";

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
      console.warn("[usePluginExtensions] Plugin API not available");
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
      console.error("[usePluginExtensions] Failed to load extensions:", err);
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
    console.warn("[getSlotExtensions] Plugin API not available");
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
    console.error(`[getSlotExtensions] Failed to get slot ${slotName}:`, err);
    return [];
  }
}

/**
 * 生成插件页面的动态路由
 * @param {Object} router - Vue Router 实例
 */
export async function registerPluginRoutes(router) {
  if (!window.electronAPI?.plugin?.getUIExtensions) {
    console.warn("[registerPluginRoutes] Plugin API not available");
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
      console.log(`[registerPluginRoutes] Route registered: ${routePath}`);
    }
  } catch (err) {
    console.error("[registerPluginRoutes] Failed to register routes:", err);
  }
}

export default usePluginExtensions;
