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

    <!-- 服务器配置对话框（增强版） -->
    <a-modal
      v-model:open="configModalVisible"
      :title="`配置: ${selectedServer?.name || ''}`"
      width="900px"
      @ok="handleSaveConfig"
      :confirm-loading="savingConfig"
    >
      <div v-if="selectedServer">
        <!-- 编辑模式切换 -->
        <a-radio-group
          v-model:value="configEditMode"
          button-style="solid"
          style="margin-bottom: 16px"
        >
          <a-radio-button value="form">可视化表单</a-radio-button>
          <a-radio-button value="json">JSON编辑器</a-radio-button>
        </a-radio-group>

        <!-- JSON编辑器模式 -->
        <div v-show="configEditMode === 'json'">
          <a-textarea
            v-model:value="serverConfigJson"
            :rows="20"
            placeholder="输入服务器配置JSON"
            style="font-family: &quot;Courier New&quot;, monospace"
          />
          <a-alert
            v-if="jsonError"
            type="error"
            :message="jsonError"
            style="margin-top: 8px"
            closable
            @close="jsonError = ''"
          />
        </div>

        <!-- 可视化表单模式 -->
        <a-form layout="vertical" v-show="configEditMode === 'form'">
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

          <a-form-item label="传输方式">
            <a-radio-group v-model:value="serverConfig.transport">
              <a-radio value="stdio">Stdio（本地进程）</a-radio>
              <a-radio value="http-sse">HTTP+SSE（远程服务）</a-radio>
            </a-radio-group>
            <div class="form-hint">
              Stdio适用于本地MCP服务器，HTTP+SSE适用于远程或Web服务
            </div>
          </a-form-item>

          <!-- HTTP+SSE传输配置 -->
          <template v-if="serverConfig.transport === 'http-sse'">
            <a-divider>HTTP+SSE配置</a-divider>

            <a-form-item label="服务器URL" required>
              <a-input
                v-model:value="serverConfig.baseURL"
                placeholder="http://localhost:3000"
              />
            </a-form-item>

            <a-form-item label="API密钥">
              <a-input-password v-model:value="serverConfig.apiKey" />
            </a-form-item>

            <a-form-item label="使用SSL">
              <a-switch v-model:checked="serverConfig.useSSL" />
            </a-form-item>

            <a-form-item label="超时时间（毫秒）">
              <a-input-number
                v-model:value="serverConfig.timeout"
                :min="1000"
                :max="300000"
                :step="1000"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- Filesystem服务器配置 -->
          <template v-if="selectedServer.id === 'filesystem'">
            <a-divider>文件系统配置</a-divider>

            <a-form-item label="根目录路径" required>
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
              <div class="form-hint">相对于根目录的允许访问路径（白名单）</div>
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
                <a-select-option value="p2p/keys/">p2p/keys/</a-select-option>
              </a-select>
              <div class="form-hint">
                永久禁止访问的路径（黑名单，优先级高于白名单）
              </div>
            </a-form-item>

            <a-form-item label="只读模式">
              <a-switch v-model:checked="serverConfig.permissions.readOnly" />
              <div class="form-hint">
                启用后只允许读取文件，不允许写入或删除
              </div>
            </a-form-item>

            <a-form-item label="最大文件大小（MB）">
              <a-input-number
                v-model:value="serverConfig.permissions.maxFileSizeMB"
                :min="1"
                :max="1024"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- PostgreSQL服务器配置 -->
          <template v-if="selectedServer.id === 'postgres'">
            <a-divider>数据库连接</a-divider>

            <a-form-item label="数据库主机" required>
              <a-input v-model:value="serverConfig.connection.host" />
            </a-form-item>

            <a-form-item label="端口" required>
              <a-input-number
                v-model:value="serverConfig.connection.port"
                :min="1"
                :max="65535"
                style="width: 100%"
              />
            </a-form-item>

            <a-form-item label="数据库名" required>
              <a-input v-model:value="serverConfig.connection.database" />
            </a-form-item>

            <a-form-item label="用户名" required>
              <a-input v-model:value="serverConfig.connection.user" />
            </a-form-item>

            <a-form-item label="密码" required>
              <a-input-password
                v-model:value="serverConfig.connection.password"
              />
              <div class="form-hint">支持环境变量，如 ${DB_PASSWORD}</div>
            </a-form-item>

            <a-divider>权限配置</a-divider>

            <a-form-item label="允许的Schema">
              <a-select
                v-model:value="serverConfig.permissions.allowedSchemas"
                mode="tags"
                placeholder="输入允许访问的schema"
                style="width: 100%"
              >
                <a-select-option value="public">public</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="禁止的表">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenTables"
                mode="tags"
                placeholder="输入禁止访问的表名"
                style="width: 100%"
              >
                <a-select-option value="users">users</a-select-option>
                <a-select-option value="credentials"
                  >credentials</a-select-option
                >
                <a-select-option value="api_keys">api_keys</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="只读模式">
              <a-switch v-model:checked="serverConfig.permissions.readOnly" />
              <div class="form-hint">启用后只允许SELECT查询</div>
            </a-form-item>

            <a-form-item label="最大结果行数">
              <a-input-number
                v-model:value="serverConfig.permissions.maxResultRows"
                :min="1"
                :max="10000"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- SQLite服务器配置 -->
          <template v-if="selectedServer.id === 'sqlite'">
            <a-divider>数据库配置</a-divider>

            <a-form-item label="数据库路径" required>
              <a-input
                v-model:value="serverConfig.databasePath"
                placeholder="D:\code\chainlesschain\data\app.db"
              />
              <div class="form-hint">SQLite数据库文件的绝对路径</div>
            </a-form-item>

            <a-divider>权限配置</a-divider>

            <a-form-item label="允许的表">
              <a-select
                v-model:value="serverConfig.permissions.allowedTables"
                mode="tags"
                placeholder="输入允许访问的表名"
                style="width: 100%"
              >
                <a-select-option value="notes">notes</a-select-option>
                <a-select-option value="tags">tags</a-select-option>
                <a-select-option value="bookmarks">bookmarks</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="禁止的表">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenTables"
                mode="tags"
                placeholder="输入禁止访问的表名"
                style="width: 100%"
              >
                <a-select-option value="users">users</a-select-option>
                <a-select-option value="credentials"
                  >credentials</a-select-option
                >
                <a-select-option value="private_keys"
                  >private_keys</a-select-option
                >
              </a-select>
            </a-form-item>

            <a-form-item label="只读模式">
              <a-switch v-model:checked="serverConfig.permissions.readOnly" />
              <div class="form-hint">启用后只允许SELECT查询</div>
            </a-form-item>

            <a-form-item label="启用全文搜索(FTS)">
              <a-switch v-model:checked="serverConfig.features.enableFTS" />
            </a-form-item>

            <a-form-item label="启用JSON扩展">
              <a-switch v-model:checked="serverConfig.features.enableJSON" />
            </a-form-item>

            <a-form-item label="最大结果行数">
              <a-input-number
                v-model:value="serverConfig.permissions.maxResultRows"
                :min="1"
                :max="10000"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- Git服务器配置 -->
          <template v-if="selectedServer.id === 'git'">
            <a-divider>仓库配置</a-divider>

            <a-form-item label="仓库路径" required>
              <a-input
                v-model:value="serverConfig.repositoryPath"
                placeholder="D:\code\chainlesschain"
              />
              <div class="form-hint">Git仓库的绝对路径</div>
            </a-form-item>

            <a-divider>权限配置</a-divider>

            <a-form-item label="允许的操作">
              <a-select
                v-model:value="serverConfig.permissions.allowedOperations"
                mode="multiple"
                placeholder="选择允许的Git操作"
                style="width: 100%"
              >
                <a-select-option value="status"
                  >status（查看状态）</a-select-option
                >
                <a-select-option value="log">log（查看历史）</a-select-option>
                <a-select-option value="diff">diff（查看差异）</a-select-option>
                <a-select-option value="show">show（查看提交）</a-select-option>
                <a-select-option value="branch"
                  >branch（分支管理）</a-select-option
                >
                <a-select-option value="commit">commit（提交）</a-select-option>
                <a-select-option value="push">push（推送）</a-select-option>
                <a-select-option value="pull">pull（拉取）</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="只读模式">
              <a-switch v-model:checked="serverConfig.permissions.readOnly" />
              <div class="form-hint">
                启用后只允许只读操作（status, log, diff, show）
              </div>
            </a-form-item>

            <a-form-item label="启用提交">
              <a-switch v-model:checked="serverConfig.features.enableCommits" />
            </a-form-item>

            <a-form-item label="启用推送">
              <a-switch v-model:checked="serverConfig.features.enablePush" />
            </a-form-item>

            <a-form-item label="启用分支操作">
              <a-switch
                v-model:checked="serverConfig.features.enableBranching"
              />
            </a-form-item>
          </template>

          <!-- Fetch服务器配置 -->
          <template v-if="selectedServer.id === 'fetch'">
            <a-divider>HTTP配置</a-divider>

            <a-form-item label="允许的域名">
              <a-select
                v-model:value="serverConfig.permissions.allowedDomains"
                mode="tags"
                placeholder="输入允许访问的域名"
                style="width: 100%"
              >
                <a-select-option value="api.example.com"
                  >api.example.com</a-select-option
                >
              </a-select>
              <div class="form-hint">留空表示允许所有域名</div>
            </a-form-item>

            <a-form-item label="禁止的域名">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenDomains"
                mode="tags"
                placeholder="输入禁止访问的域名"
                style="width: 100%"
              >
                <a-select-option value="localhost">localhost</a-select-option>
                <a-select-option value="127.0.0.1">127.0.0.1</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="允许的HTTP方法">
              <a-checkbox-group
                v-model:value="serverConfig.permissions.allowedMethods"
              >
                <a-checkbox value="GET">GET</a-checkbox>
                <a-checkbox value="POST">POST</a-checkbox>
                <a-checkbox value="PUT">PUT</a-checkbox>
                <a-checkbox value="DELETE">DELETE</a-checkbox>
                <a-checkbox value="PATCH">PATCH</a-checkbox>
              </a-checkbox-group>
            </a-form-item>

            <a-form-item label="请求超时（秒）">
              <a-input-number
                v-model:value="serverConfig.timeout"
                :min="1"
                :max="300"
                style="width: 100%"
              />
            </a-form-item>
          </template>

          <!-- 配置模板 -->
          <a-divider>快速配置</a-divider>
          <a-space>
            <a-button @click="loadConfigTemplate('safe')">
              <lock-outlined /> 安全模板（只读）
            </a-button>
            <a-button @click="loadConfigTemplate('development')">
              <code-outlined /> 开发模板（读写）
            </a-button>
            <a-button @click="loadConfigTemplate('default')">
              <reload-outlined /> 恢复默认
            </a-button>
          </a-space>
        </a-form>
      </div>
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
import { ref, reactive, computed, onMounted, watch, toRaw } from "vue";
import { message } from "ant-design-vue";
import {
  CheckCircleOutlined,
  MinusCircleOutlined,
  LockOutlined,
  CodeOutlined,
  ReloadOutlined,
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

// 用户数据路径（用于默认配置）
const userDataPath = ref("");
const projectPath = ref("");

// 配置对话框
const configModalVisible = ref(false);
const configEditMode = ref("form"); // 'form' | 'json'
const savingConfig = ref(false);
const selectedServer = ref(null);
const serverConfigJson = ref("");
const jsonError = ref("");

// 默认配置结构
const getDefaultConfig = (serverId) => {
  const baseConfig = {
    enabled: false,
    autoConnect: false,
    transport: "stdio",
    timeout: 30000,
  };

  // 计算默认路径
  const dataPath = userDataPath.value
    ? `${userDataPath.value}/data`.replace(/\\/g, "/")
    : "";
  const dbPath = dataPath ? `${dataPath}/chainlesschain.db` : "";

  switch (serverId) {
    case "filesystem":
      return {
        ...baseConfig,
        rootPath: dataPath,
        permissions: {
          allowedPaths: ["notes/", "imports/", "exports/", "projects/"],
          forbiddenPaths: [
            "chainlesschain.db",
            "ukey/",
            "did/private-keys/",
            "p2p/keys/",
          ],
          readOnly: false,
          maxFileSizeMB: 100,
        },
      };
    case "postgres":
      return {
        ...baseConfig,
        connection: {
          host: "localhost",
          port: 5432,
          database: "chainlesschain",
          user: "chainlesschain",
          password: "",
        },
        permissions: {
          allowedSchemas: ["public"],
          forbiddenTables: ["users", "credentials", "api_keys"],
          readOnly: true,
          maxResultRows: 1000,
        },
      };
    case "sqlite":
      return {
        ...baseConfig,
        databasePath: dbPath,
        permissions: {
          allowedTables: [
            "notes",
            "tags",
            "bookmarks",
            "projects",
            "project_categories",
            "chat_conversations",
            "knowledge_base",
          ],
          forbiddenTables: [
            "did_identities",
            "p2p_keys",
            "ukey_data",
            "credentials",
          ],
          readOnly: true,
          maxResultRows: 1000,
        },
        features: {
          enableFTS: true,
          enableJSON: true,
        },
      };
    case "git":
      return {
        ...baseConfig,
        repositoryPath: projectPath.value || "",
        permissions: {
          allowedOperations: ["status", "log", "diff", "show"],
          readOnly: true,
        },
        features: {
          enableCommits: false,
          enablePush: false,
          enableBranching: false,
        },
      };
    case "fetch":
      return {
        ...baseConfig,
        permissions: {
          allowedDomains: [],
          forbiddenDomains: ["localhost", "127.0.0.1"],
          allowedMethods: ["GET", "POST"],
        },
        timeout: 30,
      };
    default:
      return baseConfig;
  }
};

const serverConfig = reactive(getDefaultConfig("filesystem"));

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

// 监听配置模式切换
watch(configEditMode, (newMode) => {
  if (newMode === "json") {
    // 切换到JSON模式，序列化当前配置
    serverConfigJson.value = JSON.stringify(serverConfig, null, 2);
  } else {
    // 切换到表单模式，尝试解析JSON
    try {
      const parsed = JSON.parse(serverConfigJson.value);
      Object.assign(serverConfig, parsed);
      jsonError.value = "";
    } catch (error) {
      jsonError.value = "JSON格式错误: " + error.message;
    }
  }
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

const loadServerConfig = async (serverId) => {
  try {
    const result = await window.electronAPI.invoke("mcp:get-server-config", {
      serverName: serverId,
    });

    if (result.success && result.config) {
      // 合并加载的配置
      const defaultConfig = getDefaultConfig(serverId);
      Object.assign(serverConfig, defaultConfig, result.config);
    } else {
      // 使用默认配置
      Object.assign(serverConfig, getDefaultConfig(serverId));
    }
  } catch (error) {
    console.error("加载服务器配置失败:", error);
    // 使用默认配置
    Object.assign(serverConfig, getDefaultConfig(serverId));
  }
};

const handleEnableChange = async (enabled) => {
  try {
    const result = await window.electronAPI.invoke("mcp:update-config", {
      config: { ...toRaw(config), enabled },
    });

    if (result.success) {
      if (enabled) {
        message.success("MCP系统已启用，请重启应用以加载 MCP 服务");
      } else {
        message.success("MCP系统已禁用");
      }
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
  // 检查 MCP 系统是否启用
  if (!config.enabled) {
    message.warning("请先启用 MCP 系统");
    return;
  }

  connectingServers.value.add(server.id);
  try {
    // 加载服务器配置
    await loadServerConfig(server.id);

    const result = await window.electronAPI.invoke("mcp:connect-server", {
      serverName: server.id,
      config: JSON.parse(JSON.stringify(toRaw(serverConfig))),
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

const showServerConfig = async (server) => {
  selectedServer.value = server;

  // 加载服务器实际配置
  await loadServerConfig(server.id);

  configModalVisible.value = true;
};

const handleSaveConfig = async () => {
  savingConfig.value = true;
  try {
    // 如果是JSON模式，先验证并解析
    if (configEditMode.value === "json") {
      try {
        const parsed = JSON.parse(serverConfigJson.value);
        Object.assign(serverConfig, parsed);
        jsonError.value = "";
      } catch (error) {
        jsonError.value = "JSON格式错误: " + error.message;
        savingConfig.value = false;
        return;
      }
    }

    // 验证必填项
    if (selectedServer.value.id === "filesystem" && !serverConfig.rootPath) {
      message.error("请输入根目录路径");
      savingConfig.value = false;
      return;
    }

    if (selectedServer.value.id === "sqlite" && !serverConfig.databasePath) {
      message.error("请输入数据库路径");
      savingConfig.value = false;
      return;
    }

    if (selectedServer.value.id === "git" && !serverConfig.repositoryPath) {
      message.error("请输入仓库路径");
      savingConfig.value = false;
      return;
    }

    // 保存配置到后端
    const result = await window.electronAPI.invoke("mcp:update-server-config", {
      serverName: selectedServer.value.id,
      config: JSON.parse(JSON.stringify(toRaw(serverConfig))),
    });

    if (result.success) {
      message.success("配置已保存");
      configModalVisible.value = false;
    } else {
      throw new Error(result.error);
    }
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

const loadConfigTemplate = (templateType) => {
  const serverId = selectedServer.value.id;
  let templateConfig = getDefaultConfig(serverId);

  if (templateType === "safe") {
    // 安全模板：只读模式
    if (templateConfig.permissions) {
      templateConfig.permissions.readOnly = true;
    }
    if (templateConfig.features) {
      templateConfig.features.enableCommits = false;
      templateConfig.features.enablePush = false;
    }
    message.success("已应用安全模板（只读模式）");
  } else if (templateType === "development") {
    // 开发模板：读写模式
    if (templateConfig.permissions) {
      templateConfig.permissions.readOnly = false;
    }
    if (templateConfig.features) {
      templateConfig.features.enableCommits = true;
      templateConfig.features.enablePush = true;
    }
    message.success("已应用开发模板（读写模式）");
  } else {
    // 默认模板
    message.success("已恢复默认配置");
  }

  Object.assign(serverConfig, templateConfig);

  // 同步到JSON
  if (configEditMode.value === "json") {
    serverConfigJson.value = JSON.stringify(serverConfig, null, 2);
  }
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
  // 获取用户数据路径用于默认配置
  try {
    const result = await window.electronAPI.invoke(
      "system:get-path",
      "userData",
    );
    if (result.success) {
      userDataPath.value = result.path;
    }
    // 获取项目路径（当前工作目录）
    const cwd = await window.electronAPI.invoke("system:get-path", "exe");
    if (cwd.success) {
      // exe 路径的父目录通常是项目目录
      projectPath.value = cwd.path.replace(/[/\\][^/\\]+$/, "");
    }
  } catch (error) {
    console.error("获取路径失败:", error);
  }

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
