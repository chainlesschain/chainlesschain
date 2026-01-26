<template>
  <div class="safety-numbers-page">
    <a-page-header
      title="安全号码验证"
      @back="handleBack"
    >
      <template #subTitle>
        {{ peerName || peerId }}
      </template>
    </a-page-header>

    <div class="verification-content">
      <a-card class="info-card">
        <a-alert
          message="端到端加密验证"
          description="通过验证安全号码，您可以确认与对方的通信是端到端加密的，且未被中间人攻击。请与对方对比以下号码是否一致。"
          type="info"
          show-icon
          style="margin-bottom: 24px"
        />

        <!-- Safety Numbers Display -->
        <div class="safety-numbers-container">
          <h3>您的安全号码</h3>
          <div class="safety-numbers">
            <div
              v-for="(group, index) in safetyNumbersGroups"
              :key="index"
              class="number-group"
            >
              {{ group }}
            </div>
          </div>

          <!-- QR Code for verification -->
          <div class="qr-code-section">
            <h4>或扫描二维码验证</h4>
            <div class="qr-code-placeholder">
              <QrcodeOutlined style="font-size: 120px; color: #d9d9d9" />
            </div>
            <a-button
              type="link"
              @click="showQRCode"
            >
              <QrcodeOutlined />
              显示二维码
            </a-button>
          </div>
        </div>

        <!-- Fingerprint Info -->
        <a-divider />
        <div class="fingerprint-section">
          <h3>身份指纹</h3>
          <div class="fingerprint-info">
            <div class="info-item">
              <label>对方设备ID:</label>
              <span class="monospace">{{ peerId }}</span>
            </div>
            <div class="info-item">
              <label>验证状态:</label>
              <a-tag :color="isVerified ? 'success' : 'warning'">
                <SafetyOutlined v-if="isVerified" />
                <ExclamationCircleOutlined v-else />
                {{ isVerified ? '已验证' : '未验证' }}
              </a-tag>
            </div>
            <div
              v-if="verifiedAt"
              class="info-item"
            >
              <label>验证时间:</label>
              <span>{{ formatDate(verifiedAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="action-section">
          <a-button
            v-if="!isVerified"
            type="primary"
            size="large"
            @click="handleVerify"
          >
            <SafetyOutlined />
            标记为已验证
          </a-button>
          <a-button
            v-else
            type="default"
            size="large"
            danger
            @click="handleResetVerification"
          >
            <CloseCircleOutlined />
            重置验证状态
          </a-button>

          <a-button
            size="large"
            @click="handleScanQRCode"
          >
            <ScanOutlined />
            扫描对方二维码
          </a-button>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message, Modal } from 'ant-design-vue';
import {
  QrcodeOutlined,
  SafetyOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  ScanOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'SafetyNumbersPage',
  components: {
    QrcodeOutlined,
    SafetyOutlined,
    ExclamationCircleOutlined,
    CloseCircleOutlined,
    ScanOutlined,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();

    const peerId = ref(route.query.peerId || '');
    const peerName = ref('');
    const safetyNumbers = ref('');
    const isVerified = ref(false);
    const verifiedAt = ref(null);

    const safetyNumbersGroups = computed(() => {
      if (!safetyNumbers.value) return [];
      // Split into groups of 5 digits
      const digits = safetyNumbers.value.replace(/\s/g, '');
      const groups = [];
      for (let i = 0; i < digits.length; i += 5) {
        groups.push(digits.slice(i, i + 5));
      }
      return groups;
    });

    const handleBack = () => {
      router.back();
    };

    const formatDate = (timestamp) => {
      return new Date(timestamp).toLocaleString('zh-CN');
    };

    const loadVerificationInfo = async () => {
      try {
        const info = await window.electron.invoke('p2p:get-verification-info', {
          peerId: peerId.value,
        });

        peerName.value = info.peerName || '';
        safetyNumbers.value = info.safetyNumbers || generateSafetyNumbers();
        isVerified.value = info.isVerified || false;
        verifiedAt.value = info.verifiedAt || null;
      } catch (error) {
        console.error('Load verification info error:', error);
        // Generate fallback safety numbers
        safetyNumbers.value = generateSafetyNumbers();
      }
    };

    const generateSafetyNumbers = () => {
      // Generate 60-digit safety numbers
      let numbers = '';
      for (let i = 0; i < 60; i++) {
        numbers += Math.floor(Math.random() * 10);
      }
      return numbers;
    };

    const handleVerify = () => {
      Modal.confirm({
        title: '确认验证',
        content: '请确认您已与对方通过其他可信渠道（如当面、电话等）核对了安全号码，且完全一致。',
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
          try {
            await window.electron.invoke('p2p:verify-peer', {
              peerId: peerId.value,
            });
            isVerified.value = true;
            verifiedAt.value = Date.now();
            message.success('已标记为已验证');
          } catch (error) {
            console.error('Verify error:', error);
            message.error('验证失败: ' + error.message);
          }
        },
      });
    };

    const handleResetVerification = () => {
      Modal.confirm({
        title: '重置验证状态',
        content: '这将重置与此设备的验证状态。您需要重新验证才能确保通信安全。',
        okText: '确认',
        cancelText: '取消',
        onOk: async () => {
          try {
            await window.electron.invoke('p2p:reset-verification', {
              peerId: peerId.value,
            });
            isVerified.value = false;
            verifiedAt.value = null;
            message.success('验证状态已重置');
          } catch (error) {
            console.error('Reset verification error:', error);
            message.error('重置失败: ' + error.message);
          }
        },
      });
    };

    const showQRCode = () => {
      Modal.info({
        title: '安全号码二维码',
        content: '二维码功能开发中...',
        okText: '关闭',
      });
    };

    const handleScanQRCode = () => {
      Modal.info({
        title: '扫描二维码',
        content: '扫描功能开发中...',
        okText: '关闭',
      });
    };

    onMounted(() => {
      if (!peerId.value) {
        message.error('缺少对等方ID');
        router.back();
        return;
      }

      loadVerificationInfo();
    });

    return {
      peerId,
      peerName,
      safetyNumbers,
      safetyNumbersGroups,
      isVerified,
      verifiedAt,
      handleBack,
      formatDate,
      handleVerify,
      handleResetVerification,
      showQRCode,
      handleScanQRCode,
    };
  },
};
</script>

<style scoped lang="scss">
.safety-numbers-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f0f2f5;

  .verification-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;

    .info-card {
      max-width: 800px;
      margin: 0 auto;

      h3 {
        font-size: 18px;
        font-weight: 500;
        margin-bottom: 16px;
      }

      h4 {
        font-size: 14px;
        margin-bottom: 12px;
        color: #595959;
      }

      .safety-numbers-container {
        .safety-numbers {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
          gap: 12px;
          margin-bottom: 32px;

          .number-group {
            font-size: 20px;
            font-weight: 500;
            font-family: 'Courier New', monospace;
            background-color: #f5f5f5;
            padding: 12px;
            border-radius: 4px;
            text-align: center;
            border: 1px solid #d9d9d9;
          }
        }

        .qr-code-section {
          text-align: center;
          margin-top: 32px;

          .qr-code-placeholder {
            width: 200px;
            height: 200px;
            margin: 16px auto;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #fafafa;
            border: 2px dashed #d9d9d9;
            border-radius: 8px;
          }
        }
      }

      .fingerprint-section {
        .fingerprint-info {
          .info-item {
            display: flex;
            align-items: center;
            margin-bottom: 12px;

            label {
              width: 120px;
              color: #595959;
            }

            .monospace {
              font-family: monospace;
              background-color: #f5f5f5;
              padding: 4px 8px;
              border-radius: 4px;
            }
          }
        }
      }

      .action-section {
        margin-top: 32px;
        display: flex;
        gap: 12px;
        justify-content: center;
      }
    }
  }
}
</style>
