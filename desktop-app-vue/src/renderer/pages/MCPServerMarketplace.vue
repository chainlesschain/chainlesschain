<template>
  <div class="mcp-server-marketplace">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <CloudServerOutlined />
          MCP 服务器市场
        </h1>
        <p class="page-description">浏览和安装社区 MCP 服务器，扩展 AI 工具能力</p>
      </div>
      <div class="header-right">
        <a-button :loading="refreshing" @click="handleRefresh">
          <ReloadOutlined />
          刷新目录
        </a-button>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-section">
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索 MCP 服务器名称、描述或标签..."
        size="large"
        allow-clear
        style="max-width: 600px"
        @search="handleSearch"
      >
        <template #prefix>
          <SearchOutlined />
        </template>
      </a-input-search>
    </div>

    <!-- 加载状态 -->
    <a-spin :spinning="loading">
      <!-- 社区服务器网格 -->
      <div v-if="filteredServers.length > 0" class="server-grid">
        <h2 class="section-title">社区服务器</h2>
        <a-row :gutter="[20, 20]">
          <a-col
            v-for="server in filteredServers"
            :key="server.name"
            :xs="24"
            :sm="12"
            :md="8"
            :lg="6"
          >
            <a-card class="server-card" hoverable>
              <div class="server-header">
                <div class="server-name">
                  <h3>{{ server.name }}</h3>
                  <a-badge
                    v-if="isInstalled(server.name)"
                    status="success"
                    text="已安装"
                  />
                </div>
              </div>

              <p class="server-description">
                {{ server.description || '暂无描述' }}
              </p>

              <div v-if="server.tags && server.tags.length > 0" class="server-tags">
                <a-tag
                  v-for="tag in server.tags.slice(0, 4)"
                  :key="tag"
                  color="blue"
                  size="small"
                >
                  {{ tag }}
                </a-tag>
              </div>

              <div class="server-actions">
                <a-button
                  v-if="!isInstalled(server.name)"
                  type="primary"
                  block
                  :loading="installingName === server.name"
                  @click="handleInstallServer(server)"
                >
                  <DownloadOutlined />
                  安装
                </a-button>
                <a-button
                  v-else
                  block
                  danger
                  :loading="uninstallingName === server.name"
                  @click="handleUninstallServer(server)"
                >
                  <DeleteOutlined />
                  卸载
                </a-button>
              </div>
            </a-card>
          </a-col>
        </a-row>
      </div>

      <!-- 空状态 -->
      <a-empty
        v-else-if="!loading"
        description="未找到匹配的 MCP 服务器"
        style="margin-top: 80px"
      >
        <a-button type="primary" @click="searchQuery = ''">清除搜索</a-button>
      </a-empty>
    </a-spin>

    <!-- 已安装的社区服务器 -->
    <div v-if="installedCommunityServers.length > 0" class="installed-section">
      <a-divider />
      <h2 class="section-title">已安装的社区服务器</h2>
      <a-list
        :data-source="installedCommunityServers"
        :bordered="true"
        class="installed-list"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <span class="installed-server-name">
                  <CloudServerOutlined />
                  {{ item.name }}
                </span>
              </template>
              <template #description>
                <span>{{ item.command || item.url || '-' }}</span>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-switch
                :checked="item.enabled !== false"
                checked-children="启用"
                un-checked-children="禁用"
                @change="(checked: boolean) => handleToggleServer(item, checked)"
              />
            </template>
          </a-list-item>
        </template>
      </a-list>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  CloudServerOutlined,
  ReloadOutlined,
  SearchOutlined,
  DownloadOutlined,
  DeleteOutlined,
} from '@ant-design/icons-vue';
import { logger, createLogger } from '@/utils/logger';

const pageLogger = createLogger('mcp-server-marketplace');

// ==================== 类型定义 ====================

interface MCPServer {
  name: string;
  description?: string;
  tags?: string[];
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
  source?: string;
  enabled?: boolean;
}

// ==================== 状态 ====================

const loading = ref(false);
const refreshing = ref(false);
const searchQuery = ref('');
const installingName = ref<string | null>(null);
const uninstallingName = ref<string | null>(null);

const communityServers = ref<MCPServer[]>([]);
const installedServers = ref<MCPServer[]>([]);

// ==================== 计算属性 ====================

const filteredServers = computed(() => {
  if (!searchQuery.value) {
    return communityServers.value;
  }
  const query = searchQuery.value.toLowerCase();
  return communityServers.value.filter(
    (s) =>
      s.name.toLowerCase().includes(query) ||
      (s.description && s.description.toLowerCase().includes(query)) ||
      (s.tags && s.tags.some((tag) => tag.toLowerCase().includes(query)))
  );
});

const installedServerNames = computed(() => {
  return new Set(installedServers.value.map((s) => s.name));
});

const installedCommunityServers = computed(() => {
  return installedServers.value.filter((s) => s.source === 'community');
});

// ==================== 方法 ====================

function isInstalled(serverName: string): boolean {
  return installedServerNames.value.has(serverName);
}

