<template>
  <a-config-provider :theme="themeStore.antdTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup>
import { onMounted } from 'vue'
import { useThemeStore } from './stores/theme.js'

const themeStore = useThemeStore()
onMounted(() => themeStore.init())
</script>
