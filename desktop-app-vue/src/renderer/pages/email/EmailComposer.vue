<template>
  <a-modal
    :open="visible"
    title="撰写邮件"
    width="800px"
    :confirm-loading="sending"
    @ok="sendEmail"
    @cancel="handleCancel"
    @update:open="emit('update:visible', $event)"
  >
    <a-form :model="emailForm" layout="vertical">
      <a-form-item label="收件人" required>
        <a-select
          v-model:value="emailForm.to"
          mode="tags"
          placeholder="输入邮箱地址，按回车添加"
          :token-separators="[',', ';', ' ']"
        >
          <template #suffixIcon>
            <MailOutlined />
          </template>
        </a-select>
      </a-form-item>

      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="抄送">
            <a-select
              v-model:value="emailForm.cc"
              mode="tags"
              placeholder="输入邮箱地址"
              :token-separators="[',', ';', ' ']"
            />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="密送">
            <a-select
              v-model:value="emailForm.bcc"
              mode="tags"
              placeholder="输入邮箱地址"
              :token-separators="[',', ';', ' ']"
            />
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item label="主题" required>
        <a-input v-model:value="emailForm.subject" placeholder="邮件主题" />
      </a-form-item>

      <a-form-item label="内容" required>
        <a-tabs v-model:active-key="contentType">
          <a-tab-pane key="text" tab="纯文本">
            <a-textarea
              v-model:value="emailForm.text"
              :rows="12"
              placeholder="输入邮件内容..."
            />
          </a-tab-pane>
          <a-tab-pane key="html" tab="富文本">
            <div class="html-editor">
              <div class="editor-toolbar">
                <a-space>
                  <a-button size="small" @click="insertFormat('bold')">
                    <BoldOutlined />
                  </a-button>
                  <a-button size="small" @click="insertFormat('italic')">
                    <ItalicOutlined />
                  </a-button>
                  <a-button size="small" @click="insertFormat('underline')">
                    <UnderlineOutlined />
                  </a-button>
                  <a-divider type="vertical" />
                  <a-button size="small" @click="insertFormat('link')">
                    <LinkOutlined />
                  </a-button>
                  <a-button size="small" @click="insertFormat('image')">
                    <PictureOutlined />
                  </a-button>
                </a-space>
              </div>
              <a-textarea
                v-model:value="emailForm.html"
                :rows="10"
                placeholder="输入 HTML 内容..."
              />
            </div>
          </a-tab-pane>
        </a-tabs>
      </a-form-item>

      <a-form-item label="附件">
        <a-upload
          v-model:file-list="fileList"
          :before-upload="beforeUpload"
          :remove="removeFile"
          multiple
        >
          <a-button> <PaperClipOutlined /> 选择文件 </a-button>
        </a-upload>
        <div
          v-if="totalSize > 0"
          style="margin-top: 8px; font-size: 12px; color: #999"
        >
          总大小: {{ formatSize(totalSize) }}
          <span v-if="totalSize > 25 * 1024 * 1024" style="color: #ff4d4f">
            (建议不超过 25MB)
          </span>
        </div>
      </a-form-item>

      <a-form-item v-if="replyTo">
        <a-alert
          message="回复邮件"
          :description="`回复: ${replyTo.subject}`"
          type="info"
          show-icon
          closable
          @close="clearReply"
        />
      </a-form-item>

      <a-form-item v-if="forward">
        <a-alert
          message="转发邮件"
          :description="`转发: ${forward.subject}`"
          type="info"
          show-icon
          closable
          @close="clearForward"
        />
      </a-form-item>
    </a-form>

    <template #footer>
      <a-space>
        <a-button @click="saveDraft"> <SaveOutlined /> 保存草稿 </a-button>
        <a-button @click="handleCancel"> 取消 </a-button>
        <a-button type="primary" :loading="sending" @click="sendEmail">
          <SendOutlined /> 发送
        </a-button>
      </a-space>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  MailOutlined,
  PaperClipOutlined,
  SendOutlined,
  SaveOutlined,
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  LinkOutlined,
  PictureOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  accountId: {
    type: String,
    required: true,
  },
  replyTo: {
    type: Object,
    default: null,
  },
  forward: {
    type: Object,
    default: null,
  },
  draft: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(["update:visible", "sent", "draft-saved"]);

// 当前编辑的草稿 ID
const currentDraftId = ref(null);

// 状态
const sending = ref(false);
const contentType = ref("text");
const fileList = ref([]);

const emailForm = reactive({
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  text: "",
  html: "",
});

// 计算属性
const totalSize = computed(() => {
  return fileList.value.reduce((sum, file) => sum + (file.size || 0), 0);
});

// 方法
const beforeUpload = (file) => {
  // 检查文件大小
  if (file.size > 25 * 1024 * 1024) {
    message.warning(`${file.name} 文件过大，建议不超过 25MB`);
  }

  fileList.value.push(file);
  return false; // 阻止自动上传
};

const removeFile = (file) => {
  const index = fileList.value.indexOf(file);
  if (index > -1) {
    fileList.value.splice(index, 1);
  }
};

const insertFormat = (format) => {
  // 简单的格式插入
  const textarea = document.querySelector(".html-editor textarea");
  if (!textarea) {
    return;
  }

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = emailForm.html.substring(start, end);

  let insertText = "";
  switch (format) {
    case "bold":
      insertText = `<strong>${selectedText || "粗体文本"}</strong>`;
      break;
    case "italic":
      insertText = `<em>${selectedText || "斜体文本"}</em>`;
      break;
    case "underline":
      insertText = `<u>${selectedText || "下划线文本"}</u>`;
      break;
    case "link":
      insertText = `<a href="https://example.com">${selectedText || "链接文本"}</a>`;
      break;
    case "image":
      insertText = `<img src="https://example.com/image.jpg" alt="图片">`;
      break;
  }

  emailForm.html =
    emailForm.html.substring(0, start) +
    insertText +
    emailForm.html.substring(end);
};

