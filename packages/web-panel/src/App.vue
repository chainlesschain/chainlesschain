<template>
  <a-config-provider :theme="themeStore.antdTheme" :locale="antdLocale">
    <ErrorBoundary>
      <router-view />
    </ErrorBoundary>
  </a-config-provider>
</template>

<script setup>
import { onMounted } from 'vue'
import { useThemeStore } from './stores/theme.js'
import { useLocale } from './plugins/i18n.js'
import ErrorBoundary from './components/ErrorBoundary.vue'

const themeStore = useThemeStore()
const { antdLocale } = useLocale()
onMounted(() => themeStore.init())
</script>
