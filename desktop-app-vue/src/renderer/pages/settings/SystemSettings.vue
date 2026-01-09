<template>
  <div class="system-settings">
    <div class="settings-header">
      <h1>
        <SettingOutlined />
        系统设置
      </h1>
      <p>配置应用程序的各项参数</p>
    </div>

    <a-spin :spinning="loading">
      <a-tabs v-model:activeKey="activeTab" type="card">
        <!-- 版本设置 -->
        <a-tab-pane key="edition" tab="版本设置">
          <template #tab>
            <AppstoreOutlined />
            版本设置
          </template>
          <a-card title="版本信息">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="当前版本">
                <a-radio-group v-model:value="config.app.edition" button-style="solid">
                  <a-radio-button value="personal">个人版（本地存储）</a-radio-button>
                  <a-radio-button value="enterprise">企业版（服务器连接）</a-radio-button>
                </a-radio-group>
              </a-form-item>

              <!-- 企业版配置（仅在选择企业版时显示） -->
              <template v-if="config.app && config.app.edition === 'enterprise'">
                <a-divider>企业版配置</a-divider>
                <a-form-item label="企业服务器地址">
                  <a-input
                    v-model:value="config.enterprise.serverUrl"
                    placeholder="https://enterprise.example.com"
                  />
                </a-form-item>
                <a-form-item label="租户ID">
                  <a-input
                    v-model:value="config.enterprise.tenantId"
                    placeholder="your-tenant-id"
                  />
                </a-form-item>
                <a-form-item label="API密钥">
                  <a-input-password
                    v-model:value="config.enterprise.apiKey"
                    placeholder="输入企业版API密钥"
                  />
                </a-form-item>
                <a-alert
                  message="企业版功能"
                  description="企业版支持数据云端存储、多人协作、企业级安全等高级功能。切换版本后需要重启应用。"
                  type="info"
                  show-icon
                />
              </template>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 项目配置 -->
        <a-tab-pane key="project" tab="项目存储">
          <template #tab>
            <FolderOutlined />
            项目存储
          </template>
          <a-card title="项目存储配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="项目根目录">
                <a-input
                  v-model:value="config.project.rootPath"
                  placeholder="项目文件存储的根目录路径"
                />
                <template #extra>
                  <a-space>
                    <a-button size="small" @click="handleSelectFolder('project.rootPath')">
                      <FolderOpenOutlined />
                      选择目录
                    </a-button>
                    <span style="color: #999;">修改后需重启应用生效</span>
                  </a-space>
                </template>
              </a-form-item>

              <a-form-item label="最大项目大小">
                <a-input-number
                  v-model:value="config.project.maxSizeMB"
                  :min="100"
                  :max="10000"
                  :step="100"
                  addon-after="MB"
                  style="width: 200px;"
                />
              </a-form-item>

              <a-form-item label="自动同步">
                <a-switch v-model:checked="config.project.autoSync" />
                <span style="margin-left: 8px;">自动同步项目到后端服务器</span>
              </a-form-item>

              <a-form-item label="同步间隔" v-if="config.project.autoSync">
                <a-input-number
                  v-model:value="config.project.syncIntervalSeconds"
                  :min="60"
                  :max="3600"
                  :step="60"
                  addon-after="秒"
                  style="width: 200px;"
                />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- LLM 配置 -->
        <a-tab-pane key="llm" tab="AI 模型">
          <template #tab>
            <RobotOutlined />
            AI 模型
          </template>
          <a-card title="LLM 服务配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="服务提供商">
                <a-select v-model:value="config.llm.provider" style="width: 100%;">
                  <a-select-option value="ollama">Ollama（本地）</a-select-option>
                  <a-select-option value="openai">OpenAI</a-select-option>
                  <a-select-option value="anthropic">Claude (Anthropic)</a-select-option>
                  <a-select-option value="volcengine">火山引擎（豆包）</a-select-option>
                  <a-select-option value="dashscope">阿里通义千问</a-select-option>
                  <a-select-option value="zhipu">智谱 AI</a-select-option>
                  <a-select-option value="deepseek">DeepSeek</a-select-option>
                </a-select>
              </a-form-item>

              <a-divider>智能选择与备份</a-divider>

              <a-form-item label="AI 自主选择">
                <a-switch v-model:checked="config.llm.autoSelect" />
                <span style="margin-left: 8px;">AI 根据任务特点自动选择最优 LLM</span>
              </a-form-item>

              <a-form-item label="选择策略" v-if="config.llm.autoSelect">
                <a-select v-model:value="config.llm.selectionStrategy" style="width: 100%;">
                  <a-select-option value="cost">成本优先</a-select-option>
                  <a-select-option value="speed">速度优先</a-select-option>
                  <a-select-option value="quality">质量优先</a-select-option>
                  <a-select-option value="balanced">平衡模式（推荐）</a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="自动切换备用">
                <a-switch v-model:checked="config.llm.autoFallback" />
                <span style="margin-left: 8px;">当前 LLM 不可用时自动切换到备用</span>
              </a-form-item>

              <a-form-item label="优先级顺序">
                <a-select
                  v-model:value="config.llm.priority"
                  mode="tags"
                  style="width: 100%;"
                  placeholder="拖动调整优先级顺序"
                  :options="llmProviderOptions"
                >
                </a-select>
                <template #extra>
                  <span style="color: #999;">从左到右依次尝试，第一个可用的 LLM 将被使用</span>
                </template>
              </a-form-item>

              <!-- Ollama 配置 -->
              <a-divider v-if="config.llm.provider === 'ollama'">Ollama 配置</a-divider>
              <template v-if="config.llm.provider === 'ollama'">
                <a-form-item label="服务地址">
                  <a-input v-model:value="config.llm.ollamaHost" placeholder="http://localhost:11434" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-input v-model:value="config.llm.ollamaModel" placeholder="qwen2:7b" />
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.ollamaEmbeddingModel" placeholder="nomic-embed-text" />
                  <template #extra>
                    <span style="color: #999;">用于生成文本嵌入向量的模型</span>
                  </template>
                </a-form-item>
              </template>

              <!-- OpenAI 配置 -->
              <a-divider v-if="config.llm.provider === 'openai'">OpenAI 配置</a-divider>
              <template v-if="config.llm.provider === 'openai'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.openaiApiKey" placeholder="sk-..." />
                </a-form-item>
                <a-form-item label="API 地址">
                  <a-input v-model:value="config.llm.openaiBaseUrl" placeholder="https://api.openai.com/v1" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-input v-model:value="config.llm.openaiModel" placeholder="gpt-3.5-turbo" />
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.openaiEmbeddingModel" placeholder="text-embedding-3-small" />
                  <template #extra>
                    <span style="color: #999;">推荐: text-embedding-3-small 或 text-embedding-3-large</span>
                  </template>
                </a-form-item>
              </template>

              <!-- Claude (Anthropic) 配置 -->
              <a-divider v-if="config.llm.provider === 'anthropic'">Claude (Anthropic) 配置</a-divider>
              <template v-if="config.llm.provider === 'anthropic'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.anthropicApiKey" placeholder="sk-ant-..." />
                </a-form-item>
                <a-form-item label="API 地址">
                  <a-input v-model:value="config.llm.anthropicBaseUrl" placeholder="https://api.anthropic.com" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-input v-model:value="config.llm.anthropicModel" placeholder="claude-3-5-sonnet-20241022" />
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.anthropicEmbeddingModel" placeholder="需使用其他服务（如Voyage AI）" disabled />
                  <template #extra>
                    <span style="color: #999;">Claude暂无嵌入模型API，建议使用OpenAI或其他服务</span>
                  </template>
                </a-form-item>
              </template>

              <!-- 火山引擎配置 -->
              <a-divider v-if="config.llm.provider === 'volcengine'">火山引擎（豆包）配置</a-divider>
              <template v-if="config.llm.provider === 'volcengine'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.volcengineApiKey" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-select
                    v-model:value="config.llm.volcengineModel"
                    placeholder="选择模型版本"
                    :options="volcengineModelOptions"
                    show-search
                    :filter-option="filterOption"
                  >
                  </a-select>
                  <template #extra>
                    <span style="color: #999;">推荐使用最新版本：doubao-seed-1-6-251015（注意：模型名称使用下划线，不是点）</span>
                  </template>
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-select
                    v-model:value="config.llm.volcengineEmbeddingModel"
                    placeholder="选择嵌入模型"
                    :options="volcengineEmbeddingModelOptions"
                    show-search
                    :filter-option="filterOption"
                  >
                  </a-select>
                  <template #extra>
                    <span style="color: #999;">用于文本向量化，推荐：doubao-embedding-text-240715</span>
                  </template>
                </a-form-item>
              </template>

              <!-- 阿里通义千问配置 -->
              <a-divider v-if="config.llm.provider === 'dashscope'">阿里通义千问配置</a-divider>
              <template v-if="config.llm.provider === 'dashscope'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.dashscopeApiKey" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-select v-model:value="config.llm.dashscopeModel" style="width: 100%;">
                    <a-select-option value="qwen-turbo">Qwen Turbo（推荐）</a-select-option>
                    <a-select-option value="qwen-plus">Qwen Plus</a-select-option>
                    <a-select-option value="qwen-max">Qwen Max</a-select-option>
                  </a-select>
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.dashscopeEmbeddingModel" placeholder="text-embedding-v2" />
                  <template #extra>
                    <span style="color: #999;">阿里云灵积提供的嵌入模型</span>
                  </template>
                </a-form-item>
              </template>

              <!-- 智谱 AI 配置 -->
              <a-divider v-if="config.llm.provider === 'zhipu'">智谱 AI 配置</a-divider>
              <template v-if="config.llm.provider === 'zhipu'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.zhipuApiKey" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-input v-model:value="config.llm.zhipuModel" placeholder="glm-4" />
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.zhipuEmbeddingModel" placeholder="embedding-2" />
                  <template #extra>
                    <span style="color: #999;">智谱AI提供的文本嵌入模型</span>
                  </template>
                </a-form-item>
              </template>

              <!-- DeepSeek 配置 -->
              <a-divider v-if="config.llm.provider === 'deepseek'">DeepSeek 配置</a-divider>
              <template v-if="config.llm.provider === 'deepseek'">
                <a-form-item label="API Key">
                  <a-input-password v-model:value="config.llm.deepseekApiKey" />
                </a-form-item>
                <a-form-item label="对话模型">
                  <a-input v-model:value="config.llm.deepseekModel" placeholder="deepseek-chat" />
                </a-form-item>
                <a-form-item label="嵌入模型">
                  <a-input v-model:value="config.llm.deepseekEmbeddingModel" placeholder="" />
                  <template #extra>
                    <span style="color: #999;">DeepSeek嵌入模型（如支持）</span>
                  </template>
                </a-form-item>
              </template>

              <!-- 测试连接按钮 -->
              <a-divider />
              <a-form-item label="功能测试" :wrapper-col="{ span: 18, offset: 6 }">
                <a-space direction="vertical" style="width: 100%;">
                  <!-- 测试对话功能 -->
                  <div>
                    <a-space>
                      <a-button type="primary" @click="testLLMConnection" :loading="testingConnection">
                        测试对话
                      </a-button>
                      <a-tag v-if="llmTestResult" :color="llmTestResult.success ? 'success' : 'error'">
                        {{ llmTestResult.message }}
                      </a-tag>
                    </a-space>
                  </div>
                  <!-- 测试嵌入功能 -->
                  <div>
                    <a-space>
                      <a-button @click="testEmbedding" :loading="testingEmbedding">
                        测试嵌入
                      </a-button>
                      <a-tag v-if="embeddingTestResult" :color="embeddingTestResult.success ? 'success' : 'error'">
                        {{ embeddingTestResult.message }}
                      </a-tag>
                    </a-space>
                  </div>
                </a-space>
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 向量数据库配置 -->
        <a-tab-pane key="vector" tab="向量数据库">
          <template #tab>
            <DatabaseOutlined />
            向量数据库
          </template>
          <a-card title="Qdrant 向量数据库配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="服务地址">
                <a-input v-model:value="config.vector.qdrantHost" placeholder="http://localhost:6333" />
              </a-form-item>

              <a-form-item label="端口">
                <a-input-number v-model:value="config.vector.qdrantPort" :min="1" :max="65535" style="width: 200px;" />
              </a-form-item>

              <a-form-item label="集合名称">
                <a-input v-model:value="config.vector.qdrantCollection" placeholder="chainlesschain_vectors" />
              </a-form-item>

              <a-form-item label="Embedding 模型">
                <a-input v-model:value="config.vector.embeddingModel" placeholder="bge-base-zh-v1.5" />
              </a-form-item>

              <a-form-item label="向量维度">
                <a-input-number v-model:value="config.vector.embeddingDimension" :min="128" :max="2048" style="width: 200px;" />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- Git 配置 -->
        <a-tab-pane key="git" tab="Git 同步">
          <template #tab>
            <GithubOutlined />
            Git 同步
          </template>
          <a-card title="Git 同步配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="启用 Git 同步">
                <a-switch v-model:checked="config.git.enabled" />
              </a-form-item>

              <template v-if="config.git.enabled">
                <a-form-item label="自动同步">
                  <a-switch v-model:checked="config.git.autoSync" />
                  <span style="margin-left: 8px;">自动提交和推送</span>
                </a-form-item>

                <a-form-item label="同步间隔" v-if="config.git.autoSync">
                  <a-input-number
                    v-model:value="config.git.autoSyncInterval"
                    :min="60"
                    :max="3600"
                    :step="60"
                    addon-after="秒"
                    style="width: 200px;"
                  />
                </a-form-item>

                <a-form-item label="用户名">
                  <a-input v-model:value="config.git.userName" placeholder="Your Name" />
                </a-form-item>

                <a-form-item label="邮箱">
                  <a-input v-model:value="config.git.userEmail" placeholder="your.email@example.com" />
                </a-form-item>

                <a-form-item label="远程仓库 URL">
                  <a-input v-model:value="config.git.remoteUrl" placeholder="https://github.com/username/repo.git" />
                </a-form-item>
              </template>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 后端服务配置 -->
        <a-tab-pane key="backend" tab="后端服务">
          <template #tab>
            <CloudServerOutlined />
            后端服务
          </template>
          <a-card title="后端服务地址配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="项目服务">
                <a-input v-model:value="config.backend.projectServiceUrl" placeholder="http://localhost:9090" />
              </a-form-item>

              <a-form-item label="AI 服务">
                <a-input v-model:value="config.backend.aiServiceUrl" placeholder="http://localhost:8001" />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 数据库配置 -->
        <a-tab-pane key="database" tab="数据库">
          <template #tab>
            <DatabaseOutlined />
            数据库
          </template>
          <a-card title="数据库存储位置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="当前路径">
                <a-input
                  v-model:value="databaseConfig.path"
                  readonly
                  style="font-family: monospace;"
                />
              </a-form-item>

              <a-form-item label="默认路径">
                <a-input
                  :value="databaseConfig.defaultPath"
                  readonly
                  disabled
                  style="font-family: monospace; font-size: 12px;"
                />
              </a-form-item>

              <a-form-item label="新位置">
                <a-input
                  v-model:value="newDatabasePath"
                  placeholder="选择新的数据库存储位置"
                  style="font-family: monospace;"
                />
                <template #extra>
                  <a-space>
                    <a-button size="small" @click="handleSelectDatabasePath">
                      <FolderOpenOutlined />
                      选择位置
                    </a-button>
                    <a-button
                      size="small"
                      type="primary"
                      :disabled="!newDatabasePath || newDatabasePath === databaseConfig.path"
                      @click="handleMigrateDatabase"
                      :loading="migrating"
                    >
                      迁移数据库
                    </a-button>
                  </a-space>
                </template>
              </a-form-item>

              <a-form-item>
                <a-alert
                  message="重要提示"
                  description="迁移数据库会将当前数据库文件复制到新位置，并自动创建备份。迁移完成后需要重启应用。"
                  type="info"
                  show-icon
                />
              </a-form-item>
            </a-form>
          </a-card>

          <a-card title="数据库备份管理" style="margin-top: 16px;">
            <a-space direction="vertical" style="width: 100%;">
              <a-button type="primary" @click="handleCreateBackup" :loading="backing">
                <SaveOutlined />
                立即备份
              </a-button>

              <a-divider />

              <div>
                <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
                  <strong>备份列表</strong>
                  <a-button size="small" @click="loadBackupList">
                    <ReloadOutlined />
                    刷新
                  </a-button>
                </div>

                <a-list
                  :data-source="backupList"
                  :loading="loadingBackups"
                  size="small"
                  bordered
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <template #actions>
                        <a-button
                          size="small"
                          type="link"
                          @click="handleRestoreBackup(item.path)"
                          danger
                        >
                          恢复
                        </a-button>
                      </template>
                      <a-list-item-meta>
                        <template #title>
                          {{ item.name }}
                        </template>
                        <template #description>
                          <a-space>
                            <span>大小: {{ formatFileSize(item.size) }}</span>
                            <span>时间: {{ formatDate(item.created) }}</span>
                          </a-space>
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>

                  <template #empty>
                    <a-empty description="暂无备份" />
                  </template>
                </a-list>
              </div>
            </a-space>
          </a-card>
        </a-tab-pane>

        <!-- 安全配置 -->
        <a-tab-pane key="security" tab="安全">
          <template #tab>
            <LockOutlined />
            安全
          </template>
          <a-card title="数据库加密配置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="SQLCipher 密钥">
                <a-input-password
                  v-model:value="config.database.sqlcipherKey"
                  placeholder="留空使用默认密钥"
                />
                <template #extra>
                  <a-alert
                    message="警告"
                    description="修改加密密钥后，旧数据将无法访问。请谨慎操作！"
                    type="warning"
                    show-icon
                    style="margin-top: 8px;"
                  />
                </template>
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- P2P 网络配置 -->
        <a-tab-pane key="p2p" tab="P2P 网络">
          <template #tab>
            <GlobalOutlined />
            P2P 网络
          </template>

          <!-- 传输层配置 -->
          <a-card title="传输层配置" style="margin-bottom: 16px;">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="WebRTC 传输">
                <a-switch
                  v-model:checked="config.p2p.transports.webrtc.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  <span style="color: #52c41a;">推荐</span> - 适合大多数NAT环境，提供最佳穿透能力
                </template>
              </a-form-item>

              <a-form-item label="WebSocket 传输">
                <a-switch
                  v-model:checked="config.p2p.transports.websocket.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  HTTP兼容，防火墙友好，适合企业网络环境
                </template>
              </a-form-item>

              <a-form-item label="TCP 传输">
                <a-switch
                  v-model:checked="config.p2p.transports.tcp.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  直连传输，局域网性能最佳（向后兼容必需）
                </template>
              </a-form-item>

              <a-form-item label="智能自动选择">
                <a-switch
                  v-model:checked="config.p2p.transports.autoSelect"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  根据NAT类型自动选择最优传输层
                </template>
              </a-form-item>

              <a-form-item label="WebSocket 端口">
                <a-input-number
                  v-model:value="config.p2p.websocket.port"
                  :min="1024"
                  :max="65535"
                  style="width: 200px;"
                />
              </a-form-item>
            </a-form>
          </a-card>

          <!-- WebRTC 配置 -->
          <a-card title="WebRTC 配置" style="margin-bottom: 16px;">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="WebRTC 端口">
                <a-input-number
                  v-model:value="config.p2p.webrtc.port"
                  :min="1024"
                  :max="65535"
                  style="width: 200px;"
                />
                <template #extra>
                  WebRTC监听端口（UDP）
                </template>
              </a-form-item>

              <a-form-item label="ICE 传输策略">
                <a-select
                  v-model:value="config.p2p.webrtc.iceTransportPolicy"
                  style="width: 200px;"
                >
                  <a-select-option value="all">全部（STUN + TURN）</a-select-option>
                  <a-select-option value="relay">仅中继（TURN）</a-select-option>
                </a-select>
                <template #extra>
                  'all' 尝试所有候选，'relay' 强制使用TURN中继（更私密但速度慢）
                </template>
              </a-form-item>

              <a-form-item label="ICE 候选池大小">
                <a-slider
                  v-model:value="config.p2p.webrtc.iceCandidatePoolSize"
                  :min="0"
                  :max="20"
                  :marks="{ 0: '0', 5: '5', 10: '10', 15: '15', 20: '20' }"
                />
                <template #extra>
                  预先收集的ICE候选数量，增加可加快连接建立速度
                </template>
              </a-form-item>

              <a-divider>STUN 服务器</a-divider>

              <a-form-item label="STUN 服务器列表">
                <a-space direction="vertical" style="width: 100%;">
                  <a-tag
                    v-for="(server, index) in config.p2p.stun.servers"
                    :key="index"
                    closable
                    @close="handleRemoveStunServer(index)"
                  >
                    {{ server }}
                  </a-tag>
                  <a-input-group compact>
                    <a-input
                      v-model:value="newStunServer"
                      placeholder="stun:stun.example.com:19302"
                      style="width: calc(100% - 80px);"
                      @pressEnter="handleAddStunServer"
                    />
                    <a-button type="primary" @click="handleAddStunServer">
                      添加
                    </a-button>
                  </a-input-group>
                </a-space>
                <template #extra>
                  STUN服务器用于NAT穿透和公网IP发现
                </template>
              </a-form-item>

              <a-divider>TURN 服务器</a-divider>

              <a-form-item label="启用 TURN">
                <a-switch
                  v-model:checked="config.p2p.turn.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  TURN服务器用于在无法建立直接P2P连接时提供中继服务
                </template>
              </a-form-item>

              <a-form-item v-if="config.p2p.turn.enabled" label="TURN 服务器列表">
                <a-space direction="vertical" style="width: 100%;">
                  <a-card
                    v-for="(server, index) in config.p2p.turn.servers"
                    :key="index"
                    size="small"
                    style="margin-bottom: 8px;"
                  >
                    <template #extra>
                      <a-button
                        type="text"
                        danger
                        size="small"
                        @click="handleRemoveTurnServer(index)"
                      >
                        删除
                      </a-button>
                    </template>
                    <a-descriptions :column="1" size="small">
                      <a-descriptions-item label="URL">{{ server.urls }}</a-descriptions-item>
                      <a-descriptions-item label="用户名">{{ server.username || '-' }}</a-descriptions-item>
                      <a-descriptions-item label="凭证">{{ server.credential ? '***' : '-' }}</a-descriptions-item>
                    </a-descriptions>
                  </a-card>

                  <a-button type="dashed" block @click="showAddTurnServerModal = true">
                    + 添加 TURN 服务器
                  </a-button>
                </a-space>
                <template #extra>
                  生产环境建议配置自建TURN服务器
                </template>
              </a-form-item>
            </a-form>
          </a-card>

          <!-- NAT 穿透状态 -->
          <a-card title="NAT 穿透状态" style="margin-bottom: 16px;">
            <a-space direction="vertical" size="middle" style="width: 100%;">
              <a-row :gutter="16">
                <a-col :span="6">
                  <a-statistic title="NAT 类型">
                    <template #formatter>
                      <a-tag :color="getNATTypeColor(natInfo?.type)">
                        {{ getNATTypeName(natInfo?.type) }}
                      </a-tag>
                    </template>
                  </a-statistic>
                </a-col>
                <a-col :span="6">
                  <a-statistic title="公网 IP" :value="natInfo?.publicIP || '未检测'" />
                </a-col>
                <a-col :span="6">
                  <a-statistic title="本地 IP" :value="natInfo?.localIP || '未知'" />
                </a-col>
                <a-col :span="6">
                  <a-button type="primary" @click="handleDetectNAT" :loading="detectingNAT">
                    <ReloadOutlined />
                    重新检测
                  </a-button>
                </a-col>
              </a-row>

              <a-alert
                v-if="natInfo?.description"
                :message="natInfo.description"
                :type="natInfo.type === 'symmetric' ? 'warning' : 'info'"
                show-icon
              />

              <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
                <a-form-item label="自动检测 NAT">
                  <a-switch
                    v-model:checked="config.p2p.nat.autoDetect"
                    checked-children="启用"
                    un-checked-children="禁用"
                  />
                  <template #extra>
                    启动时自动检测NAT类型并选择最优传输策略
                  </template>
                </a-form-item>

                <a-form-item label="检测间隔">
                  <a-input-number
                    v-model:value="config.p2p.nat.detectionInterval"
                    :min="60000"
                    :max="86400000"
                    :step="60000"
                    :formatter="value => `${Math.floor(value / 60000)} 分钟`"
                    :parser="value => parseInt(value) * 60000"
                    style="width: 200px;"
                  />
                  <template #extra>
                    定期重新检测NAT类型（网络环境变化时）
                  </template>
                </a-form-item>
              </a-form>
            </a-space>
          </a-card>

          <!-- Circuit Relay 设置 -->
          <a-card title="Circuit Relay 中继设置" style="margin-bottom: 16px;">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="启用中继">
                <a-switch
                  v-model:checked="config.p2p.relay.enabled"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  通过中继节点建立连接（NAT穿透的后备方案）
                </template>
              </a-form-item>

              <a-form-item label="最大预留数量">
                <a-slider
                  v-model:value="config.p2p.relay.maxReservations"
                  :min="1"
                  :max="5"
                  :marks="{ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }"
                />
                <template #extra>
                  同时保持的中继节点预留数量
                </template>
              </a-form-item>

              <a-form-item label="自动升级直连">
                <a-switch
                  v-model:checked="config.p2p.relay.autoUpgrade"
                  checked-children="启用"
                  un-checked-children="禁用"
                />
                <template #extra>
                  通过DCUTr尝试将中继连接升级为直连（提升性能）
                </template>
              </a-form-item>

              <a-form-item label="当前中继节点">
                <a-button @click="handleRefreshRelays" :loading="refreshingRelays">
                  <ReloadOutlined />
                  刷新列表
                </a-button>
                <a-list
                  v-if="relayInfo.length > 0"
                  :data-source="relayInfo"
                  style="margin-top: 12px;"
                >
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta>
                        <template #title>
                          {{ item.peerId.substring(0, 20) }}...
                        </template>
                        <template #description>
                          {{ item.addr }}
                        </template>
                      </a-list-item-meta>
                      <template #extra>
                        <a-tag :color="item.status === 'open' ? 'green' : 'orange'">
                          {{ item.status }}
                        </a-tag>
                      </template>
                    </a-list-item>
                  </template>
                </a-list>
                <a-empty v-else description="暂无中继连接" style="margin-top: 12px;" />
              </a-form-item>
            </a-form>
          </a-card>

          <!-- WebRTC 连接质量监控 -->
          <a-card title="WebRTC 连接质量监控" style="margin-bottom: 16px;">
            <a-space direction="vertical" size="middle" style="width: 100%;">
              <a-button type="primary" @click="handleRefreshWebRTCQuality" :loading="refreshingWebRTCQuality">
                <ReloadOutlined />
                刷新质量报告
              </a-button>

              <a-empty v-if="!webrtcQualityReports || webrtcQualityReports.length === 0" description="暂无WebRTC连接" />

              <div v-else>
                <a-card
                  v-for="report in webrtcQualityReports"
                  :key="report.peerId"
                  size="small"
                  style="margin-bottom: 12px;"
                >
                  <template #title>
                    <a-space>
                      <span>{{ report.peerId.substring(0, 20) }}...</span>
                      <a-tag :color="getQualityColor(report.quality)">
                        {{ getQualityLabel(report.quality) }}
                      </a-tag>
                    </a-space>
                  </template>

                  <a-descriptions :column="2" size="small" bordered>
                    <a-descriptions-item label="丢包率">
                      <a-tag :color="report.metrics.packetLoss > 5 ? 'red' : 'green'">
                        {{ report.metrics.packetLoss.toFixed(2) }}%
                      </a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="延迟 (RTT)">
                      <a-tag :color="report.metrics.rtt > 300 ? 'red' : 'green'">
                        {{ report.metrics.rtt }} ms
                      </a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="抖动 (Jitter)">
                      <a-tag :color="report.metrics.jitter > 50 ? 'red' : 'green'">
                        {{ report.metrics.jitter }} ms
                      </a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="带宽">
                      {{ (report.metrics.bandwidth / 1000).toFixed(2) }} kbps
                    </a-descriptions-item>
                    <a-descriptions-item label="运行时间" :span="2">
                      {{ formatUptime(report.uptime) }}
                    </a-descriptions-item>
                  </a-descriptions>

                  <!-- 告警信息 -->
                  <a-alert
                    v-if="report.alerts && report.alerts.length > 0"
                    type="warning"
                    style="margin-top: 12px;"
                  >
                    <template #message>
                      <div v-for="(alert, index) in report.alerts" :key="index">
                        <a-tag :color="alert.severity === 'critical' ? 'red' : 'orange'">
                          {{ alert.type }}
                        </a-tag>
                        {{ alert.message }}
                      </div>
                    </template>
                  </a-alert>

                  <!-- 优化建议 -->
                  <a-collapse v-if="report.suggestions && report.suggestions.length > 0" style="margin-top: 12px;">
                    <a-collapse-panel key="1" header="优化建议">
                      <a-list size="small" :data-source="report.suggestions">
                        <template #renderItem="{ item }">
                          <a-list-item>
                            <a-list-item-meta>
                              <template #title>
                                <a-tag :color="getPriorityColor(item.priority)">
                                  {{ item.priority }}
                                </a-tag>
                                {{ item.issue }}
                              </template>
                              <template #description>
                                {{ item.suggestion }}
                              </template>
                            </a-list-item-meta>
                          </a-list-item>
                        </template>
                      </a-list>
                    </a-collapse-panel>
                  </a-collapse>
                </a-card>
              </div>
            </a-space>
          </a-card>

          <!-- 网络诊断 -->
          <a-card title="网络诊断">
            <a-space direction="vertical" size="middle" style="width: 100%;">
              <a-button type="primary" @click="handleRunDiagnostics" :loading="runningDiagnostics">
                <ExperimentOutlined />
                运行完整诊断
              </a-button>

              <a-descriptions v-if="diagnosticResults" bordered :column="3">
                <a-descriptions-item label="总传输层">
                  {{ diagnosticResults.summary?.totalTransports || 0 }}
                </a-descriptions-item>
                <a-descriptions-item label="可用传输层">
                  <a-tag color="green">
                    {{ diagnosticResults.summary?.availableTransports || 0 }}
                  </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="活跃连接">
                  {{ diagnosticResults.summary?.activeConnections || 0 }}
                </a-descriptions-item>
              </a-descriptions>

              <a-table
                v-if="diagnosticResults?.transports"
                :columns="diagnosticColumns"
                :data-source="formatDiagnosticData(diagnosticResults.transports)"
                :pagination="false"
                size="small"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'status'">
                    <a-tag :color="record.available ? 'green' : 'red'">
                      {{ record.available ? '可用' : '不可用' }}
                    </a-tag>
                  </template>
                  <template v-if="column.key === 'addresses'">
                    <div v-if="record.listenAddresses">
                      <div v-for="(addr, i) in record.listenAddresses" :key="i" style="font-size: 12px;">
                        {{ addr }}
                      </div>
                    </div>
                    <span v-else>-</span>
                  </template>
                  <template v-if="column.key === 'error'">
                    <a-tooltip v-if="record.error" :title="record.error">
                      <a-tag color="red">有错误</a-tag>
                    </a-tooltip>
                    <span v-else>-</span>
                  </template>
                </template>
              </a-table>
            </a-space>
          </a-card>
        </a-tab-pane>
      </a-tabs>

      <!-- 操作按钮 -->
      <div class="settings-actions">
        <a-space size="large">
          <a-button type="primary" size="large" :loading="saving" @click="handleSave">
            <SaveOutlined />
            保存配置
          </a-button>

          <a-button size="large" @click="handleReset">
            <ReloadOutlined />
            重置为默认值
          </a-button>

          <a-button size="large" @click="handleExportEnv">
            <ExportOutlined />
            导出为 .env 文件
          </a-button>

          <a-button size="large" @click="handleCancel">
            取消
          </a-button>
        </a-space>
      </div>
    </a-spin>

    <!-- 添加 TURN 服务器模态框 -->
    <a-modal
      v-model:open="showAddTurnServerModal"
      title="添加 TURN 服务器"
      @ok="handleAddTurnServer"
      @cancel="resetTurnServerForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="服务器 URL" required>
          <a-input
            v-model:value="newTurnServer.urls"
            placeholder="turn:turn.example.com:3478"
          />
        </a-form-item>
        <a-form-item label="用户名">
          <a-input
            v-model:value="newTurnServer.username"
            placeholder="username"
          />
        </a-form-item>
        <a-form-item label="凭证/密码">
          <a-input-password
            v-model:value="newTurnServer.credential"
            placeholder="password"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  SettingOutlined,
  AppstoreOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  DatabaseOutlined,
  GithubOutlined,
  CloudServerOutlined,
  LockOutlined,
  SaveOutlined,
  ReloadOutlined,
  ExportOutlined,
  GlobalOutlined,
  ExperimentOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();

