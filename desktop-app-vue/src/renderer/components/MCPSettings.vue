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

      <!-- MCP禁用警告 -->
      <a-alert
        v-if="!config.enabled"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
        message="MCP系统已禁用"
        description="请先开启上方的「启用MCP系统」开关，然后重启应用后才能连接服务器。"
      />

      <!-- 服务器列表 -->
      <a-divider orientation="left"> 服务器列表 </a-divider>

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
            <a-tag v-else-if="record.serverState === 'error'" color="error">
              <minus-circle-outlined /> 连接错误
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
                :loading="connectingServers.has(record.id)"
                :disabled="!config.enabled"
                :title="!config.enabled ? '请先启用MCP系统' : ''"
                @click="handleConnect(record)"
              >
                连接
              </a-button>
              <a-button
                v-else
                danger
                size="small"
                :loading="disconnectingServers.has(record.id)"
                @click="handleDisconnect(record)"
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
      <a-divider orientation="left"> 性能指标 </a-divider>

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
      :confirm-loading="savingConfig"
      @ok="handleSaveConfig"
    >
      <div v-if="selectedServer">
        <!-- 编辑模式切换 -->
        <a-radio-group
          v-model:value="configEditMode"
          button-style="solid"
          style="margin-bottom: 16px"
        >
          <a-radio-button value="form"> 可视化表单 </a-radio-button>
          <a-radio-button value="json"> JSON编辑器 </a-radio-button>
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
        <a-form v-show="configEditMode === 'form'" layout="vertical">
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
              <a-radio value="stdio"> Stdio（本地进程） </a-radio>
              <a-radio value="http-sse"> HTTP+SSE（远程服务） </a-radio>
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
                <a-select-option value="notes/"> notes/ </a-select-option>
                <a-select-option value="imports/"> imports/ </a-select-option>
                <a-select-option value="exports/"> exports/ </a-select-option>
                <a-select-option value="projects/"> projects/ </a-select-option>
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
                <a-select-option value="chainlesschain.db">
                  chainlesschain.db
                </a-select-option>
                <a-select-option value="ukey/"> ukey/ </a-select-option>
                <a-select-option value="did/private-keys/">
                  did/private-keys/
                </a-select-option>
                <a-select-option value="p2p/keys/"> p2p/keys/ </a-select-option>
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
                <a-select-option value="public"> public </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="禁止的表">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenTables"
                mode="tags"
                placeholder="输入禁止访问的表名"
                style="width: 100%"
              >
                <a-select-option value="users"> users </a-select-option>
                <a-select-option value="credentials">
                  credentials
                </a-select-option>
                <a-select-option value="api_keys"> api_keys </a-select-option>
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
                <a-select-option value="notes"> notes </a-select-option>
                <a-select-option value="tags"> tags </a-select-option>
                <a-select-option value="bookmarks"> bookmarks </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="禁止的表">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenTables"
                mode="tags"
                placeholder="输入禁止访问的表名"
                style="width: 100%"
              >
                <a-select-option value="users"> users </a-select-option>
                <a-select-option value="credentials">
                  credentials
                </a-select-option>
                <a-select-option value="private_keys">
                  private_keys
                </a-select-option>
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
                <a-select-option value="status">
                  status（查看状态）
                </a-select-option>
                <a-select-option value="log"> log（查看历史） </a-select-option>
                <a-select-option value="diff">
                  diff（查看差异）
                </a-select-option>
                <a-select-option value="show">
                  show（查看提交）
                </a-select-option>
                <a-select-option value="branch">
                  branch（分支管理）
                </a-select-option>
                <a-select-option value="commit">
                  commit（提交）
                </a-select-option>
                <a-select-option value="push"> push（推送） </a-select-option>
                <a-select-option value="pull"> pull（拉取） </a-select-option>
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
                <a-select-option value="api.example.com">
                  api.example.com
                </a-select-option>
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
                <a-select-option value="localhost"> localhost </a-select-option>
                <a-select-option value="127.0.0.1"> 127.0.0.1 </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="允许的HTTP方法">
              <a-checkbox-group
                v-model:value="serverConfig.permissions.allowedMethods"
              >
                <a-checkbox value="GET"> GET </a-checkbox>
                <a-checkbox value="POST"> POST </a-checkbox>
                <a-checkbox value="PUT"> PUT </a-checkbox>
                <a-checkbox value="DELETE"> DELETE </a-checkbox>
                <a-checkbox value="PATCH"> PATCH </a-checkbox>
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

          <!-- GitHub服务器配置 -->
          <template v-if="selectedServer.id === 'github'">
            <a-divider>认证配置</a-divider>

            <a-form-item label="Personal Access Token" required>
              <a-input-password
                v-model:value="serverConfig.authentication.personalAccessToken"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              />
              <div class="form-hint">
                从 GitHub Settings → Developer settings → Personal access tokens
                获取
              </div>
            </a-form-item>

            <a-divider>权限配置</a-divider>

            <a-form-item label="允许的仓库">
              <a-select
                v-model:value="serverConfig.permissions.allowedRepos"
                mode="tags"
                placeholder="owner/repo 格式，留空表示所有仓库"
                style="width: 100%"
              />
              <div class="form-hint">
                格式：owner/repo，例如：facebook/react
              </div>
            </a-form-item>

            <a-form-item label="禁止的仓库">
              <a-select
                v-model:value="serverConfig.permissions.forbiddenRepos"
                mode="tags"
                placeholder="输入禁止访问的仓库"
                style="width: 100%"
              />
            </a-form-item>

            <a-form-item label="允许的操作">
              <a-checkbox-group
                v-model:value="serverConfig.permissions.allowedOperations"
              >
                <a-checkbox value="read_repo"> 读取仓库 </a-checkbox>
                <a-checkbox value="read_issues"> 读取Issues </a-checkbox>
                <a-checkbox value="write_issues"> 创建/编辑Issues </a-checkbox>
                <a-checkbox value="read_pulls"> 读取PR </a-checkbox>
                <a-checkbox value="write_pulls"> 创建/编辑PR </a-checkbox>
                <a-checkbox value="read_actions"> 读取Actions </a-checkbox>
              </a-checkbox-group>
            </a-form-item>

            <a-form-item label="只读模式">
              <a-switch v-model:checked="serverConfig.permissions.readOnly" />
              <span style="margin-left: 8px; color: #666">
                开启后只允许读取操作
              </span>
            </a-form-item>

            <a-divider>功能选项</a-divider>

            <a-form-item label="启用搜索">
              <a-switch v-model:checked="serverConfig.features.enableSearch" />
            </a-form-item>

            <a-form-item label="启用Gist">
              <a-switch v-model:checked="serverConfig.features.enableGists" />
            </a-form-item>

            <a-form-item label="启用组织">
              <a-switch
                v-model:checked="serverConfig.features.enableOrganizations"
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

    <!-- 工具测试对话框 -->
    <a-modal
      v-model:open="toolTestModalVisible"
      :title="`测试工具: ${selectedTool?.name || ''}`"
      width="800px"
      :confirm-loading="toolTestLoading"
      ok-text="执行"
      cancel-text="取消"
      @ok="executeToolTest"
    >
      <div v-if="selectedTool">
        <!-- 工具描述 -->
        <a-alert
          :message="selectedTool.description || '无描述'"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <!-- 参数输入表单 -->
        <a-form layout="vertical">
          <template v-if="toolParameters.length > 0">
            <a-divider orientation="left"> 参数输入 </a-divider>

            <template v-for="param in toolParameters" :key="param.name">
              <!-- 字符串参数 -->
              <a-form-item
                v-if="param.type === 'string'"
                :label="param.name"
                :required="param.required"
              >
                <a-textarea
                  v-if="param.multiline"
                  v-model:value="toolTestArgs[param.name]"
                  :placeholder="param.description || `请输入 ${param.name}`"
                  :rows="4"
                />
                <a-input
                  v-else
                  v-model:value="toolTestArgs[param.name]"
                  :placeholder="param.description || `请输入 ${param.name}`"
                />
                <div v-if="param.description" class="form-hint">
                  {{ param.description }}
                </div>
              </a-form-item>

              <!-- 数字参数 -->
              <a-form-item
                v-else-if="param.type === 'number' || param.type === 'integer'"
                :label="param.name"
                :required="param.required"
              >
                <a-input-number
                  v-model:value="toolTestArgs[param.name]"
                  :placeholder="param.description || `请输入 ${param.name}`"
                  style="width: 100%"
                />
                <div v-if="param.description" class="form-hint">
                  {{ param.description }}
                </div>
              </a-form-item>

              <!-- 布尔参数 -->
              <a-form-item
                v-else-if="param.type === 'boolean'"
                :label="param.name"
                :required="param.required"
              >
                <a-switch v-model:checked="toolTestArgs[param.name]" />
                <div v-if="param.description" class="form-hint">
                  {{ param.description }}
                </div>
              </a-form-item>

              <!-- 枚举参数 -->
              <a-form-item
                v-else-if="param.enum && param.enum.length > 0"
                :label="param.name"
                :required="param.required"
              >
                <a-select
                  v-model:value="toolTestArgs[param.name]"
                  :placeholder="param.description || `请选择 ${param.name}`"
                  style="width: 100%"
                >
                  <a-select-option
                    v-for="opt in param.enum"
                    :key="opt"
                    :value="opt"
                  >
                    {{ opt }}
                  </a-select-option>
                </a-select>
                <div v-if="param.description" class="form-hint">
                  {{ param.description }}
                </div>
              </a-form-item>

              <!-- 数组参数 -->
              <a-form-item
                v-else-if="param.type === 'array'"
                :label="param.name"
                :required="param.required"
              >
                <a-select
                  v-model:value="toolTestArgs[param.name]"
                  mode="tags"
                  :placeholder="
                    param.description ||
                    `请输入 ${param.name} (多个值用回车分隔)`
                  "
                  style="width: 100%"
                />
                <div v-if="param.description" class="form-hint">
                  {{ param.description }}
                </div>
              </a-form-item>

              <!-- 对象或其他复杂类型 -->
              <a-form-item
                v-else
                :label="param.name"
                :required="param.required"
              >
                <a-textarea
                  v-model:value="toolTestArgs[param.name]"
                  :placeholder="`请输入 JSON 格式的 ${param.name}`"
                  :rows="3"
                />
                <div class="form-hint">
                  {{
                    param.description || `类型: ${param.type}，请输入 JSON 格式`
                  }}
                </div>
              </a-form-item>
            </template>
          </template>

          <a-empty v-else description="此工具无需参数" style="margin: 16px 0" />

          <!-- JSON模式切换 -->
          <a-divider orientation="left">
            <a-switch
              v-model:checked="toolTestJsonMode"
              size="small"
              style="margin-right: 8px"
            />
            JSON 编辑模式
          </a-divider>

          <a-textarea
            v-if="toolTestJsonMode"
            v-model:value="toolTestArgsJson"
            :rows="6"
            placeholder='{"param1": "value1", "param2": "value2"}'
            style="font-family: &quot;Courier New&quot;, monospace"
          />
          <a-alert
            v-if="toolTestJsonError"
            type="error"
            :message="toolTestJsonError"
            style="margin-top: 8px"
            closable
            @close="toolTestJsonError = ''"
          />
        </a-form>

        <!-- 执行结果 -->
        <template v-if="toolTestResult !== null">
          <a-divider orientation="left"> 执行结果 </a-divider>

          <a-alert
            v-if="toolTestResult.success"
            type="success"
            message="执行成功"
            style="margin-bottom: 12px"
            show-icon
          />
          <a-alert
            v-else
            type="error"
            :message="toolTestResult.error || '执行失败'"
            style="margin-bottom: 12px"
            show-icon
          />

          <div class="tool-result-container">
            <pre class="tool-result">{{
              formatToolResult(toolTestResult)
            }}</pre>
          </div>

          <a-space style="margin-top: 12px">
            <a-button size="small" @click="copyToolResult">
              <copy-outlined /> 复制结果
            </a-button>
            <a-button size="small" @click="clearToolResult">
              <delete-outlined /> 清除结果
            </a-button>
          </a-space>
        </template>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from "@/utils/logger";

