<template>
  <a-dropdown :trigger="['click']" placement="bottomRight">
    <a-button class="language-btn">
      <span class="language-icon">{{ currentLanguageIcon }}</span>
      <span class="language-text">{{ currentLanguageLabel }}</span>
      <GlobalOutlined style="margin-left: 8px" />
    </a-button>

    <template #overlay>
      <a-menu
        :selected-keys="[currentLocale]"
        @click="handleLanguageChange"
      >
        <a-menu-item
          v-for="lang in supportedLocales"
          :key="lang.value"
        >
          <span class="language-icon">{{ lang.icon }}</span>
          <span style="margin-left: 8px">{{ lang.label }}</span>
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { GlobalOutlined } from '@ant-design/icons-vue';
import { supportedLocales, setLocale, getLocale } from '../locales';
import { message } from 'ant-design-vue';

const { t } = useI18n();

// Get current locale
const currentLocale = computed(() => getLocale());

// Get current language info
const currentLanguageInfo = computed(() => {
  return supportedLocales.find(lang => lang.value === currentLocale.value) || supportedLocales[0];
});

const currentLanguageLabel = computed(() => currentLanguageInfo.value.label);
const currentLanguageIcon = computed(() => currentLanguageInfo.value.icon);

// Handle language change
const handleLanguageChange = ({ key }) => {
  if (key !== currentLocale.value) {
    setLocale(key);
    const langInfo = supportedLocales.find(lang => lang.value === key);
    message.success(t('common.success') + ': ' + langInfo.label);
  }
};
</script>

<style scoped>
.language-btn {
  display: flex;
  align-items: center;
  border-radius: 6px;
  padding: 4px 12px;
}

.language-icon {
  font-size: 18px;
  line-height: 1;
}

.language-text {
  margin-left: 8px;
  font-size: 14px;
}

@media (max-width: 768px) {
  .language-text {
    display: none;
  }
}
</style>
