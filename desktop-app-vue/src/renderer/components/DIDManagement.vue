<template>
  <div class="did-management">
    <a-card
      title="DID 身份管理"
      :loading="loading"
    >
      <template #extra>
        <a-space>
          <!-- 自动重新发布状态 -->
          <a-badge
            :status="autoRepublishStatus.enabled ? 'processing' : 'default'"
            :text="autoRepublishStatus.enabled ? '自动重新发布' : '未启用'"
          />
          <a-button @click="showAutoRepublishModal = true">
            <template #icon>
              <setting-outlined />
            </template>
            自动发布设置
          </a-button>
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            <template #icon>
              <plus-outlined />
            </template>
            创建新身份
          </a-button>
        </a-space>
      </template>

      <!-- 身份列表 -->
      <div
        v-if="identities.length === 0"
        class="empty-state"
      >
        <a-empty description="暂无身份">
          <a-button
            type="primary"
            @click="showCreateModal = true"
          >
            创建第一个身份
          </a-button>
        </a-empty>
      </div>

      <a-row
        v-else
        :gutter="[16, 16]"
      >
        <a-col
          v-for="identity in identities"
          :key="identity.did"
          :xs="24"
          :sm="12"
          :lg="8"
        >
          <a-card
            hoverable
            :class="{ 'default-identity': identity.is_default }"
            class="identity-card"
          >
            <template #title>
              <div class="identity-header">
                <a-avatar
                  :size="48"
                  :src="identity.avatar_path"
                >
                  {{ identity.nickname?.charAt(0) || "A" }}
                </a-avatar>
                <div class="identity-title">
                  <div class="nickname">
                    {{ identity.nickname }}
                    <a-tag
                      v-if="identity.is_default"
                      color="green"
                      size="small"
                    >
                      默认
                    </a-tag>
                  </div>
                  <div
                    class="did-short"
                    :title="identity.did"
                  >
                    {{ shortenDID(identity.did) }}
                  </div>
                </div>
              </div>
            </template>

            <template #actions>
              <a-tooltip title="设为默认">
                <star-outlined
                  v-if="!identity.is_default"
                  @click="handleSetDefault(identity.did)"
                />
                <star-filled
                  v-else
                  style="color: #faad14"
                />
              </a-tooltip>
              <a-tooltip title="查看详情">
                <eye-outlined @click="handleViewDetails(identity)" />
              </a-tooltip>
              <a-tooltip title="生成二维码">
                <qrcode-outlined @click="handleGenerateQR(identity.did)" />
              </a-tooltip>
              <a-tooltip title="删除">
                <delete-outlined
                  v-if="!identity.is_default"
                  style="color: #ff4d4f"
                  @click="handleDelete(identity.did)"
                />
              </a-tooltip>
            </template>

            <div class="identity-content">
              <p
                v-if="identity.bio"
                class="bio"
              >
                {{ identity.bio }}
              </p>
              <div class="metadata">
                <div class="metadata-item">
                  <span class="label">创建时间:</span>
                  <span>{{ formatDate(identity.created_at) }}</span>
                </div>
                <div class="metadata-item">
                  <span class="label">DHT状态:</span>
                  <a-tag
                    :color="identity.dhtPublished ? 'success' : 'default'"
                    size="small"
                  >
                    {{ identity.dhtPublished ? "已发布" : "未发布" }}
                  </a-tag>
                </div>
                <div class="metadata-item">
                  <span class="label">助记词:</span>
                  <a-tag
                    :color="identity.hasMnemonicBackup ? 'success' : 'warning'"
                    size="small"
                  >
                    <safety-outlined v-if="identity.hasMnemonicBackup" />
                    <warning-outlined v-else />
                    {{ identity.hasMnemonicBackup ? "已备份" : "未备份" }}
                  </a-tag>
                </div>
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </a-card>

    <!-- 创建身份模态框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="创建新的 DID 身份"
      :width="700"
      :confirm-loading="creating"
      @ok="handleCreateIdentity"
    >
      <a-alert
        v-if="!createForm.useMnemonic"
        message="系统将自动生成 24 个单词的助记词"
        description="助记词是恢复身份的唯一方式，请务必安全备份！"
        type="info"
        show-icon
        style="margin-bottom: 20px"
      />

      <a-form
        :model="createForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="创建方式">
          <a-radio-group v-model:value="createForm.useMnemonic">
            <a-radio :value="false">
              <safety-outlined /> 生成新身份（推荐）
            </a-radio>
            <a-radio :value="true">
              <key-outlined /> 从助记词恢复
            </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item
          v-if="createForm.useMnemonic"
          label="助记词"
          required
        >
          <a-textarea
            v-model:value="createForm.mnemonic"
            placeholder="请输入 12 或 24 个助记词，用空格分隔"
            :rows="4"
            :maxlength="300"
          />
          <div class="form-hint">
            请确保助记词来源可靠，助记词错误或泄露将导致身份安全问题
          </div>
        </a-form-item>

        <a-form-item
          label="昵称"
          required
        >
          <a-input
            v-model:value="createForm.nickname"
            placeholder="请输入昵称"
            :maxlength="50"
          />
        </a-form-item>

        <a-form-item label="个人简介">
          <a-textarea
            v-model:value="createForm.bio"
            placeholder="简单介绍一下自己（可选）"
            :rows="4"
            :maxlength="200"
            show-count
          />
        </a-form-item>

        <a-form-item label="头像">
          <a-input
            v-model:value="createForm.avatar"
            placeholder="头像路径或URL（可选）"
          />
          <div class="form-hint">
            暂不支持上传，请输入本地路径或在线URL
          </div>
        </a-form-item>

        <a-form-item label="设为默认">
          <a-switch v-model:checked="createForm.setAsDefault" />
          <div class="form-hint">
            默认身份将用于 P2P 通信和内容发布
          </div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 身份详情模态框 -->
    <a-modal
      v-model:open="showDetailsModal"
      :title="currentIdentity?.nickname + ' - 身份详情'"
      :width="800"
      :footer="null"
    >
      <div
        v-if="currentIdentity"
        class="identity-details"
      >
        <a-descriptions
          bordered
          :column="1"
        >
          <a-descriptions-item label="DID 标识符">
            <a-typography-paragraph
              :copyable="{ text: currentIdentity.did }"
              style="margin: 0"
            >
              {{ currentIdentity.did }}
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="昵称">
            {{ currentIdentity.nickname }}
          </a-descriptions-item>

          <a-descriptions-item label="个人简介">
            {{ currentIdentity.bio || "无" }}
          </a-descriptions-item>

          <a-descriptions-item label="签名公钥">
            <a-typography-paragraph
              :copyable="{ text: currentIdentity.public_key_sign }"
              style="margin: 0"
            >
              <code>{{ currentIdentity.public_key_sign }}</code>
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="加密公钥">
            <a-typography-paragraph
              :copyable="{ text: currentIdentity.public_key_encrypt }"
              style="margin: 0"
            >
              <code>{{ currentIdentity.public_key_encrypt }}</code>
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="创建时间">
            {{ formatDate(currentIdentity.created_at) }}
          </a-descriptions-item>

          <a-descriptions-item label="默认身份">
            <a-tag :color="currentIdentity.is_default ? 'green' : 'default'">
              {{ currentIdentity.is_default ? "是" : "否" }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item label="DHT 发布状态">
            <a-space>
              <a-tag
                :color="currentIdentity.dhtPublished ? 'success' : 'default'"
              >
                {{
                  currentIdentity.dhtPublished ? "已发布到 DHT 网络" : "未发布"
                }}
              </a-tag>
              <a-button
                v-if="!currentIdentity.dhtPublished"
                type="primary"
                size="small"
                :loading="publishing"
                @click="handlePublishToDHT"
              >
                发布到 DHT
              </a-button>
              <a-button
                v-else
                danger
                size="small"
                :loading="unpublishing"
                @click="handleUnpublishFromDHT"
              >
                取消发布
              </a-button>
            </a-space>
          </a-descriptions-item>

          <a-descriptions-item label="助记词备份">
            <a-space>
              <a-tag
                :color="
                  currentIdentity.hasMnemonicBackup ? 'success' : 'warning'
                "
              >
                <safety-outlined v-if="currentIdentity.hasMnemonicBackup" />
                <warning-outlined v-else />
                {{ currentIdentity.hasMnemonicBackup ? "已备份" : "未备份" }}
              </a-tag>
              <a-button
                v-if="currentIdentity.hasMnemonicBackup"
                type="primary"
                danger
                size="small"
                @click="handleExportMnemonic"
              >
                <key-outlined /> 导出助记词
              </a-button>
              <a-alert
                v-else
                message="该身份没有助记词备份"
                type="warning"
                show-icon
                banner
                style="margin-top: 8px"
              />
            </a-space>
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <div class="actions-section">
          <a-space>
            <a-button @click="handleViewDIDDocument">
              <template #icon>
                <file-text-outlined />
              </template>
              查看 DID 文档
            </a-button>
            <a-button @click="handleExportDocument">
              <template #icon>
                <download-outlined />
              </template>
              导出 DID 文档
            </a-button>
            <a-button
              type="primary"
              @click="handleGenerateQR(currentIdentity.did)"
            >
              <template #icon>
                <qrcode-outlined />
              </template>
              生成二维码
            </a-button>
          </a-space>
        </div>
      </div>
    </a-modal>

    <!-- DID 文档查看器 -->
    <a-modal
      v-model:open="showDocumentModal"
      title="DID 文档"
      :width="800"
      :footer="null"
    >
      <a-typography>
        <pre class="did-document">{{
          JSON.stringify(didDocument, null, 2)
        }}</pre>
      </a-typography>
      <a-button
        type="primary"
        @click="handleCopyDocument"
      >
        <template #icon>
          <copy-outlined />
        </template>
        复制 JSON
      </a-button>
    </a-modal>

    <!-- 二维码模态框 -->
    <a-modal
      v-model:open="showQRModal"
      title="DID 身份二维码"
      :width="500"
      :footer="null"
    >
      <div class="qr-container">
        <div
          id="qrcode"
          ref="qrcodeContainer"
        />
        <p class="qr-hint">
          扫描此二维码可快速添加为联系人
        </p>
        <a-button
          type="primary"
          block
          @click="handleSaveQR"
        >
          <template #icon>
            <download-outlined />
          </template>
          保存二维码
        </a-button>
      </div>
    </a-modal>

    <!-- 自动重新发布设置模态框 -->
    <a-modal
      v-model:open="showAutoRepublishModal"
      title="自动重新发布设置"
      :width="600"
      @ok="handleSaveAutoRepublishConfig"
    >
      <a-alert
        message="自动重新发布可以防止 DID 在 DHT 网络中过期"
        description="建议启用此功能以确保您的 DID 始终可被解析"
        type="info"
        show-icon
        style="margin-bottom: 24px"
      />

      <a-form
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="启用自动重新发布">
          <a-switch v-model:checked="autoRepublishConfig.enabled" />
          <div class="form-hint">
            启用后，系统将定期重新发布已发布的 DID 到 DHT 网络
          </div>
        </a-form-item>

        <a-form-item
          v-if="autoRepublishConfig.enabled"
          label="重新发布间隔"
        >
          <a-input-number
            v-model:value="autoRepublishConfig.intervalHours"
            :min="1"
            :max="168"
            :step="1"
            addon-after="小时"
            style="width: 100%"
          />
          <div class="form-hint">
            建议设置为 24 小时（1 天）。DHT 数据通常在 24-48 小时后过期。
          </div>
        </a-form-item>

        <a-form-item label="当前状态">
          <a-space
            direction="vertical"
            style="width: 100%"
          >
            <div>
              <a-badge
                :status="autoRepublishStatus.enabled ? 'processing' : 'default'"
                :text="autoRepublishStatus.enabled ? '运行中' : '已停止'"
              />
            </div>
            <div v-if="autoRepublishStatus.enabled">
              间隔: {{ autoRepublishStatus.intervalHours }} 小时
            </div>
            <a-button
              type="primary"
              :loading="republishing"
              @click="handleRepublishNow"
            >
              立即重新发布所有 DID
            </a-button>
          </a-space>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 助记词显示模态框（新创建身份后） -->
    <a-modal
      v-model:open="showMnemonicDisplayModal"
      title="备份助记词"
      :width="700"
      :closable="false"
      :mask-closable="false"
      :keyboard="false"
    >
      <template #footer>
        <a-space>
          <a-button @click="handleDownloadMnemonic">
            <download-outlined /> 下载备份
          </a-button>
          <a-button
            type="primary"
            @click="handleCopyMnemonic"
          >
            <copy-outlined /> 复制助记词
          </a-button>
          <a-button
            type="primary"
            danger
            :disabled="!mnemonicCopied"
            @click="handleConfirmMnemonicBackup"
          >
            我已安全备份
          </a-button>
        </a-space>
      </template>

      <a-alert
        message="请妥善保管助记词！"
        description="助记词是恢复身份的唯一凭证。任何人获得助记词都可以完全控制您的身份。请将其保存在安全的地方，不要截图或发送给他人。"
        type="warning"
        show-icon
        style="margin-bottom: 24px"
      />

      <div class="mnemonic-display">
        <div class="mnemonic-grid">
          <div
            v-for="(word, index) in mnemonicWords"
            :key="index"
            class="mnemonic-word"
          >
            <span class="word-number">{{ index + 1 }}</span>
            <span class="word-text">{{ word }}</span>
          </div>
        </div>

        <a-divider />

        <div class="mnemonic-full">
          <a-typography-paragraph :copyable="{ text: generatedMnemonic }">
            <code>{{ generatedMnemonic }}</code>
          </a-typography-paragraph>
        </div>

        <a-alert
          v-if="mnemonicCopied"
          message="已复制到剪贴板"
          type="success"
          show-icon
          style="margin-top: 16px"
        />
      </div>
    </a-modal>

    <!-- 助记词导出模态框（导出现有身份） -->
    <a-modal
      v-model:open="showMnemonicExportModal"
      title="导出助记词"
      :width="700"
      :footer="null"
    >
      <a-alert
        message="请确保周围环境安全！"
        description="助记词一旦泄露，您的身份将面临安全风险。请确保没有人在旁边，也没有摄像头或录屏软件正在运行。"
        type="error"
        show-icon
        style="margin-bottom: 24px"
      />

      <div class="mnemonic-export">
        <div class="mnemonic-grid">
          <div
            v-for="(word, index) in exportingMnemonic.split(' ')"
            :key="index"
            class="mnemonic-word"
          >
            <span class="word-number">{{ index + 1 }}</span>
            <span class="word-text">{{ word }}</span>
          </div>
        </div>

        <a-divider />

        <div class="mnemonic-full">
          <a-typography-paragraph :copyable="{ text: exportingMnemonic }">
            <code>{{ exportingMnemonic }}</code>
          </a-typography-paragraph>
        </div>

        <a-space style="margin-top: 24px; width: 100%; justify-content: center">
          <a-button
            type="primary"
            @click="handleCopyExportedMnemonic"
          >
            <copy-outlined /> 复制助记词
          </a-button>
          <a-button @click="handleDownloadExportedMnemonic">
            <download-outlined /> 下载备份
          </a-button>
          <a-button
            danger
            @click="showMnemonicExportModal = false"
          >
            关闭
          </a-button>
        </a-space>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, h } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  PlusOutlined,
  StarOutlined,
  StarFilled,
  EyeOutlined,
  QrcodeOutlined,
  DeleteOutlined,
  FileTextOutlined,
  DownloadOutlined,
  CopyOutlined,
  SettingOutlined,
  KeyOutlined,
  SafetyOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import QRCode from "qrcode";

