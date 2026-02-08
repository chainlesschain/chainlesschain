<template>
  <a-config-provider :locale="currentAntdLocale" :theme="themeConfig">
    <!-- 离线状态横幅 -->
    <transition name="slide-down">
      <div v-if="!networkStore.isOnline" class="offline-banner">
        <a-alert
          type="warning"
          :message="$t('app.offlineMessage', '您当前处于离线状态')"
          :description="
            $t('app.offlineDescription', '部分功能可能不可用，请检查网络连接')
          "
          banner
          closable
        />
      </div>
    </transition>

    <a-spin
      v-if="loading"
      size="large"
      :tip="$t('app.initializing')"
      class="loading-overlay"
    />
    <router-view v-else />

    <!-- 全局设置向导 (首次启动时显示) -->
    <GlobalSettingsWizard
      :open="showGlobalSetupWizard"
      :can-skip="false"
      @complete="handleGlobalSetupComplete"
    />

    <!-- 数据库加密设置向导 -->
    <DatabaseEncryptionWizard
      v-model:open="showEncryptionWizard"
      @complete="onEncryptionWizardComplete"
      @skip="onEncryptionWizardSkip"
    />

    <!-- 通知中心 -->
    <NotificationCenter />

    <!-- 快捷键帮助面板 -->
    <ShortcutHelpPanel v-model="showShortcutHelp" />

    <!-- 全局搜索 -->
    <GlobalSearch v-model="showGlobalSearch" />

    <!-- 企业版DID邀请接受对话框 -->
    <InvitationAcceptDialog
      v-model:open="showInvitationDialog"
      :token="invitationToken"
      @accepted="handleInvitationAccepted"
      @rejected="handleInvitationRejected"
    />

    <!-- 预算告警监听器 -->
    <BudgetAlertListener />
  </a-config-provider>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, onMounted, onUnmounted, onErrorCaptured } from "vue";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import { useAppStore } from "./stores/app";
import { useSocialStore } from "./stores/social";
import { useNetworkStore } from "./stores/network";
import { ukeyAPI, llmAPI } from "./utils/ipc";
import { handleError, ErrorType, ErrorLevel } from "./utils/errorHandler";
import { useTheme } from "./utils/themeManager";
import { useShortcuts, CommonShortcuts } from "./utils/shortcutManager";
import { useNotifications } from "./utils/notificationManager";
import DatabaseEncryptionWizard from "./components/DatabaseEncryptionWizard.vue";
import GlobalSettingsWizard from "./components/GlobalSettingsWizard.vue";
import NotificationCenter from "./components/common/NotificationCenter.vue";
import ShortcutHelpPanel from "./components/common/ShortcutHelpPanel.vue";
import GlobalSearch from "./components/common/GlobalSearch.vue";
import InvitationAcceptDialog from "./components/organization/InvitationAcceptDialog.vue";
import BudgetAlertListener from "./components/BudgetAlertListener.vue";
import zhCN from "ant-design-vue/es/locale/zh_CN";
import enUS from "ant-design-vue/es/locale/en_US";
import zhTW from "ant-design-vue/es/locale/zh_TW";
import jaJP from "ant-design-vue/es/locale/ja_JP";
import koKR from "ant-design-vue/es/locale/ko_KR";

const store = useAppStore();
const socialStore = useSocialStore();
const networkStore = useNetworkStore();
const loading = ref(true);
const { locale } = useI18n();
const showGlobalSetupWizard = ref(false);
const showEncryptionWizard = ref(false);

// 企业版DID邀请链接
const showInvitationDialog = ref(false);
const invitationToken = ref("");

// 主题系统
const { effectiveTheme, toggle: toggleTheme } = useTheme();

// 主题配置
const themeConfig = computed(() => ({
  token: {
    colorPrimary: effectiveTheme.value.colors?.primary || "#1890ff",
    borderRadius: 6,
  },
}));

// 快捷键帮助面板
const showShortcutHelp = ref(false);

// 全局搜索
const showGlobalSearch = ref(false);

// 通知系统
const { success: notifySuccess, error: notifyError } = useNotifications();

// 注册全局快捷键
useShortcuts([
  {
    keys: CommonShortcuts.HELP,
    description: "显示快捷键帮助",
    handler: () => {
      showShortcutHelp.value = true;
    },
  },
  {
    keys: ["ctrl", "t"],
    description: "切换主题",
    handler: () => {
      toggleTheme();
      notifySuccess("主题已切换", `当前主题: ${effectiveTheme.value.name}`);
    },
  },
  {
    keys: CommonShortcuts.SEARCH,
    description: "全局搜索",
    handler: () => {
      showGlobalSearch.value = true;
    },
  },
]);

// Ant Design Vue locale mapping
const antdLocaleMap = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "zh-TW": zhTW,
  "ja-JP": jaJP,
  "ko-KR": koKR,
};

// Computed property for current Ant Design locale
const currentAntdLocale = computed(() => {
  return antdLocaleMap[locale.value] || zhCN;
});

