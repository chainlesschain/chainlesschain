<template>
  <a-modal
    v-model:open="visible"
    title="创建邀请链接"
    width="600px"
    :confirm-loading="loading"
    @ok="handleCreate"
    @cancel="handleCancel"
  >
    <a-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
    >
      <a-form-item label="角色" name="role">
        <a-select v-model:value="formData.role" placeholder="选择角色">
          <a-select-option value="member">
            <a-tag color="blue"> 成员 </a-tag>
            <span style="margin-left: 8px">可创建和编辑内容</span>
          </a-select-option>
          <a-select-option value="admin">
            <a-tag color="orange"> 管理员 </a-tag>
            <span style="margin-left: 8px">可管理成员和内容</span>
          </a-select-option>
          <a-select-option value="viewer">
            <a-tag color="green"> 访客 </a-tag>
            <span style="margin-left: 8px">只能查看内容</span>
          </a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item label="邀请消息" name="message">
        <a-textarea
          v-model:value="formData.message"
          placeholder="输入邀请消息（可选）"
          :rows="3"
          :maxlength="200"
          show-count
        />
      </a-form-item>

      <a-form-item label="使用次数" name="maxUses">
        <a-space>
          <a-input-number
            v-model:value="formData.maxUses"
            :min="1"
            :max="999999"
            :disabled="formData.unlimited"
            style="width: 150px"
          />
          <a-checkbox
            v-model:checked="formData.unlimited"
            @change="handleUnlimitedChange"
          >
            无限制
          </a-checkbox>
        </a-space>
        <div style="margin-top: 8px; color: #8c8c8c; font-size: 12px">
          <InfoCircleOutlined /> 设置此链接可以被使用的次数
        </div>
      </a-form-item>

      <a-form-item label="过期时间" name="expiresIn">
        <a-radio-group
          v-model:value="formData.expiresInOption"
          @change="handleExpiresChange"
        >
          <a-radio value="1h"> 1小时 </a-radio>
          <a-radio value="1d"> 1天 </a-radio>
          <a-radio value="7d"> 7天 </a-radio>
          <a-radio value="30d"> 30天 </a-radio>
          <a-radio value="custom"> 自定义 </a-radio>
          <a-radio value="never"> 永不过期 </a-radio>
        </a-radio-group>

        <a-date-picker
          v-if="formData.expiresInOption === 'custom'"
          v-model:value="formData.customExpireDate"
          show-time
          format="YYYY-MM-DD HH:mm"
          placeholder="选择过期时间"
          style="width: 100%; margin-top: 12px"
          :disabled-date="disabledDate"
        />

        <div
          v-if="formData.expiresInOption !== 'never'"
          style="margin-top: 8px; color: #8c8c8c; font-size: 12px"
        >
          <ClockCircleOutlined /> 过期后链接将自动失效
        </div>
      </a-form-item>

      <a-form-item label="高级选项" name="advanced">
        <a-collapse ghost>
          <a-collapse-panel key="1" header="元数据（可选）">
            <a-form-item
              label="来源"
              :label-col="{ span: 6 }"
              :wrapper-col="{ span: 18 }"
            >
              <a-input
                v-model:value="formData.metadata.source"
                placeholder="例如：email, social_media"
              />
            </a-form-item>
            <a-form-item
              label="活动"
              :label-col="{ span: 6 }"
              :wrapper-col="{ span: 18 }"
            >
              <a-input
                v-model:value="formData.metadata.campaign"
                placeholder="例如：Q1_2026"
              />
            </a-form-item>
            <a-form-item
              label="备注"
              :label-col="{ span: 6 }"
              :wrapper-col="{ span: 18 }"
            >
              <a-textarea
                v-model:value="formData.metadata.notes"
                placeholder="内部备注"
                :rows="2"
              />
            </a-form-item>
          </a-collapse-panel>
        </a-collapse>
      </a-form-item>

      <a-alert
        message="安全提示"
        description="请通过安全渠道分享邀请链接，避免在公开场合发布。建议为不同场景创建不同的链接以便追踪。"
        type="info"
        show-icon
        style="margin-top: 16px"
      />
    </a-form>

    <template #footer>
      <a-space>
        <a-button @click="handleCancel"> 取消 </a-button>
        <a-button type="primary" :loading="loading" @click="handleCreate">
          创建链接
        </a-button>
      </a-space>
    </template>
  </a-modal>

  <!-- 创建成功对话框 -->
  <a-modal
    v-model:open="showSuccessDialog"
    title="邀请链接创建成功"
    width="700px"
    :footer="null"
  >
    <a-result status="success" title="邀请链接已创建">
      <template #subTitle>
        <div style="margin-top: 16px">
          <a-typography-paragraph>
            链接已生成，您可以通过以下方式分享：
          </a-typography-paragraph>
        </div>
      </template>

      <template #extra>
        <a-space direction="vertical" style="width: 100%" :size="16">
          <!-- 链接URL -->
          <a-card title="邀请链接" size="small">
            <div style="display: flex; align-items: center; gap: 12px">
              <a-input
                :value="createdLink.invitationUrl"
                readonly
                style="flex: 1"
              />
              <a-button type="primary" @click="copyCreatedLink">
                <template #icon>
                  <CopyOutlined />
                </template>
                复制
              </a-button>
            </div>
          </a-card>

          <!-- 二维码 -->
          <a-card title="二维码" size="small">
            <div style="text-align: center">
              <div ref="qrcodeRef" style="display: inline-block" />
              <div style="margin-top: 12px">
                <a-button @click="downloadQRCode">
                  <template #icon>
                    <DownloadOutlined />
                  </template>
                  下载二维码
                </a-button>
              </div>
            </div>
          </a-card>

          <!-- 链接信息 -->
          <a-descriptions bordered size="small" :column="2">
            <a-descriptions-item label="角色">
              <a-tag :color="getRoleColor(createdLink.role)">
                {{ getRoleLabel(createdLink.role) }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="最大使用次数">
              {{
                createdLink.maxUses === 999999 ? "无限制" : createdLink.maxUses
              }}
            </a-descriptions-item>
            <a-descriptions-item label="过期时间" :span="2">
              {{
                createdLink.expiresAt
                  ? formatDate(createdLink.expiresAt)
                  : "永不过期"
              }}
            </a-descriptions-item>
            <a-descriptions-item
              v-if="createdLink.message"
              label="邀请消息"
              :span="2"
            >
              {{ createdLink.message }}
            </a-descriptions-item>
          </a-descriptions>

          <a-button type="primary" block @click="handleSuccessClose">
            完成
          </a-button>
        </a-space>
      </template>
    </a-result>
  </a-modal>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, watch, nextTick } from "vue";