const loading = ref(false);
const creating = ref(false);
const publishing = ref(false);
const unpublishing = ref(false);
const identities = ref([]);

// 模态框控制
const showCreateModal = ref(false);
const showDetailsModal = ref(false);
const showDocumentModal = ref(false);
const showQRModal = ref(false);
const showAutoRepublishModal = ref(false);
const showMnemonicModal = ref(false);
const showMnemonicDisplayModal = ref(false);
const showMnemonicExportModal = ref(false);

// 当前选中的身份
const currentIdentity = ref(null);
const didDocument = ref(null);
const qrcodeContainer = ref(null);

// 自动重新发布状态
const autoRepublishStatus = ref({
  enabled: false,
  interval: 0,
  intervalHours: 0,
});
const autoRepublishConfig = reactive({
  enabled: false,
  intervalHours: 24,
});
const republishing = ref(false);

// 创建表单
const createForm = reactive({
  nickname: "",
  bio: "",
  avatar: "",
  setAsDefault: false,
  useMnemonic: false, // 是否使用助记词创建
  mnemonic: "", // 助记词（用于恢复）
});

// 助记词相关状态
const generatedMnemonic = ref("");
const mnemonicWords = ref([]);
const mnemonicCopied = ref(false);
const mnemonicConfirmed = ref(false);
const exportingMnemonic = ref("");

