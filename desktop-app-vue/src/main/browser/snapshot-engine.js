/**
 * SnapshotEngine - 智能快照引擎
 * 实现 OpenClaw 风格的页面元素扫描和引用系统
 *
 * @module browser/snapshot-engine
 * @author ChainlessChain Team
 * @since v0.27.0 Phase 2
 */

const { EventEmitter } = require('events');

/**
 * ARIA 角色映射表
 * 用于推断元素的语义角色
 */
const ARIA_ROLE_MAP = {
  // 表单控件
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
  button: 'button',

  // 链接和导航
  a: 'link',
  nav: 'navigation',

  // 结构化内容
  article: 'article',
  section: 'region',
  main: 'main',
  aside: 'complementary',
  header: 'banner',
  footer: 'contentinfo',

  // 列表
  ul: 'list',
  ol: 'list',
  li: 'listitem',

  // 表格
  table: 'table',
  thead: 'rowgroup',
  tbody: 'rowgroup',
  tr: 'row',
  th: 'columnheader',
  td: 'cell',

  // 其他
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
  figure: 'figure',
  dialog: 'dialog',
  form: 'form'
};

/**
 * 可交互元素标签列表
 */
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea',
  'details', 'summary', 'audio', 'video',
  'label', 'option'
]);

/**
 * 可交互 ARIA 角色列表
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'checkbox',
  'radio', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'searchbox', 'slider',
  'spinbutton', 'switch', 'treeitem'
]);

/**
 * 智能快照引擎类
 */
class SnapshotEngine extends EventEmitter {
  constructor() {
    super();
    this.snapshots = new Map(); // targetId => Snapshot
    this.nextRefId = 1;
  }

