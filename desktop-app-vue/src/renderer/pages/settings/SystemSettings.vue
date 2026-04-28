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
      <a-tabs v-model:active-key="activeTab" type="card">
        <!-- 通用设置 -->
        <a-tab-pane key="general" tab="通用设置">
          <template #tab>
            <SettingOutlined />
            通用设置
          </template>
          <a-card title="通用设置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="主题">
                <a-radio-group
                  v-model:value="config.general.theme"
                  button-style="solid"
                >
                  <a-radio-button value="light"> 浅色 </a-radio-button>
                  <a-radio-button value="dark"> 深色 </a-radio-button>
                  <a-radio-button value="auto"> 跟随系统 </a-radio-button>
                </a-radio-group>
              </a-form-item>

              <a-form-item label="语言">
                <a-select
                  v-model:value="config.general.language"
                  style="width: 200px"
                >
                  <a-select-option value="zh-CN"> 🇨🇳 简体中文 </a-select-option>
                  <a-select-option value="zh-TW"> 🇹🇼 繁体中文 </a-select-option>
                  <a-select-option value="en-US"> 🇺🇸 English </a-select-option>
                  <a-select-option value="ja-JP"> 🇯🇵 日本語 </a-select-option>
                  <a-select-option value="ko-KR"> 🇰🇷 한국어 </a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="开机自启">
                <a-switch v-model:checked="config.general.autoStart" />
                <span style="margin-left: 8px">系统启动时自动运行应用</span>
              </a-form-item>

              <a-form-item label="最小化到托盘">
                <a-switch v-model:checked="config.general.minimizeToTray" />
                <span style="margin-left: 8px"
                  >点击最小化按钮时隐藏到系统托盘</span
                >
              </a-form-item>

              <a-form-item label="关闭到托盘">
                <a-switch v-model:checked="config.general.closeToTray" />
                <span style="margin-left: 8px"
                  >点击关闭按钮时隐藏到系统托盘而不是退出</span
                >
              </a-form-item>

              <a-form-item label="启动时最小化">
                <a-switch v-model:checked="config.general.startMinimized" />
                <span style="margin-left: 8px">应用启动时直接最小化到托盘</span>
              </a-form-item>

              <a-form-item label="启用 V6 桌面壳">
                <a-switch v-model:checked="config.ui.useV6ShellByDefault" />
                <span style="margin-left: 8px">
                  保存后重启生效。Phase 3.4 硬翻后已默认开启；关闭则回退经典 V5
                  壳。也可以
                  <a @click.prevent="openV6PreviewNow">立即试用</a>
                  而不改变默认。
                </span>
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 编辑器设置 -->
        <a-tab-pane key="editor" tab="编辑器">
          <template #tab>
            <EditOutlined />
            编辑器
          </template>
          <a-card title="编辑器设置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="字体大小">
                <a-slider
                  v-model:value="config.editor.fontSize"
                  :min="10"
                  :max="32"
                  :marks="{
                    10: '10px',
                    14: '14px',
                    18: '18px',
                    24: '24px',
                    32: '32px',
                  }"
                />
              </a-form-item>

              <a-form-item label="字体">
                <a-input
                  v-model:value="config.editor.fontFamily"
                  placeholder="Consolas, Monaco, monospace"
                />
              </a-form-item>

              <a-form-item label="行高">
                <a-input-number
                  v-model:value="config.editor.lineHeight"
                  :min="1.0"
                  :max="3.0"
                  :step="0.1"
                  style="width: 200px"
                />
              </a-form-item>

              <a-form-item label="Tab 大小">
                <a-input-number
                  v-model:value="config.editor.tabSize"
                  :min="2"
                  :max="8"
                  style="width: 200px"
                />
              </a-form-item>

              <a-form-item label="自动换行">
                <a-switch v-model:checked="config.editor.wordWrap" />
              </a-form-item>

              <a-form-item label="自动保存">
                <a-switch v-model:checked="config.editor.autoSave" />
                <span style="margin-left: 8px">编辑后自动保存</span>
              </a-form-item>

              <a-form-item v-if="config.editor.autoSave" label="自动保存延迟">
                <a-input-number
                  v-model:value="config.editor.autoSaveDelay"
                  :min="500"
                  :max="10000"
                  :step="500"
                  addon-after="毫秒"
                  style="width: 200px"
                />
              </a-form-item>

              <a-form-item label="拼写检查">
                <a-switch v-model:checked="config.editor.spellCheck" />
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 快捷键设置 -->
        <a-tab-pane key="shortcuts" tab="快捷键">
          <template #tab>
            <ThunderboltOutlined />
            快捷键
          </template>
          <a-card title="全局快捷键">
            <a-form :label-col="{ span: 8 }" :wrapper-col="{ span: 16 }">
              <a-form-item label="显示/隐藏窗口">
                <a-input
                  v-model:value="config.shortcuts['show-hide-window']"
                  placeholder="CommandOrControl+Shift+Space"
                  readonly
                />
              </a-form-item>

              <a-form-item label="新建笔记">
                <a-input
                  v-model:value="config.shortcuts['new-note']"
                  placeholder="CommandOrControl+N"
                  readonly
                />
              </a-form-item>

              <a-form-item label="全局搜索">
                <a-input
                  v-model:value="config.shortcuts['global-search']"
                  placeholder="CommandOrControl+K"
                  readonly
                />
              </a-form-item>

              <a-form-item label="截图">
                <a-input
                  v-model:value="config.shortcuts['screenshot']"
                  placeholder="CommandOrControl+Shift+S"
                  readonly
                />
              </a-form-item>

              <a-form-item label="剪贴板历史">
                <a-input
                  v-model:value="config.shortcuts['clipboard-history']"
                  placeholder="CommandOrControl+Shift+V"
                  readonly
                />
              </a-form-item>
            </a-form>
            <a-alert
              message="快捷键说明"
              description="CommandOrControl 在 macOS 上为 Command 键,在 Windows/Linux 上为 Ctrl 键"
              type="info"
              show-icon
              style="margin-top: 16px"
            />
          </a-card>
        </a-tab-pane>

        <!-- 隐私设置 -->
        <a-tab-pane key="privacy" tab="隐私">
          <template #tab>
            <EyeInvisibleOutlined />
            隐私
          </template>
          <a-card title="隐私与数据">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="匿名统计">
                <a-switch v-model:checked="config.privacy.analytics" />
                <span style="margin-left: 8px"
                  >帮助我们改进产品(不包含个人信息)</span
                >
              </a-form-item>

              <a-form-item label="崩溃报告">
                <a-switch v-model:checked="config.privacy.crashReports" />
                <span style="margin-left: 8px">自动发送崩溃报告</span>
              </a-form-item>

              <a-form-item label="错误报告">
                <a-switch v-model:checked="config.privacy.errorReporting" />
                <span style="margin-left: 8px">自动发送错误日志</span>
              </a-form-item>

              <a-form-item label="剪贴板历史">
                <a-switch v-model:checked="config.privacy.clipboardHistory" />
                <span style="margin-left: 8px">记录剪贴板历史</span>
              </a-form-item>
            </a-form>
            <a-alert
              message="数据安全承诺"
              description="我们承诺不会收集您的个人数据和笔记内容。所有统计数据都是匿名的,仅用于改进产品体验。"
              type="success"
              show-icon
              style="margin-top: 16px"
            />
          </a-card>
        </a-tab-pane>

        <!-- 性能设置 -->
        <a-tab-pane key="performance" tab="性能">
          <template #tab>
            <DashboardOutlined />
            性能
          </template>
          <PerformancePane v-model:config="config" />
        </a-tab-pane>

        <!-- 通知设置 -->
        <a-tab-pane key="notifications" tab="通知">
          <template #tab>
            <BellOutlined />
            通知
          </template>
          <a-card title="通知设置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="启用通知">
                <a-switch v-model:checked="config.notifications.enabled" />
              </a-form-item>

              <template v-if="config.notifications.enabled">
                <a-form-item label="通知声音">
                  <a-switch v-model:checked="config.notifications.sound" />
                </a-form-item>

                <a-form-item label="角标提示">
                  <a-switch v-model:checked="config.notifications.badge" />
                  <span style="margin-left: 8px">在应用图标上显示未读数量</span>
                </a-form-item>

                <a-form-item label="桌面通知">
                  <a-switch v-model:checked="config.notifications.desktop" />
                  <span style="margin-left: 8px">显示系统桌面通知</span>
                </a-form-item>
              </template>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- 高级设置 -->
        <a-tab-pane key="advanced" tab="高级">
          <template #tab>
            <ToolOutlined />
            高级
          </template>
          <a-card title="高级设置">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="开发者工具">
                <a-switch v-model:checked="config.advanced.devTools" />
                <span style="margin-left: 8px">启用开发者工具(F12)</span>
              </a-form-item>

              <a-form-item label="实验性功能">
                <a-switch
                  v-model:checked="config.advanced.experimentalFeatures"
                />
                <span style="margin-left: 8px">启用实验性功能(可能不稳定)</span>
              </a-form-item>

              <a-form-item label="调试模式">
                <a-switch v-model:checked="config.advanced.debugMode" />
                <span style="margin-left: 8px">启用详细日志输出</span>
              </a-form-item>

              <a-form-item label="日志级别">
                <a-select
                  v-model:value="config.advanced.logLevel"
                  style="width: 200px"
                >
                  <a-select-option value="error">
                    Error (仅错误)
                  </a-select-option>
                  <a-select-option value="warn">
                    Warn (警告及以上)
                  </a-select-option>
                  <a-select-option value="info">
                    Info (信息及以上)
                  </a-select-option>
                  <a-select-option value="debug">
                    Debug (调试及以上)
                  </a-select-option>
                  <a-select-option value="trace">
                    Trace (全部)
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-form>
            <a-alert
              message="警告"
              description="高级设置仅供开发者和高级用户使用。不当的设置可能导致应用不稳定或数据丢失。"
              type="error"
              show-icon
              style="margin-top: 16px"
            />
          </a-card>
        </a-tab-pane>

        <!-- 版本设置 -->
        <a-tab-pane key="edition" tab="版本设置">
          <template #tab>
            <AppstoreOutlined />
            版本设置
          </template>
          <a-card title="版本信息">
            <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
              <a-form-item label="当前版本">
                <a-radio-group
                  v-model:value="config.app.edition"
                  button-style="solid"
                >
                  <a-radio-button value="personal">
                    个人版（本地存储）
                  </a-radio-button>
                  <a-radio-button value="enterprise">
                    企业版（服务器连接）
                  </a-radio-button>
                </a-radio-group>
              </a-form-item>

              <!-- 企业版配置（仅在选择企业版时显示） -->
              <template
                v-if="config.app && config.app.edition === 'enterprise'"
              >
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
          <ProjectPane v-model:config="config" />
        </a-tab-pane>

        <!-- LLM 配置 -->
        <a-tab-pane key="llm">
          <template #tab>
            <RobotOutlined />
            AI 模型
          </template>
          <LLMPane v-model:config="config" />
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
                <a-input
                  v-model:value="config.vector.qdrantHost"
                  placeholder="http://localhost:6333"
                />
              </a-form-item>

              <a-form-item label="端口">
                <a-input-number
                  v-model:value="config.vector.qdrantPort"
                  :min="1"
                  :max="65535"
                  style="width: 200px"
                />
              </a-form-item>

              <a-form-item label="集合名称">
                <a-input
                  v-model:value="config.vector.qdrantCollection"
                  placeholder="chainlesschain_vectors"
                />
              </a-form-item>

              <a-form-item label="Embedding 模型">
                <a-input
                  v-model:value="config.vector.embeddingModel"
                  placeholder="bge-base-zh-v1.5"
                />
              </a-form-item>

              <a-form-item label="向量维度">
                <a-input-number
                  v-model:value="config.vector.embeddingDimension"
                  :min="128"
                  :max="2048"
                  style="width: 200px"
                />
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
                  <span style="margin-left: 8px">自动提交和推送</span>
                </a-form-item>

                <a-form-item v-if="config.git.autoSync" label="同步间隔">
                  <a-input-number
                    v-model:value="config.git.autoSyncInterval"
                    :min="60"
                    :max="3600"
                    :step="60"
                    addon-after="秒"
                    style="width: 200px"
                  />
                </a-form-item>

                <a-form-item label="用户名">
                  <a-input
                    v-model:value="config.git.userName"
                    placeholder="Your Name"
                  />
                </a-form-item>

                <a-form-item label="邮箱">
                  <a-input
                    v-model:value="config.git.userEmail"
                    placeholder="your.email@example.com"
                  />
                </a-form-item>

                <a-form-item label="远程仓库 URL">
                  <a-input
                    v-model:value="config.git.remoteUrl"
                    placeholder="https://github.com/username/repo.git"
                  />
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
                <a-input
                  v-model:value="config.backend.projectServiceUrl"
                  placeholder="http://localhost:9090"
                />
              </a-form-item>

              <a-form-item label="AI 服务">
                <a-input
                  v-model:value="config.backend.aiServiceUrl"
                  placeholder="http://localhost:8001"
                />
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
          <DatabasePane />
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
                    style="margin-top: 8px"
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

          <P2PNetworkPane v-model:config="config" />
        </a-tab-pane>

        <!-- 语音识别 -->
        <a-tab-pane key="speech">
          <template #tab>
            <SoundOutlined />
            语音识别
          </template>
          <SpeechRecognitionPane v-model:config="config" />
        </a-tab-pane>
      </a-tabs>

      <!-- 操作按钮 -->
      <div class="settings-actions">
        <a-space size="large">
          <a-button
            type="primary"
            size="large"
            :loading="saving"
            @click="handleSave"
          >
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

          <a-button size="large" @click="handleCancel"> 取消 </a-button>
        </a-space>
      </div>
    </a-spin>
  </div>