import {
  ref,
  reactive,
  computed,
  onMounted,
  onUnmounted,
  watch,
  toRaw,
} from "vue";
import { message } from "ant-design-vue";
import {
  CheckCircleOutlined,
  MinusCircleOutlined,
  LockOutlined,
  CodeOutlined,
  ReloadOutlined,
  CopyOutlined,
  DeleteOutlined,
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
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          dataPath || ".",
        ],
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
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres"],
        connection: {
          host: "localhost",
          port: 5432,
          database: "chainlesschain",
          user: "chainlesschain",
          password: "chainlesschain_pwd_2024",
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
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sqlite", dbPath || ""],
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
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-git"],
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
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-fetch"],
        permissions: {
          allowedDomains: [],
          forbiddenDomains: ["localhost", "127.0.0.1"],
          allowedMethods: ["GET", "POST"],
        },
        timeout: 30,
      };
    case "github":
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        authentication: {
          personalAccessToken: "",
        },
        permissions: {
          allowedRepos: [],
          forbiddenRepos: [],
          allowedOperations: [
            "read_repo",
            "read_issues",
            "read_pulls",
            "read_actions",
          ],
          readOnly: true,
        },
        features: {
          enableSearch: true,
          enableGists: false,
          enableOrganizations: false,
        },
      };
    default:
      return {
        ...baseConfig,
        command: "npx",
        args: ["-y", `@modelcontextprotocol/server-${serverId}`],
      };
  }
};

