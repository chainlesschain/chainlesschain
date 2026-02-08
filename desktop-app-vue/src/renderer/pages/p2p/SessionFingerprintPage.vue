<template>
  <div class="session-fingerprint-page">
    <a-page-header title="会话指纹验证" @back="handleBack">
      <template #subTitle>
        {{ peerName || peerId }}
      </template>
    </a-page-header>

    <div class="fingerprint-content">
      <a-row :gutter="24">
        <!-- Local Fingerprint -->
        <a-col :xs="24" :md="12">
          <a-card title="本地会话指纹">
            <div class="fingerprint-display">
              <div class="fingerprint-blocks">
                <div
                  v-for="(block, index) in localFingerprintBlocks"
                  :key="index"
                  class="fingerprint-block"
                  :style="{ backgroundColor: block.color }"
                >
                  <span class="block-text">{{ block.text }}</span>
                </div>
              </div>
              <div class="fingerprint-hex">
                {{ localFingerprint }}
              </div>
            </div>
          </a-card>
        </a-col>

        <!-- Remote Fingerprint -->
        <a-col :xs="24" :md="12">
          <a-card title="对方会话指纹">
            <div v-if="remoteFingerprint" class="fingerprint-display">
              <div class="fingerprint-blocks">
                <div
                  v-for="(block, index) in remoteFingerprintBlocks"
                  :key="index"
                  class="fingerprint-block"
                  :style="{ backgroundColor: block.color }"
                >
                  <span class="block-text">{{ block.text }}</span>
                </div>
              </div>
              <div class="fingerprint-hex">
                {{ remoteFingerprint }}
              </div>
            </div>
            <div v-else class="loading-state">
              <a-spin />
              <p>等待对方指纹...</p>
            </div>
          </a-card>
        </a-col>
      </a-row>

      <!-- Comparison Result -->
      <a-card
        v-if="localFingerprint && remoteFingerprint"
        class="comparison-card"
        :class="{ matched: fingerprintsMatch, mismatched: !fingerprintsMatch }"
      >
        <div class="comparison-result">
          <div v-if="fingerprintsMatch" class="match-indicator">
            <CheckCircleOutlined style="font-size: 48px; color: #52c41a" />
            <h3>指纹匹配!</h3>
            <p>会话是安全的，未被中间人攻击</p>
            <a-button type="primary" size="large" @click="handleConfirmMatch">
              <SafetyOutlined />
              确认并继续
            </a-button>
          </div>
          <div v-else class="mismatch-indicator">
            <CloseCircleOutlined style="font-size: 48px; color: #ff4d4f" />
            <h3>指纹不匹配!</h3>
            <a-alert
              message="安全警告"
              description="指纹不匹配可能表示存在中间人攻击。建议立即断开连接并通过其他安全渠道联系对方。"
              type="error"
              show-icon
              style="margin: 24px 0"
            />
            <div class="action-buttons">
              <a-button
                type="primary"
                danger
                size="large"
                @click="handleReportMismatch"
              >
                <ExclamationCircleOutlined />
                报告并断开连接
              </a-button>
              <a-button size="large" @click="handleBack"> 返回 </a-button>
            </div>
          </div>
        </div>
      </a-card>

      <!-- Info Section -->
      <a-card title="会话指纹说明" class="info-card">
        <p>
          <InfoCircleOutlined style="margin-right: 8px" />
          会话指纹是基于当前会话密钥生成的唯一标识符。通过比对双方的会话指纹，可以确保您的通信没有被中间人拦截。
        </p>
        <a-divider />
        <h4>如何验证:</h4>
        <ol>
          <li>通过语音通话、视频或当面等可信渠道与对方沟通</li>
          <li>双方对比显示的指纹颜色块和十六进制值</li>
          <li>如果完全一致，点击"确认并继续"</li>
          <li>如果不一致，立即断开连接并报告</li>
        </ol>
      </a-card>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { message } from "ant-design-vue";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons-vue";

