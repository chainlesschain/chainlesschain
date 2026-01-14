<template>
  <div class="email-reader">
    <a-row :gutter="16">
      <!-- 左侧：邮箱树 -->
      <a-col :span="5">
        <a-card title="邮箱" size="small" :bordered="false">
          <template #extra>
            <a-button type="link" size="small" @click="syncMailboxes">
              <ReloadOutlined />
            </a-button>
          </template>

          <a-tree
            v-if="mailboxTree.length > 0"
            :tree-data="mailboxTree"
            :selected-keys="selectedMailbox"
            @select="onMailboxSelect"
            :show-icon="true"
          >
            <template #icon="{ dataRef }">
              <InboxOutlined v-if="dataRef.name === 'INBOX'" />
              <SendOutlined v-else-if="dataRef.name === 'Sent'" />
              <DeleteOutlined v-else-if="dataRef.name === 'Trash'" />
              <FolderOutlined v-else />
            </template>
          </a-tree>

          <a-empty v-else description="暂无邮箱" size="small" />
        </a-card>
      </a-col>

      <!-- 中间：邮件列表 -->
      <a-col :span="8">
        <a-card :bordered="false">
          <template #title>
            <a-space>
              <span>邮件列表</span>
              <a-badge :count="unreadCount" />
            </a-space>
          </template>

          <template #extra>
            <a-space>
              <a-dropdown>
                <a-button size="small">
                  <FilterOutlined /> 筛选
                </a-button>
                <template #overlay>
                  <a-menu @click="handleFilterChange">
                    <a-menu-item key="all">全部</a-menu-item>
                    <a-menu-item key="unread">未读</a-menu-item>
                    <a-menu-item key="starred">收藏</a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>

              <a-button size="small" @click="syncEmails" :loading="syncing">
                <SyncOutlined />
              </a-button>

              <a-button type="primary" size="small" @click="showComposer">
                <EditOutlined /> 写邮件
              </a-button>
            </a-space>
          </template>

          <a-list
            :data-source="emails"
            :loading="loading"
            item-layout="vertical"
            size="small"
            style="height: calc(100vh - 200px); overflow-y: auto"
          >
            <template #renderItem="{ item }">
              <a-list-item
                :class="{
                  'email-item': true,
                  'email-read': item.is_read,
                  'email-selected': selectedEmail?.id === item.id
                }"
                @click="selectEmail(item)"
                style="cursor: pointer"
              >
                <a-list-item-meta>
                  <template #title>
                    <a-space>
                      <StarFilled v-if="item.is_starred" style="color: #faad14" />
                      <PaperClipOutlined v-if="item.has_attachments" />
                      <span :style="{ fontWeight: item.is_read ? 'normal' : 'bold' }">
                        {{ item.subject || '(无主题)' }}
                      </span>
                    </a-space>
                  </template>

                  <template #description>
                    <div class="email-meta">
                      <span class="email-from">{{ item.from_address }}</span>
                      <span class="email-date">{{ formatTime(item.date) }}</span>
                    </div>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <!-- 右侧：邮件内容 -->
      <a-col :span="11">
        <a-card v-if="selectedEmail" :bordered="false">
          <template #title>
            <div class="email-header">
              <h3>{{ selectedEmail.subject || '(无主题)' }}</h3>
            </div>
          </template>

          <template #extra>
            <a-space>
              <a-tooltip :title="selectedEmail.is_starred ? '取消收藏' : '收藏'">
                <a-button
                  type="text"
                  @click="toggleStar"
                  :style="{ color: selectedEmail.is_starred ? '#faad14' : undefined }"
                >
                  <StarFilled v-if="selectedEmail.is_starred" />
                  <StarOutlined v-else />
                </a-button>
              </a-tooltip>

              <a-tooltip title="回复">
                <a-button type="text" @click="replyEmail">
                  <RollbackOutlined />
                </a-button>
              </a-tooltip>

              <a-tooltip title="转发">
                <a-button type="text" @click="forwardEmail">
                  <ShareAltOutlined />
                </a-button>
              </a-tooltip>

              <a-tooltip title="保存到知识库">
                <a-button type="text" @click="saveToKnowledge">
                  <SaveOutlined />
                </a-button>
              </a-tooltip>

              <a-dropdown>
                <a-button type="text">
                  <MoreOutlined />
                </a-button>
                <template #overlay>
                  <a-menu @click="handleMenuClick">
                    <a-menu-item key="markRead">
                      <CheckOutlined /> 标记为已读
                    </a-menu-item>
                    <a-menu-item key="markUnread">
                      <EyeInvisibleOutlined /> 标记为未读
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="archive">
                      <InboxOutlined /> 归档
                    </a-menu-item>
                    <a-menu-item key="delete" danger>
                      <DeleteOutlined /> 删除
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </template>

          <!-- 邮件详情 -->
          <div class="email-details">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="发件人">
                {{ selectedEmail.from_address }}
              </a-descriptions-item>
              <a-descriptions-item label="收件人">
                {{ selectedEmail.to_address }}
              </a-descriptions-item>
              <a-descriptions-item label="抄送" v-if="selectedEmail.cc_address">
                {{ selectedEmail.cc_address }}
              </a-descriptions-item>
              <a-descriptions-item label="日期">
                {{ formatFullTime(selectedEmail.date) }}
              </a-descriptions-item>
            </a-descriptions>
          </div>

          <a-divider />

          <!-- 邮件内容 -->
          <div class="email-content" v-html="sanitizedContent"></div>

          <!-- 附件列表 -->
          <div v-if="attachments.length > 0" class="email-attachments">
            <a-divider>附件 ({{ attachments.length }})</a-divider>
            <a-list :data-source="attachments" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <FileOutlined style="font-size: 24px" />
                    </template>
                    <template #title>
                      <a @click="downloadAttachment(item)">
                        {{ item.filename }}
                      </a>
                    </template>
                    <template #description>
                      {{ formatSize(item.size) }}
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <a-button
                      type="link"
                      size="small"
                      @click="downloadAttachment(item)"
                      :loading="item.downloading"
                    >
                      <DownloadOutlined /> 下载
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </div>
        </a-card>

        <a-empty
          v-else
          description="请选择一封邮件"
          style="margin-top: 100px"
        />
      </a-col>
    </a-row>

    <!-- 撰写邮件对话框 -->
    <EmailComposer
      v-model:open="composerVisible"
      :account-id="accountId"
      :reply-to="replyToEmail"
      :forward="forwardEmail"
      @sent="onEmailSent"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  InboxOutlined,
  SendOutlined,
  DeleteOutlined,
  FolderOutlined,
  FilterOutlined,
  SyncOutlined,
  EditOutlined,
  StarFilled,
  StarOutlined,
  PaperClipOutlined,
  RollbackOutlined,
  ShareAltOutlined,
  SaveOutlined,
  MoreOutlined,
  CheckOutlined,
  EyeInvisibleOutlined,
  FileOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import EmailComposer from './EmailComposer.vue';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const route = useRoute();