const loading = ref(false);
const saving = ref(false);
const activeTab = ref('project');

// LLM 测试连接相关
const testingConnection = ref(false);
const llmTestResult = ref(null);

// LLM 嵌入测试相关
const testingEmbedding = ref(false);
const embeddingTestResult = ref(null);

// LLM 提供商选项
const llmProviderOptions = [
  { label: 'Ollama（本地）', value: 'ollama' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude (Anthropic)', value: 'anthropic' },
  { label: '火山引擎（豆包）', value: 'volcengine' },
  { label: '阿里通义千问', value: 'dashscope' },
  { label: '智谱 AI', value: 'zhipu' },
  { label: 'DeepSeek', value: 'deepseek' },
];

// 火山引擎（豆包）模型选项 - 2025年1月最新版本
const volcengineModelOptions = [
  // Doubao Seed 1.6 系列（最新推荐 - 注意使用下划线格式）
  { label: 'doubao-seed-1-6-251015（推荐 - 最新，支持reasoning_effort）', value: 'doubao-seed-1-6-251015' },
  { label: 'doubao-seed-1-6-250615（支持thinking控制）', value: 'doubao-seed-1-6-250615' },

  // Doubao 1.5 系列
  { label: 'doubao-1-5-pro-32k-250115（高性能32k）', value: 'doubao-1-5-pro-32k-250115' },
  { label: 'doubao-1-5-lite-250115（轻量版）', value: 'doubao-1-5-lite-250115' },
  { label: 'doubao-1-5-vision-pro-250115（视觉模型）', value: 'doubao-1-5-vision-pro-250115' },

  // Doubao Pro 系列
  { label: 'doubao-pro-32k-241215（高性能32k）', value: 'doubao-pro-32k-241215' },
  { label: 'doubao-pro-32k-240828', value: 'doubao-pro-32k-240828' },

  // 其他版本
  { label: 'doubao-lite-32k（轻量32k）', value: 'doubao-lite-32k' },
];

// 火山引擎（豆包）嵌入模型选项
const volcengineEmbeddingModelOptions = [
  { label: 'doubao-embedding-text-240715（推荐 - 最新，2560维）', value: 'doubao-embedding-text-240715' },
  { label: 'doubao-embedding-text-240515（2048维）', value: 'doubao-embedding-text-240515' },
  { label: 'doubao-embedding-large（大模型）', value: 'doubao-embedding-large' },
  { label: 'doubao-embedding-vision（视觉嵌入）', value: 'doubao-embedding-vision' },
];

// 过滤选项
const filterOption = (input, option) => {
  return option.value.toLowerCase().includes(input.toLowerCase()) ||
         option.label.toLowerCase().includes(input.toLowerCase());
};

// 数据库配置
const databaseConfig = ref({
  path: '',
  defaultPath: '',
  exists: false,
  autoBackup: true,
  maxBackups: 7,
});
const newDatabasePath = ref('');
const migrating = ref(false);
const backing = ref(false);
const loadingBackups = ref(false);
const backupList = ref([]);

const config = ref({
  app: {
    edition: 'personal', // personal | enterprise
  },
  enterprise: {
    serverUrl: '',
    tenantId: '',
    apiKey: '',
  },
  project: {
    rootPath: '',
    maxSizeMB: 1000,
    allowedFileTypes: [],
    autoSync: true,
    syncIntervalSeconds: 300,
  },
  llm: {
    provider: 'volcengine',
    priority: ['volcengine', 'ollama', 'deepseek'],
    autoFallback: true,
    autoSelect: true,
    selectionStrategy: 'balanced',
    ollamaHost: '',
    ollamaModel: '',
    ollamaEmbeddingModel: '',
    openaiApiKey: '',
    openaiBaseUrl: '',
    openaiModel: '',
    openaiEmbeddingModel: '',
    anthropicApiKey: '',
    anthropicBaseUrl: '',
    anthropicModel: '',
    anthropicEmbeddingModel: '',
    volcengineApiKey: '',
    volcengineModel: '',
    volcengineEmbeddingModel: '',
    dashscopeApiKey: '',
    dashscopeModel: '',
    dashscopeEmbeddingModel: '',
    zhipuApiKey: '',
    zhipuModel: '',
    zhipuEmbeddingModel: '',
    deepseekApiKey: '',
    deepseekModel: '',
    deepseekEmbeddingModel: '',
  },
  vector: {
    qdrantHost: '',
    qdrantPort: 6333,
    qdrantCollection: '',
    embeddingModel: '',
    embeddingDimension: 768,
  },
  git: {
    enabled: false,
    autoSync: false,
    autoSyncInterval: 300,
    userName: '',
    userEmail: '',
    remoteUrl: '',
  },
  backend: {
    projectServiceUrl: '',
    aiServiceUrl: '',
  },
  database: {
    sqlcipherKey: '',
  },
  p2p: {
    transports: {
      webrtc: { enabled: true },
      websocket: { enabled: true },
      tcp: { enabled: true },
      autoSelect: true,
    },
    stun: {
      servers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ],
    },
    turn: {
      enabled: false,
      servers: [],
    },
    webrtc: {
      port: 9095,
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    },
    relay: {
      enabled: true,
      maxReservations: 2,
      autoUpgrade: true,
    },
    nat: {
      autoDetect: true,
      detectionInterval: 3600000,
    },
    connection: {
      dialTimeout: 30000,
      maxRetries: 3,
      healthCheckInterval: 60000,
    },
    websocket: {
      port: 9001,
    },
    compatibility: {
      detectLegacy: true,
    },
  },
});

