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
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAppStore } from './stores/app';
import { ukeyAPI, llmAPI } from './utils/ipc';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import enUS from 'ant-design-vue/es/locale/en_US';
import zhTW from 'ant-design-vue/es/locale/zh_TW';
import jaJP from 'ant-design-vue/es/locale/ja_JP';
import koKR from 'ant-design-vue/es/locale/ko_KR';

const store = useAppStore();
const loading = ref(true);
const { locale } = useI18n();

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
  } catch (error) {
    console.error($t('app.initializationFailed'), error);
  } finally {
    loading.value = false;
  }
});
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