// 加载身份列表
async function loadIdentities() {
  loading.value = true;
  try {
    const result = await window.electronAPI.did.getAllIdentities();

    // 检查每个身份的 DHT 发布状态和助记词备份状态
    const identitiesWithStatus = await Promise.all(
      result.map(async (identity) => {
        try {
          const isPublished = await window.electronAPI.did.isPublishedToDHT(
            identity.did,
          );
          const hasMnemonic = await window.electronAPI.did.hasMnemonic(
            identity.did,
          );
          return {
            ...identity,
            dhtPublished: isPublished,
            hasMnemonicBackup: hasMnemonic,
          };
        } catch (error) {
          console.error("检查状态失败:", error);
          return { ...identity, dhtPublished: false, hasMnemonicBackup: false };
        }
      }),
    );

    identities.value = identitiesWithStatus;
  } catch (error) {
    message.error("加载身份列表失败: " + error.message);
  } finally {
    loading.value = false;
  }
}

// 创建新身份
async function handleCreateIdentity() {
  if (!createForm.nickname.trim()) {
    message.warning("请输入昵称");
    return;
  }

  // 如果使用助记词恢复，需要验证助记词
  if (createForm.useMnemonic) {
    if (!createForm.mnemonic.trim()) {
      message.warning("请输入助记词");
      return;
    }

    const isValid = await window.electronAPI.did.validateMnemonic(
      createForm.mnemonic.trim(),
    );
    if (!isValid) {
      message.error("助记词格式无效，请检查后重试");
      return;
    }
  }

  creating.value = true;
  try {
    const profile = {
      nickname: createForm.nickname,
      bio: createForm.bio || null,
      avatar: createForm.avatar || null,
    };

    let result;

    if (createForm.useMnemonic) {
      // 从助记词恢复身份
      const options = {
        setAsDefault: createForm.setAsDefault,
      };
      result = await window.electronAPI.did.createFromMnemonic(
        profile,
        createForm.mnemonic.trim(),
        options,
      );
      message.success("身份已从助记词恢复！DID: " + result.did);
    } else {
      // 生成新身份（自动生成助记词）
      const mnemonic = await window.electronAPI.did.generateMnemonic();
      const options = {
        setAsDefault: createForm.setAsDefault,
      };
      result = await window.electronAPI.did.createFromMnemonic(
        profile,
        mnemonic,
        options,
      );

      // 保存生成的助记词并显示
      generatedMnemonic.value = mnemonic;
      mnemonicWords.value = mnemonic.split(" ");
      mnemonicCopied.value = false;
      mnemonicConfirmed.value = false;

      // 关闭创建模态框，显示助记词模态框
      showCreateModal.value = false;
      showMnemonicDisplayModal.value = true;
      message.success("身份创建成功！请务必备份助记词！");
    }

    // 重置表单
    createForm.nickname = "";
    createForm.bio = "";
    createForm.avatar = "";
    createForm.setAsDefault = false;
    createForm.useMnemonic = false;
    createForm.mnemonic = "";

    // 如果是从助记词恢复，关闭模态框
    if (createForm.useMnemonic) {
      showCreateModal.value = false;
    }

    // 刷新列表
    await loadIdentities();
  } catch (error) {
    message.error("创建身份失败: " + error.message);
  } finally {
    creating.value = false;
  }
}