</template>

<script setup>
/**
 * V5 system settings — 17 tabs of cross-shell configuration (general /
 * editor / shortcuts / privacy / performance / notifications / advanced /
 * edition / project / llm / vector / git / backend / database / security /
 * p2p / speech). Reads/writes via config:get-all + config:update;
 * activeTab honors ?tab=… deep links from the V6 SettingsPanel.
 *
 * **Partial V6 port note** (2026-04-28, commit a75d1e129): The V6 panel
 * adds a 680px modal SettingsPanel (`shell/SettingsPanel.vue` +
 * `shell/helpers/settingsHelpers.ts`) that surfaces a 4-row status
 * summary (LLM / V6 shell / theme / language) + 7 clickable category
 * cards that deep-link here via /settings/system?tab=<id>. The V5 page
 * is NOT deprecated because: (1) full multi-tab form with sliders /
 * complex selectors does not fit a 680px modal, (2) cross-shell users
 * already reach this page directly via /settings/system, (3) the V6
 * shell's own toggle (ui.useV6ShellByDefault) is set here. New config
 * sections keep landing here; new lightweight summary affordances go
 * to the V6 panel instead.
 */
import { logger } from "@/utils/logger";

import { ref, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  SettingOutlined,
  AppstoreOutlined,
  FolderOutlined,
  RobotOutlined,
  DatabaseOutlined,
  GithubOutlined,
  CloudServerOutlined,
  LockOutlined,
  SaveOutlined,
  ReloadOutlined,
  ExportOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  SoundOutlined,
} from "@ant-design/icons-vue";
import P2PNetworkPane from "./panes/P2PNetworkPane.vue";
import SpeechRecognitionPane from "./panes/SpeechRecognitionPane.vue";
import LLMPane from "./panes/LLMPane.vue";
import DatabasePane from "./panes/DatabasePane.vue";
import ProjectPane from "./panes/ProjectPane.vue";
import PerformancePane from "./panes/PerformancePane.vue";