import { message } from "ant-design-vue";
import {
  InfoCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
} from "@ant-design/icons-vue";
import QRCode from "qrcode";
import dayjs from "dayjs";

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  orgId: {
    type: String,
    required: true,
  },
});

// Emits
const emit = defineEmits(["update:visible", "created"]);

// State
const loading = ref(false);
const showSuccessDialog = ref(false);
const formRef = ref(null);
const qrcodeRef = ref(null);
const createdLink = ref({});

const formData = reactive({
  role: "member",
  message: "",
  maxUses: 10,
  unlimited: false,
  expiresInOption: "7d",
  customExpireDate: null,
  metadata: {
    source: "",
    campaign: "",
    notes: "",
  },
});

// Validation rules
const rules = {
  role: [{ required: true, message: "请选择角色", trigger: "change" }],
  maxUses: [
    { required: true, message: "请输入使用次数", trigger: "blur" },
    { type: "number", min: 1, message: "使用次数至少为1", trigger: "blur" },
  ],
};

// Computed
const visible = computed({
  get: () => props.visible,
  set: (val) => emit("update:visible", val),
});

// Methods
const handleCreate = async () => {
  try {
    await formRef.value.validate();

    loading.value = true;

    // 计算过期时间
    let expiresIn = null;
    if (formData.expiresInOption !== "never") {
      if (formData.expiresInOption === "custom") {
        if (!formData.customExpireDate) {
          message.error("请选择过期时间");
          loading.value = false;
          return;
        }
        expiresIn = formData.customExpireDate.valueOf() - Date.now();
      } else {
        const timeMap = {
          "1h": 60 * 60 * 1000,
          "1d": 24 * 60 * 60 * 1000,
          "7d": 7 * 24 * 60 * 60 * 1000,
          "30d": 30 * 24 * 60 * 60 * 1000,
        };
        expiresIn = timeMap[formData.expiresInOption];
      }
    }

    // 准备元数据
    const metadata = {};
    if (formData.metadata.source) {
      metadata.source = formData.metadata.source;
    }
    if (formData.metadata.campaign) {
      metadata.campaign = formData.metadata.campaign;
    }
    if (formData.metadata.notes) {
      metadata.notes = formData.metadata.notes;
    }

    // 调用IPC创建链接
    const result = await window.electron.ipcRenderer.invoke(
      "org:create-invitation-link",
      {
        orgId: props.orgId,
        role: formData.role,
        message: formData.message,
        maxUses: formData.unlimited ? -1 : formData.maxUses,
        expiresIn,
        metadata,
      },
    );

    if (result.success) {
      createdLink.value = result.invitationLink;
      visible.value = false;
      showSuccessDialog.value = true;

      // 生成二维码
      await nextTick();
      await generateQRCode();

      emit("created", result.invitationLink);
      resetForm();
    } else {
      message.error(result.error || "创建邀请链接失败");
    }
  } catch (error) {
    if (error.errorFields) {
      // 表单验证错误
      return;
    }
    logger.error("创建邀请链接失败:", error);
    message.error("创建邀请链接失败");
  } finally {
    loading.value = false;
  }
};