// 深度合并配置对象
const deepMerge = (target, source) => {
  const result = { ...target };
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
};

// 加载配置
const loadConfig = async () => {
  loading.value = true;
  try {
    const allConfig = await window.electronAPI.config.getAll();
    // 使用深度合并，保留默认值
    config.value = deepMerge(config.value, allConfig);

    // 加载数据库配置
    const dbConfig = await window.electronAPI.db.getConfig();
    databaseConfig.value = dbConfig;
  } catch (error) {
    console.error('加载配置失败:', error);
    message.error('加载配置失败：' + error.message);
  } finally {
    loading.value = false;
  }
};

// 加载备份列表
const loadBackupList = async () => {
  loadingBackups.value = true;
  try {
    backupList.value = await window.electronAPI.db.listBackups();
  } catch (error) {
    console.error('加载备份列表失败:', error);
    message.error('加载备份列表失败：' + error.message);
  } finally {
    loadingBackups.value = false;
  }
};

// P2P 网络相关
const natInfo = ref(null);
const relayInfo = ref([]);
const diagnosticResults = ref(null);
const detectingNAT = ref(false);
const refreshingRelays = ref(false);
const runningDiagnostics = ref(false);

// STUN/TURN 服务器管理
const newStunServer = ref('');
const showAddTurnServerModal = ref(false);
const newTurnServer = ref({
  urls: '',
  username: '',
  credential: ''
});