// 状态
const accountId = ref(route.params.accountId);
const loading = ref(false);
const syncing = ref(false);
const mailboxes = ref([]);
const selectedMailbox = ref([]);
const emails = ref([]);
const selectedEmail = ref(null);
const attachments = ref([]);
const filter = ref('all');
const composerVisible = ref(false);
const replyToEmail = ref(null);
const forwardEmailData = ref(null);

// 计算属性
const unreadCount = computed(() => {
  return emails.value.filter(e => !e.is_read).length;
});

const mailboxTree = computed(() => {
  return mailboxes.value.map(mb => ({
    key: mb.id,
    title: mb.display_name,
    name: mb.name,
    children: [],
  }));
});

const sanitizedContent = computed(() => {
  if (!selectedEmail.value) return '';

  const content = selectedEmail.value.html_content || selectedEmail.value.text_content || '';

  // 如果是纯文本，转换为 HTML
  const htmlContent = selectedEmail.value.html_content
    ? content
    : content.replace(/\n/g, '<br>');

  return DOMPurify.sanitize(htmlContent, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span'
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'style']
  });
});

// 方法
const loadMailboxes = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'email:get-mailboxes',
      accountId.value
    );

    if (result.success) {
      mailboxes.value = result.mailboxes;

      // 默认选择 INBOX
      const inbox = mailboxes.value.find(mb => mb.name === 'INBOX');
      if (inbox && selectedMailbox.value.length === 0) {
        selectedMailbox.value = [inbox.id];
        await loadEmails(inbox.id);
      }
    }
  } catch (error) {
    message.error('加载邮箱失败: ' + error.message);
  }
};