// 设置默认身份
async function handleSetDefault(did) {
  try {
    await window.electronAPI.did.setDefaultIdentity(did);
    message.success("已设置为默认身份");
    await loadIdentities();
  } catch (error) {
    message.error("设置失败: " + error.message);
  }
}

// 查看详情
async function handleViewDetails(identity) {
  currentIdentity.value = identity;
  showDetailsModal.value = true;
}

// 查看 DID 文档
async function handleViewDIDDocument() {
  try {
    const doc = await window.electronAPI.did.exportDocument(
      currentIdentity.value.did,
    );
    didDocument.value = doc;
    showDocumentModal.value = true;
  } catch (error) {
    message.error("获取 DID 文档失败: " + error.message);
  }
}

// 导出 DID 文档
async function handleExportDocument() {
  try {
    const doc = await window.electronAPI.did.exportDocument(
      currentIdentity.value.did,
    );
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `did-document-${currentIdentity.value.nickname}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("DID 文档已导出");
  } catch (error) {
    message.error("导出失败: " + error.message);
  }
}

// 复制 DID 文档
function handleCopyDocument() {
  const text = JSON.stringify(didDocument.value, null, 2);
  navigator.clipboard.writeText(text);
  message.success("已复制到剪贴板");
}

// 生成二维码
async function handleGenerateQR(did) {
  try {
    const qrData = await window.electronAPI.did.generateQRCode(did);
    showQRModal.value = true;

    // 等待 DOM 更新
    setTimeout(async () => {
      const container = document.getElementById("qrcode");
      if (container) {
        container.replaceChildren();
        await QRCode.toCanvas(qrData, {
          errorCorrectionLevel: "M",
          width: 300,
          margin: 2,
        }).then((canvas) => {
          container.appendChild(canvas);
        });
      }
    }, 100);
  } catch (error) {
    message.error("生成二维码失败: " + error.message);
  }
}

// 保存二维码
function handleSaveQR() {
  const canvas = document.querySelector("#qrcode canvas");
  if (canvas) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `did-qrcode-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("二维码已保存");
    });
  }
}