// WebRTC 质量监控
const webrtcQualityReports = ref([]);
const refreshingWebRTCQuality = ref(false);

// 诊断表格列定义
const diagnosticColumns = [
  { title: '传输层', dataIndex: 'transport', key: 'transport' },
  { title: '状态', dataIndex: 'available', key: 'status' },
  { title: '监听地址', dataIndex: 'listenAddresses', key: 'addresses' },
  { title: '错误信息', dataIndex: 'error', key: 'error' },
];

// NAT类型名称映射
const getNATTypeName = (type) => {
  const names = {
    'none': '无NAT（公网IP）',
    'full-cone': '完全锥形NAT',
    'restricted': '受限锥形NAT',
    'port-restricted': '端口受限NAT',
    'symmetric': '对称NAT',
    'unknown': '未知'
  };
  return names[type] || '未检测';
};

// NAT类型颜色映射
const getNATTypeColor = (type) => {
  const colors = {
    'none': 'green',
    'full-cone': 'green',
    'restricted': 'blue',
    'port-restricted': 'orange',
    'symmetric': 'red',
    'unknown': 'gray'
  };
  return colors[type] || 'gray';
};

// 格式化诊断数据
const formatDiagnosticData = (transports) => {
  return Object.entries(transports).map(([transport, info]) => ({
    transport: transport.toUpperCase(),
    available: info.available,
    listenAddresses: info.listenAddresses,
    error: info.error,
  }));
};

