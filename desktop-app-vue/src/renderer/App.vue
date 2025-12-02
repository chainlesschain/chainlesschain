<template>
  <a-config-provider
    :locale="zhCN"
    :theme="{
      token: {
        colorPrimary: '#1890ff',
        borderRadius: 6,
      },
    }"
  >
    <a-spin v-if="loading" size="large" tip="正在初始化..." class="loading-overlay" />
    <router-view v-else />
  </a-config-provider>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useAppStore } from './stores/app';
import { ukeyAPI, llmAPI } from './utils/ipc';
import zhCN from 'ant-design-vue/es/locale/zh_CN';

const store = useAppStore();
const loading = ref(true);

onMounted(async () => {
  try {
    // 检测U盾状态
    const ukeyStatus = await ukeyAPI.detect();
    store.setUKeyStatus(ukeyStatus);

    // 检查LLM服务状态
    const llmStatus = await llmAPI.checkStatus();
    store.setLLMStatus(llmStatus);
  } catch (error) {
    console.error('初始化失败:', error);
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