const router = useRouter();
const route = useRoute();

const loading = ref(false);
const saving = ref(false);
// Initial tab: ?tab=xxx query (used by V6 SettingsPanel deep links) wins,
// otherwise default to project. The watch below keeps it in sync if the
// query changes while the page is mounted.
const activeTab = ref(
  typeof route.query.tab === "string" && route.query.tab.length > 0
    ? route.query.tab
    : "project",
);
watch(
  () => route.query.tab,
  (next) => {
    if (typeof next === "string" && next.length > 0) {
      activeTab.value = next;
    }
  },
);

// 在不改变默认壳的情况下立即打开 V6 预览（/v6-preview，与 router 重定向目标一致）
const openV6PreviewNow = () => {
  router.push("/v6-preview");
};

const config = ref({
  app: {
    edition: "personal", // personal | enterprise
  },
  enterprise: {
    serverUrl: "",
    tenantId: "",
    apiKey: "",
  },
  general: {
    theme: "light",
    language: "zh-CN",
    autoStart: false,
    minimizeToTray: true,
    closeToTray: true,
    startMinimized: false,
  },
  ui: {
    useV6ShellByDefault: true,
  },
  editor: {
    fontSize: 14,
    fontFamily: "Consolas, Monaco, monospace",
    lineHeight: 1.5,
    tabSize: 4,
    wordWrap: true,
    autoSave: true,
    autoSaveDelay: 1000,
    spellCheck: false,
  },
  shortcuts: {
    "show-hide-window": "CommandOrControl+Shift+Space",
    "new-note": "CommandOrControl+N",
    "global-search": "CommandOrControl+K",
    screenshot: "CommandOrControl+Shift+S",
  },
  privacy: {
    analytics: false,
    crashReports: false,
    errorReporting: false,
    clipboardHistory: false,
  },
  performance: {
    hardwareAcceleration: true,
    gpuRasterization: false,
    maxMemory: 512,
    cacheSize: 100,
  },
  project: {
    rootPath: "",
    maxSizeMB: 1000,
    allowedFileTypes: [],
    autoSync: true,
    syncIntervalSeconds: 300,
  },
  llm: {
    provider: "volcengine",
    priority: ["volcengine", "ollama", "deepseek"],
    autoFallback: true,
    autoSelect: true,
    selectionStrategy: "balanced",
    ollamaHost: "",
    ollamaModel: "",
    ollamaEmbeddingModel: "",
    openaiApiKey: "",
    openaiBaseUrl: "",
    openaiModel: "",
    openaiEmbeddingModel: "",
    anthropicApiKey: "",
    anthropicBaseUrl: "",
    anthropicModel: "",
    anthropicEmbeddingModel: "",
    volcengineApiKey: "",
    volcengineModel: "",
    volcengineEmbeddingModel: "",
    dashscopeApiKey: "",
    dashscopeModel: "",
    dashscopeEmbeddingModel: "",
    zhipuApiKey: "",
    zhipuModel: "",
    zhipuEmbeddingModel: "",
    deepseekApiKey: "",
    deepseekModel: "",
    deepseekEmbeddingModel: "",
  },
  vector: {
    qdrantHost: "",
    qdrantPort: 6333,
    qdrantCollection: "",
    embeddingModel: "",
    embeddingDimension: 768,
  },
  git: {
    enabled: false,
    autoSync: false,
    autoSyncInterval: 300,
    userName: "",
    userEmail: "",
    remoteUrl: "",
  },
  backend: {
    projectServiceUrl: "",
    aiServiceUrl: "",
  },
  database: {
    sqlcipherKey: "",
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
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ],
    },
    turn: {
      enabled: false,
      servers: [],
    },
    webrtc: {
      port: 9095,
      iceTransportPolicy: "all",
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
  speech: {
    defaultEngine: "whisper-local",
    webSpeech: {
      lang: "zh-CN",
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
    },
    whisperAPI: {
      apiKey: "",
      baseURL: "https://api.openai.com/v1",
      model: "whisper-1",
      language: "zh",
      temperature: 0,
      responseFormat: "json",
      timeout: 60000,
    },
    whisperLocal: {
      serverUrl: "http://localhost:8002",
      modelSize: "base",
      device: "auto",
      timeout: 120000,
    },
    audio: {
      targetFormat: "wav",
      targetSampleRate: 16000,
      targetChannels: 1,
      maxFileSize: 26214400, // 25MB
      maxDuration: 3600,
      segmentDuration: 300,
      supportedFormats: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"],
    },
    storage: {
      savePath: "",
      keepOriginal: true,
      keepProcessed: false,
      autoCleanup: true,
      cleanupAfterDays: 30,
    },
    knowledgeIntegration: {
      autoSaveToKnowledge: true,
      autoAddToIndex: true,
      defaultType: "note",
    },
    performance: {
      maxConcurrentJobs: 2,
      enableCache: true,
      cacheExpiration: 3600000,
    },
  },
});