const serverConfig = reactive(getDefaultConfig("filesystem"));

// 工具对话框
const toolsModalVisible = ref(false);
const serverTools = ref([]);

// 工具测试对话框状态
const toolTestModalVisible = ref(false);
const selectedTool = ref(null);
const toolTestLoading = ref(false);
const toolTestArgs = reactive({});
const toolTestArgsJson = ref("{}");
const toolTestJsonMode = ref(false);
const toolTestJsonError = ref("");
const toolTestResult = ref(null);

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
    // Only consider connected if server exists AND state is 'connected' (not 'error')
    const isActuallyConnected =
      connectedServer && connectedServer.state === "connected";
    return {
      ...server,
      isConnected: isActuallyConnected,
      serverState: connectedServer?.state || null,
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
  if (latencies.length === 0) {
    return 0;
  }
  const sum = latencies.reduce((a, b) => a + b, 0);
  return (sum / latencies.length).toFixed(2);
});

// 解析工具参数定义
const toolParameters = computed(() => {
  if (!selectedTool.value?.inputSchema?.properties) {
    return [];
  }

  const schema = selectedTool.value.inputSchema;
  const required = schema.required || [];

  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: prop.type || "string",
    description: prop.description || "",
    required: required.includes(name),
    enum: prop.enum || null,
    default: prop.default,
    multiline: prop.format === "multiline" || name.includes("content"),
  }));
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

