<template>
  <div class="did-management">
    <a-card title="DID 身份管理" :loading="loading">
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
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon>
              <plus-outlined />
            </template>
            创建新身份
          </a-button>
        </a-space>
      </template>

      <!-- 身份列表 -->
      <div v-if="identities.length === 0" class="empty-state">
        <a-empty description="暂无身份">
          <a-button type="primary" @click="showCreateModal = true">
            创建第一个身份
          </a-button>
        </a-empty>
      </div>

      <a-row v-else :gutter="[16, 16]">
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
                <a-avatar :size="48" :src="identity.avatar_path">
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
                  <div class="did-short" :title="identity.did">
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
                <star-filled v-else style="color: #faad14" />
              </a-tooltip>
              <a-tooltip title="查看详情">
                <eye-outlined @click="handleViewDetails(identity)" />
              </a-tooltip>
              <a-tooltip title="生成二维码">
                <qrcode-outlined
                  @click="detailsModalRef?.openQR(identity.did)"
                />
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
              <p v-if="identity.bio" class="bio">
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
            <a-radio :value="true"> <key-outlined /> 从助记词恢复 </a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item v-if="createForm.useMnemonic" label="助记词" required>
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

        <a-form-item label="昵称" required>
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
          <div class="form-hint">暂不支持上传，请输入本地路径或在线URL</div>
        </a-form-item>

        <a-form-item label="设为默认">
          <a-switch v-model:checked="createForm.setAsDefault" />
          <div class="form-hint">默认身份将用于 P2P 通信和内容发布</div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 身份详情 / DID 文档 / 二维码 模态框 -->
    <IdentityDetailsModal
      ref="detailsModalRef"
      @identities-refreshed="loadIdentities"
      @export-mnemonic="
        (identity) => mnemonicModalsRef?.triggerExport(identity)
      "
    />

    <!-- 自动重新发布设置模态框 -->
    <AutoRepublishSettingsPane
      v-model:open="showAutoRepublishModal"
      @status-change="autoRepublishStatus = $event"
      @after-republish="loadIdentities"
    />

    <!-- 助记词展示/导出模态框 -->
    <MnemonicModals ref="mnemonicModalsRef" />
  </div>
</template>

<script setup>
/**
 * @deprecated V5 entry — full functional parity ported to the V6 panel
 * (`src/renderer/shell/DIDManagementPanel.vue` + `shell/did/*.vue` +
 * `stores/didManagement.ts`) across phases 2-6 (commits 51f765429,
 * 130da1d1e, b7bd92bfa, f58d5f796, e1b2a96f2). Kept active so users who
 * opted out of the V6 shell via SystemSettings still have a working
 * /did route. Do not add new features here — port them to the V6 panel
 * instead.
 */
import { logger } from "@/utils/logger";

import { ref, reactive, onMounted } from "vue";
import { message, Modal } from "ant-design-vue";
import {
  PlusOutlined,
  StarOutlined,
  StarFilled,
  EyeOutlined,
  QrcodeOutlined,
  DeleteOutlined,
  SettingOutlined,
  KeyOutlined,
  SafetyOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import AutoRepublishSettingsPane from "./did/AutoRepublishSettingsPane.vue";
import MnemonicModals from "./did/MnemonicModals.vue";
import IdentityDetailsModal from "./did/IdentityDetailsModal.vue";

const loading = ref(false);
const creating = ref(false);
const identities = ref([]);

// 模态框控制
const showCreateModal = ref(false);
const showAutoRepublishModal = ref(false);

// 子组件 ref（提供 open / openQR / showDisplay / triggerExport 等命令式 API）
const detailsModalRef = ref(null);
const mnemonicModalsRef = ref(null);

// 自动重新发布状态（由 AutoRepublishSettingsPane 通过 @status-change 推送）
const autoRepublishStatus = ref({
  enabled: false,
  interval: 0,
  intervalHours: 0,
});

// 创建表单
const createForm = reactive({
  nickname: "",
  bio: "",
  avatar: "",
  setAsDefault: false,
  useMnemonic: false, // 是否使用助记词创建
  mnemonic: "", // 助记词（用于恢复）
});

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
          logger.error("检查状态失败:", error);
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

      // 关闭创建模态框，交给 MnemonicModals 展示助记词
      showCreateModal.value = false;
      mnemonicModalsRef.value?.showDisplay(mnemonic);
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
function handleViewDetails(identity) {
  detailsModalRef.value?.open(identity);
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
  if (!did) {
    return "";
  }
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
  if (!timestamp) {
    return "未知";
  }
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

onMounted(() => {
  loadIdentities();
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
</style>