  /**
   * 获取页面快照
   * @param {Page} page - Playwright Page 对象
   * @param {Object} options - 快照选项
   * @param {boolean} options.interactive - 是否只包含可交互元素
   * @param {boolean} options.visible - 是否只包含可见元素
   * @param {boolean} options.roleRefs - 是否使用角色引用格式
   * @returns {Promise<Object>} 快照对象
   */
  async takeSnapshot(page, options = {}) {
    const {
      interactive = true,
      visible = true,
      roleRefs = true
    } = options;

    try {
      // 在页面上下文中执行扫描
      const rawElements = await page.evaluate(({ interactive, visible }) => {
        const results = [];

        /**
         * 推断元素的 ARIA 角色
         */
        function inferAriaRole(element) {
          // 优先使用显式的 role 属性
          if (element.hasAttribute('role')) {
            return element.getAttribute('role');
          }

          // 根据标签名推断
          const tagName = element.tagName.toLowerCase();
          const roleMap = {
            input: element.type === 'checkbox' ? 'checkbox' :
                   element.type === 'radio' ? 'radio' :
                   element.type === 'button' ? 'button' :
                   element.type === 'search' ? 'searchbox' : 'textbox',
            textarea: 'textbox',
            select: 'combobox',
            button: 'button',
            a: 'link',
            nav: 'navigation',
            article: 'article',
            section: 'region',
            main: 'main',
            aside: 'complementary',
            header: 'banner',
            footer: 'contentinfo',
            ul: 'list',
            ol: 'list',
            li: 'listitem',
            table: 'table',
            tr: 'row',
            th: 'columnheader',
            td: 'cell',
            h1: 'heading',
            h2: 'heading',
            h3: 'heading',
            h4: 'heading',
            h5: 'heading',
            h6: 'heading',
            img: 'img',
            figure: 'figure',
            dialog: 'dialog',
            form: 'form'
          };

          return roleMap[tagName] || 'generic';
        }

        /**
         * 检查元素是否可交互
         */
        function isInteractive(element) {
          const tagName = element.tagName.toLowerCase();
          const role = element.getAttribute('role');

          // 检查标签名
          const interactiveTags = [
            'a', 'button', 'input', 'select', 'textarea',
            'details', 'summary', 'audio', 'video', 'label', 'option'
          ];
          if (interactiveTags.includes(tagName)) {
            return true;
          }

          // 检查 ARIA 角色
          const interactiveRoles = [
            'button', 'link', 'textbox', 'combobox', 'checkbox',
            'radio', 'tab', 'menuitem', 'option', 'searchbox',
            'slider', 'spinbutton', 'switch', 'treeitem'
          ];
          if (role && interactiveRoles.includes(role)) {
            return true;
          }

          // 检查事件处理器
          if (element.onclick || element.hasAttribute('onclick')) {
            return true;
          }

          // 检查 tabindex
          if (element.hasAttribute('tabindex') && element.tabIndex >= 0) {
            return true;
          }

          // 检查 contenteditable
          if (element.isContentEditable) {
            return true;
          }

          return false;
        }

        /**
         * 检查元素是否可见
         */
        function isVisible(element) {
          if (!element.offsetParent && element.tagName !== 'BODY') {
            return false;
          }

          const style = window.getComputedStyle(element);
          if (style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0') {
            return false;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return false;
          }

          return true;
        }

        /**
         * 获取元素的可访问名称
         */
        function getAccessibleName(element) {
          // aria-label
          if (element.hasAttribute('aria-label')) {
            return element.getAttribute('aria-label');
          }

          // aria-labelledby
          if (element.hasAttribute('aria-labelledby')) {
            const id = element.getAttribute('aria-labelledby');
            const labelElement = document.getElementById(id);
            if (labelElement) {
              return labelElement.textContent.trim();
            }
          }

          // <label> 标签
          if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) {
              return label.textContent.trim();
            }
          }

          // placeholder (输入框)
          if (element.placeholder) {
            return element.placeholder;
          }

          // alt (图片)
          if (element.alt) {
            return element.alt;
          }

          // title
          if (element.title) {
            return element.title;
          }

          // value (按钮)
          if (element.value && (element.tagName === 'BUTTON' || element.tagName === 'INPUT')) {
            return element.value;
          }

          // textContent (截取前50字符)
          const text = element.textContent.trim();
          if (text) {
            return text.slice(0, 50);
          }

          return '';
        }

        /**
         * 生成元素的 CSS 选择器
         */
        function generateSelector(element) {
          if (element.id) {
            return `#${element.id}`;
          }

          const path = [];
          let current = element;

          while (current && current.tagName) {
            let selector = current.tagName.toLowerCase();

            if (current.className) {
              const classes = current.className.split(' ').filter(c => c.trim());
              if (classes.length > 0) {
                selector += '.' + classes.join('.');
              }
            }

            // 添加 nth-child 避免歧义
            let sibling = current;
            let nth = 1;
            while (sibling = sibling.previousElementSibling) {
              if (sibling.tagName === current.tagName) {
                nth++;
              }
            }

            if (nth > 1 || current.nextElementSibling) {
              selector += `:nth-child(${nth})`;
            }

            path.unshift(selector);
            current = current.parentElement;

            // 限制路径深度
            if (path.length >= 5) {
              break;
            }
          }

          return path.join(' > ');
        }

        // 扫描所有元素
        const allElements = document.querySelectorAll('*');

        allElements.forEach((element, index) => {
          // 过滤条件：可交互性
          if (interactive && !isInteractive(element)) {
            return;
          }

          // 过滤条件：可见性
          if (visible && !isVisible(element)) {
            return;
          }

          const role = inferAriaRole(element);
          const label = getAccessibleName(element);
          const selector = generateSelector(element);
          const rect = element.getBoundingClientRect();

          results.push({
            index,
            tag: element.tagName.toLowerCase(),
            role,
            label,
            selector,
            position: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            },
            attributes: {
              id: element.id || null,
              class: element.className || null,
              href: element.href || null,
              src: element.src || null,
              type: element.type || null,
              name: element.name || null,
              value: element.value || null,
              placeholder: element.placeholder || null
            },
            clickable: isInteractive(element),
            visible: isVisible(element)
          });
        });

        return results;
      }, { interactive, visible });

      // 为每个元素生成引用
      const elements = rawElements.map((el, idx) => {
        const ref = roleRefs ? `e${idx + 1}` : idx + 1;
        return {
          ref,
          ...el
        };
      });

      // 创建快照对象
      const snapshot = {
        url: page.url(),
        title: await page.title(),
        timestamp: Date.now(),
        elementsCount: elements.length,
        elements,
        options: { interactive, visible, roleRefs }
      };

      // 缓存快照（按 page 的 targetId）
      const targetId = this._getPageTargetId(page);
      if (targetId) {
        this.snapshots.set(targetId, snapshot);
      }

      this.emit('snapshot:taken', {
        targetId,
        elementsCount: elements.length
      });

      console.log(`[SnapshotEngine] Snapshot taken: ${elements.length} elements`);

      return snapshot;
    } catch (error) {
      this.emit('snapshot:error', { error: error.message });
      throw new Error(`Failed to take snapshot: ${error.message}`);
    }
  }

  /**
   * 查找元素
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {Object|null} 元素对象
   */
  findElement(targetId, ref) {
    const snapshot = this.snapshots.get(targetId);
    if (!snapshot) {
      return null;
    }

    return snapshot.elements.find(el => el.ref === ref) || null;
  }

  /**
   * 验证引用是否有效
   * @param {string} targetId - 标签页 ID
   * @param {string} ref - 元素引用
   * @returns {boolean}
   */
  validateRef(targetId, ref) {
    return this.findElement(targetId, ref) !== null;
  }

  /**
   * 清除快照缓存
   * @param {string} targetId - 标签页 ID（可选）
   */
  clearSnapshot(targetId = null) {
    if (targetId) {
      this.snapshots.delete(targetId);
      console.log(`[SnapshotEngine] Snapshot cleared for ${targetId}`);
    } else {
      this.snapshots.clear();
      console.log('[SnapshotEngine] All snapshots cleared');
    }
  }

  /**
   * 获取快照统计
   * @returns {Object}
   */
  getStats() {
    return {
      totalSnapshots: this.snapshots.size,
      snapshots: Array.from(this.snapshots.entries()).map(([targetId, snapshot]) => ({
        targetId,
        url: snapshot.url,
        elementsCount: snapshot.elementsCount,
        timestamp: snapshot.timestamp,
        age: Date.now() - snapshot.timestamp
      }))
    };
  }

  /**
   * 获取 Page 对象的 targetId
   * @param {Page} page
   * @returns {string|null}
   * @private
   */
  _getPageTargetId(page) {
    // Playwright Page 对象没有直接的 targetId
    // 我们需要从 BrowserEngine 传递或使用其他方式标识
    return page._targetId || null;
  }
}

module.exports = { SnapshotEngine };