// 全局错误捕获
onErrorCaptured((err, instance, info) => {
  logger.error("[App] Global error captured:", err);
  logger.error("[App] Component info:", info);

  // 使用统一错误处理
  handleError(err, {
    showMessage: true,
    showNotification: true,
    logToFile: true,
    context: {
      component: "App",
      componentInfo: info,
      location: "global",
    },
  });

  // 不阻止错误传播到开发工具
  return false;
});

// 监听未捕获的 Promise 错误
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("[App] Unhandled promise rejection:", event.reason);

    handleError(event.reason, {
      showMessage: true,
      logToFile: true,
      context: {
        type: "unhandledRejection",
        promise: event.promise,
      },
    });

    event.preventDefault();
  });
}

// 深链接事件处理器（企业版DID邀请链接）
const handleInvitationDeepLink = (event, token) => {
  logger.info("收到邀请链接:", token);
  invitationToken.value = token;
  showInvitationDialog.value = true;
};

const handleInvitationAccepted = (org) => {
  logger.info("已加入组织:", org.name);
  message.success(`成功加入组织: ${org.name}`);
};

const handleInvitationRejected = () => {
  logger.info("已拒绝邀请");
};

// 显示全局设置向导
const handleShowGlobalSettings = () => {
  showGlobalSetupWizard.value = true;
};

// 数据库切换处理
const handleDatabaseSwitched = (data) => {
  logger.info("数据库已切换:", data);
  // 刷新页面以重新加载新身份的数据
  setTimeout(() => {
    window.location.reload();
  }, 300);
};

onMounted(async () => {
  try {
    // 初始化网络状态监听器
    networkStore.initNetworkListeners();

    // 初始化社交模块在线状态监听器
    socialStore.initOnlineStatusListeners();

    // 监听深链接事件（企业版DID邀请链接）
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on(
        "deep-link:invitation",
        handleInvitationDeepLink,
      );
    }

    // 检测U盾状态
    const ukeyStatus = await ukeyAPI.detect();
    store.setUKeyStatus(ukeyStatus);

    // 检查LLM服务状态
    const llmStatus = await llmAPI.checkStatus();
    store.setLLMStatus(llmStatus);

    // 步骤1: 首先检查全局设置是否完成
    if (window.electron?.ipcRenderer) {
      try {
        const setupStatus = await window.electron.ipcRenderer.invoke(
          "initial-setup:get-status",
        );

        if (!setupStatus.completed) {
          // 首次启动，显示全局设置向导
          setTimeout(() => {
            showGlobalSetupWizard.value = true;
          }, 500);
          loading.value = false;
          return; // 等待全局设置完成，不继续检查加密状态
        }

        // 步骤2: 全局设置已完成，检查数据库加密状态
        const encStatus = await window.electron.ipcRenderer.invoke(
          "database:get-encryption-status",
        );

        // 如果是首次设置且未加密，延迟1秒后显示加密向导
        if (encStatus.firstTimeSetup && !encStatus.isEncrypted) {
          setTimeout(() => {
            showEncryptionWizard.value = true;
          }, 1000);
        }
      } catch (error) {
        logger.error("检查设置状态失败:", error);
      }
    }

    // 监听托盘菜单触发的全局设置事件
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on(
        "show-global-settings",
        handleShowGlobalSettings,
      );

      // 监听数据库切换事件(身份上下文切换)
      window.electron.ipcRenderer.on(
        "database-switched",
        handleDatabaseSwitched,
      );
    }
  } catch (error) {
    logger.error("应用初始化失败", error);
  } finally {
    loading.value = false;
  }
});

// 清理事件监听器
onUnmounted(() => {
  // 移除网络状态监听器
  networkStore.removeNetworkListeners();

  // 移除社交模块在线状态监听器
  socialStore.removeOnlineStatusListeners();

  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.removeListener(
      "deep-link:invitation",
      handleInvitationDeepLink,
    );
    window.electron.ipcRenderer.removeListener(
      "show-global-settings",
      handleShowGlobalSettings,
    );
    window.electron.ipcRenderer.removeListener(
      "database-switched",
      handleDatabaseSwitched,
    );
  }
});

// 全局设置向导完成处理
const handleGlobalSetupComplete = async () => {
  showGlobalSetupWizard.value = false;

  // 全局设置完成后，立即检查加密状态
  try {
    const encStatus = await window.electron.ipcRenderer.invoke(
      "database:get-encryption-status",
    );
    if (encStatus.firstTimeSetup && !encStatus.isEncrypted) {
      setTimeout(() => {
        showEncryptionWizard.value = true;
      }, 800);
    } else {
      // 如果加密已设置或跳过，提示可能需要重启
      message.success("全局设置已保存，部分配置将在重启后生效");
    }
  } catch (error) {
    logger.error("检查加密状态失败:", error);
    message.success("全局设置已保存");
  }
};

// 数据库加密向导完成处理
const onEncryptionWizardComplete = () => {
  message.success("加密设置完成！应用将在重启后生效。");
};

// 数据库加密向导跳过处理
const onEncryptionWizardSkip = () => {
  message.info("您可以随时在设置中启用数据库加密");
};
</script>

<style>
.loading-overlay {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
}

/* 离线横幅样式 */
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 下滑动画 */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease-out;
}

.slide-down-enter-from {
  transform: translateY(-100%);
  opacity: 0;
}

.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