// 删除身份
function handleDelete(did) {
  const identity = identities.value.find((i) => i.did === did);
  if (identity?.is_default) {
    message.warning("不能删除默认身份");
    return;
  }

  // 确认删除
  Modal.confirm({
    title: "确认删除",
    content: "删除身份后将无法恢复，确定要删除吗？",
    okText: "确定",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        await window.electronAPI.did.deleteIdentity(did);
        message.success("身份已删除");
        await loadIdentities();
      } catch (error) {
        message.error("删除失败: " + error.message);
      }
    },
  });
}

// 缩短 DID 显示
function shortenDID(did) {
  if (!did) {return "";}
  const parts = did.split(":");
  if (parts.length === 3) {
    const identifier = parts[2];
    return `did:${parts[1]}:${identifier.substring(0, 8)}...${identifier.substring(
      identifier.length - 6,
    )}`;
  }
  return did;
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) {return "未知";}
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

// 发布 DID 到 DHT
async function handlePublishToDHT() {
  if (!currentIdentity.value) {
    return;
  }

  publishing.value = true;
  try {
    const result = await window.electronAPI.did.publishToDHT(
      currentIdentity.value.did,
    );
    message.success("DID 已成功发布到 DHT 网络");
    console.log("发布结果:", result);

    // 更新当前身份的 DHT 状态
    currentIdentity.value.dhtPublished = true;

    // 刷新身份列表
    await loadIdentities();
  } catch (error) {
    console.error("发布失败:", error);
    message.error("发布失败: " + error.message);
  } finally {
    publishing.value = false;
  }
}

