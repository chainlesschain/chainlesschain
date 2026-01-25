<template>
  <div class="android-features-test-page">
    <a-page-header
      title="安卓端功能测试入口"
      subtitle="桌面端对应安卓端功能的测试页面"
    >
      <template #tags>
        <a-tag color="blue">
          测试页面
        </a-tag>
      </template>
    </a-page-header>

    <div class="features-content">
      <!-- LLM 功能 -->
      <a-card
        title="LLM 功能测试"
        class="feature-card"
      >
        <a-row :gutter="[16, 16]">
          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/settings')"
            >
              <template #cover>
                <div class="card-icon">
                  <SettingOutlined style="font-size: 48px; color: #1890ff" />
                </div>
              </template>
              <a-card-meta
                title="LLM 设置"
                description="配置LLM服务提供商和参数"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/llm/performance')"
            >
              <template #cover>
                <div class="card-icon">
                  <BarChartOutlined style="font-size: 48px; color: #52c41a" />
                </div>
              </template>
              <a-card-meta
                title="Token 使用统计"
                description="查看LLM使用情况和成本分析"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/llm/test-chat')"
            >
              <template #cover>
                <div class="card-icon">
                  <MessageOutlined style="font-size: 48px; color: #722ed1" />
                </div>
              </template>
              <a-card-meta
                title="LLM 测试聊天"
                description="测试不同LLM提供商的对话功能"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-card>

      <!-- P2P 功能 -->
      <a-card
        title="P2P 功能测试"
        class="feature-card"
      >
        <a-row :gutter="[16, 16]">
          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p-messaging')"
            >
              <template #cover>
                <div class="card-icon">
                  <MessageOutlined style="font-size: 48px; color: #1890ff" />
                </div>
              </template>
              <a-card-meta
                title="P2P 消息"
                description="加密点对点消息传输"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/device-pairing')"
            >
              <template #cover>
                <div class="card-icon">
                  <ApiOutlined style="font-size: 48px; color: #52c41a" />
                </div>
              </template>
              <a-card-meta
                title="设备配对"
                description="配对新的P2P设备"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/safety-numbers')"
            >
              <template #cover>
                <div class="card-icon">
                  <SafetyOutlined style="font-size: 48px; color: #fa8c16" />
                </div>
              </template>
              <a-card-meta
                title="安全号码验证"
                description="验证端到端加密的安全性"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/session-fingerprint')"
            >
              <template #cover>
                <div class="card-icon">
                  <ScanOutlined style="font-size: 48px; color: #eb2f96" />
                </div>
              </template>
              <a-card-meta
                title="会话指纹"
                description="查看和验证会话指纹"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/device-management')"
            >
              <template #cover>
                <div class="card-icon">
                  <MobileOutlined style="font-size: 48px; color: #13c2c2" />
                </div>
              </template>
              <a-card-meta
                title="设备管理"
                description="管理所有已配对设备"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/file-transfer')"
            >
              <template #cover>
                <div class="card-icon">
                  <FileOutlined style="font-size: 48px; color: #2f54eb" />
                </div>
              </template>
              <a-card-meta
                title="文件传输"
                description="P2P文件传输管理"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/p2p/message-queue')"
            >
              <template #cover>
                <div class="card-icon">
                  <InboxOutlined style="font-size: 48px; color: #722ed1" />
                </div>
              </template>
              <a-card-meta
                title="消息队列"
                description="查看待发送和待接收消息"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/did')"
            >
              <template #cover>
                <div class="card-icon">
                  <IdcardOutlined style="font-size: 48px; color: #fa541c" />
                </div>
              </template>
              <a-card-meta
                title="DID 管理"
                description="分布式身份管理"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/external-devices')"
            >
              <template #cover>
                <div class="card-icon">
                  <FolderOpenOutlined style="font-size: 48px; color: #faad14" />
                </div>
              </template>
              <a-card-meta
                title="设备文件浏览器"
                description="浏览外部设备文件"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-card>

      <!-- 知识库和AI功能 -->
      <a-card
        title="知识库与AI功能"
        class="feature-card"
      >
        <a-row :gutter="[16, 16]">
          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/knowledge/list')"
            >
              <template #cover>
                <div class="card-icon">
                  <FileTextOutlined style="font-size: 48px; color: #1890ff" />
                </div>
              </template>
              <a-card-meta
                title="知识库列表"
                description="管理个人知识库"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/knowledge/graph')"
            >
              <template #cover>
                <div class="card-icon">
                  <ApartmentOutlined style="font-size: 48px; color: #52c41a" />
                </div>
              </template>
              <a-card-meta
                title="知识图谱"
                description="可视化知识关联"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/ai/chat')"
            >
              <template #cover>
                <div class="card-icon">
                  <RobotOutlined style="font-size: 48px; color: #722ed1" />
                </div>
              </template>
              <a-card-meta
                title="AI 对话"
                description="智能AI助手对话"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-card>

      <!-- 其他功能 -->
      <a-card
        title="其他功能"
        class="feature-card"
      >
        <a-row :gutter="[16, 16]">
          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/projects')"
            >
              <template #cover>
                <div class="card-icon">
                  <ProjectOutlined style="font-size: 48px; color: #1890ff" />
                </div>
              </template>
              <a-card-meta
                title="项目管理"
                description="管理项目和任务"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/call-history')"
            >
              <template #cover>
                <div class="card-icon">
                  <PhoneOutlined style="font-size: 48px; color: #52c41a" />
                </div>
              </template>
              <a-card-meta
                title="通话记录"
                description="查看语音/视频通话历史"
              />
            </a-card>
          </a-col>

          <a-col
            :xs="24"
            :sm="12"
            :md="8"
          >
            <a-card
              hoverable
              @click="navigateTo('/offline-queue')"
            >
              <template #cover>
                <div class="card-icon">
                  <CloudServerOutlined style="font-size: 48px; color: #fa8c16" />
                </div>
              </template>
              <a-card-meta
                title="离线队列"
                description="离线消息队列管理"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-card>
    </div>
  </div>
</template>

<script>
import { useRouter } from 'vue-router';
import {
  SettingOutlined,
  BarChartOutlined,
  MessageOutlined,
  ApiOutlined,
  SafetyOutlined,
  ScanOutlined,
  MobileOutlined,
  FileOutlined,
  InboxOutlined,
  IdcardOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  ApartmentOutlined,
  RobotOutlined,
  ProjectOutlined,
  PhoneOutlined,
  CloudServerOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'AndroidFeaturesTestPage',
  components: {
    SettingOutlined,
    BarChartOutlined,
    MessageOutlined,
    ApiOutlined,
    SafetyOutlined,
    ScanOutlined,
    MobileOutlined,
    FileOutlined,
    InboxOutlined,
    IdcardOutlined,
    FolderOpenOutlined,
    FileTextOutlined,
    ApartmentOutlined,
    RobotOutlined,
    ProjectOutlined,
    PhoneOutlined,
    CloudServerOutlined,
  },
  setup() {
    const router = useRouter();

    const navigateTo = (path) => {
      router.push(path);
    };

    return {
      navigateTo,
    };
  },
};
</script>

<style scoped lang="scss">
.android-features-test-page {
  min-height: 100vh;
  background-color: #f0f2f5;

  .features-content {
    padding: 24px;

    .feature-card {
      margin-bottom: 24px;

      .card-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 120px;
        background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      }

      :deep(.ant-card-body) {
        padding: 16px;
      }

      .ant-card-hoverable {
        transition: all 0.3s;

        &:hover {
          transform: translateY(-4px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
      }
    }
  }
}
</style>
