<template>
  <a-config-provider
    :locale="currentAntdLocale"
    :theme="{
      token: {
        colorPrimary: '#1890ff',
        borderRadius: 6,
      },
    }"
  >
    <a-spin v-if="loading" size="large" :tip="$t('app.initializing')" class="loading-overlay" />
    <router-view v-else />

    <!-- 首次启动加密设置向导 -->
    <DatabaseEncryptionWizard
      v-model:visible="showWizard"
      @complete="onWizardComplete"
      @skip="onWizardSkip"
    />
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { message } from 'ant-design-vue';
import { useAppStore } from './stores/app';
import { ukeyAPI, llmAPI } from './utils/ipc';
import DatabaseEncryptionWizard from './components/DatabaseEncryptionWizard.vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import zhTW from 'ant-design-vue/es/locale/zh_TW';
import jaJP from 'ant-design-vue/es/locale/ja_JP';
import koKR from 'ant-design-vue/es/locale/ko_KR';

const store = useAppStore();
const loading = ref(true);
const { locale } = useI18n();
const showWizard = ref(false);

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

onMounted(async () => {
  try {
    // 检测U盾状态
    const ukeyStatus = await ukeyAPI.detect();
    store.setUKeyStatus(ukeyStatus);

    // 检查LLM服务状态
    const llmStatus = await llmAPI.checkStatus();
    store.setLLMStatus(llmStatus);

    // 检查数据库加密状态，决定是否显示首次设置向导
    if (window.electron?.ipcRenderer) {
      try {
        const status = await window.electron.ipcRenderer.invoke('database:get-encryption-status');

        // 如果是首次设置且未加密，延迟1秒后显示向导
        if (status.firstTimeSetup && !status.isEncrypted) {
          setTimeout(() => {
            showWizard.value = true;
          }, 1000);
        }
      } catch (error) {
        console.error('检查加密状态失败:', error);
      }
    }
  } catch (error) {
    console.error($t('app.initializationFailed'), error);
  } finally {
    loading.value = false;
  }
});

// 向导完成处理
const onWizardComplete = () => {
  message.success('加密设置完成！应用将在重启后生效。');
};

// 向导跳过处理
const onWizardSkip = () => {
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