// 从 DHT 取消发布 DID
async function handleUnpublishFromDHT() {
  if (!currentIdentity.value) {
    return;
  }

  Modal.confirm({
    title: "确认取消发布",
    content: "取消发布后，其他节点将无法通过 DHT 解析您的 DID，确定要继续吗？",
    okText: "确定",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      unpublishing.value = true;
      try {
        await window.electronAPI.did.unpublishFromDHT(
          currentIdentity.value.did,
        );
        message.success("DID 已从 DHT 网络取消发布");

        // 更新当前身份的 DHT 状态
        currentIdentity.value.dhtPublished = false;

        // 刷新身份列表
        await loadIdentities();
      } catch (error) {
        console.error("取消发布失败:", error);
        message.error("取消发布失败: " + error.message);
      } finally {
        unpublishing.value = false;
      }
    },
  });
}

// 加载自动重新发布状态
async function loadAutoRepublishStatus() {
  try {
    const status = await window.electronAPI.did.getAutoRepublishStatus();
    autoRepublishStatus.value = status;
    autoRepublishConfig.enabled = status.enabled;
    autoRepublishConfig.intervalHours = status.intervalHours;
  } catch (error) {
    console.error("[DIDManagement] 加载自动重新发布状态失败:", error);
  }
}

// 保存自动重新发布配置
async function handleSaveAutoRepublishConfig() {
  try {
    const intervalMs = autoRepublishConfig.intervalHours * 60 * 60 * 1000;

    if (autoRepublishConfig.enabled) {
      await window.electronAPI.did.startAutoRepublish(intervalMs);
      message.success("自动重新发布已启用");
    } else {
      await window.electronAPI.did.stopAutoRepublish();
      message.success("自动重新发布已停止");
    }

    await loadAutoRepublishStatus();
    showAutoRepublishModal.value = false;
  } catch (error) {
    console.error("[DIDManagement] 保存配置失败:", error);
    message.error("保存配置失败: " + error.message);
  }
}