// 监听工具测试JSON模式切换
watch(toolTestJsonMode, (newMode) => {
  if (newMode) {
    // 切换到JSON模式，序列化当前参数
    const cleanArgs = {};
    for (const [key, value] of Object.entries(toolTestArgs)) {
      if (value !== "" && value !== undefined && value !== null) {
        cleanArgs[key] = value;
      }
    }
    toolTestArgsJson.value = JSON.stringify(cleanArgs, null, 2);
  } else {
    // 切换到表单模式，尝试解析JSON
    try {
      const parsed = JSON.parse(toolTestArgsJson.value);
      Object.keys(toolTestArgs).forEach((key) => delete toolTestArgs[key]);
      Object.assign(toolTestArgs, parsed);
      toolTestJsonError.value = "";
    } catch (error) {
      toolTestJsonError.value = "JSON格式错误: " + error.message;
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
    logger.error("加载服务器列表失败:", error);
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
    logger.error("加载连接状态失败:", error);
  }
};

const loadMetrics = async () => {
  try {
    const result = await window.electronAPI.invoke("mcp:get-metrics");
    if (result.success) {
      Object.assign(metrics, result.metrics);
    }
  } catch (error) {
    logger.error("加载指标失败:", error);
  }
};

const loadConfig = async () => {
  loading.value = true;
  try {
    if (!window.electronAPI?.invoke) {
      return;
    }
    const result = await window.electronAPI.invoke("mcp:get-config");
    if (result?.success) {
      config.enabled = result.config?.enabled || false;
    }
  } catch (error) {
    // IPC 未就绪时静默处理
    if (!error.message?.includes("No handler registered")) {
      logger.error("[MCPSettings] 加载配置失败:", error);
    }
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
    logger.error("加载服务器配置失败:", error);
    // 使用默认配置
    Object.assign(serverConfig, getDefaultConfig(serverId));
  }
};

const handleEnableChange = async (enabled) => {
  try {
    if (!window.electronAPI?.invoke) {
      message.warning("IPC 通道未就绪，请稍后重试");
      config.enabled = !enabled;
      return;
    }
    const result = await window.electronAPI.invoke("mcp:update-config", {
      config: { ...toRaw(config), enabled },
    });

    if (result?.success) {
      if (enabled) {
        message.success("MCP系统已启用，请重启应用以加载 MCP 服务");
      } else {
        message.success("MCP系统已禁用");
      }
    } else {
      throw new Error(result?.error || "更新失败");
    }
  } catch (error) {
    // IPC 未就绪时静默恢复状态
    if (error.message?.includes("No handler registered")) {
      message.warning("MCP 服务尚未就绪，请稍后重试");
    } else {
      logger.error("[MCPSettings] 更新配置失败:", error);
      message.error("更新配置失败: " + error.message);
    }
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
    logger.error(`连接 ${server.name} 失败:`, error);
    message.error(`连接失败: ${error.message}`);
    // Refresh server list to sync error state from backend
    await loadConnectedServers();
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
    logger.error(`断开 ${server.name} 失败:`, error);
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
    logger.error("保存配置失败:", error);
    message.error("保存配置失败: " + error.message);
  } finally {
    savingConfig.value = false;
  }
};

const showServerTools = async (server) => {
  selectedServer.value = server;

  try {
    // Refresh server status first to ensure we have current state
    await loadConnectedServers();

    // Check if server is still connected
    const currentServer = connectedServers.value.find(
      (s) => s.name === server.id,
    );
    if (!currentServer || currentServer.state !== "connected") {
      message.warning(`服务器 ${server.name} 未连接，请先连接服务器`);
      return;
    }

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
    logger.error("加载工具列表失败:", error);
    message.error("加载工具列表失败: " + error.message);
    // Refresh server list to sync state
    await loadConnectedServers();
  }
};

const testTool = (tool) => {
  selectedTool.value = tool;

  // 重置状态
  Object.keys(toolTestArgs).forEach((key) => delete toolTestArgs[key]);
  toolTestArgsJson.value = "{}";
  toolTestJsonMode.value = false;
  toolTestJsonError.value = "";
  toolTestResult.value = null;

  // 初始化参数默认值
  if (tool.inputSchema?.properties) {
    const schema = tool.inputSchema;
    const required = schema.required || [];

    Object.entries(schema.properties).forEach(([name, prop]) => {
      if (prop.default !== undefined) {
        toolTestArgs[name] = prop.default;
      } else if (prop.type === "boolean") {
        toolTestArgs[name] = false;
      } else if (prop.type === "array") {
        toolTestArgs[name] = [];
      } else if (prop.type === "number" || prop.type === "integer") {
        toolTestArgs[name] = undefined;
      } else {
        toolTestArgs[name] = "";
      }
    });
  }

  toolTestModalVisible.value = true;
};

const executeToolTest = async () => {
  toolTestLoading.value = true;
  toolTestResult.value = null;

  try {
    let args;

    // 如果是 JSON 模式，解析 JSON
    if (toolTestJsonMode.value) {
      try {
        args = JSON.parse(toolTestArgsJson.value);
        toolTestJsonError.value = "";
      } catch (error) {
        toolTestJsonError.value = "JSON 格式错误: " + error.message;
        toolTestLoading.value = false;
        return;
      }
    } else {
      // 使用表单数据
      args = {};
      const schema = selectedTool.value.inputSchema || {};
      const properties = schema.properties || {};

      for (const [key, value] of Object.entries(toolTestArgs)) {
        // 跳过空值（非必填项）
        if (value === "" || value === undefined || value === null) {
          continue;
        }

        // 根据类型处理值
        const propSchema = properties[key] || {};
        if (propSchema.type === "object" && typeof value === "string") {
          try {
            args[key] = JSON.parse(value);
          } catch {
            args[key] = value;
          }
        } else {
          args[key] = value;
        }
      }
    }

    // 验证必填参数
    const schema = selectedTool.value.inputSchema || {};
    const required = schema.required || [];
    for (const reqParam of required) {
      if (args[reqParam] === undefined || args[reqParam] === "") {
        message.error(`参数 "${reqParam}" 是必填项`);
        toolTestLoading.value = false;
        return;
      }
    }

    logger.info(`[MCP Test] Executing tool: ${selectedTool.value.name}`, args);

    // 调用 MCP 工具
    const result = await window.electronAPI.invoke("mcp:call-tool", {
      serverName: selectedServer.value.id,
      toolName: selectedTool.value.name,
      arguments: args,
    });

    toolTestResult.value = result;

    if (result.success) {
      message.success("工具执行成功");
    } else {
      message.error("工具执行失败: " + result.error);
    }
  } catch (error) {
    logger.error("[MCP Test] Tool execution failed:", error);
    toolTestResult.value = {
      success: false,
      error: error.message,
    };
    message.error("工具执行失败: " + error.message);
  } finally {
    toolTestLoading.value = false;
  }
};

const formatToolResult = (result) => {
  if (!result) {
    return "";
  }

  try {
    if (result.success && result.result) {
      // 处理 MCP 标准返回格式
      if (Array.isArray(result.result.content)) {
        return result.result.content
          .map((item) => {
            if (item.type === "text") {
              return item.text;
            } else if (item.type === "image") {
              return `[图片: ${item.mimeType}]`;
            } else if (item.type === "resource") {
              return `[资源: ${item.uri}]`;
            }
            return JSON.stringify(item, null, 2);
          })
          .join("\n");
      }
      return JSON.stringify(result.result, null, 2);
    }
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
};

const copyToolResult = async () => {
  try {
    const text = formatToolResult(toolTestResult.value);
    await navigator.clipboard.writeText(text);
    message.success("已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
};

const clearToolResult = () => {
  toolTestResult.value = null;
};

const loadConfigTemplate = (templateType) => {
  const serverId = selectedServer.value.id;
  const templateConfig = getDefaultConfig(serverId);

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
  if (window.electronAPI?.invoke) {
    try {
      const result = await window.electronAPI.invoke(
        "system:get-path",
        "userData",
      );
      if (result?.success) {
        userDataPath.value = result.path;
      }
    } catch (error) {
      // IPC 未就绪时静默处理
      if (!error.message?.includes("No handler registered")) {
        logger.warn("[MCPSettings] 获取用户数据路径失败:", error.message);
      }
    }

    try {
      // 获取项目路径（当前工作目录）
      const cwd = await window.electronAPI.invoke("system:get-path", "exe");
      if (cwd?.success) {
        // exe 路径的父目录通常是项目目录
        projectPath.value = cwd.path.replace(/[/\\][^/\\]+$/, "");
      }
    } catch (error) {
      // IPC 未就绪时静默处理
      if (!error.message?.includes("No handler registered")) {
        logger.warn("[MCPSettings] 获取项目路径失败:", error.message);
      }
    }
  }

  await loadConfig();
  await loadAvailableServers();
  await loadConnectedServers();
  await loadMetrics();
});

// 定期刷新连接状态和指标
let refreshInterval = null;
onMounted(() => {
  refreshInterval = setInterval(() => {
    loadConnectedServers();
    loadMetrics();
  }, 5000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
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

.tool-result-container {
  max-height: 300px;
  overflow: auto;
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
}

.tool-result {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "Courier New", Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}
</style>
