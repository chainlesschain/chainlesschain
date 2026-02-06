/**
 * ElementLocator - 元素定位器
 * 实现多层降级策略，通过引用定位页面元素
 *
 * @module browser/element-locator
 * @author ChainlessChain Team
 * @since v0.27.0 Phase 2
 */

/**
 * 元素定位器类
 * 实现 OpenClaw 风格的智能元素定位
 */
class ElementLocator {
  /**
   * 通过引用定位元素（多层降级策略）
   * @param {Page} page - Playwright Page 对象
   * @param {Object} element - 元素对象（来自快照）
   * @param {Object} options - 定位选项
   * @returns {Promise<Locator>} Playwright Locator 对象
   */
  static async locate(page, element, options = {}) {
    const { timeout = 5000 } = options;

    try {
      // 策略 1: 使用 getByRole (最稳定)
      if (element.role && element.label) {
        try {
          const locator = page.getByRole(element.role, {
            name: element.label,
            exact: false
          });

          // 验证元素存在
          await locator.first().waitFor({ timeout: 1000 });
          return locator.first();
        } catch (e) {
          console.log(`[ElementLocator] getByRole failed for ${element.ref}, trying next strategy...`);
        }
      }

      // 策略 2: 使用 ARIA 属性
      if (element.label) {
        try {
          const locator = page.locator(`[aria-label="${element.label}"]`);
          await locator.first().waitFor({ timeout: 1000 });
          return locator.first();
        } catch (e) {
          console.log(`[ElementLocator] ARIA label failed for ${element.ref}, trying next strategy...`);
        }
      }

      // 策略 3: 使用 ID
      if (element.attributes.id) {
        try {
          const locator = page.locator(`#${element.attributes.id}`);
          await locator.waitFor({ timeout: 1000 });
          return locator;
        } catch (e) {
          console.log(`[ElementLocator] ID failed for ${element.ref}, trying next strategy...`);
        }
      }

      // 策略 4: 使用文本内容
      if (element.label && element.tag === 'a') {
        try {
          const locator = page.getByRole('link', { name: element.label });
          await locator.first().waitFor({ timeout: 1000 });
          return locator.first();
        } catch (e) {
          console.log(`[ElementLocator] Text link failed for ${element.ref}, trying next strategy...`);
        }
      }

      // 策略 5: 使用 CSS 选择器（最后手段）
      if (element.selector) {
        try {
          const locator = page.locator(element.selector);
          await locator.first().waitFor({ timeout: 1000 });
          return locator.first();
        } catch (e) {
          console.log(`[ElementLocator] CSS selector failed for ${element.ref}`);
        }
      }

      // 策略 6: 使用智能 XPath（终极降级）
      const xpath = this.generateSmartXPath(element);
      if (xpath) {
        try {
          const locator = page.locator(`xpath=${xpath}`);
          await locator.first().waitFor({ timeout: 1000 });
          return locator.first();
        } catch (e) {
          console.log(`[ElementLocator] XPath failed for ${element.ref}`);
        }
      }

      throw new Error(`Unable to locate element ${element.ref} after all strategies`);
    } catch (error) {
      throw new Error(`Failed to locate element ${element.ref}: ${error.message}`);
    }
  }

  /**
   * 生成智能 XPath
   * @param {Object} element - 元素对象
   * @returns {string} XPath 表达式
   */
  static generateSmartXPath(element) {
    const parts = [];

    // 基础标签
    parts.push(`//${element.tag}`);

    // 添加属性过滤
    const filters = [];

    if (element.attributes.id) {
      filters.push(`@id="${element.attributes.id}"`);
    }

    if (element.attributes.class) {
      const classes = element.attributes.class.split(' ').filter(c => c.trim());
      if (classes.length > 0) {
        filters.push(`contains(@class, "${classes[0]}")`);
      }
    }

    if (element.attributes.type) {
      filters.push(`@type="${element.attributes.type}"`);
    }

    if (element.attributes.name) {
      filters.push(`@name="${element.attributes.name}"`);
    }

    // 文本内容过滤
    if (element.label && element.label.length < 50) {
      filters.push(`contains(text(), "${element.label.slice(0, 30)}")`);
    }

    if (filters.length > 0) {
      parts.push(`[${filters.join(' and ')}]`);
    }

    return parts.join('');
  }

  /**
   * 验证元素是否仍然存在
   * @param {Page} page - Playwright Page 对象
   * @param {Object} element - 元素对象
   * @returns {Promise<boolean>}
   */
  static async exists(page, element) {
    try {
      const locator = await this.locate(page, element, { timeout: 2000 });
      const count = await locator.count();
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取元素的当前位置
   * @param {Page} page - Playwright Page 对象
   * @param {Object} element - 元素对象
   * @returns {Promise<Object>} 位置对象 { x, y, width, height }
   */
  static async getPosition(page, element) {
    const locator = await this.locate(page, element);
    const box = await locator.boundingBox();

    if (!box) {
      throw new Error(`Element ${element.ref} has no bounding box`);
    }

    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height
    };
  }

  /**
   * 检查元素是否可见
   * @param {Page} page - Playwright Page 对象
   * @param {Object} element - 元素对象
   * @returns {Promise<boolean>}
   */
  static async isVisible(page, element) {
    try {
      const locator = await this.locate(page, element, { timeout: 2000 });
      return await locator.isVisible();
    } catch (error) {
      return false;
    }
  }

  /**
   * 等待元素出现
   * @param {Page} page - Playwright Page 对象
   * @param {Object} element - 元素对象
   * @param {Object} options - 等待选项
   * @returns {Promise<Locator>}
   */
  static async waitFor(page, element, options = {}) {
    const { timeout = 10000, state = 'visible' } = options;

    const locator = await this.locate(page, element, { timeout: 1000 });
    await locator.waitFor({ state, timeout });

    return locator;
  }
}

module.exports = { ElementLocator };