// NAT检测
const handleDetectNAT = async () => {
  detectingNAT.value = true;
  try {
    natInfo.value = await window.electronAPI.p2p.detectNAT();
    message.success('NAT检测完成');
  } catch (error) {
    console.error('NAT检测失败:', error);
    message.error('NAT检测失败：' + error.message);
  } finally {
    detectingNAT.value = false;
  }
};

// 刷新中继信息
const handleRefreshRelays = async () => {
  refreshingRelays.value = true;
  try {
    relayInfo.value = await window.electronAPI.p2p.getRelayInfo();
    message.success('中继信息已更新');
  } catch (error) {
    console.error('获取中继信息失败:', error);
    message.error('获取中继信息失败：' + error.message);
  } finally {
    refreshingRelays.value = false;
  }
};

// 运行诊断
const handleRunDiagnostics = async () => {
  runningDiagnostics.value = true;
  try {
    diagnosticResults.value = await window.electronAPI.p2p.runDiagnostics();
    message.success('诊断完成');
  } catch (error) {
    console.error('诊断失败:', error);
    message.error('诊断失败：' + error.message);
  } finally {
    runningDiagnostics.value = false;
  }
};

// STUN 服务器管理
const handleAddStunServer = () => {
  if (!newStunServer.value) {
    message.warning('请输入STUN服务器地址');
    return;
  }

  // 验证格式
  if (!newStunServer.value.startsWith('stun:')) {
    message.error('STUN服务器地址格式错误，应以 stun: 开头');
    return;
  }

  // 检查是否已存在
  if (config.value.p2p.stun.servers.includes(newStunServer.value)) {
    message.warning('该STUN服务器已存在');
    return;
  }

  config.value.p2p.stun.servers.push(newStunServer.value);
  newStunServer.value = '';
  message.success('STUN服务器已添加');
};

