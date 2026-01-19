/**
 * 权限检查指令
 * 用法：
 * - v-permission="'member.manage'" - 如果没有权限则隐藏元素
 * - v-permission:disable="'member.manage'" - 如果没有权限则禁用元素
 * - v-permission:hide="'member.manage'" - 如果没有权限则隐藏元素（默认）
 */

import { logger, createLogger } from '@/utils/logger';
import { useIdentityStore } from '../stores/identity';

/**
 * 检查用户是否具有指定权限
 * @param {string} permission - 权限字符串
 * @returns {Promise<boolean>}
 */
async function checkPermission(permission) {
  const identityStore = useIdentityStore();

  // 如果不在组织上下文中，返回true（个人模式无权限限制）
  if (!identityStore.isOrganizationContext) {
    return true;
  }

  try {
    return await identityStore.checkPermission(permission);
  } catch (error) {
    logger.error('权限检查失败:', error);
    return false;
  }
}

/**
 * 处理元素的显示/隐藏
 * @param {HTMLElement} el
 * @param {boolean} hasPermission
 */
function handleHide(el, hasPermission) {
  if (!hasPermission) {
    el.style.display = 'none';
  } else {
    el.style.display = '';
  }
}

/**
 * 处理元素的禁用状态
 * @param {HTMLElement} el
 * @param {boolean} hasPermission
 */
function handleDisable(el, hasPermission) {
  if (!hasPermission) {
    el.setAttribute('disabled', 'disabled');
    el.classList.add('permission-disabled');
    el.style.opacity = '0.5';
    el.style.cursor = 'not-allowed';
    el.style.pointerEvents = 'none';

    // 如果是Ant Design组件，设置disabled属性
    if (el.__vueParentComponent) {
      const props = el.__vueParentComponent.props;
      if (props) {
        props.disabled = true;
      }
    }
  } else {
    el.removeAttribute('disabled');
    el.classList.remove('permission-disabled');
    el.style.opacity = '';
    el.style.cursor = '';
    el.style.pointerEvents = '';

    if (el.__vueParentComponent) {
      const props = el.__vueParentComponent.props;
      if (props) {
        props.disabled = false;
      }
    }
  }
}

/**
 * 处理元素的只读状态
 * @param {HTMLElement} el
 * @param {boolean} hasPermission
 */
function handleReadonly(el, hasPermission) {
  if (!hasPermission) {
    el.setAttribute('readonly', 'readonly');
    el.classList.add('permission-readonly');
    el.style.pointerEvents = 'none';
  } else {
    el.removeAttribute('readonly');
    el.classList.remove('permission-readonly');
    el.style.pointerEvents = '';
  }
}

/**
 * 自定义权限指令
 */
export const permission = {
  async mounted(el, binding) {
    const { value, arg, modifiers } = binding;

    // 如果没有指定权限，直接返回
    if (!value) {
      logger.warn('v-permission 指令需要指定权限字符串');
      return;
    }

    // 检查权限
    const hasPermission = await checkPermission(value);

    // 存储权限状态到元素上
    el._hasPermission = hasPermission;
    el._permissionValue = value;
    el._permissionMode = arg || 'hide'; // 默认是hide模式

    // 根据模式处理元素
    const mode = arg || (modifiers.disable ? 'disable' : modifiers.readonly ? 'readonly' : 'hide');

    switch (mode) {
      case 'disable':
        handleDisable(el, hasPermission);
        break;
      case 'readonly':
        handleReadonly(el, hasPermission);
        break;
      case 'hide':
      default:
        handleHide(el, hasPermission);
        break;
    }
  },

  async updated(el, binding) {
    const { value, arg, modifiers } = binding;

    // 如果权限值没有变化，不重新检查
    if (el._permissionValue === value) {
      return;
    }

    // 重新检查权限
    const hasPermission = await checkPermission(value);
    el._hasPermission = hasPermission;
    el._permissionValue = value;

    // 根据模式处理元素
    const mode = arg || (modifiers.disable ? 'disable' : modifiers.readonly ? 'readonly' : 'hide');
    el._permissionMode = mode;

    switch (mode) {
      case 'disable':
        handleDisable(el, hasPermission);
        break;
      case 'readonly':
        handleReadonly(el, hasPermission);
        break;
      case 'hide':
      default:
        handleHide(el, hasPermission);
        break;
    }
  },

  unmounted(el) {
    // 清理
    delete el._hasPermission;
    delete el._permissionValue;
    delete el._permissionMode;
  }
};

/**
 * 注册指令到Vue应用
 * @param {import('vue').App} app
 */
export function registerPermissionDirective(app) {
  app.directive('permission', permission);
}

export default permission;
