<template>
  <div class="organization-layout">
    <!-- 组织导航标签 -->
    <div class="org-tabs">
      <a-tabs
        v-model:active-key="activeTab"
        @change="handleTabChange"
      >
        <a-tab-pane
          key="members"
          tab="成员管理"
        >
          <template #tab>
            <TeamOutlined />
            成员管理
          </template>
        </a-tab-pane>
        <a-tab-pane
          key="roles"
          tab="角色管理"
        >
          <template #tab>
            <SafetyCertificateOutlined />
            角色管理
          </template>
        </a-tab-pane>
        <a-tab-pane
          key="activities"
          tab="活动日志"
        >
          <template #tab>
            <HistoryOutlined />
            活动日志
          </template>
        </a-tab-pane>
        <a-tab-pane
          key="settings"
          tab="组织设置"
        >
          <template #tab>
            <SettingOutlined />
            组织设置
          </template>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 内容区域 -->
    <div class="org-content">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  TeamOutlined,
  SafetyCertificateOutlined,
  HistoryOutlined,
  SettingOutlined
} from '@ant-design/icons-vue';

const route = useRoute();
const router = useRouter();

const orgId = computed(() => route.params.orgId);

// 根据当前路由确定激活的标签
const activeTab = ref(getTabFromRoute());

function getTabFromRoute() {
  const path = route.path;
  if (path.includes('/members')) {return 'members';}
  if (path.includes('/roles')) {return 'roles';}
  if (path.includes('/activities')) {return 'activities';}
  if (path.includes('/settings')) {return 'settings';}
  return 'members';
}

// 标签切换
function handleTabChange(key) {
  const routes = {
    members: `/org/${orgId.value}/members`,
    roles: `/org/${orgId.value}/roles`,
    activities: `/org/${orgId.value}/activities`,
    settings: `/org/${orgId.value}/settings`
  };

  router.push(routes[key]);
}

// 监听路由变化,更新激活标签
watch(() => route.path, () => {
  activeTab.value = getTabFromRoute();
});
</script>

<style scoped lang="scss">
.organization-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;

  .org-tabs {
    background: white;
    padding: 0 24px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);

    :deep(.ant-tabs-nav) {
      margin: 0;
    }

    :deep(.ant-tabs-tab) {
      padding: 16px 0;
      margin-right: 32px;
      font-size: 14px;

      .anticon {
        margin-right: 6px;
      }
    }
  }

  .org-content {
    flex: 1;
    overflow: auto;
  }
}
</style>