async function fetchServers() {
  loading.value = true;
  try {
    const [communityResult, installedResult] = await Promise.all([
      (window as any).electronAPI.invoke('mcp:list-community-servers'),
      (window as any).electronAPI.invoke('mcp:list-servers'),
    ]);

    if (communityResult.success) {
      communityServers.value = communityResult.servers || communityResult.data || [];
    } else {
      communityServers.value = getDefaultCommunityServers();
    }

    if (installedResult.success) {
      installedServers.value = installedResult.servers || installedResult.data || [];
    }

    pageLogger.info(
      `加载完成: ${communityServers.value.length} 个社区服务器, ${installedServers.value.length} 个已安装`
    );
  } catch (error) {
    pageLogger.warn('加载 MCP 服务器列表失败，使用默认数据:', error);
    communityServers.value = getDefaultCommunityServers();
  } finally {
    loading.value = false;
  }
}

async function handleRefresh() {
  refreshing.value = true;
  try {
    await fetchServers();
    message.success('服务器目录已刷新');
  } catch (error) {
    message.error('刷新失败');
  } finally {
    refreshing.value = false;
  }
}

function handleSearch() {
  // 搜索在 computed 中实时处理
}

async function handleInstallServer(server: MCPServer) {
  installingName.value = server.name;
  try {
    const result = await (window as any).electronAPI.invoke('mcp:install-server', {
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      source: 'community',
    });

    if (result.success) {
      message.success(`MCP 服务器 "${server.name}" 安装成功`);
      await fetchServers();
    } else {
      message.error(result.error || '安装失败');
    }
  } catch (error) {
    pageLogger.error('安装 MCP 服务器失败:', error);
    message.error('安装失败: ' + (error as Error).message);
  } finally {
    installingName.value = null;
  }
}

async function handleUninstallServer(server: MCPServer) {
  uninstallingName.value = server.name;
  try {
    const result = await (window as any).electronAPI.invoke('mcp:remove-server', {
      name: server.name,
    });

    if (result.success) {
      message.success(`MCP 服务器 "${server.name}" 已卸载`);
      await fetchServers();
    } else {
      message.error(result.error || '卸载失败');
    }
  } catch (error) {
    pageLogger.error('卸载 MCP 服务器失败:', error);
    message.error('卸载失败: ' + (error as Error).message);
  } finally {
    uninstallingName.value = null;
  }
}

async function handleToggleServer(server: MCPServer, enabled: boolean) {
  try {
    const result = await (window as any).electronAPI.invoke('mcp:toggle-server', {
      name: server.name,
      enabled,
    });

    if (result.success) {
      server.enabled = enabled;
      message.success(enabled ? `"${server.name}" 已启用` : `"${server.name}" 已禁用`);
    } else {
      message.error(result.error || '操作失败');
    }
  } catch (error) {
    pageLogger.error('切换 MCP 服务器状态失败:', error);
    message.error('操作失败');
  }
}

function getDefaultCommunityServers(): MCPServer[] {
  return [
    {
      name: 'filesystem',
      description: '文件系统读写操作，支持目录遍历和文件管理',
      tags: ['文件', '系统', '读写'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    {
      name: 'postgres',
      description: 'PostgreSQL 数据库查询和管理',
      tags: ['数据库', 'SQL', 'PostgreSQL'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
    },
    {
      name: 'sqlite',
      description: 'SQLite 数据库操作，轻量级本地数据存储',
      tags: ['数据库', 'SQL', 'SQLite'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
    },
    {
      name: 'git',
      description: 'Git 仓库操作，支持提交、分支和历史查看',
      tags: ['Git', '版本控制', '代码'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git'],
    },
    {
      name: 'brave-search',
      description: 'Brave 搜索引擎集成，支持网络搜索',
      tags: ['搜索', '网络', 'API'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
    },
    {
      name: 'puppeteer',
      description: '浏览器自动化，支持网页截图和交互',
      tags: ['浏览器', '自动化', '截图'],
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  ];
}

// ==================== 生命周期 ====================

onMounted(async () => {
  pageLogger.info('MCPServerMarketplace 挂载');
  await fetchServers();
});
</script>

<style scoped lang="scss">
.mcp-server-marketplace {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }
  }

  .search-section {
    background: white;
    padding: 20px 24px;
    border-radius: 8px;
    margin-bottom: 24px;
  }

  .section-title {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #262626;
  }

  .server-grid {
    margin-bottom: 24px;

    .server-card {
      border-radius: 8px;
      height: 100%;

      .server-header {
        margin-bottom: 12px;

        .server-name {
          display: flex;
          justify-content: space-between;
          align-items: center;

          h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
        }
      }

      .server-description {
        color: #595959;
        font-size: 13px;
        margin-bottom: 12px;
        min-height: 40px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .server-tags {
        margin-bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .server-actions {
        margin-top: auto;
      }
    }
  }

  .installed-section {
    .installed-list {
      background: white;
      border-radius: 8px;

      .installed-server-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
      }
    }
  }
}
</style>
