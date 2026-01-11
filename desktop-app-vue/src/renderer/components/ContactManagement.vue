<template>
  <div class="contact-management">
    <a-card title="联系人管理" :loading="loading">
      <template #extra>
        <a-space>
          <a-button @click="showScanModal = true">
            <template #icon><scan-outlined /></template>
            扫码添加
          </a-button>
          <a-button type="primary" @click="showAddModal = true">
            <template #icon><user-add-outlined /></template>
            添加联系人
          </a-button>
        </a-space>
      </template>

      <!-- 搜索框 -->
      <a-input-search
        v-model:value="searchQuery"
        placeholder="搜索联系人..."
        style="margin-bottom: 16px"
        @search="handleSearch"
      />

      <!-- 统计信息 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="8">
          <a-statistic title="总联系人" :value="statistics.total" />
        </a-col>
        <a-col :span="8">
          <a-statistic title="好友" :value="statistics.friends" />
        </a-col>
        <a-col :span="8">
          <a-statistic title="在线" :value="0" />
        </a-col>
      </a-row>

      <!-- 联系人列表 -->
      <a-list
        :data-source="displayContacts"
        :pagination="{ pageSize: 10 }"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button type="link" @click="handleViewContact(item)">
                查看
              </a-button>
              <a-button type="link" @click="handleEditContact(item)">
                编辑
              </a-button>
              <a-button type="link" danger @click="handleDeleteContact(item.did)">
                删除
              </a-button>
            </template>
            <a-list-item-meta
              :title="item.nickname"
              :description="shortenDID(item.did)"
            >
              <template #avatar>
                <a-avatar :src="item.avatar_url">
                  {{ item.nickname?.charAt(0) || 'C' }}
                </a-avatar>
              </template>
            </a-list-item-meta>
            <div>
              <a-tag :color="getRelationshipColor(item.relationship)">
                {{ getRelationshipLabel(item.relationship) }}
              </a-tag>
              <span style="margin-left: 8px; color: #999">
                信任: {{ item.trust_score || 0 }}
              </span>
            </div>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 扫码添加模态框 -->
    <a-modal
      v-model:open="showScanModal"
      title="扫描二维码添加联系人"
      @ok="handleScanComplete"
      @cancel="showScanModal = false"
    >
      <a-form :label-col="{ span: 6 }">
        <a-form-item label="二维码数据">
          <a-textarea
            v-model:value="qrData"
            placeholder="粘贴扫描到的二维码 JSON 数据"
            :rows="6"
          />
          <div class="form-hint">
            使用手机扫描对方的 DID 二维码，然后将数据粘贴到这里
          </div>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 添加联系人模态框 -->
    <a-modal
      v-model:open="showAddModal"
      title="添加联系人"
      @ok="handleAddContact"
      :confirm-loading="adding"
    >
      <a-form
        :model="contactForm"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="DID" required>
          <a-input
            v-model:value="contactForm.did"
            placeholder="did:chainlesschain:..."
          />
        </a-form-item>

        <a-form-item label="昵称">
          <a-input
            v-model:value="contactForm.nickname"
            placeholder="给联系人起个昵称"
          />
        </a-form-item>

        <a-form-item label="签名公钥" required>
          <a-input
            v-model:value="contactForm.public_key_sign"
            placeholder="Base64 编码的签名公钥"
          />
        </a-form-item>

        <a-form-item label="加密公钥" required>
          <a-input
            v-model:value="contactForm.public_key_encrypt"
            placeholder="Base64 编码的加密公钥"
          />
        </a-form-item>

        <a-form-item label="关系">
          <a-select v-model:value="contactForm.relationship">
            <a-select-option value="contact">联系人</a-select-option>
            <a-select-option value="friend">好友</a-select-option>
            <a-select-option value="family">家人</a-select-option>
            <a-select-option value="colleague">同事</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="备注">
          <a-textarea
            v-model:value="contactForm.notes"
            placeholder="备注信息"
            :rows="3"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 查看联系人详情 -->
    <a-modal
      v-model:open="showDetailModal"
      :title="currentContact?.nickname + ' - 详情'"
      :footer="null"
      width="700px"
    >
      <a-descriptions v-if="currentContact" bordered :column="1">
        <a-descriptions-item label="DID">
          <a-typography-paragraph
            :copyable="{ text: currentContact.did }"
            style="margin: 0"
          >
            {{ currentContact.did }}
          </a-typography-paragraph>
        </a-descriptions-item>

        <a-descriptions-item label="昵称">
          {{ currentContact.nickname }}
        </a-descriptions-item>

        <a-descriptions-item label="关系">
          <a-tag :color="getRelationshipColor(currentContact.relationship)">
            {{ getRelationshipLabel(currentContact.relationship) }}
          </a-tag>
        </a-descriptions-item>

        <a-descriptions-item label="信任评分">
          <a-rate
            :value="currentContact.trust_score / 20"
            disabled
            allow-half
          />
          <span style="margin-left: 8px">{{ currentContact.trust_score || 0 }}</span>
        </a-descriptions-item>

        <a-descriptions-item label="添加时间">
          {{ formatDate(currentContact.added_at) }}
        </a-descriptions-item>

        <a-descriptions-item label="最后在线">
          {{ currentContact.last_seen ? formatDate(currentContact.last_seen) : '从未' }}
        </a-descriptions-item>

        <a-descriptions-item label="备注">
          {{ currentContact.notes || '无' }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  UserAddOutlined,
  ScanOutlined,
} from '@ant-design/icons-vue';

