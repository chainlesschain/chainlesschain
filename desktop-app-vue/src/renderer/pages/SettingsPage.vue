<template>
  <div class="settings-page">
    <div class="settings-content">
      <a-tabs
        v-model:active-key="activeTab"
        type="card"
        class="settings-tabs"
      >
        <!-- 通用设置 -->
        <a-tab-pane
          key="general"
          tab="通用"
        >
          <template #tab>
            <span>
              <setting-outlined />
              通用
            </span>
          </template>
          <a-card title="通用设置">
            <a-form
              :label-col="{ span: 6 }"
              :wrapper-col="{ span: 18 }"
            >
              <a-form-item label="主题">
                <a-radio-group v-model:value="theme">
                  <a-radio value="light">
                    浅色
                  </a-radio>
                  <a-radio value="dark">
                    深色
                  </a-radio>
                  <a-radio value="auto">
                    跟随系统
                  </a-radio>
                </a-radio-group>
              </a-form-item>

              <a-form-item :label="$t('settings.language')">
                <a-select
                  v-model:value="language"
                  style="width: 200px"
                  @change="handleLanguageChange"
                >
                  <a-select-option
                    v-for="lang in supportedLanguages"
                    :key="lang.value"
                    :value="lang.value"
                  >
                    {{ lang.icon }} {{ lang.label }}
                  </a-select-option>
                </a-select>
              </a-form-item>

              <a-form-item label="启动时打开">
                <a-switch v-model:checked="openOnStartup" />
              </a-form-item>

              <a-form-item label="最小化到托盘">
                <a-switch v-model:checked="minimizeToTray" />
              </a-form-item>

              <a-form-item :wrapper-col="{ offset: 6, span: 18 }">
                <a-button
                  type="primary"
                  @click="handleSaveGeneral"
                >
                  保存设置
                </a-button>
              </a-form-item>
            </a-form>
          </a-card>
        </a-tab-pane>

        <!-- LLM 服务设置 -->
        <a-tab-pane
          key="llm"
          tab="LLM 服务"
        >
          <template #tab>
            <span>
              <api-outlined />
              LLM 服务
            </span>
          </template>
          <LLMSettings />
        </a-tab-pane>

        <!-- Token 使用与成本 -->
        <a-tab-pane
          key="token-usage"
          tab="Token 使用"
        >
          <template #tab>
            <span>
              <dollar-outlined />
              Token 使用
            </span>
          </template>
          <TokenUsageTab />
        </a-tab-pane>

        <!-- MCP 服务器管理 -->
        <a-tab-pane
          key="mcp"
          tab="MCP 服务器"
        >
          <template #tab>
            <span>
              <api-outlined />
              MCP 服务器
            </span>
          </template>
          <MCPSettings />
        </a-tab-pane>

        <!-- Git 同步设置 -->
        <a-tab-pane
          key="git"
          tab="Git 同步"
        >
          <template #tab>
            <span>
              <sync-outlined />
              Git 同步
            </span>
          </template>
          <GitSettings />
        </a-tab-pane>

        <!-- RAG 知识库设置 -->
        <a-tab-pane
          key="rag"
          tab="知识库RAG"
        >
          <template #tab>
            <span>
              <database-outlined />
              知识库RAG
            </span>
          </template>
          <RAGSettings />
        </a-tab-pane>

        <!-- U盾设置 -->
        <a-tab-pane
          key="ukey"
          tab="U盾"
        >
          <template #tab>
            <span>
              <safety-outlined />
              U盾
            </span>
          </template>
          <a-card title="U盾设置">
            <a-descriptions
              bordered
              :column="1"
            >
              <a-descriptions-item label="设备状态">
                <a-tag
                  v-if="store.ukeyStatus.detected"
                  color="success"
                >
                  已检测
                </a-tag>
                <a-tag
                  v-else
                  color="error"
                >
                  未检测
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="锁定状态">
                <a-tag
                  v-if="store.ukeyStatus.unlocked"
                  color="success"
                >
                  已解锁
                </a-tag>
                <a-tag
                  v-else
                  color="warning"
                >
                  已锁定
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <div style="margin-top: 16px">
              <a-alert
                type="info"
                message="U盾用于保护您的数据安全"
                description="请妥善保管您的U盾设备和PIN码"
                show-icon
              />
            </div>
          </a-card>
        </a-tab-pane>

        <!-- 数据库安全 -->
        <a-tab-pane
          key="database"
          tab="数据库安全"
        >
          <template #tab>
            <span>
              <lock-outlined />
              数据库安全
            </span>
          </template>
          <a-card>
            <a-result
              status="info"
              title="数据库加密设置"
              sub-title="完整的数据库安全设置请访问专用页面"
            >
              <template #extra>
                <a-button
                  type="primary"
                  @click="router.push('/settings/database-security')"
                >
                  <lock-outlined /> 进入数据库安全设置
                </a-button>
              </template>
            </a-result>
          </a-card>
        </a-tab-pane>

        <!-- Additional Tools V3 统计 -->
        <a-tab-pane
          key="additional-tools-v3"
          tab="工具统计"
        >
          <template #tab>
            <span>
              <bar-chart-outlined />
              工具统计
            </span>
          </template>
          <AdditionalToolsStats />
        </a-tab-pane>

        <!-- 性能监控 -->
        <a-tab-pane
          key="performance"
          tab="性能监控"
        >
          <template #tab>
            <span>
              <dashboard-outlined />
              性能监控
            </span>
          </template>
          <a-card title="系统性能监控">
            <PerformanceDashboard v-model:open="performanceDashboardVisible" />
            <a-button
              v-if="!performanceDashboardVisible"
              type="primary"
              @click="performanceDashboardVisible = true"
            >
              <dashboard-outlined />
              打开性能仪表板
            </a-button>
          </a-card>
        </a-tab-pane>

        <!-- 关于 -->
        <a-tab-pane
          key="about"
          tab="关于"
        >
          <template #tab>
            <span>
              <info-circle-outlined />
              关于
            </span>
          </template>
          <a-card title="关于 ChainlessChain">
            <a-descriptions
              bordered
              :column="1"
            >
              <a-descriptions-item label="版本">
                0.1.0
              </a-descriptions-item>
              <a-descriptions-item label="描述">
                ChainlessChain 是一个基于 Electron + Vue 3 的个人 AI 知识库系统
              </a-descriptions-item>
              <a-descriptions-item label="技术栈">
                <a-space direction="vertical">
                  <a-tag color="blue">
                    Electron 28
                  </a-tag>
                  <a-tag color="green">
                    Vue 3
                  </a-tag>
                  <a-tag color="purple">
                    Ant Design Vue 4
                  </a-tag>
                  <a-tag color="orange">
                    Vite 5
                  </a-tag>
                </a-space>
              </a-descriptions-item>
              <a-descriptions-item label="功能特性">
                <ul style="margin: 0; padding-left: 20px">
                  <li>SQLite 本地数据库</li>
                  <li>U盾硬件加密</li>
                  <li>Git 同步支持</li>
                  <li>LLM AI 对话</li>
                  <li>Markdown 编辑</li>
                  <li>全文搜索</li>
                </ul>
              </a-descriptions-item>
            </a-descriptions>

            <div style="margin-top: 16px">
              <a-space>
                <a-button
                  type="link"
                  @click="checkUpdate"
                >
                  检查更新
                </a-button>
                <a-button
                  type="link"
                  @click="openGithub"
                >
                  GitHub
                </a-button>
              </a-space>
            </div>
          </a-card>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import {
  ApiOutlined,
  SyncOutlined,
  SafetyOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  DatabaseOutlined,
  LockOutlined,
  BarChartOutlined,
  DashboardOutlined,
} from "@ant-design/icons-vue";
import { useAppStore } from "../stores/app";
import { supportedLocales, setLocale, getLocale } from "../locales";
import LLMSettings from "../components/LLMSettings.vue";
import TokenUsageTab from "../components/TokenUsageTab.vue";
import GitSettings from "../components/GitSettings.vue";
import RAGSettings from "../components/RAGSettings.vue";
import AdditionalToolsStats from "../components/tool/AdditionalToolsStats.vue";
import PerformanceDashboard from "../components/PerformanceDashboard.vue";

