/**
 * Calculator Skill Plugin
 * 示例插件：展示如何通过插件扩展技能和工具
 */

class CalculatorPlugin {
  constructor(api) {
    this.api = api;
    console.log('[CalculatorPlugin] 插件已构造');
  }

  /**
   * 插件启用时调用
   */
  onEnable() {
    console.log('[CalculatorPlugin] 插件已启用');
    console.log('[CalculatorPlugin] 可用API:', Object.keys(this.api));
  }

  /**
   * 加法工具处理函数
   * @param {Object} params - 参数对象
   * @param {number} params.a - 第一个数字
   * @param {number} params.b - 第二个数字
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async handleAdd(params, context) {
    console.log('[CalculatorPlugin] handleAdd called:', params);

    const { a, b } = params;

    // 参数验证
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('参数必须是数字');
    }

    const result = a + b;

    return {
      success: true,
      result,
      message: `${a} + ${b} = ${result}`,
      timestamp: Date.now(),
    };
  }

  /**
   * 乘法工具处理函数
   * @param {Object} params - 参数对象
   * @param {number} params.a - 第一个数字
   * @param {number} params.b - 第二个数字
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async handleMultiply(params, context) {
    console.log('[CalculatorPlugin] handleMultiply called:', params);

    const { a, b } = params;

    // 参数验证
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new Error('参数必须是数字');
    }

    const result = a * b;

    return {
      success: true,
      result,
      message: `${a} × ${b} = ${result}`,
      timestamp: Date.now(),
    };
  }

  /**
   * 插件禁用时调用
   */
  onDisable() {
    console.log('[CalculatorPlugin] 插件已禁用');
  }
}

module.exports = CalculatorPlugin;
