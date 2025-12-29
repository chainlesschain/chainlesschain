<template>
  <div class="language-switcher">
    <a-dropdown :trigger="['click']">
      <a-button shape="circle">
        <template #icon><GlobalOutlined /></template>
      </a-button>

      <template #overlay>
        <a-menu @click="handleMenuClick" :selected-keys="[currentLocale]">
          <a-menu-item :key="LOCALES.ZH_CN">
            <span>🇨🇳 简体中文</span>
          </a-menu-item>
          <a-menu-item :key="LOCALES.EN_US">
            <span>🇺🇸 English</span>
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </div>
</template>

<script setup>
import { GlobalOutlined } from '@ant-design/icons-vue';
import { useI18n } from '../../i18n';
import { message } from 'ant-design-vue';

const { currentLocale, setLocale, LOCALES } = useI18n();

const handleMenuClick = ({ key }) => {
  setLocale(key);
  message.success('语言已切换 / Language changed');
  // 刷新页面以应用新语言
  setTimeout(() => {
    window.location.reload();
  }, 500);
};
</script>

<style scoped lang="scss">
.language-switcher {
  display: inline-block;
}
</style>
