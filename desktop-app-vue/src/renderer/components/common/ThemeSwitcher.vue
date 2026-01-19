<template>
  <div class="theme-switcher">
    <a-dropdown :trigger="['click']">
      <a-button shape="circle">
        <template #icon>
          <BulbOutlined v-if="appliedTheme === THEMES.LIGHT" />
          <BulbFilled v-else />
        </template>
      </a-button>

      <template #overlay>
        <a-menu
          :selected-keys="[currentTheme]"
          @click="handleMenuClick"
        >
          <a-menu-item key="light">
            <BulbOutlined />
            <span style="margin-left: 8px">浅色模式</span>
          </a-menu-item>
          <a-menu-item key="dark">
            <BulbFilled />
            <span style="margin-left: 8px">深色模式</span>
          </a-menu-item>
          <a-menu-item key="auto">
            <SyncOutlined />
            <span style="margin-left: 8px">跟随系统</span>
          </a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </div>
</template>

<script setup>
import { BulbOutlined, BulbFilled, SyncOutlined } from '@ant-design/icons-vue';
import { useTheme } from '../../composables/useTheme';

const { currentTheme, appliedTheme, setTheme, THEMES } = useTheme();

const handleMenuClick = ({ key }) => {
  setTheme(key);
};
</script>

<style scoped lang="scss">
.theme-switcher {
  display: inline-block;
}
</style>
