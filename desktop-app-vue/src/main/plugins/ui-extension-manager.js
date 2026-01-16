/**
 * UIExtensionManager - UI扩展点管理器
 *
 * 职责：
 * - 管理插件的UI扩展点（页面、菜单、组件）
 * - 维护扩展点注册表
 * - 提供扩展点查询接口
 */

const EventEmitter = require("events");
const path = require("path");

class UIExtensionManager extends EventEmitter {
  constructor() {
    super();

    // 页面扩展注册表
    this.pageExtensions = new Map(); // pluginId:pageId -> PageExtension

    // 菜单扩展注册表
    this.menuExtensions = new Map(); // pluginId:menuId -> MenuExtension

    // 组件扩展注册表 (按插槽分组)
    this.componentExtensions = new Map(); // slotName -> [ComponentExtension]

    // 插件到扩展的映射（用于卸载时清理）
    this.pluginExtensions = new Map(); // pluginId -> { pages: [], menus: [], components: [] }
  }

  /**
   * 注册页面扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} pageConfig - 页面配置
   * @returns {string} 页面扩展ID
   */
  registerPage(pluginId, pageConfig) {
    const {
      id,
      path: pagePath,
      name,
      title,
      icon,
      component,
      componentPath,
      meta = {},
      order = 100,
    } = pageConfig;

    const extensionId = `${pluginId}:${id}`;

    // 验证必需字段
    if (!id || !pagePath) {
      throw new Error("页面扩展必须提供 id 和 path");
    }

    const pageExtension = {
      id: extensionId,
      pluginId,
      pageId: id,
      path: pagePath,
      name: name || id,
      title: title || name || id,
      icon: icon || "AppstoreOutlined",
      component,
      componentPath,
      meta: {
        ...meta,
        pluginId,
        isPluginPage: true,
      },
      order,
      registeredAt: Date.now(),
    };

    this.pageExtensions.set(extensionId, pageExtension);
    this._addToPluginExtensions(pluginId, "pages", extensionId);

    this.emit("page:registered", pageExtension);
    console.log(`[UIExtensionManager] 页面扩展已注册: ${extensionId}`);

    return extensionId;
  }

  /**
   * 注册菜单扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} menuConfig - 菜单配置
   * @returns {string} 菜单扩展ID
   */
  registerMenu(pluginId, menuConfig) {
    const {
      id,
      label,
      icon,
      path: menuPath,
      parent,
      order = 100,
      badge,
      visible = true,
      children = [],
    } = menuConfig;

    const extensionId = `${pluginId}:${id}`;

    // 验证必需字段
    if (!id || !label) {
      throw new Error("菜单扩展必须提供 id 和 label");
    }

    const menuExtension = {
      id: extensionId,
      pluginId,
      menuId: id,
      label,
      icon: icon || "AppstoreOutlined",
      path: menuPath,
      parent: parent || null, // null 表示顶级菜单
      order,
      badge,
      visible,
      children: children.map((child, index) => ({
        ...child,
        id: `${extensionId}:${child.id || index}`,
        pluginId,
        order: child.order || index * 10,
      })),
      meta: {
        pluginId,
        isPluginMenu: true,
      },
      registeredAt: Date.now(),
    };

    this.menuExtensions.set(extensionId, menuExtension);
    this._addToPluginExtensions(pluginId, "menus", extensionId);

    this.emit("menu:registered", menuExtension);
    console.log(`[UIExtensionManager] 菜单扩展已注册: ${extensionId}`);

    return extensionId;
  }

  /**
   * 注册组件扩展
   * @param {string} pluginId - 插件ID
   * @param {Object} componentConfig - 组件配置
   * @returns {string} 组件扩展ID
   */
  registerComponent(pluginId, componentConfig) {
    const {
      id,
      slot,
      component,
      componentPath,
      props = {},
      order = 100,
      visible = true,
      conditions = [],
    } = componentConfig;

    const extensionId = `${pluginId}:${id}`;

    // 验证必需字段
    if (!id || !slot) {
      throw new Error("组件扩展必须提供 id 和 slot");
    }

    const componentExtension = {
      id: extensionId,
      pluginId,
      componentId: id,
      slot,
      component,
      componentPath,
      props,
      order,
      visible,
      conditions,
      meta: {
        pluginId,
        isPluginComponent: true,
      },
      registeredAt: Date.now(),
    };

    // 按插槽分组存储
    if (!this.componentExtensions.has(slot)) {
      this.componentExtensions.set(slot, []);
    }
    this.componentExtensions.get(slot).push(componentExtension);

    // 按优先级排序
    this.componentExtensions.get(slot).sort((a, b) => a.order - b.order);

    this._addToPluginExtensions(pluginId, "components", extensionId);

    this.emit("component:registered", componentExtension);
    console.log(
      `[UIExtensionManager] 组件扩展已注册: ${extensionId} -> ${slot}`,
    );

    return extensionId;
  }

  /**
   * 获取所有页面扩展
   * @returns {Array} 页面扩展列表
   */
  getPageExtensions() {
    return Array.from(this.pageExtensions.values()).sort(
      (a, b) => a.order - b.order,
    );
  }

  /**
   * 获取所有菜单扩展
   * @param {string} parent - 父菜单ID（可选，用于获取子菜单）
   * @returns {Array} 菜单扩展列表
   */
  getMenuExtensions(parent = null) {
    const menus = Array.from(this.menuExtensions.values())
      .filter((m) => m.parent === parent && m.visible)
      .sort((a, b) => a.order - b.order);

    return menus;
  }

