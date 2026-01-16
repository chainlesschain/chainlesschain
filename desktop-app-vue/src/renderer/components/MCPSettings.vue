<template>
  <div class="mcp-settings">
    <a-card title="MCP (Model Context Protocol) 服务器管理" :loading="loading">
      <!-- 概览统计 -->
      <a-row :gutter="16" style="margin-bottom: 24px">
        <a-col :span="6">
          <a-statistic title="可用服务器" :value="availableServers.length" />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="已连接"
            :value="connectedServers.length"
            :value-style="{ color: '#3f8600' }"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic title="可用工具" :value="totalTools" />
        </a-col>
        <a-col :span="6">
          <a-statistic title="总调用次数" :value="metrics.totalCalls" />
        </a-col>
      </a-row>

      <!-- 启用开关 -->
      <a-form layout="vertical">
        <a-form-item label="启用MCP系统">
          <a-switch
            v-model:checked="config.enabled"
            @change="handleEnableChange"
          />
          <div class="form-hint">
            启用后可以连接外部MCP服务器，扩展AI助手功能
          </div>
        </a-form-item>
      </a-form>

      <!-- 服务器列表 -->
      <a-divider orientation="left">服务器列表</a-divider>

      <a-table
        :columns="serverColumns"
        :data-source="serversWithStatus"
        :pagination="false"
        :loading="serversLoading"
        row-key="id"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <div>
              <strong>{{ record.name }}</strong>
              <a-tag
                :color="
                  record.vendor === '@modelcontextprotocol' ? 'blue' : 'default'
                "
                style="margin-left: 8px"
              >
                {{ record.vendor }}
              </a-tag>
            </div>
            <div style="font-size: 12px; color: rgba(0, 0, 0, 0.45)">
              {{ record.description }}
            </div>
          </template>

          <template v-else-if="column.key === 'status'">
            <a-tag v-if="record.isConnected" color="success">
              <check-circle-outlined /> 已连接
            </a-tag>
            <a-tag v-else color="default">
              <minus-circle-outlined /> 未连接
            </a-tag>
          </template>

          <template v-else-if="column.key === 'tools'">
            <span v-if="record.isConnected">
              {{ record.toolCount }} 个工具
            </span>
            <span v-else style="color: rgba(0, 0, 0, 0.25)">-</span>
          </template>

          <template v-else-if="column.key === 'security'">
            <a-tag :color="getSecurityColor(record.securityLevel)">
              {{ getSecurityLabel(record.securityLevel) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button
                v-if="!record.isConnected"
                type="primary"
                size="small"
                @click="handleConnect(record)"
                :loading="connectingServers.has(record.id)"
              >
                连接
              </a-button>
              <a-button
                v-else
                danger
                size="small"
                @click="handleDisconnect(record)"
                :loading="disconnectingServers.has(record.id)"
              >
                断开
              </a-button>

              <a-button size="small" @click="showServerConfig(record)">
                配置
              </a-button>

              <a-button
                v-if="record.isConnected"
                size="small"
                @click="showServerTools(record)"
              >
                工具
              </a-button>
            </a-space>
          </template>
        </template>
      </a-table>

      <!-- 性能指标 -->
      <a-divider orientation="left">性能指标</a-divider>

      <a-descriptions bordered :column="2">
        <a-descriptions-item label="总调用次数">
          {{ metrics.totalCalls }}
        </a-descriptions-item>
        <a-descriptions-item label="成功调用">
          {{ metrics.successfulCalls }}
        </a-descriptions-item>
        <a-descriptions-item label="成功率">
          {{
            metrics.totalCalls > 0
              ? ((metrics.successfulCalls / metrics.totalCalls) * 100).toFixed(
                  2,
                )
              : 0
          }}%
        </a-descriptions-item>
        <a-descriptions-item label="平均响应时间">
          {{ averageLatency }}ms
        </a-descriptions-item>
      </a-descriptions>
    </a-card>

    <!-- 服务器配置对话框 -->
    <a-modal
      v-model:open="configModalVisible"
      title="服务器配置"
      width="800px"
      @ok="handleSaveConfig"
      :confirm-loading="savingConfig"
    >
      <a-form layout="vertical" v-if="selectedServer">
        <a-form-item label="服务器ID">
          <a-input :value="selectedServer.id" disabled />
        </a-form-item>

        <a-form-item label="启用">
          <a-switch v-model:checked="serverConfig.enabled" />
        </a-form-item>

        <a-form-item label="自动连接">
          <a-switch v-model:checked="serverConfig.autoConnect" />
          <div class="form-hint">应用启动时自动连接此服务器</div>
        </a-form-item>

        <template v-if="selectedServer.id === 'filesystem'">
          <a-form-item label="根目录路径">
            <a-input
              v-model:value="serverConfig.rootPath"
              placeholder="D:\code\chainlesschain\data"
            />
            <div class="form-hint">服务器可访问的根目录（绝对路径）</div>
          </a-form-item>

          <a-form-item label="允许路径">
            <a-select
              v-model:value="serverConfig.permissions.allowedPaths"
              mode="tags"
              placeholder="输入允许访问的相对路径"
              style="width: 100%"
            >
              <a-select-option value="notes/">notes/</a-select-option>
              <a-select-option value="imports/">imports/</a-select-option>
              <a-select-option value="exports/">exports/</a-select-option>
              <a-select-option value="projects/">projects/</a-select-option>
            </a-select>
            <div class="form-hint">相对于根目录的允许访问路径</div>
          </a-form-item>

          <a-form-item label="禁止路径">
            <a-select
              v-model:value="serverConfig.permissions.forbiddenPaths"
              mode="tags"
              placeholder="输入禁止访问的路径"
              style="width: 100%"
            >
              <a-select-option value="chainlesschain.db"
                >chainlesschain.db</a-select-option
              >
              <a-select-option value="ukey/">ukey/</a-select-option>
              <a-select-option value="did/private-keys/"
                >did/private-keys/</a-select-option
              >
            </a-select>
          </a-form-item>

          <a-form-item label="只读模式">
            <a-switch v-model:checked="serverConfig.permissions.readOnly" />
          </a-form-item>
        </template>

        <template v-if="selectedServer.id === 'postgres'">
          <a-form-item label="数据库主机">
            <a-input v-model:value="serverConfig.connection.host" />
          </a-form-item>

          <a-form-item label="端口">
            <a-input-number
              v-model:value="serverConfig.connection.port"
              :min="1"
              :max="65535"
              style="width: 100%"
            />
          </a-form-item>

          <a-form-item label="数据库名">
            <a-input v-model:value="serverConfig.connection.database" />
          </a-form-item>

          <a-form-item label="用户名">
            <a-input v-model:value="serverConfig.connection.user" />
          </a-form-item>

          <a-form-item label="密码">
            <a-input-password
              v-model:value="serverConfig.connection.password"
            />
          </a-form-item>

          <a-form-item label="只读模式">
            <a-switch v-model:checked="serverConfig.permissions.readOnly" />
          </a-form-item>
        </template>
      </a-form>
    </a-modal>

    <!-- 工具列表对话框 -->
    <a-modal
      v-model:open="toolsModalVisible"
      :title="`${selectedServer?.name} - 可用工具`"
      width="900px"
      :footer="null"
    >
      <a-table
        :columns="toolColumns"
        :data-source="serverTools"
        :pagination="false"
        row-key="name"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <code style="color: #1890ff">{{ record.name }}</code>
          </template>

          <template v-if="column.key === 'actions'">
            <a-button size="small" @click="testTool(record)"> 测试 </a-button>
          </template>
        </template>
      </a-table>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  CheckCircleOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons-vue";

// 状态
const loading = ref(false);
const serversLoading = ref(false);
const availableServers = ref([]);
const connectedServers = ref([]);
const connectingServers = ref(new Set());
const disconnectingServers = ref(new Set());
const config = reactive({
  enabled: false,
});
const metrics = reactive({
  totalCalls: 0,
  successfulCalls: 0,
  toolCallLatencies: new Map(),
});

// 配置对话框
const configModalVisible = ref(false);
const savingConfig = ref(false);
const selectedServer = ref(null);
const serverConfig = reactive({
  enabled: false,
  autoConnect: false,
  rootPath: "",
  permissions: {
    allowedPaths: [],
    forbiddenPaths: [],
    readOnly: false,
  },
  connection: {
    host: "localhost",
    port: 5432,
    database: "",
    user: "",
    password: "",
  },
});

// 工具对话框
const toolsModalVisible = ref(false);
const serverTools = ref([]);

// 表格列定义
const serverColumns = [
  {
    title: "服务器名称",
    key: "name",
    width: 300,
  },
  {
    title: "状态",
    key: "status",
    width: 120,
  },
  {
    title: "工具数量",
    key: "tools",
    width: 100,
  },
  {
    title: "安全级别",
    key: "security",
    width: 120,
  },
  {
    title: "操作",
    key: "actions",
    width: 280,
  },
];

const toolColumns = [
  {
    title: "工具名称",
    dataIndex: "name",
    key: "name",
    width: 200,
  },
  {
    title: "描述",
    dataIndex: "description",
    key: "description",
  },
  {
    title: "操作",
    key: "actions",
    width: 100,
  },
];

// 计算属性
const serversWithStatus = computed(() => {
  return availableServers.value.map((server) => {
    const connectedServer = connectedServers.value.find(
      (s) => s.name === server.id,
    );
    return {
      ...server,
      isConnected: !!connectedServer,
      toolCount: connectedServer?.tools || 0,
    };
  });
});

const totalTools = computed(() => {
  return connectedServers.value.reduce(
    (sum, server) => sum + (server.tools || 0),
    0,
  );
});

const averageLatency = computed(() => {
  const latencies = Array.from(metrics.toolCallLatencies.values()).flat();
  if (latencies.length === 0) return 0;
  const sum = latencies.reduce((a, b) => a + b, 0);
  return (sum / latencies.length).toFixed(2);
});

// 方法
const loadAvailableServers = async () => {
  serversLoading.value = true;
  try {
    const result = await window.electronAPI.invoke("mcp:list-servers");
    if (result.success) {
      availableServers.value = result.servers;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("加载服务器列表失败:", error);
    message.error("加载服务器列表失败: " + error.message);
  } finally {
    serversLoading.value = false;
  }
};

const loadConnectedServers = async () => {
  try {
    const result = await window.electronAPI.invoke("mcp:get-connected-servers");
    if (result.success) {
      connectedServers.value = result.servers;
    }
  } catch (error) {
    console.error("加载连接状态失败:", error);
  }
};

const loadMetrics = async () => {
  try {
    const result = await window.electronAPI.invoke("mcp:get-metrics");
    if (result.success) {
      Object.assign(metrics, result.metrics);
    }
  } catch (error) {
    console.error("加载指标失败:", error);
  }
};

const loadConfig = async () => {
  loading.value = true;
  try {
    const result = await window.electronAPI.invoke("mcp:get-config");
    if (result.success) {
      config.enabled = result.config.enabled || false;
    }
  } catch (error) {
    console.error("加载配置失败:", error);
  } finally {
    loading.value = false;
  }
};

const handleEnableChange = async (enabled) => {
  try {
    const result = await window.electronAPI.invoke("mcp:update-config", {
      config: { ...config, enabled },
    });

    if (result.success) {
      message.success(enabled ? "MCP系统已启用" : "MCP系统已禁用");
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("更新配置失败:", error);
    message.error("更新配置失败: " + error.message);
    config.enabled = !enabled;
  }
};

const handleConnect = async (server) => {
  connectingServers.value.add(server.id);
  try {
    const result = await window.electronAPI.invoke("mcp:connect-server", {
      serverName: server.id,
      config: {}, // 使用默认配置
    });

    if (result.success) {
      message.success(`已连接到 ${server.name}`);
      await loadConnectedServers();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error(`连接 ${server.name} 失败:`, error);
    message.error(`连接失败: ${error.message}`);
  } finally {
    connectingServers.value.delete(server.id);
  }
};

const handleDisconnect = async (server) => {
  disconnectingServers.value.add(server.id);
  try {
    const result = await window.electronAPI.invoke("mcp:disconnect-server", {
      serverName: server.id,
    });

    if (result.success) {
      message.success(`已断开 ${server.name}`);
      await loadConnectedServers();
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error(`断开 ${server.name} 失败:`, error);
    message.error(`断开失败: ${error.message}`);
  } finally {
    disconnectingServers.value.delete(server.id);
  }
};

const showServerConfig = (server) => {
  selectedServer.value = server;

  // 加载服务器配置
  // TODO: 从后端加载实际配置

  configModalVisible.value = true;
};

const handleSaveConfig = async () => {
  savingConfig.value = true;
  try {
    // TODO: 保存配置到后端
    message.success("配置已保存");
    configModalVisible.value = false;
  } catch (error) {
    console.error("保存配置失败:", error);
    message.error("保存配置失败: " + error.message);
  } finally {
    savingConfig.value = false;
  }
};

const showServerTools = async (server) => {
  selectedServer.value = server;

  try {
    const result = await window.electronAPI.invoke("mcp:list-tools", {
      serverName: server.id,
    });

    if (result.success) {
      serverTools.value = result.tools;
      toolsModalVisible.value = true;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("加载工具列表失败:", error);
    message.error("加载工具列表失败: " + error.message);
  }
};

const testTool = (tool) => {
  message.info(`测试工具: ${tool.name} (功能开发中)`);
};

const getSecurityColor = (level) => {
  const colors = {
    low: "green",
    medium: "orange",
    high: "red",
  };
  return colors[level] || "default";
};

const getSecurityLabel = (level) => {
  const labels = {
    low: "低",
    medium: "中",
    high: "高",
  };
  return labels[level] || level;
};

// 生命周期
onMounted(async () => {
  await loadConfig();
  await loadAvailableServers();
  await loadConnectedServers();
  await loadMetrics();

  // 定期刷新连接状态和指标
  setInterval(() => {
    loadConnectedServers();
    loadMetrics();
  }, 5000);
});
</script>

<style scoped>
.mcp-settings {
  height: 100%;
}

.mcp-settings :deep(.ant-card) {
  max-width: 1200px;
}

.form-hint {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-top: 4px;
}
</style>
