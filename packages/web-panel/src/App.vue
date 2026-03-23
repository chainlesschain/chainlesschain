<template>
  <a-config-provider :theme="darkTheme">
    <router-view />
  </a-config-provider>
</template>

<script setup>
import { theme } from 'ant-design-vue'

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    colorBgBase: '#141414',
    colorBgContainer: '#1f1f1f',
    colorBgElevated: '#2a2a2a',
    borderRadius: 8,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    Layout: {
      siderBg: '#1c1c1c',
      headerBg: '#1c1c1c',
      bodyBg: '#141414',
    },
    Menu: {
      darkItemBg: '#1c1c1c',
      darkSubMenuItemBg: '#171717',
    }
  }
}
</script>