// 立即重新发布
async function handleRepublishNow() {
  republishing.value = true;
  try {
    const result = await window.electronAPI.did.republishAll();

    if (result.failed > 0) {
      message.warning(
        `重新发布完成: ${result.success} 成功，${result.failed} 失败，${result.skipped} 跳过`,
      );
    } else {
      message.success(
        `成功重新发布 ${result.success} 个 DID${result.skipped > 0 ? `（跳过 ${result.skipped} 个未发布的 DID）` : ""}`,
      );
    }

    await loadIdentities();
  } catch (error) {
    console.error("[DIDManagement] 重新发布失败:", error);
    message.error("重新发布失败: " + error.message);
  } finally {
    republishing.value = false;
  }
}

// 复制助记词
async function handleCopyMnemonic() {
  try {
    await navigator.clipboard.writeText(generatedMnemonic.value);
    mnemonicCopied.value = true;
    message.success("助记词已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
}

// 确认助记词备份
function handleConfirmMnemonicBackup() {
  if (!mnemonicCopied.value) {
    Modal.warning({
      title: "请先复制助记词",
      content: "请务必复制并安全保存助记词，这是恢复身份的唯一方式！",
    });
    return;
  }

  mnemonicConfirmed.value = true;
  showMnemonicDisplayModal.value = false;
  message.success("助记词备份确认完成");
}

// 下载助记词为文本文件
function handleDownloadMnemonic() {
  const blob = new Blob([generatedMnemonic.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemonic-backup-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  mnemonicCopied.value = true;
  message.success("助记词已下载");
}

// 导出现有身份的助记词
async function handleExportMnemonic() {
  if (!currentIdentity.value) {
    return;
  }

  // 安全警告
  Modal.confirm({
    title: "导出助记词",
    content:
      "助记词是恢复身份的唯一凭证，请务必妥善保管！任何人获得助记词都可以完全控制您的身份。确定要导出吗？",
    icon: h(WarningOutlined),
    okText: "确定导出",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const mnemonic = await window.electronAPI.did.exportMnemonic(
          currentIdentity.value.did,
        );

        if (!mnemonic) {
          message.warning("该身份没有助记词备份");
          return;
        }

        exportingMnemonic.value = mnemonic;
        showMnemonicExportModal.value = true;
      } catch (error) {
        console.error("导出助记词失败:", error);
        message.error("导出助记词失败: " + error.message);
      }
    },
  });
}

// 复制导出的助记词
async function handleCopyExportedMnemonic() {
  try {
    await navigator.clipboard.writeText(exportingMnemonic.value);
    message.success("助记词已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
}

// 下载导出的助记词
function handleDownloadExportedMnemonic() {
  const blob = new Blob([exportingMnemonic.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mnemonic-${currentIdentity.value.nickname}-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  message.success("助记词已下载");
}

onMounted(() => {
  loadIdentities();
  loadAutoRepublishStatus();
});
</script>

<style scoped>
.did-management {
  padding: 20px;
}

.empty-state {
  padding: 40px 0;
  text-align: center;
}

.identity-card {
  height: 100%;
}

.identity-card.default-identity {
  border: 2px solid #52c41a;
}

.identity-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.identity-title {
  flex: 1;
  overflow: hidden;
}

.nickname {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.did-short {
  font-size: 12px;
  color: #999;
  font-family: "Courier New", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-content {
  min-height: 80px;
}

.bio {
  color: #666;
  font-size: 14px;
  margin-bottom: 12px;
  line-height: 1.5;
}

.metadata {
  font-size: 12px;
  color: #999;
}

.metadata-item {
  display: flex;
  gap: 8px;
}

.metadata-item .label {
  font-weight: 500;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.identity-details {
  padding: 20px 0;
}

.actions-section {
  margin-top: 20px;
}

.did-document {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 400px;
  font-size: 12px;
}

.qr-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
}

#qrcode {
  display: flex;
  justify-content: center;
  align-items: center;
}

.qr-hint {
  color: #999;
  font-size: 14px;
  margin: 0;
}

/* 助记词显示样式 */
.mnemonic-display,
.mnemonic-export {
  padding: 20px 0;
}

.mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.mnemonic-word {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f5f5;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s;
}

.mnemonic-word:hover {
  background: #e8f4ff;
  border-color: #1890ff;
}

.word-number {
  font-size: 12px;
  color: #999;
  font-weight: 600;
  min-width: 24px;
}

.word-text {
  font-size: 14px;
  font-family: "Courier New", monospace;
  font-weight: 500;
  color: #333;
}

.mnemonic-full {
  background: #fafafa;
  padding: 16px;
  border-radius: 4px;
  border: 1px dashed #d9d9d9;
}

.mnemonic-full code {
  word-break: break-all;
  font-size: 13px;
  line-height: 1.8;
}

@media (max-width: 768px) {
  .mnemonic-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
