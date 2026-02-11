/**
 * CoordinateAction - 坐标级鼠标操作（类似 Claude Computer Use）
 *
 * 支持像素级精确控制，包括：
 * - 任意坐标点击
 * - 鼠标移动轨迹
 * - 拖拽操作
 * - 手势操作
 *
 * @module browser/actions/coordinate-action
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require('events');

/**
 * 鼠标按钮类型
 */
const MouseButton = {
  LEFT: 'left',
  RIGHT: 'right',
  MIDDLE: 'middle'
};

/**
 * 手势类型
 */
const GestureType = {
  SWIPE_UP: 'swipe_up',
  SWIPE_DOWN: 'swipe_down',
  SWIPE_LEFT: 'swipe_left',
  SWIPE_RIGHT: 'swipe_right',
  PINCH_IN: 'pinch_in',
  PINCH_OUT: 'pinch_out',
  ROTATE_CW: 'rotate_cw',
  ROTATE_CCW: 'rotate_ccw'
};

class CoordinateAction extends EventEmitter {
  constructor(browserEngine) {
    super();
    this.engine = browserEngine;
    this.mousePosition = { x: 0, y: 0 };
  }

  /**
   * 获取页面对象
   * @private
   */
  _getPage(targetId) {
    return this.engine.getPage(targetId);
  }

  /**
   * 在指定坐标点击
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 点击选项
   * @returns {Promise<Object>}
   */
  async clickAt(targetId, x, y, options = {}) {
    const page = this._getPage(targetId);

    const clickOptions = {
      button: options.button || MouseButton.LEFT,
      clickCount: options.clickCount || 1,
      delay: options.delay || 0
    };

    try {
      await page.mouse.click(x, y, clickOptions);

      this.mousePosition = { x, y };
      this.emit('click', { targetId, x, y, options: clickOptions });

      return {
        success: true,
        action: 'click',
        x,
        y,
        button: clickOptions.button,
        clickCount: clickOptions.clickCount
      };
    } catch (error) {
      throw new Error(`Click at (${x}, ${y}) failed: ${error.message}`);
    }
  }

  /**
   * 双击指定坐标
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 点击选项
   * @returns {Promise<Object>}
   */
  async doubleClickAt(targetId, x, y, options = {}) {
    return this.clickAt(targetId, x, y, { ...options, clickCount: 2 });
  }

  /**
   * 右键点击指定坐标
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 点击选项
   * @returns {Promise<Object>}
   */
  async rightClickAt(targetId, x, y, options = {}) {
    return this.clickAt(targetId, x, y, { ...options, button: MouseButton.RIGHT });
  }

  /**
   * 移动鼠标到指定坐标
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {Object} options - 移动选项
   * @returns {Promise<Object>}
   */
  async moveTo(targetId, x, y, options = {}) {
    const page = this._getPage(targetId);

    try {
      // 平滑移动
      if (options.smooth) {
        await this._smoothMove(page, x, y, options.steps || 10);
      } else {
        await page.mouse.move(x, y);
      }

      this.mousePosition = { x, y };
      this.emit('move', { targetId, x, y });

      return {
        success: true,
        action: 'move',
        x,
        y
      };
    } catch (error) {
      throw new Error(`Move to (${x}, ${y}) failed: ${error.message}`);
    }
  }