const handleRemoveStunServer = (index) => {
  config.value.p2p.stun.servers.splice(index, 1);
  message.success('STUN服务器已删除');
};

// TURN 服务器管理
const handleAddTurnServer = () => {
  if (!newTurnServer.value.urls) {
    message.warning('请输入TURN服务器地址');
    return;
  }

  // 验证格式
  if (!newTurnServer.value.urls.startsWith('turn:') && !newTurnServer.value.urls.startsWith('turns:')) {
    message.error('TURN服务器地址格式错误，应以 turn: 或 turns: 开头');
    return;
  }

  // 添加到列表
  config.value.p2p.turn.servers.push({
    urls: newTurnServer.value.urls,
    username: newTurnServer.value.username || undefined,
    credential: newTurnServer.value.credential || undefined
  });

  // 重置表单
  resetTurnServerForm();
  showAddTurnServerModal.value = false;
  message.success('TURN服务器已添加');
};

const handleRemoveTurnServer = (index) => {
  config.value.p2p.turn.servers.splice(index, 1);
  message.success('TURN服务器已删除');
};

const resetTurnServerForm = () => {
  newTurnServer.value = {
    urls: '',
    username: '',
    credential: ''
  };
};

// WebRTC 质量监控
const handleRefreshWebRTCQuality = async () => {
  refreshingWebRTCQuality.value = true;
  try {
    // 获取所有连接的质量报告
    const reports = await window.electronAPI.p2p.getWebRTCQualityReport();

    if (reports && Array.isArray(reports)) {
      // 为每个报告获取优化建议
      webrtcQualityReports.value = await Promise.all(
        reports.map(async (report) => {
          const suggestions = await window.electronAPI.p2p.getWebRTCOptimizationSuggestions(report.peerId);
          return {
            ...report,
            suggestions
          };
        })
      );
    } else {
      webrtcQualityReports.value = [];
    }

    message.success('WebRTC质量报告已更新');
  } catch (error) {
    console.error('获取WebRTC质量报告失败:', error);
    message.error('获取WebRTC质量报告失败：' + error.message);
  } finally {
    refreshingWebRTCQuality.value = false;
  }
};