// 深度合并配置对象
const deepMerge = (target, source) => {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
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
  } catch (error) {
    logger.error("加载配置失败:", error);
    message.error("加载配置失败：" + error.message);
  } finally {
    loading.value = false;
  }
};

// 保存配置
const handleSave = async () => {
  saving.value = true;
  try {
    // 深拷贝并清理配置对象，确保可序列化
    const cleanConfig = JSON.parse(JSON.stringify(config.value));
    await window.electronAPI.config.update(cleanConfig);
    message.success("配置已保存，部分修改需要重启应用生效");
  } catch (error) {
    logger.error("保存配置失败:", error);
    message.error("保存配置失败：" + error.message);
  } finally {
    saving.value = false;
  }
};

// 重置配置
const handleReset = () => {
  Modal.confirm({
    title: "确认重置",
    content: "确定要将所有配置重置为默认值吗？此操作不可撤销！",
    okText: "重置",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await window.electronAPI.config.reset();
        await loadConfig();
        message.success("配置已重置为默认值");
      } catch (error) {
        logger.error("重置配置失败:", error);
        message.error("重置配置失败：" + error.message);
      }
    },
  });
};

// 导出为 .env 文件
const handleExportEnv = async () => {
  try {
    // 使用 showSaveDialog 让用户选择保存位置
    const result = await window.electronAPI.dialog.showSaveDialog({
      title: "导出配置为 .env 文件",
      defaultPath: ".env",
      filters: [
        { name: "环境变量文件", extensions: ["env"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (result && !result.canceled && result.filePath) {
      await window.electronAPI.config.exportEnv(result.filePath);
      message.success("配置已导出到：" + result.filePath);
    }
  } catch (error) {
    logger.error("导出配置失败:", error);
    message.error("导出配置失败：" + error.message);
  }
};

// 取消
const handleCancel = () => {
  router.back();
};

onMounted(async () => {
  loadConfig();
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
