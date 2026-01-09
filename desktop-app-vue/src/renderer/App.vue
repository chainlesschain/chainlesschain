<template>
  <a-config-provider
    :locale="currentAntdLocale"
    :theme="themeConfig"
  >
    <a-spin v-if="loading" size="large" :tip="$t('app.initializing')" class="loading-overlay" />
    <router-view v-else />

    <!-- 全局设置向导 (首次启动时显示) -->
    <GlobalSettingsWizard
      :visible="showGlobalSetupWizard"
      :canSkip="false"
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
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onErrorCaptured } from 'vue';
import { useI18n } from 'vue-i18n';
import { message } from 'ant-design-vue';
import { useAppStore } from './stores/app';
import { ukeyAPI, llmAPI } from './utils/ipc';
import { handleError, ErrorType, ErrorLevel } from './utils/errorHandler';
import { useTheme } from './utils/themeManager';
import { useShortcuts, CommonShortcuts } from './utils/shortcutManager';
import { useNotifications } from './utils/notificationManager';
import DatabaseEncryptionWizard from './components/DatabaseEncryptionWizard.vue';
import GlobalSettingsWizard from './components/GlobalSettingsWizard.vue';
import NotificationCenter from './components/common/NotificationCenter.vue';
import ShortcutHelpPanel from './components/common/ShortcutHelpPanel.vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import zhTW from 'ant-design-vue/es/locale/zh_TW';
import jaJP from 'ant-design-vue/es/locale/ja_JP';
import koKR from 'ant-design-vue/es/locale/ko_KR';

const store = useAppStore();
const loading = ref(true);
const { locale } = useI18n();
const showGlobalSetupWizard = ref(false);
const showEncryptionWizard = ref(false);

// 主题系统
const { effectiveTheme, toggle: toggleTheme } = useTheme();

// 主题配置
const themeConfig = computed(() => ({
  token: {
    colorPrimary: effectiveTheme.value.colors?.primary || '#1890ff',
    borderRadius: 6,
  },
}));

// 快捷键帮助面板
const showShortcutHelp = ref(false);

// 通知系统
const { success: notifySuccess, error: notifyError } = useNotifications();

// 注册全局快捷键
useShortcuts([
  {
    keys: CommonShortcuts.HELP,
    description: '显示快捷键帮助',
    handler: () => {
      showShortcutHelp.value = true;
    },
  },
  {
    keys: ['ctrl', 't'],
    description: '切换主题',
    handler: () => {
      toggleTheme();
      notifySuccess('主题已切换', `当前主题: ${effectiveTheme.value.name}`);
    },
  },
]);

// Ant Design Vue locale mapping
const antdLocaleMap = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR
};

// Computed property for current Ant Design locale
const currentAntdLocale = computed(() => {
  return antdLocaleMap[locale.value] || zhCN;
});

// 全局错误捕获
onErrorCaptured((err, instance, info) => {
  console.error('[App] Global error captured:', err);
  console.error('[App] Component info:', info);

  // 使用统一错误处理
  handleError(err, {
    showMessage: true,
    showNotification: true,
    logToFile: true,
    context: {
      component: 'App',
      componentInfo: info,
      location: 'global',
    },
  });

  // 不阻止错误传播到开发工具
  return false;
});

// 监听未捕获的 Promise 错误
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[App] Unhandled promise rejection:', event.reason);

    handleError(event.reason, {
      showMessage: true,
      logToFile: true,
      context: {
        type: 'unhandledRejection',
        promise: event.promise,
      },
    });

    event.preventDefault();
  });
}

onMounted(async () => {
  try {
    // 检测U盾状态
    const ukeyStatus = await ukeyAPI.detect();
    store.setUKeyStatus(ukeyStatus);

    // 检查LLM服务状态
    const llmStatus = await llmAPI.checkStatus();
    store.setLLMStatus(llmStatus);

    // 步骤1: 首先检查全局设置是否完成
    if (window.electron?.ipcRenderer) {
      try {
        const setupStatus = await window.electron.ipcRenderer.invoke('initial-setup:get-status');

        if (!setupStatus.completed) {
          // 首次启动，显示全局设置向导
          setTimeout(() => {
            showGlobalSetupWizard.value = true;
          }, 500);
          loading.value = false;
          return; // 等待全局设置完成，不继续检查加密状态
        }

        // 步骤2: 全局设置已完成，检查数据库加密状态
        const encStatus = await window.electron.ipcRenderer.invoke('database:get-encryption-status');

        // 如果是首次设置且未加密，延迟1秒后显示加密向导
        if (encStatus.firstTimeSetup && !encStatus.isEncrypted) {
          setTimeout(() => {
            showEncryptionWizard.value = true;
          }, 1000);
        }
      } catch (error) {
        console.error('检查设置状态失败:', error);
      }
    }

    // 监听托盘菜单触发的全局设置事件
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.on('show-global-settings', () => {
        showGlobalSetupWizard.value = true;
      });

      // 监听数据库切换事件(身份上下文切换)
      window.electron.ipcRenderer.on('database-switched', (data) => {
        console.log('数据库已切换:', data);
        // 刷新页面以重新加载新身份的数据
        setTimeout(() => {
          window.location.reload();
        }, 300);
      });
    }
  } catch (error) {
    console.error('应用初始化失败', error);
  } finally {
    loading.value = false;
  }
});

// 全局设置向导完成处理
const handleGlobalSetupComplete = async () => {
  showGlobalSetupWizard.value = false;

  // 全局设置完成后，立即检查加密状态
  try {
    const encStatus = await window.electron.ipcRenderer.invoke('database:get-encryption-status');
    if (encStatus.firstTimeSetup && !encStatus.isEncrypted) {
      setTimeout(() => {
        showEncryptionWizard.value = true;
      }, 800);
    } else {
      // 如果加密已设置或跳过，提示可能需要重启
      message.success('全局设置已保存，部分配置将在重启后生效');
    }
  } catch (error) {
    console.error('检查加密状态失败:', error);
    message.success('全局设置已保存');
  }
};

// 数据库加密向导完成处理
const onEncryptionWizardComplete = () => {
  message.success('加密设置完成！应用将在重启后生效。');
};

// 数据库加密向导跳过处理
const onEncryptionWizardSkip = () => {
  message.info('您可以随时在设置中启用数据库加密');
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
</style>