// 质量等级颜色映射
const getQualityColor = (quality) => {
  const colorMap = {
    'excellent': 'green',
    'good': 'blue',
    'fair': 'orange',
    'poor': 'red',
    'critical': 'red'
  };
  return colorMap[quality] || 'default';
};

// 质量等级标签映射
const getQualityLabel = (quality) => {
  const labelMap = {
    'excellent': '优秀',
    'good': '良好',
    'fair': '一般',
    'poor': '较差',
    'critical': '严重'
  };
  return labelMap[quality] || quality;
};

// 优先级颜色映射
const getPriorityColor = (priority) => {
  const colorMap = {
    'high': 'red',
    'medium': 'orange',
    'low': 'blue'
  };
  return colorMap[priority] || 'default';
};

// 格式化运行时间
const formatUptime = (uptime) => {
  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
};

// 测试 LLM 连接
const testLLMConnection = async () => {
  testingConnection.value = true;
  llmTestResult.value = null;

  try {
    // 验证必填字段
    const provider = config.value.llm.provider;
    if (provider === 'openai' && !config.value.llm.openaiApiKey) {
      throw new Error('请先输入 OpenAI API Key');
    }
    if (provider === 'anthropic' && !config.value.llm.anthropicApiKey) {
      throw new Error('请先输入 Claude API Key');
    }
    if (provider === 'volcengine' && !config.value.llm.volcengineApiKey) {
      throw new Error('请先输入火山引擎 API Key');
    }
    if (provider === 'deepseek' && !config.value.llm.deepseekApiKey) {
      throw new Error('请先输入 DeepSeek API Key');
    }
    if (provider === 'dashscope' && !config.value.llm.dashscopeApiKey) {
      throw new Error('请先输入阿里通义千问 API Key');
    }
    if (provider === 'zhipu' && !config.value.llm.zhipuApiKey) {
      throw new Error('请先输入智谱 AI API Key');
    }

    // 构建LLM配置对象
    const llmConfig = {
      provider: provider,
      options: {
        temperature: 0.7,
        timeout: 120000,
      },
    };

    // 根据提供商添加特定配置
    switch (provider) {
      case 'ollama':
        llmConfig.ollama = {
          url: config.value.llm.ollamaHost || 'http://localhost:11434',
          model: config.value.llm.ollamaModel || 'llama2',
        };
        break;
      case 'openai':
        llmConfig.openai = {
          apiKey: config.value.llm.openaiApiKey,
          baseURL: config.value.llm.openaiBaseUrl || 'https://api.openai.com/v1',
          model: config.value.llm.openaiModel || 'gpt-3.5-turbo',
        };
        break;
      case 'anthropic':
        llmConfig.anthropic = {
          apiKey: config.value.llm.anthropicApiKey,
          baseURL: config.value.llm.anthropicBaseUrl || 'https://api.anthropic.com',
          model: config.value.llm.anthropicModel || 'claude-3-5-sonnet-20241022',
          version: '2023-06-01',
        };
        break;
      case 'volcengine':
        llmConfig.volcengine = {
          apiKey: config.value.llm.volcengineApiKey,
          baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
          model: config.value.llm.volcengineModel || 'doubao-pro-4k',
        };
        break;
      case 'deepseek':
        llmConfig.deepseek = {
          apiKey: config.value.llm.deepseekApiKey,
          baseURL: 'https://api.deepseek.com/v1',
          model: config.value.llm.deepseekModel || 'deepseek-chat',
        };
        break;
      case 'dashscope':
        llmConfig.dashscope = {
          apiKey: config.value.llm.dashscopeApiKey,
          model: config.value.llm.dashscopeModel || 'qwen-turbo',
        };
        break;
      case 'zhipu':
        llmConfig.zhipu = {
          apiKey: config.value.llm.zhipuApiKey,
          model: config.value.llm.zhipuModel || 'glm-4',
        };
        break;
    }

    // 先保存LLM配置
    await window.electronAPI.llm.setConfig(llmConfig);

    // 然后测试连接
    const result = await window.electronAPI.llm.checkStatus();

    if (result.available) {
      llmTestResult.value = {
        success: true,
        message: '连接成功！服务正常运行',
      };
      message.success('LLM 服务连接成功');
    } else {
      llmTestResult.value = {
        success: false,
        message: '连接失败: ' + (result.error || '未知错误'),
      };
      message.error('LLM 服务连接失败');
    }
  } catch (error) {
    console.error('测试LLM连接失败:', error);
    llmTestResult.value = {
      success: false,
      message: '测试失败: ' + error.message,
    };
    message.error('测试失败：' + error.message);
  } finally {
    testingConnection.value = false;
  }
};

// 测试嵌入模型
const testEmbedding = async () => {
  testingEmbedding.value = true;
  embeddingTestResult.value = null;

  try {
    // 验证必填字段
    const provider = config.value.llm.provider;
    if (provider === 'openai' && !config.value.llm.openaiApiKey) {
      throw new Error('请先输入 OpenAI API Key');
    }
    if (provider === 'volcengine' && !config.value.llm.volcengineApiKey) {
      throw new Error('请先输入火山引擎 API Key');
    }
    if (provider === 'deepseek' && !config.value.llm.deepseekApiKey) {
      throw new Error('请先输入 DeepSeek API Key');
    }
    if (provider === 'dashscope' && !config.value.llm.dashscopeApiKey) {
      throw new Error('请先输入阿里通义千问 API Key');
    }
    if (provider === 'zhipu' && !config.value.llm.zhipuApiKey) {
      throw new Error('请先输入智谱 AI API Key');
    }

    // 构建LLM配置对象（包含嵌入模型）
    const llmConfig = {
      provider: provider,
      options: {
        timeout: 120000,
      },
    };

    // 根据提供商添加特定配置
    switch (provider) {
      case 'ollama':
        llmConfig.ollama = {
          url: config.value.llm.ollamaHost || 'http://localhost:11434',
          model: config.value.llm.ollamaModel || 'llama2',
          embeddingModel: config.value.llm.ollamaEmbeddingModel || 'nomic-embed-text',
        };
        break;
      case 'openai':
        llmConfig.openai = {
          apiKey: config.value.llm.openaiApiKey,
          baseURL: config.value.llm.openaiBaseUrl || 'https://api.openai.com/v1',
          model: config.value.llm.openaiModel || 'gpt-3.5-turbo',
          embeddingModel: config.value.llm.openaiEmbeddingModel || 'text-embedding-3-small',
        };
        break;
      case 'volcengine':
        llmConfig.volcengine = {
          apiKey: config.value.llm.volcengineApiKey,
          baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
          model: config.value.llm.volcengineModel || 'doubao-pro-4k',
          embeddingModel: config.value.llm.volcengineEmbeddingModel || 'doubao-embedding',
        };
        break;
      case 'deepseek':
        llmConfig.deepseek = {
          apiKey: config.value.llm.deepseekApiKey,
          baseURL: 'https://api.deepseek.com/v1',
          model: config.value.llm.deepseekModel || 'deepseek-chat',
          embeddingModel: config.value.llm.deepseekEmbeddingModel || '',
        };
        break;
      case 'dashscope':
        llmConfig.dashscope = {
          apiKey: config.value.llm.dashscopeApiKey,
          model: config.value.llm.dashscopeModel || 'qwen-turbo',
          embeddingModel: config.value.llm.dashscopeEmbeddingModel || 'text-embedding-v2',
        };
        break;
      case 'zhipu':
        llmConfig.zhipu = {
          apiKey: config.value.llm.zhipuApiKey,
          model: config.value.llm.zhipuModel || 'glm-4',
          embeddingModel: config.value.llm.zhipuEmbeddingModel || 'embedding-2',
        };
        break;
      default:
        throw new Error(`提供商 ${provider} 可能不支持嵌入模型`);
    }

    // 先保存LLM配置
    await window.electronAPI.llm.setConfig(llmConfig);

    // 测试嵌入功能
    const testText = '这是一段用于测试嵌入模型的中文文本。';
    const result = await window.electronAPI.llm.embeddings(testText);

    if (result && Array.isArray(result) && result.length > 0) {
      embeddingTestResult.value = {
        success: true,
        message: `嵌入生成成功！向量维度: ${result.length}`,
      };
      message.success(`嵌入模型测试成功，向量维度: ${result.length}`);
    } else {
      embeddingTestResult.value = {
        success: false,
        message: '嵌入生成失败: 返回结果为空',
      };
      message.error('嵌入模型测试失败');
    }
  } catch (error) {
    console.error('测试嵌入模型失败:', error);
    embeddingTestResult.value = {
      success: false,
      message: '测试失败: ' + error.message,
    };
    message.error('测试失败：' + error.message);
  } finally {
    testingEmbedding.value = false;
  }
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    // 深拷贝并清理配置对象，确保可序列化
    const cleanConfig = JSON.parse(JSON.stringify(config.value));
    await window.electronAPI.config.update(cleanConfig);
    message.success('配置已保存，部分修改需要重启应用生效');
  } catch (error) {
    console.error('保存配置失败:', error);
    message.error('保存配置失败：' + error.message);
  } finally {
    saving.value = false;
  }
};