const router = useRouter();
const store = useAppStore();
import MCPSettings from "../components/MCPSettings.vue";
const { t } = useI18n();

// 当前激活的标签页
const activeTab = ref("general");

// 支持的语言列表
const supportedLanguages = supportedLocales;

// 通用设置
const theme = ref("light");
const language = ref(getLocale());
const openOnStartup = ref(false);
const minimizeToTray = ref(true);

// 性能仪表板
const performanceDashboardVisible = ref(false);

// 处理语言切换
const handleLanguageChange = (value) => {
  setLocale(value);
  const langInfo = supportedLocales.find((lang) => lang.value === value);
  message.success(t("common.success") + ": " + langInfo.label);
};

// 返回
const handleBack = () => {
  router.push("/");
};

// 保存通用设置
const handleSaveGeneral = () => {
  message.success("设置已保存");
};

// 检查更新
const checkUpdate = () => {
  message.info("当前已是最新版本");
};

// 打开 GitHub
const openGithub = () => {
  // 通过 IPC 打开外部链接
  message.info("即将打开 GitHub 页面");
};

// 组件挂载时
onMounted(() => {
  // 从 URL 参数获取标签页
  const query = router.currentRoute.value.query;
  if (query.tab) {
    activeTab.value = query.tab;
  }
});
</script>

<style scoped>
.settings-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  margin: -24px;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.settings-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-tabs :deep(.ant-tabs-nav) {
  padding: 16px 24px 0;
  margin: 0;
  flex-shrink: 0;
}

.settings-tabs :deep(.ant-tabs-content-holder) {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.settings-tabs :deep(.ant-tabs-content) {
  height: 100%;
}

.settings-tabs :deep(.ant-tabs-tabpane) {
  padding: 24px;
  min-height: min-content;
}

.settings-tabs :deep(.ant-card) {
  margin-bottom: 16px;
}
</style>