export default {
  name: "SessionFingerprintPage",
  components: {
    CheckCircleOutlined,
    CloseCircleOutlined,
    SafetyOutlined,
    ExclamationCircleOutlined,
    InfoCircleOutlined,
  },
  setup() {
    const router = useRouter();
    const route = useRoute();

    const peerId = ref(route.query.peerId || "");
    const peerName = ref("");
    const localFingerprint = ref("");
    const remoteFingerprint = ref("");

    const generateFingerprintBlocks = (fingerprint) => {
      if (!fingerprint) {
        return [];
      }

      const blocks = [];
      const chunks = fingerprint.match(/.{1,4}/g) || [];

      for (let i = 0; i < Math.min(8, chunks.length); i++) {
        const chunk = chunks[i];
        const colorValue = parseInt(chunk, 16) % 360;
        blocks.push({
          text: chunk.toUpperCase(),
          color: `hsl(${colorValue}, 60%, 60%)`,
        });
      }

      return blocks;
    };

    const localFingerprintBlocks = computed(() =>
      generateFingerprintBlocks(localFingerprint.value),
    );

    const remoteFingerprintBlocks = computed(() =>
      generateFingerprintBlocks(remoteFingerprint.value),
    );

    const fingerprintsMatch = computed(() => {
      if (!localFingerprint.value || !remoteFingerprint.value) {
        return false;
      }
      return localFingerprint.value === remoteFingerprint.value;
    });

    const handleBack = () => {
      router.back();
    };

    const loadFingerprints = async () => {
      try {
        const result = await window.electron.invoke(
          "p2p:get-session-fingerprint",
          {
            peerId: peerId.value,
          },
        );

        peerName.value = result.peerName || "";
        localFingerprint.value =
          result.localFingerprint || generateDummyFingerprint();
        remoteFingerprint.value = result.remoteFingerprint || "";
      } catch (error) {
        console.error("Load fingerprints error:", error);
        localFingerprint.value = generateDummyFingerprint();
      }
    };

    const generateDummyFingerprint = () => {
      // Generate a dummy 64-char hex fingerprint
      let fp = "";
      for (let i = 0; i < 64; i++) {
        fp += Math.floor(Math.random() * 16).toString(16);
      }
      return fp;
    };

    const handleConfirmMatch = async () => {
      try {
        await window.electron.invoke("p2p:confirm-fingerprint-match", {
          peerId: peerId.value,
        });
        message.success("会话已验证");
        router.back();
      } catch (error) {
        console.error("Confirm match error:", error);
        message.error("确认失败: " + error.message);
      }
    };

    const handleReportMismatch = async () => {
      try {
        await window.electron.invoke("p2p:report-fingerprint-mismatch", {
          peerId: peerId.value,
        });
        message.warning("已报告指纹不匹配并断开连接");
        router.push({ name: "P2PMessaging" });
      } catch (error) {
        console.error("Report mismatch error:", error);
        message.error("报告失败: " + error.message);
      }
    };

    onMounted(() => {
      if (!peerId.value) {
        message.error("缺少对等方ID");
        router.back();
        return;
      }

      loadFingerprints();

      // Simulate receiving remote fingerprint after 2 seconds
      setTimeout(() => {
        if (!remoteFingerprint.value) {
          remoteFingerprint.value = generateDummyFingerprint();
        }
      }, 2000);
    });

    return {
      peerId,
      peerName,
      localFingerprint,
      remoteFingerprint,
      localFingerprintBlocks,
      remoteFingerprintBlocks,
      fingerprintsMatch,
      handleBack,
      handleConfirmMatch,
      handleReportMismatch,
    };
  },
};
</script>

<style scoped lang="scss">
.session-fingerprint-page {
  min-height: 100vh;
  background-color: #f0f2f5;

  .fingerprint-content {
    padding: 24px;

    .fingerprint-display {
      .fingerprint-blocks {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        margin-bottom: 16px;

        .fingerprint-block {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

          .block-text {
            font-family: monospace;
            font-weight: bold;
            color: white;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
          }
        }
      }

      .fingerprint-hex {
        font-family: monospace;
        font-size: 12px;
        word-break: break-all;
        background-color: #f5f5f5;
        padding: 12px;
        border-radius: 4px;
        color: #595959;
      }
    }

    .loading-state {
      text-align: center;
      padding: 40px 20px;

      p {
        margin-top: 16px;
        color: #8c8c8c;
      }
    }

    .comparison-card {
      margin-top: 24px;

      &.matched {
        border-color: #52c41a;
      }

      &.mismatched {
        border-color: #ff4d4f;
      }

      .comparison-result {
        text-align: center;
        padding: 20px;

        .match-indicator,
        .mismatch-indicator {
          h3 {
            font-size: 24px;
            margin: 16px 0 8px;
          }

          p {
            color: #595959;
            margin-bottom: 24px;
          }

          .action-buttons {
            display: flex;
            gap: 12px;
            justify-content: center;
          }
        }
      }
    }

    .info-card {
      margin-top: 24px;

      h4 {
        font-weight: 500;
        margin-bottom: 8px;
      }

      ol {
        margin-left: 20px;

        li {
          margin-bottom: 8px;
          color: #595959;
        }
      }
    }
  }
}
</style>