// 重置配置
const handleReset = () => {
  Modal.confirm({
    title: '确认重置',
    content: '确定要将所有配置重置为默认值吗？此操作不可撤销！',
    okText: '重置',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.config.reset();
        await loadConfig();
        message.success('配置已重置为默认值');
      } catch (error) {
        console.error('重置配置失败:', error);
        message.error('重置配置失败：' + error.message);
      }
    },
  });
};

// 导出为 .env 文件
const handleExportEnv = async () => {
  try {
    // 使用 showSaveDialog 让用户选择保存位置
    const result = await window.electronAPI.dialog.showSaveDialog({
      title: '导出配置为 .env 文件',
      defaultPath: '.env',
      filters: [
        { name: '环境变量文件', extensions: ['env'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    if (result && !result.canceled && result.filePath) {
      await window.electronAPI.config.exportEnv(result.filePath);
      message.success('配置已导出到：' + result.filePath);
    }
  } catch (error) {
    console.error('导出配置失败:', error);
    message.error('导出配置失败：' + error.message);
  }
};

// 选择文件夹
const handleSelectFolder = async (configPath) => {
  try {
    // 获取当前配置值作为默认路径
    const currentValue = configPath.split('.').reduce((obj, key) => obj?.[key], config.value);

    const selectedPath = await window.electronAPI.dialog.selectFolder({
      title: '选择文件夹',
      defaultPath: currentValue || undefined,
      buttonLabel: '选择'
    });

    if (selectedPath) {
      // 更新配置对象
      const keys = configPath.split('.');
      let obj = config.value;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = selectedPath;

      message.success('文件夹已选择：' + selectedPath);
    }
  } catch (error) {
    console.error('选择文件夹失败:', error);
    message.error('选择文件夹失败：' + error.message);
  }
};

// 取消
const handleCancel = () => {
  router.back();
};

// 选择数据库路径
const handleSelectDatabasePath = async () => {
  try {
    // 获取当前数据库目录作为默认路径
    const currentPath = databaseConfig.value.path || '';
    const lastSlash = Math.max(currentPath.lastIndexOf('/'), currentPath.lastIndexOf('\\'));
    const defaultDir = lastSlash > 0 ? currentPath.substring(0, lastSlash) : '';

    const selectedPath = await window.electronAPI.dialog.selectFolder({
      title: '选择数据库存储位置',
      defaultPath: defaultDir,
      buttonLabel: '选择'
    });

    if (selectedPath) {
      // 构造完整的数据库文件路径（处理路径分隔符）
      const separator = selectedPath.includes('\\') ? '\\' : '/';
      newDatabasePath.value = selectedPath + separator + 'chainlesschain.db';
      message.success('已选择新位置：' + newDatabasePath.value);
    }
  } catch (error) {
    console.error('选择数据库路径失败:', error);
    message.error('选择数据库路径失败：' + error.message);
  }
};

// 迁移数据库
const handleMigrateDatabase = async () => {
  if (!newDatabasePath.value) {
    message.warning('请先选择新的数据库位置');
    return;
  }

  Modal.confirm({
    title: '确认迁移数据库',
    content: `确定要将数据库迁移到新位置吗？\n新位置：${newDatabasePath.value}\n\n迁移完成后将自动重启应用。`,
    okText: '迁移',
    cancelText: '取消',
    async onOk() {
      migrating.value = true;
      try {
        const result = await window.electronAPI.db.migrate(newDatabasePath.value);

        message.success('数据库迁移成功！应用即将重启...');

        // 等待2秒后重启应用
        setTimeout(async () => {
          await window.electronAPI.app.restart();
        }, 2000);
      } catch (error) {
        console.error('迁移数据库失败:', error);
        message.error('迁移数据库失败：' + error.message);
        migrating.value = false;
      }
    },
  });
};

// 创建备份
const handleCreateBackup = async () => {
  backing.value = true;
  try {
    const backupPath = await window.electronAPI.db.createBackup();
    message.success('备份创建成功：' + backupPath);

    // 刷新备份列表
    await loadBackupList();
  } catch (error) {
    console.error('创建备份失败:', error);
    message.error('创建备份失败：' + error.message);
  } finally {
    backing.value = false;
  }
};

// 恢复备份
const handleRestoreBackup = (backupPath) => {
  Modal.confirm({
    title: '确认恢复备份',
    content: `确定要从此备份恢复数据库吗？\n备份文件：${backupPath}\n\n当前数据将被覆盖，恢复后需要重启应用。`,
    okText: '恢复',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.db.restoreBackup(backupPath);
        message.success('备份恢复成功！应用即将重启...');

        // 等待2秒后重启应用
        setTimeout(async () => {
          await window.electronAPI.app.restart();
        }, 2000);
      } catch (error) {
        console.error('恢复备份失败:', error);
        message.error('恢复备份失败：' + error.message);
      }
    },
  });
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// 格式化日期
const formatDate = (date) => {
  const d = new Date(date);
  return d.toLocaleString('zh-CN');
};

onMounted(async () => {
  loadConfig();
  loadBackupList();

  // 加载P2P NAT信息
  try {
    natInfo.value = await window.electronAPI.p2p.getNATInfo();
  } catch (error) {
    console.error('加载NAT信息失败:', error);
  }
});
</script>

<style scoped>
.system-settings {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  flex-shrink: 0;
  padding: 24px 24px 0;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.settings-header h1 {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-header p {
  margin: 0 0 24px 0;
  color: #666;
  font-size: 14px;
}

:deep(.ant-spin-nested-loading),
:deep(.ant-spin-container) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.ant-tabs) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 24px;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

:deep(.ant-tabs-nav) {
  flex-shrink: 0;
  margin-bottom: 16px;
}

:deep(.ant-tabs-content-holder) {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

:deep(.ant-tabs-content) {
  height: 100%;
}

.settings-actions {
  flex-shrink: 0;
  margin-top: 16px;
  margin-bottom: 24px;
  padding: 24px;
  background: #f5f5f5;
  border-radius: 8px;
  text-align: center;
}

:deep(.ant-card) {
  margin-bottom: 16px;
}

:deep(.ant-divider) {
  margin: 16px 0;
}
</style>