const sendEmail = async () => {
  // 验证
  if (emailForm.to.length === 0) {
    message.error("请输入收件人");
    return;
  }

  if (!emailForm.subject) {
    message.error("请输入邮件主题");
    return;
  }

  if (!emailForm.text && !emailForm.html) {
    message.error("请输入邮件内容");
    return;
  }

  sending.value = true;

  try {
    // 准备附件
    const attachments = await Promise.all(
      fileList.value.map(async (file) => {
        return {
          filename: file.name,
          path: file.path || file.originFileObj?.path,
          content: file.originFileObj,
        };
      }),
    );

    // 发送邮件
    const result = await window.electron.ipcRenderer.invoke(
      "email:send-email",
      props.accountId,
      {
        to: emailForm.to.join(", "),
        cc: emailForm.cc.length > 0 ? emailForm.cc.join(", ") : undefined,
        bcc: emailForm.bcc.length > 0 ? emailForm.bcc.join(", ") : undefined,
        subject: emailForm.subject,
        text: contentType.value === "text" ? emailForm.text : undefined,
        html: contentType.value === "html" ? emailForm.html : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        inReplyTo: props.replyTo?.message_id,
        references: props.replyTo?.message_id,
      },
    );

    if (result.success) {
      // 如果是从草稿发送的，删除草稿
      if (currentDraftId.value) {
        try {
          await window.electron.ipcRenderer.invoke(
            "email:delete-draft",
            currentDraftId.value,
          );
        } catch (e) {
          // 静默忽略删除草稿失败
          console.warn("删除草稿失败:", e);
        }
      }
      message.success("邮件发送成功");
      emit("sent");
      resetForm();
      emit("update:visible", false);
    }
  } catch (error) {
    message.error("发送失败: " + error.message);
  } finally {
    sending.value = false;
  }
};

const saveDraft = async () => {
  try {
    const draftData = {
      id: currentDraftId.value, // 如果有，则更新现有草稿
      to: emailForm.to,
      cc: emailForm.cc,
      bcc: emailForm.bcc,
      subject: emailForm.subject,
      text: emailForm.text,
      html: emailForm.html,
      attachments: fileList.value.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
      replyToId: props.replyTo?.id || null,
      forwardId: props.forward?.id || null,
    };

    const result = await window.electron.ipcRenderer.invoke(
      "email:save-draft",
      props.accountId,
      draftData,
    );

    // 保存返回的草稿 ID（用于后续更新）
    if (result.draftId) {
      currentDraftId.value = result.draftId;
    }

    message.success("草稿已保存");
    emit("draft-saved");
  } catch (error) {
    message.error("保存草稿失败: " + error.message);
  }
};

const handleCancel = () => {
  emit("update:visible", false);
};

const resetForm = () => {
  emailForm.to = [];
  emailForm.cc = [];
  emailForm.bcc = [];
  emailForm.subject = "";
  emailForm.text = "";
  emailForm.html = "";
  fileList.value = [];
  contentType.value = "text";
};

const clearReply = () => {
  emit("update:replyTo", null);
};

const clearForward = () => {
  emit("update:forward", null);
};

const formatSize = (bytes) => {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
};

// 监听 props 变化
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      // 如果是编辑草稿
      if (props.draft) {
        currentDraftId.value = props.draft.id;
        emailForm.to = props.draft.to || [];
        emailForm.cc = props.draft.cc || [];
        emailForm.bcc = props.draft.bcc || [];
        emailForm.subject = props.draft.subject || "";
        emailForm.text = props.draft.text || "";
        emailForm.html = props.draft.html || "";
        // 如果有 HTML 内容，切换到 HTML 模式
        if (props.draft.html) {
          contentType.value = "html";
        }
        return;
      }

      // 如果是回复邮件
      if (props.replyTo) {
        emailForm.to = [props.replyTo.from_address];
        emailForm.subject = props.replyTo.subject.startsWith("Re:")
          ? props.replyTo.subject
          : `Re: ${props.replyTo.subject}`;
        emailForm.text = `\n\n--- 原始邮件 ---\n发件人: ${props.replyTo.from_address}\n日期: ${props.replyTo.date}\n主题: ${props.replyTo.subject}\n\n${props.replyTo.text_content}`;
      }

      // 如果是转发邮件
      if (props.forward) {
        emailForm.subject = props.forward.subject.startsWith("Fwd:")
          ? props.forward.subject
          : `Fwd: ${props.forward.subject}`;
        emailForm.text = `\n\n--- 转发邮件 ---\n发件人: ${props.forward.from_address}\n日期: ${props.forward.date}\n主题: ${props.forward.subject}\n\n${props.forward.text_content}`;
      }
    } else {
      resetForm();
      currentDraftId.value = null;
    }
  },
);
</script>

<style scoped>
.html-editor {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
}

.editor-toolbar {
  padding: 8px;
  border-bottom: 1px solid #d9d9d9;
  background-color: #fafafa;
}

.html-editor textarea {
  border: none;
  border-radius: 0 0 4px 4px;
}

.html-editor textarea:focus {
  box-shadow: none;
}
</style>
