/**
 * Hello World Plugin
 * 一个简单的测试插件
 */

class HelloWorldPlugin {
  constructor() {
    this.name = 'Hello World Plugin';
  }

  /**
   * 插件激活时调用
   */
  onEnable() {
    console.log('[HelloWorldPlugin] 插件已启用');
  }

  /**
   * 插件禁用时调用
   */
  onDisable() {
    console.log('[HelloWorldPlugin] 插件已禁用');
  }

  /**
   * 插件卸载时调用
   */
  onUninstall() {
    console.log('[HelloWorldPlugin] 插件已卸载');
  }

  /**
   * 菜单点击处理
   */
  handleMenuClick() {
    console.log('[HelloWorldPlugin] 菜单被点击');
    return {
      success: true,
      message: 'Hello from plugin!',
    };
  }
}

module.exports = HelloWorldPlugin;
