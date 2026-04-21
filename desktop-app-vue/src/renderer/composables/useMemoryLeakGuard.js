import { ref, onUnmounted } from "vue";
import { logger } from "@/utils/logger";

/**
 * 跟踪 setTimeout/setInterval 定时器与 electronAPI.project 事件监听器，
 * 并在组件卸载时统一清理，防止内存泄漏。
 *
 * @param {string} [label] - 用于日志的组件标签
 */
export function useMemoryLeakGuard(label = "Component") {
  const activeTimers = ref([]);
  const activeListeners = ref([]);

  const safeSetTimeout = (callback, delay) => {
    const timerId = setTimeout(() => {
      const index = activeTimers.value.indexOf(timerId);
      if (index > -1) {
        activeTimers.value.splice(index, 1);
      }
      callback();
    }, delay);

    activeTimers.value.push(timerId);
    return timerId;
  };

  const safeRegisterListener = (eventName, handler) => {
    window.electronAPI.project.on(eventName, handler);

    const cleanup = () => {
      window.electronAPI.project.off(eventName, handler);
    };

    activeListeners.value.push(cleanup);
    return cleanup;
  };

  const clearSafeTimeout = (timerId) => {
    clearTimeout(timerId);
    const index = activeTimers.value.indexOf(timerId);
    if (index > -1) {
      activeTimers.value.splice(index, 1);
    }
  };

  const clearAll = () => {
    if (activeTimers.value.length > 0) {
      logger.info(`[${label}] 清理 ${activeTimers.value.length} 个定时器`);
      activeTimers.value.forEach((timerId) => {
        clearTimeout(timerId);
      });
      activeTimers.value = [];
    }

    if (activeListeners.value.length > 0) {
      logger.info(
        `[${label}] 清理 ${activeListeners.value.length} 个事件监听器`,
      );
      activeListeners.value.forEach((cleanup) => {
        try {
          cleanup();
        } catch (error) {
          logger.error(`[${label}] 清理监听器失败:`, error);
        }
      });
      activeListeners.value = [];
    }
  };

  onUnmounted(() => {
    clearAll();
  });

  return {
    activeTimers,
    activeListeners,
    safeSetTimeout,
    safeRegisterListener,
    clearSafeTimeout,
    clearAll,
  };
}