const syncMailboxes = async () => {
  try {
    await window.electron.ipcRenderer.invoke('email:sync-mailboxes', accountId.value);
    message.success('邮箱同步成功');
    await loadMailboxes();
  } catch (error) {
    message.error('同步邮箱失败: ' + error.message);
  }
};

const loadEmails = async (mailboxId) => {
  loading.value = true;
  try {
    const options = {
      accountId: accountId.value,
      mailboxId: mailboxId,
      limit: 100,
    };

    if (filter.value === 'unread') {
      options.isRead = false;
    } else if (filter.value === 'starred') {
      options.isStarred = true;
    }

    const result = await window.electron.ipcRenderer.invoke('email:get-emails', options);

    if (result.success) {
      emails.value = result.emails;
    }
  } catch (error) {
    message.error('加载邮件失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

const syncEmails = async () => {
  if (selectedMailbox.value.length === 0) {
    message.warning('请先选择邮箱');
    return;
  }

  syncing.value = true;
  try {
    const mailbox = mailboxes.value.find(mb => mb.id === selectedMailbox.value[0]);

    const result = await window.electron.ipcRenderer.invoke(
      'email:fetch-emails',
      accountId.value,
      {
        mailbox: mailbox.name,
        limit: 50,
        unseen: true,
      }
    );

    if (result.success) {
      message.success(`已同步 ${result.count} 封新邮件`);
      await loadEmails(selectedMailbox.value[0]);
    }
  } catch (error) {
    message.error('同步失败: ' + error.message);
  } finally {
    syncing.value = false;
  }
};

const selectEmail = async (email) => {
  selectedEmail.value = email;

  // 加载附件
  await loadAttachments(email.id);

  // 标记为已读
  if (!email.is_read) {
    try {
      await window.electron.ipcRenderer.invoke('email:mark-as-read', email.id);
      email.is_read = 1;
    } catch (error) {
      console.error('标记已读失败:', error);
    }
  }
};

const loadAttachments = async (emailId) => {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'email:get-attachments',
      emailId
    );

    if (result.success) {
      attachments.value = result.attachments;
    }
  } catch (error) {
    console.error('加载附件失败:', error);
    attachments.value = [];
  }
};

const downloadAttachment = async (attachment) => {
  attachment.downloading = true;

  try {
    const { dialog } = window.electron;
    const result = await dialog.showSaveDialog({
      defaultPath: attachment.filename,
    });

    if (!result.canceled && result.filePath) {
      await window.electron.ipcRenderer.invoke(
        'email:download-attachment',
        attachment.id,
        result.filePath
      );

      message.success('附件下载成功');
    }
  } catch (error) {
    message.error('下载失败: ' + error.message);
  } finally {
    attachment.downloading = false;
  }
};

const toggleStar = async () => {
  if (!selectedEmail.value) return;

  const newStarred = !selectedEmail.value.is_starred;

  try {
    await window.electron.ipcRenderer.invoke(
      'email:mark-as-starred',
      selectedEmail.value.id,
      newStarred
    );

    selectedEmail.value.is_starred = newStarred ? 1 : 0;

    const email = emails.value.find(e => e.id === selectedEmail.value.id);
    if (email) {
      email.is_starred = newStarred ? 1 : 0;
    }

    message.success(newStarred ? '已收藏' : '已取消收藏');
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const saveToKnowledge = async () => {
  if (!selectedEmail.value) return;

  try {
    const result = await window.electron.ipcRenderer.invoke(
      'email:save-to-knowledge',
      selectedEmail.value.id
    );

    if (result.success) {
      message.success('已保存到知识库');
    }
  } catch (error) {
    message.error('保存失败: ' + error.message);
  }
};

const showComposer = () => {
  replyToEmail.value = null;
  forwardEmailData.value = null;
  composerVisible.value = true;
};

const replyEmail = () => {
  replyToEmail.value = selectedEmail.value;
  composerVisible.value = true;
};

const forwardEmail = () => {
  forwardEmailData.value = selectedEmail.value;
  composerVisible.value = true;
};

const handleMenuClick = async ({ key }) => {
  if (!selectedEmail.value) return;

  try {
    switch (key) {
      case 'markRead':
        await window.electron.ipcRenderer.invoke('email:mark-as-read', selectedEmail.value.id);
        selectedEmail.value.is_read = 1;
        message.success('已标记为已读');
        break;

      case 'markUnread':
        // TODO: 实现标记未读
        message.info('功能开发中');
        break;

      case 'archive':
        await window.electron.ipcRenderer.invoke('email:archive-email', selectedEmail.value.id);
        message.success('已归档');
        await loadEmails(selectedMailbox.value[0]);
        selectedEmail.value = null;
        break;

      case 'delete':
        await window.electron.ipcRenderer.invoke('email:delete-email', selectedEmail.value.id);
        message.success('已删除');
        await loadEmails(selectedMailbox.value[0]);
        selectedEmail.value = null;
        break;
    }
  } catch (error) {
    message.error('操作失败: ' + error.message);
  }
};

const handleFilterChange = ({ key }) => {
  filter.value = key;
  if (selectedMailbox.value.length > 0) {
    loadEmails(selectedMailbox.value[0]);
  }
};

const onMailboxSelect = (keys) => {
  if (keys.length > 0) {
    selectedMailbox.value = keys;
    loadEmails(keys[0]);
  }
};

const onEmailSent = () => {
  message.success('邮件发送成功');
  composerVisible.value = false;
};

const formatTime = (timestamp) => {
  return dayjs(timestamp).fromNow();
};

const formatFullTime = (timestamp) => {
  return dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss');
};

const formatSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
};

// 监听路由变化
watch(() => route.params.accountId, (newId) => {
  if (newId) {
    accountId.value = newId;
    loadMailboxes();
  }
});

// 生命周期
onMounted(() => {
  loadMailboxes();
});
</script>

<style scoped>
.email-reader {
  padding: 24px;
}

.email-item {
  padding: 12px;
  border-radius: 4px;
  transition: background-color 0.3s;
}

.email-item:hover {
  background-color: #f5f5f5;
}

.email-item.email-selected {
  background-color: #e6f7ff;
}

.email-item.email-read {
  opacity: 0.7;
}

.email-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
}

.email-from {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.email-date {
  margin-left: 8px;
}

.email-header h3 {
  margin: 0;
  font-size: 20px;
}

.email-details {
  margin-bottom: 16px;
}

.email-content {
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  min-height: 200px;
}

.email-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 16px 0;
}

.email-content :deep(pre) {
  background-color: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}

.email-content :deep(code) {
  background-color: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
}

.email-content :deep(blockquote) {
  border-left: 4px solid #1890ff;
  padding-left: 16px;
  margin: 16px 0;
  color: #666;
}

.email-content :deep(a) {
  color: #1890ff;
  text-decoration: none;
}

.email-content :deep(a:hover) {
  text-decoration: underline;
}

.email-attachments {
  margin-top: 24px;
}
</style>