const handleCancel = () => {
  visible.value = false;
  resetForm();
};

const handleSuccessClose = () => {
  showSuccessDialog.value = false;
};

const handleUnlimitedChange = (e) => {
  if (e.target.checked) {
    formData.maxUses = 999999;
  } else {
    formData.maxUses = 10;
  }
};

const handleExpiresChange = () => {
  if (formData.expiresInOption !== "custom") {
    formData.customExpireDate = null;
  }
};

const disabledDate = (current) => {
  // 不能选择过去的日期
  return current && current < dayjs().startOf("day");
};

const copyCreatedLink = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "org:copy-invitation-link",
      createdLink.value.invitationUrl,
    );

    if (result.success) {
      message.success("链接已复制到剪贴板");
    } else {
      message.error("复制失败");
    }
  } catch (error) {
    logger.error("复制链接失败:", error);
    message.error("复制链接失败");
  }
};

const generateQRCode = async () => {
  if (!qrcodeRef.value) {
    return;
  }

  try {
    // 清空之前的二维码
    qrcodeRef.value.replaceChildren();

    // 生成新的二维码
    await QRCode.toCanvas(qrcodeRef.value, createdLink.value.invitationUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });
  } catch (error) {
    logger.error("生成二维码失败:", error);
  }
};

const downloadQRCode = () => {
  const canvas = qrcodeRef.value.querySelector("canvas");
  if (!canvas) {
    return;
  }

  const link = document.createElement("a");
  link.download = `invitation-qrcode-${Date.now()}.png`;
  link.href = canvas.toDataURL();
  link.click();
  message.success("二维码已下载");
};

const resetForm = () => {
  formData.role = "member";
  formData.message = "";
  formData.maxUses = 10;
  formData.unlimited = false;
  formData.expiresInOption = "7d";
  formData.customExpireDate = null;
  formData.metadata = {
    source: "",
    campaign: "",
    notes: "",
  };
  formRef.value?.resetFields();
};

// Helper functions
const getRoleColor = (role) => {
  const colors = {
    owner: "red",
    admin: "orange",
    member: "blue",
    viewer: "green",
  };
  return colors[role] || "default";
};

const getRoleLabel = (role) => {
  const labels = {
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    viewer: "访客",
  };
  return labels[role] || role;
};

const formatDate = (timestamp) => {
  return dayjs(timestamp).format("YYYY-MM-DD HH:mm:ss");
};

// Watch
watch(
  () => props.visible,
  (val) => {
    if (val) {
      resetForm();
    }
  },
);
</script>

<style scoped lang="scss">
:deep(.ant-form-item) {
  margin-bottom: 20px;
}

:deep(
  .ant-collapse-ghost
    > .ant-collapse-item
    > .ant-collapse-content
    > .ant-collapse-content-box
) {
  padding-top: 12px;
}
</style>