  /**
   * 获取指定插槽的组件扩展
   * @param {string} slotName - 插槽名称
   * @returns {Array} 组件扩展列表
   */
  getComponentExtensions(slotName) {
    const extensions = this.componentExtensions.get(slotName) || [];
    return extensions.filter((ext) => ext.visible);
  }

  /**
   * 获取所有可用的插槽
   * @returns {Array} 插槽名称列表
   */
  getAvailableSlots() {
    return Array.from(this.componentExtensions.keys());
  }

  /**
   * 注销插件的所有扩展
   * @param {string} pluginId - 插件ID
   */
  unregisterPlugin(pluginId) {
    const extensions = this.pluginExtensions.get(pluginId);
    if (!extensions) {
      return;
    }

    // 注销页面扩展
    for (const pageId of extensions.pages || []) {
      this.pageExtensions.delete(pageId);
      this.emit("page:unregistered", { id: pageId, pluginId });
    }

    // 注销菜单扩展
    for (const menuId of extensions.menus || []) {
      this.menuExtensions.delete(menuId);
      this.emit("menu:unregistered", { id: menuId, pluginId });
    }

    // 注销组件扩展
    for (const componentId of extensions.components || []) {
      for (const [slot, components] of this.componentExtensions) {
        const index = components.findIndex((c) => c.id === componentId);
        if (index !== -1) {
          components.splice(index, 1);
          this.emit("component:unregistered", {
            id: componentId,
            slot,
            pluginId,
          });
        }
      }
    }

    // 清理映射
    this.pluginExtensions.delete(pluginId);

    console.log(`[UIExtensionManager] 插件 ${pluginId} 的所有UI扩展已注销`);
    this.emit("plugin:unregistered", { pluginId });
  }

  /**
   * 获取插件的所有扩展
   * @param {string} pluginId - 插件ID
   * @returns {Object} 扩展列表 { pages, menus, components }
   */
  getPluginExtensions(pluginId) {
    const extensionIds = this.pluginExtensions.get(pluginId) || {
      pages: [],
      menus: [],
      components: [],
    };

    return {
      pages: extensionIds.pages
        .map((id) => this.pageExtensions.get(id))
        .filter(Boolean),
      menus: extensionIds.menus
        .map((id) => this.menuExtensions.get(id))
        .filter(Boolean),
      components: extensionIds.components
        .map((id) => {
          for (const components of this.componentExtensions.values()) {
            const found = components.find((c) => c.id === id);
            if (found) return found;
          }
          return null;
        })
        .filter(Boolean),
    };
  }

  /**
   * 检查页面路径是否已被占用
   * @param {string} pagePath - 页面路径
   * @returns {boolean}
   */
  isPagePathOccupied(pagePath) {
    for (const page of this.pageExtensions.values()) {
      if (page.path === pagePath) {
        return true;
      }
    }
    return false;
  }

  /**
   * 生成Vue Router路由配置
   * @returns {Array} 路由配置数组
   */
  generateRoutes() {
    const routes = [];

    for (const page of this.pageExtensions.values()) {
      const route = {
        path: page.path,
        name: page.name,
        meta: {
          title: page.title,
          icon: page.icon,
          ...page.meta,
        },
      };

      // 如果提供了组件路径，使用动态导入
      if (page.componentPath) {
        route.componentPath = page.componentPath;
      } else if (page.component) {
        route.component = page.component;
      }

      routes.push(route);
    }

    return routes.sort((a, b) => {
      const orderA = a.meta?.order || 100;
      const orderB = b.meta?.order || 100;
      return orderA - orderB;
    });
  }

  /**
   * 生成侧边栏菜单配置
   * @returns {Array} 菜单配置数组
   */
  generateMenuConfig() {
    const buildMenuTree = (parent = null) => {
      const menus = this.getMenuExtensions(parent);
      return menus.map((menu) => ({
        key: menu.path || menu.menuId,
        label: menu.label,
        icon: menu.icon,
        path: menu.path,
        badge: menu.badge,
        pluginId: menu.pluginId,
        children:
          menu.children.length > 0 ? menu.children : buildMenuTree(menu.menuId),
      }));
    };

    return buildMenuTree(null);
  }

  /**
   * 清空所有扩展
   */
  clear() {
    this.pageExtensions.clear();
    this.menuExtensions.clear();
    this.componentExtensions.clear();
    this.pluginExtensions.clear();

    this.emit("cleared");
    console.log("[UIExtensionManager] 所有UI扩展已清空");
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    let componentCount = 0;
    for (const components of this.componentExtensions.values()) {
      componentCount += components.length;
    }

    return {
      pages: this.pageExtensions.size,
      menus: this.menuExtensions.size,
      components: componentCount,
      slots: this.componentExtensions.size,
      plugins: this.pluginExtensions.size,
    };
  }

  /**
   * 添加扩展到插件映射
   * @private
   */
  _addToPluginExtensions(pluginId, type, extensionId) {
    if (!this.pluginExtensions.has(pluginId)) {
      this.pluginExtensions.set(pluginId, {
        pages: [],
        menus: [],
        components: [],
      });
    }

    this.pluginExtensions.get(pluginId)[type].push(extensionId);
  }
}

// 单例实例
let instance = null;

/**
 * 获取UIExtensionManager单例
 * @returns {UIExtensionManager}
 */
function getUIExtensionManager() {
  if (!instance) {
    instance = new UIExtensionManager();
  }
  return instance;
}

module.exports = {
  UIExtensionManager,
  getUIExtensionManager,
};
