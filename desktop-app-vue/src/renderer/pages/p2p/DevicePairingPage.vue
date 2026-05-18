<template>
  <div class="device-pairing-page">
    <a-page-header
      title="设备配对"
      @back="handleBack"
    />

    <div class="pairing-content">
      <a-card class="pairing-card">
        <div class="pairing-steps">
          <!-- Step 1: Scanning -->
          <div
            v-if="pairingState === 'scanning'"
            class="step-container"
          >
            <a-spin size="large" />
            <h3>正在扫描设备...</h3>
            <p>请确保目标设备已开启并在附近</p>
            <a-button
              type="default"
              @click="handleCancel"
            >
              取消
            </a-button>
          </div>

          <!-- Step 2: Verifying -->
          <div
            v-else-if="pairingState === 'verifying'"
            class="step-container"
          >
            <SecurityScanOutlined style="font-size: 64px; color: #1890ff; margin-bottom: 16px" />
            <h3>验证设备身份</h3>
            <p class="device-name">
              {{ deviceName || deviceId }}
            </p>

            <a-alert
              message="请确认以下安全码匹配"
              type="info"
              show-icon
              style="margin: 24px 0"
            />

            <div class="verification-code">
              <span
                v-for="(digit, index) in verificationCode"
                :key="index"
                class="code-digit"
              >
                {{ digit }}
              </span>
            </div>

            <div class="action-buttons">
              <a-button
                type="primary"
                size="large"
                @click="confirmPairing"
              >
                <CheckOutlined />
                确认配对
              </a-button>
              <a-button
                size="large"
                @click="handleCancel"
              >
                取消
              </a-button>
            </div>
          </div>

          <!-- Step 3: Pairing -->
          <div
            v-else-if="pairingState === 'pairing'"
            class="step-container"
          >
            <a-spin size="large" />
            <h3>正在配对...</h3>
            <p>请稍候</p>
          </div>

          <!-- Step 4: Success -->
          <div
            v-else-if="pairingState === 'success'"
            class="step-container"
          >
            <CheckCircleOutlined style="font-size: 64px; color: #52c41a; margin-bottom: 16px" />
            <h3>配对成功!</h3>
            <p class="device-name">
              {{ deviceName || deviceId }}
            </p>
            <a-button
              type="primary"
              size="large"
              @click="goToChat"
            >
              开始聊天
            </a-button>
          </div>

          <!-- Step 5: Error -->
          <div
            v-else-if="pairingState === 'error'"
            class="step-container"
          >
            <CloseCircleOutlined style="font-size: 64px; color: #ff4d4f; margin-bottom: 16px" />
            <h3>配对失败</h3>
            <p class="error-message">
              {{ errorMessage }}
            </p>
            <div class="action-buttons">
              <a-button
                type="primary"
                @click="handleRetry"
              >
                <ReloadOutlined />
                重试
              </a-button>
              <a-button @click="handleCancel">
                返回
              </a-button>
            </div>
          </div>
        </div>
      </a-card>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  SecurityScanOutlined,
  CheckOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';

export default {
  name: 'DevicePairingPage',
  components: {
    SecurityScanOutlined,
    CheckOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    ReloadOutlined,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();

    const deviceId = ref(route.query.deviceId || '');
    const deviceName = ref(route.query.deviceName || '');
    const pairingState = ref('scanning'); // scanning, verifying, pairing, success, error
    const verificationCode = ref([]);
    const errorMessage = ref('');

    const handleBack = () => {
      router.back();
    };

    const handleCancel = () => {
      // Cancel pairing
      window.electron.invoke('p2p:cancel-pairing', { deviceId: deviceId.value });
      router.back();
    };

    const confirmPairing = async () => {
      pairingState.value = 'pairing';
      try {
        await window.electron.invoke('p2p:confirm-pairing', {
          deviceId: deviceId.value,
        });
        pairingState.value = 'success';
      } catch (error) {
        console.error('Pairing error:', error);
        errorMessage.value = error.message || '配对失败，请重试';
        pairingState.value = 'error';
      }
    };

    const handleRetry = () => {
      pairingState.value = 'scanning';
      startPairing();
    };

    const goToChat = () => {
      router.push({
        name: 'P2PMessaging',
        query: { deviceId: deviceId.value },
      });
    };

    const startPairing = async () => {
      try {
        // Request pairing
        const result = await window.electron.invoke('p2p:start-pairing', {
          deviceId: deviceId.value,
        });

        // Generate verification code
        verificationCode.value = generateVerificationCode();
        pairingState.value = 'verifying';
      } catch (error) {
        console.error('Start pairing error:', error);
        errorMessage.value = error.message || '无法启动配对流程';
        pairingState.value = 'error';
      }
    };

    const generateVerificationCode = () => {
      // Generate a 6-digit verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      return code.split('');
    };

    onMounted(() => {
      if (!deviceId.value) {
        message.error('缺少设备ID');
        router.back();
        return;
      }

      startPairing();
    });

    return {
      deviceId,
      deviceName,
      pairingState,
      verificationCode,
      errorMessage,
      handleBack,
      handleCancel,
      confirmPairing,
      handleRetry,
      goToChat,
    };
  },
};
</script>

<style scoped lang="scss">
.device-pairing-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f0f2f5;

  .pairing-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;

    .pairing-card {
      width: 100%;
      max-width: 600px;
      min-height: 400px;

      .pairing-steps {
        .step-container {
          text-align: center;
          padding: 40px 20px;

          h3 {
            font-size: 24px;
            margin: 16px 0 8px;
            font-weight: 500;
          }

          p {
            color: #8c8c8c;
            margin-bottom: 24px;

            &.device-name {
              font-size: 18px;
              color: #262626;
              font-weight: 500;
            }

            &.error-message {
              color: #ff4d4f;
            }
          }

          .verification-code {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin: 24px 0;

            .code-digit {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 48px;
              height: 64px;
              font-size: 32px;
              font-weight: bold;
              background-color: #f0f0f0;
              border: 2px solid #d9d9d9;
              border-radius: 8px;
              font-family: monospace;
            }
          }

          .action-buttons {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-top: 24px;
          }
        }
      }
    }
  }
}
</style>
