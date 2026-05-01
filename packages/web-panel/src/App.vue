<template>
  <a-config-provider :theme="themeStore.antdTheme">
    <ErrorBoundary>
      <router-view />
    </ErrorBoundary>
  </a-config-provider>
</template>

<script setup>
import { onMounted } from 'vue'
import { useThemeStore } from './stores/theme.js'
import ErrorBoundary from './components/ErrorBoundary.vue'

const themeStore = useThemeStore()
onMounted(() => themeStore.init())
</script>