const loading = ref(false);
const adding = ref(false);
const contacts = ref([]);
const searchQuery = ref('');

const statistics = reactive({
  total: 0,
  friends: 0,
  byRelationship: {},
});

// 模态框控制
const showScanModal = ref(false);
const showAddModal = ref(false);
const showDetailModal = ref(false);

// 当前联系人
const currentContact = ref(null);

// 二维码数据
const qrData = ref('');

// 联系人表单
const contactForm = reactive({
  did: '',
  nickname: '',
  public_key_sign: '',
  public_key_encrypt: '',
  relationship: 'contact',
  notes: '',
});

// 显示的联系人列表（根据搜索筛选）
const displayContacts = computed(() => {
  if (!searchQuery.value) {
    return contacts.value;
  }

  const query = searchQuery.value.toLowerCase();
  return contacts.value.filter(
    (c) =>
      c.nickname?.toLowerCase().includes(query) ||
      c.did?.toLowerCase().includes(query) ||
      c.notes?.toLowerCase().includes(query)
  );
});

// 加载联系人列表
async function loadContacts() {
  loading.value = true;
  try {
    const result = await window.electronAPI.contact.getAll();
    contacts.value = result.contacts || [];

    // 加载统计信息
    const stats = await window.electronAPI.contact.getStatistics();
    Object.assign(statistics, stats);
  } catch (error) {
    message.error('加载联系人失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

// 扫码添加
async function handleScanComplete() {
  if (!qrData.value.trim()) {
    message.warning('请输入二维码数据');
    return;
  }

  try {
    await window.electronAPI.contact.addFromQR(qrData.value);
    message.success('已从二维码添加联系人');
    showScanModal.value = false;
    qrData.value = '';
    await loadContacts();
  } catch (error) {
    message.error('添加失败: ' + error.message);
  }
}

// 添加联系人
async function handleAddContact() {
  if (!contactForm.did || !contactForm.public_key_sign || !contactForm.public_key_encrypt) {
    message.warning('请填写必填字段');
    return;
  }

  adding.value = true;
  try {
    await window.electronAPI.contact.add({
      did: contactForm.did,
      nickname: contactForm.nickname || 'Unknown',
      public_key_sign: contactForm.public_key_sign,
      public_key_encrypt: contactForm.public_key_encrypt,
      relationship: contactForm.relationship,
      notes: contactForm.notes,
    });

    message.success('联系人已添加');
    showAddModal.value = false;

    // 重置表单
    contactForm.did = '';
    contactForm.nickname = '';
    contactForm.public_key_sign = '';
    contactForm.public_key_encrypt = '';
    contactForm.relationship = 'contact';
    contactForm.notes = '';

    await loadContacts();
  } catch (error) {
    message.error('添加失败: ' + error.message);
  } finally {
    adding.value = false;
  }
}

// 查看联系人
function handleViewContact(contact) {
  currentContact.value = contact;
  showDetailModal.value = true;
}

// 编辑联系人
function handleEditContact(contact) {
  contactForm.did = contact.did;
  contactForm.nickname = contact.nickname;
  contactForm.public_key_sign = contact.public_key_sign;
  contactForm.public_key_encrypt = contact.public_key_encrypt;
  contactForm.relationship = contact.relationship;
  contactForm.notes = contact.notes || '';
  showAddModal.value = true;
}

// 删除联系人
function handleDeleteContact(did) {
  Modal.confirm({
    title: '确认删除',
    content: '确定要删除这个联系人吗？',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.contact.delete(did);
        message.success('联系人已删除');
        await loadContacts();
      } catch (error) {
        message.error('删除失败: ' + error.message);
      }
    },
  });
}

// 搜索
function handleSearch() {
  // searchQuery 已经绑定到 displayContacts 计算属性
}

// 获取关系标签
function getRelationshipLabel(relationship) {
  const labels = {
    contact: '联系人',
    friend: '好友',
    family: '家人',
    colleague: '同事',
  };
  return labels[relationship] || relationship;
}

// 获取关系颜色
function getRelationshipColor(relationship) {
  const colors = {
    contact: 'blue',
    friend: 'green',
    family: 'red',
    colleague: 'orange',
  };
  return colors[relationship] || 'default';
}

// 缩短 DID 显示
function shortenDID(did) {
  if (!did) return '';
  const parts = did.split(':');
  if (parts.length === 3) {
    const identifier = parts[2];
    return `did:${parts[1]}:${identifier.substring(0, 8)}...${identifier.substring(
      identifier.length - 6
    )}`;
  }
  return did;
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

onMounted(() => {
  loadContacts();
});
</script>

<style scoped>
.contact-management {
  padding: 20px;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
</style>