  /**
   * 平滑移动鼠标（模拟人类行为）
   * @private
   */
  async _smoothMove(page, targetX, targetY, steps = 10) {
    const startX = this.mousePosition.x;
    const startY = this.mousePosition.y;

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // 使用 easeInOutQuad 缓动函数
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const currentX = startX + (targetX - startX) * eased;
      const currentY = startY + (targetY - startY) * eased;

      await page.mouse.move(currentX, currentY);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * 从一个坐标拖拽到另一个坐标
   * @param {string} targetId - 标签页 ID
   * @param {number} fromX - 起始 X 坐标
   * @param {number} fromY - 起始 Y 坐标
   * @param {number} toX - 目标 X 坐标
   * @param {number} toY - 目标 Y 坐标
   * @param {Object} options - 拖拽选项
   * @returns {Promise<Object>}
   */
  async dragFromTo(targetId, fromX, fromY, toX, toY, options = {}) {
    const page = this._getPage(targetId);

    try {
      // 移动到起始位置
      await page.mouse.move(fromX, fromY);

      // 按下鼠标
      await page.mouse.down({
        button: options.button || MouseButton.LEFT
      });

      // 平滑拖动到目标位置
      if (options.smooth !== false) {
        const steps = options.steps || 20;
        for (let i = 1; i <= steps; i++) {
          const progress = i / steps;
          const currentX = fromX + (toX - fromX) * progress;
          const currentY = fromY + (toY - fromY) * progress;
          await page.mouse.move(currentX, currentY);
          await new Promise(resolve => setTimeout(resolve, options.stepDelay || 10));
        }
      } else {
        await page.mouse.move(toX, toY);
      }

      // 释放鼠标
      await page.mouse.up({
        button: options.button || MouseButton.LEFT
      });

      this.mousePosition = { x: toX, y: toY };
      this.emit('drag', { targetId, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } });

      return {
        success: true,
        action: 'drag',
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY }
      };
    } catch (error) {
      throw new Error(`Drag from (${fromX}, ${fromY}) to (${toX}, ${toY}) failed: ${error.message}`);
    }
  }

  /**
   * 执行手势操作
   * @param {string} targetId - 标签页 ID
   * @param {string} gesture - 手势类型
   * @param {Object} options - 手势选项
   * @returns {Promise<Object>}
   */
  async gesture(targetId, gesture, options = {}) {
    const page = this._getPage(targetId);
    const viewport = page.viewportSize() || { width: 1280, height: 720 };

    // 默认从视口中心开始
    const centerX = options.startX || viewport.width / 2;
    const centerY = options.startY || viewport.height / 2;
    const distance = options.distance || 200;

    let fromX, fromY, toX, toY;

    switch (gesture) {
      case GestureType.SWIPE_UP:
        fromX = centerX;
        fromY = centerY + distance / 2;
        toX = centerX;
        toY = centerY - distance / 2;
        break;

      case GestureType.SWIPE_DOWN:
        fromX = centerX;
        fromY = centerY - distance / 2;
        toX = centerX;
        toY = centerY + distance / 2;
        break;

      case GestureType.SWIPE_LEFT:
        fromX = centerX + distance / 2;
        fromY = centerY;
        toX = centerX - distance / 2;
        toY = centerY;
        break;

      case GestureType.SWIPE_RIGHT:
        fromX = centerX - distance / 2;
        fromY = centerY;
        toX = centerX + distance / 2;
        toY = centerY;
        break;

      default:
        throw new Error(`Unknown gesture: ${gesture}`);
    }

    return this.dragFromTo(targetId, fromX, fromY, toX, toY, {
      smooth: true,
      steps: options.steps || 15,
      stepDelay: options.stepDelay || 20
    });
  }

  /**
   * 在指定坐标处滚动
   * @param {string} targetId - 标签页 ID
   * @param {number} x - X 坐标
   * @param {number} y - Y 坐标
   * @param {number} deltaX - 水平滚动距离
   * @param {number} deltaY - 垂直滚动距离
   * @param {Object} options - 滚动选项
   * @returns {Promise<Object>}
   */
  async scrollAt(targetId, x, y, deltaX, deltaY, options = {}) {
    const page = this._getPage(targetId);

    try {
      // 先移动鼠标到指定位置
      await page.mouse.move(x, y);

      // 执行滚动
      await page.mouse.wheel(deltaX, deltaY);

      this.emit('scroll', { targetId, x, y, deltaX, deltaY });

      return {
        success: true,
        action: 'scroll',
        x,
        y,
        deltaX,
        deltaY
      };
    } catch (error) {
      throw new Error(`Scroll at (${x}, ${y}) failed: ${error.message}`);
    }
  }

  /**
   * 绘制路径（Canvas 操作）
   * @param {string} targetId - 标签页 ID
   * @param {Array<{x: number, y: number}>} points - 路径点
   * @param {Object} options - 绘制选项
   * @returns {Promise<Object>}
   */
  async drawPath(targetId, points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('At least 2 points required for drawing path');
    }

    const page = this._getPage(targetId);

    try {
      // 移动到起点
      await page.mouse.move(points[0].x, points[0].y);

      // 按下鼠标
      await page.mouse.down({
        button: options.button || MouseButton.LEFT
      });

      // 沿路径移动
      for (let i = 1; i < points.length; i++) {
        await page.mouse.move(points[i].x, points[i].y);
        if (options.stepDelay) {
          await new Promise(resolve => setTimeout(resolve, options.stepDelay));
        }
      }

      // 释放鼠标
      await page.mouse.up({
        button: options.button || MouseButton.LEFT
      });

      const lastPoint = points[points.length - 1];
      this.mousePosition = { x: lastPoint.x, y: lastPoint.y };

      this.emit('draw', { targetId, pointsCount: points.length });

      return {
        success: true,
        action: 'draw',
        pointsCount: points.length,
        startPoint: points[0],
        endPoint: lastPoint
      };
    } catch (error) {
      throw new Error(`Draw path failed: ${error.message}`);
    }
  }

  /**
   * 获取当前鼠标位置
   * @returns {{x: number, y: number}}
   */
  getMousePosition() {
    return { ...this.mousePosition };
  }

  /**
   * 获取元素中心坐标
   * @param {string} targetId - 标签页 ID
   * @param {string} selector - CSS 选择器
   * @returns {Promise<{x: number, y: number}>}
   */
  async getElementCenter(targetId, selector) {
    const page = this._getPage(targetId);

    const box = await page.locator(selector).boundingBox();
    if (!box) {
      throw new Error(`Element not found: ${selector}`);
    }

    return {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2
    };
  }

  /**
   * 根据截图坐标比例计算实际坐标
   * @param {string} targetId - 标签页 ID
   * @param {number} ratioX - X 坐标比例 (0-1)
   * @param {number} ratioY - Y 坐标比例 (0-1)
   * @returns {Promise<{x: number, y: number}>}
   */
  async ratioToCoordinate(targetId, ratioX, ratioY) {
    const page = this._getPage(targetId);
    const viewport = page.viewportSize() || { width: 1280, height: 720 };

    return {
      x: Math.round(viewport.width * ratioX),
      y: Math.round(viewport.height * ratioY)
    };
  }

  /**
   * 统一执行入口
   * @param {string} targetId - 标签页 ID
   * @param {Object} options - 操作选项
   * @returns {Promise<Object>}
   */
  async execute(targetId, options = {}) {
    const { action } = options;

    switch (action) {
      case 'click':
        return this.clickAt(targetId, options.x, options.y, options);

      case 'doubleClick':
        return this.doubleClickAt(targetId, options.x, options.y, options);

      case 'rightClick':
        return this.rightClickAt(targetId, options.x, options.y, options);

      case 'move':
        return this.moveTo(targetId, options.x, options.y, options);

      case 'drag':
        return this.dragFromTo(
          targetId,
          options.fromX, options.fromY,
          options.toX, options.toY,
          options
        );

      case 'gesture':
        return this.gesture(targetId, options.gesture, options);

      case 'scroll':
        return this.scrollAt(
          targetId,
          options.x, options.y,
          options.deltaX || 0, options.deltaY || 0,
          options
        );

      case 'draw':
        return this.drawPath(targetId, options.points, options);

      default:
        throw new Error(`Unknown coordinate action: ${action}`);
    }
  }
}

module.exports = {
  CoordinateAction,
  MouseButton,
  GestureType
};
