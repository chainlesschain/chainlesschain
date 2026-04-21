<template>
  <a-breadcrumb v-if="breadcrumbs.length > 1" class="breadcrumb-nav">
    <template #separator>
      <span class="breadcrumb-separator">/</span>
    </template>
    <a-breadcrumb-item v-for="(item, index) in breadcrumbs" :key="index">
      <a
        v-if="item.path && index < breadcrumbs.length - 1"
        class="breadcrumb-link"
        @click="handleBreadcrumbClick(item)"
      >
        <component
          :is="iconResolver(item.icon)"
          v-if="item.icon"
          class="breadcrumb-icon"
        />
        <span class="breadcrumb-text">{{ item.title }}</span>
      </a>
      <span v-else class="breadcrumb-current">
        <component
          :is="iconResolver(item.icon)"
          v-if="item.icon"
          class="breadcrumb-icon"
        />
        <span class="breadcrumb-text">{{ item.title }}</span>
      </span>
    </a-breadcrumb-item>
  </a-breadcrumb>
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

defineProps({
  iconResolver: { type: Function, required: true },
});

const route = useRoute();
const router = useRouter();

const breadcrumbs = computed(() => {
  const items = [];
  const path = route.path;

  if (path === "/") {
    items.push({ title: "首页", path: "/", icon: "HomeOutlined" });
    return items;
  }

  items.push({ title: "首页", path: "/", icon: "HomeOutlined" });

  if (path.startsWith("/projects")) {
    items.push({
      title: "项目管理",
      path: "/projects",
      icon: "FolderOutlined",
    });

    if (path === "/projects/categories") {
      items.push({ title: "项目分类", path: null });
    } else if (path === "/projects/management") {
      items.push({ title: "项目列表管理", path: null });
    } else if (path === "/projects/workspace") {
      items.push({ title: "工作区管理", path: null });
    } else if (path.match(/^\/projects\/\d+/)) {
      items.push({ title: "项目详情", path: null });
    }
  } else if (path.startsWith("/knowledge")) {
    items.push({
      title: "知识与AI",
      path: "/knowledge/list",
      icon: "FileTextOutlined",
    });

    if (path === "/knowledge/graph") {
      items.push({ title: "知识图谱", path: null });
    }
  } else if (path === "/ai/chat") {
    items.push({ title: "AI对话", path: null, icon: "RobotOutlined" });
  } else if (
    path.startsWith("/did") ||
    path.startsWith("/credentials") ||
    path.startsWith("/contacts") ||
    path.startsWith("/friends") ||
    path.startsWith("/posts") ||
    path.startsWith("/p2p-messaging")
  ) {
    items.push({ title: "身份与社交", path: "/did", icon: "TeamOutlined" });

    if (path === "/credentials") {
      items.push({ title: "可验证凭证", path: null });
    } else if (path === "/contacts") {
      items.push({ title: "联系人", path: null });
    } else if (path === "/friends") {
      items.push({ title: "好友管理", path: null });
    } else if (path === "/posts") {
      items.push({ title: "动态广场", path: null });
    } else if (path === "/p2p-messaging") {
      items.push({ title: "P2P加密消息", path: null });
    }
  } else if (
    path.startsWith("/trading") ||
    path.startsWith("/marketplace") ||
    path.startsWith("/contracts") ||
    path.startsWith("/wallet")
  ) {
    items.push({ title: "交易系统", path: "/trading", icon: "ShopOutlined" });

    if (path === "/marketplace") {
      items.push({ title: "交易市场", path: null });
    } else if (path === "/contracts") {
      items.push({ title: "智能合约", path: null });
    } else if (path === "/wallet") {
      items.push({ title: "钱包管理", path: null });
    }
  } else if (path === "/webide") {
    items.push({ title: "Web IDE", path: null, icon: "CodeOutlined" });
  } else if (
    path.startsWith("/organizations") ||
    path.startsWith("/enterprise") ||
    path.startsWith("/permissions")
  ) {
    items.push({
      title: "企业版",
      path: "/organizations",
      icon: "BankOutlined",
    });

    if (path === "/enterprise/dashboard") {
      items.push({ title: "企业仪表板", path: null });
    } else if (path === "/permissions") {
      items.push({ title: "权限管理", path: null });
    }
  } else if (
    path.startsWith("/settings") ||
    path.startsWith("/plugins") ||
    path.startsWith("/sync") ||
    path.startsWith("/database")
  ) {
    items.push({
      title: "系统设置",
      path: "/settings",
      icon: "SettingOutlined",
    });

    if (path === "/settings/system") {
      items.push({ title: "系统配置", path: null });
    } else if (path === "/settings/plugins") {
      items.push({ title: "插件管理", path: null });
    } else if (path === "/plugins/marketplace") {
      items.push({ title: "插件市场", path: null });
    } else if (path === "/sync/conflicts") {
      items.push({ title: "同步冲突管理", path: null });
    } else if (path === "/database/performance") {
      items.push({ title: "数据库性能监控", path: null });
    } else if (path === "/workflow/optimizations") {
      items.push({ title: "工作流优化", path: null });
    }
  }

  return items;
});

function handleBreadcrumbClick(item) {
  if (item.path) {
    router.push(item.path);
  }
}
</script>
