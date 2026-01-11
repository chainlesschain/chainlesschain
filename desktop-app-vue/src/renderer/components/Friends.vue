<template>
  <div class="friends-container">
    <a-card title="好友管理" :loading="loading">
      <template #extra>
        <a-space>
          <a-badge :count="pendingRequestsCount" :number-style="{ backgroundColor: '#f5222d' }">
            <a-button @click="showRequestsModal = true">
              <template #icon><bell-outlined /></template>
              好友请求
            </a-button>
          </a-badge>
          <a-button type="primary" @click="showAddFriendModal = true">
            <template #icon><user-add-outlined /></template>
            添加好友
          </a-button>
          <a-button @click="loadFriends">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 统计信息 -->
      <a-row :gutter="16" style="margin-bottom: 16px">
        <a-col :span="8">
          <a-statistic title="好友总数" :value="statistics.total">
            <template #prefix><user-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="8">
          <a-statistic title="在线" :value="statistics.online" :value-style="{ color: '#3f8600' }">
            <template #prefix><check-circle-outlined /></template>
          </a-statistic>
        </a-col>
        <a-col :span="8">
          <a-statistic title="离线" :value="statistics.offline">
            <template #prefix><minus-circle-outlined /></template>
          </a-statistic>
        </a-col>
      </a-row>

      <!-- 分组筛选 -->
      <a-space style="margin-bottom: 16px">
        <span>分组:</span>
        <a-radio-group v-model:value="selectedGroup" button-style="solid" @change="handleGroupChange">
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button v-for="(count, group) in statistics.byGroup" :key="group" :value="group">
            {{ group }} ({{ count }})
          </a-radio-button>
        </a-radio-group>
      </a-space>

      <!-- 搜索框 -->
      <a-input-search
        v-model:value="searchText"
        placeholder="搜索好友 DID 或备注"
        style="margin-bottom: 16px"
        @search="handleSearch"
      >
        <template #prefix><search-outlined /></template>
      </a-input-search>

      <!-- 好友列表 -->
      <a-list
        :data-source="filteredFriends"
        :loading="loading"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip title="发送消息">
                <a-button
                  type="link"
                  size="small"
                  @click="handleOpenChat(item)"
                >
                  <template #icon><message-outlined /></template>
                </a-button>
              </a-tooltip>
              <a-dropdown>
                <a-button type="link" size="small">
                  <template #icon><ellipsis-outlined /></template>
                </a-button>
                <template #overlay>
                  <a-menu>
                    <a-menu-item @click="handleEditNickname(item)">
                      <edit-outlined /> 修改备注
                    </a-menu-item>
                    <a-menu-item @click="handleChangeGroup(item)">
                      <folder-outlined /> 修改分组
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item danger @click="handleRemoveFriend(item)">
                      <delete-outlined /> 删除好友
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </template>

            <a-list-item-meta>
              <template #avatar>
                <a-badge :status="getOnlineStatus(item)" :offset="[-5, 35]">
                  <a-avatar :style="{ backgroundColor: getAvatarColor(item.friend_did) }">
                    <template #icon><user-outlined /></template>
                  </a-avatar>
                </a-badge>
              </template>
              <template #title>
                <a-space>
                  <span>{{ item.nickname || shortenDid(item.friend_did) }}</span>
                  <a-tag v-if="item.group_name" color="blue" size="small">
                    {{ item.group_name }}
                  </a-tag>
                </a-space>
              </template>
              <template #description>
                <a-space direction="vertical" size="small">
                  <a-typography-text copyable type="secondary" style="font-size: 12px">
                    {{ item.friend_did }}
                  </a-typography-text>
                  <span style="font-size: 12px; color: #999">
                    {{ getStatusText(item) }}
                  </span>
                </a-space>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>

        <template #empty>
          <a-empty description="暂无好友">
            <a-button type="primary" @click="showAddFriendModal = true">
              添加第一个好友
            </a-button>
          </a-empty>
        </template>
      </a-list>
    </a-card>

    <!-- 添加好友对话框 -->
    <a-modal
      v-model:open="showAddFriendModal"
      title="添加好友"
      :confirm-loading="adding"
      @ok="handleAddFriend"
    >
      <a-form :model="addFriendForm" layout="vertical">
        <a-form-item label="好友 DID" required>
          <a-input
            v-model:value="addFriendForm.targetDid"
            placeholder="输入好友的 DID"
          />
        </a-form-item>
        <a-form-item label="验证消息">
          <a-textarea
            v-model:value="addFriendForm.message"
            placeholder="请输入验证消息 (可选)"
            :rows="3"
            :maxlength="200"
            show-count
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 好友请求列表对话框 -->
    <a-modal
      v-model:open="showRequestsModal"
      title="好友请求"
      width="600px"
      :footer="null"
    >
      <a-list
        :data-source="pendingRequests"
        :loading="loadingRequests"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button
                type="primary"
                size="small"
                @click="handleAcceptRequest(item.id)"
                :loading="processingRequest === item.id"
              >
                接受
              </a-button>
              <a-button
                size="small"
                @click="handleRejectRequest(item.id)"
                :loading="processingRequest === item.id"
              >
                拒绝
              </a-button>
            </template>

            <a-list-item-meta>
              <template #avatar>
                <a-avatar style="background-color: #1890ff">
                  <template #icon><user-outlined /></template>
                </a-avatar>
              </template>
              <template #title>
                {{ shortenDid(item.from_did) }}
              </template>
              <template #description>
                <a-space direction="vertical" size="small">
                  <a-typography-text copyable type="secondary" style="font-size: 12px">
                    {{ item.from_did }}
                  </a-typography-text>
                  <div v-if="item.message" style="font-size: 12px">
                    验证消息: {{ item.message }}
                  </div>
                  <div style="font-size: 12px; color: #999">
                    {{ formatTime(item.created_at) }}
                  </div>
                </a-space>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>

        <template #empty>
          <a-empty description="暂无好友请求" />
        </template>
      </a-list>
    </a-modal>

    <!-- 修改备注对话框 -->
    <a-modal
      v-model:open="showEditNicknameModal"
      title="修改备注"
      @ok="handleSaveNickname"
    >
      <a-form-item label="备注名">
        <a-input v-model:value="editNicknameForm.nickname" placeholder="输入备注名" />
      </a-form-item>
    </a-modal>

    <!-- 修改分组对话框 -->
    <a-modal
      v-model:open="showChangeGroupModal"
      title="修改分组"
      @ok="handleSaveGroup"
    >
      <a-form-item label="分组">
        <a-select v-model:value="changeGroupForm.groupName" placeholder="选择或输入分组">
          <a-select-option v-for="group in Object.keys(statistics.byGroup)" :key="group" :value="group">
            {{ group }}
          </a-select-option>
        </a-select>
      </a-form-item>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { message as antMessage } from 'ant-design-vue';
import { useSocialStore } from '../stores/social';
import {
  UserOutlined,
  UserAddOutlined,
  ReloadOutlined,
  MessageOutlined,
  BellOutlined,
  SearchOutlined,
  EllipsisOutlined,
  EditOutlined,
  FolderOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons-vue';

// 状态
const router = useRouter();
const socialStore = useSocialStore();

const loading = ref(false);
const loadingRequests = ref(false);
const adding = ref(false);
const processingRequest = ref(null);

const friends = ref([]);
const pendingRequests = ref([]);
const statistics = ref({
  total: 0,
  online: 0,
  offline: 0,
  byGroup: {},
});

const selectedGroup = ref('');
const searchText = ref('');
const filteredFriends = computed(() => {
  let result = friends.value;

  // 分组筛选
  if (selectedGroup.value) {
    result = result.filter(f => f.group_name === selectedGroup.value);
  }

  // 搜索筛选
  if (searchText.value) {
    const search = searchText.value.toLowerCase();
    result = result.filter(f =>
      f.friend_did.toLowerCase().includes(search) ||
      (f.nickname && f.nickname.toLowerCase().includes(search))
    );
  }

  return result;
});

const pendingRequestsCount = computed(() => pendingRequests.value.length);

// 对话框状态
const showAddFriendModal = ref(false);
const showRequestsModal = ref(false);
const showEditNicknameModal = ref(false);
const showChangeGroupModal = ref(false);

// 表单数据
const addFriendForm = reactive({
  targetDid: '',
  message: '',
});

const editNicknameForm = reactive({
  friendDid: '',
  nickname: '',
});

const changeGroupForm = reactive({
  friendDid: '',
  groupName: '我的好友',
});

// 工具函数
const shortenDid = (did) => {
  if (!did) return '';
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const getAvatarColor = (did) => {
  const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#1890ff'];
  const hash = did.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const getOnlineStatus = (friend) => {
  if (!friend.onlineStatus) return 'default';
  return friend.onlineStatus.status === 'online' ? 'success' : 'default';
};

const getStatusText = (friend) => {
  if (!friend.onlineStatus || friend.onlineStatus.status === 'offline') {
    if (friend.onlineStatus?.lastSeen) {
      return `最后上线: ${formatTime(friend.onlineStatus.lastSeen)}`;
    }
    return '离线';
  }

  if (friend.onlineStatus.deviceCount > 1) {
    return `在线 (${friend.onlineStatus.deviceCount} 台设备)`;
  }

  return '在线';
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60 * 1000) {
    return '刚刚';
  }

  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes} 分钟前`;
  }

  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours} 小时前`;
  }

  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days} 天前`;
  }

  return date.toLocaleDateString('zh-CN');
};

// 加载好友列表
const loadFriends = async () => {
  try {
    loading.value = true;
    friends.value = await window.electronAPI.friend.getFriends(selectedGroup.value || null);
    console.log('好友列表已加载:', friends.value.length);
  } catch (error) {
    console.error('加载好友列表失败:', error);
    antMessage.error('加载好友列表失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 加载统计信息
const loadStatistics = async () => {
  try {
    statistics.value = await window.electronAPI.friend.getStatistics();
  } catch (error) {
    console.error('加载统计信息失败:', error);
  }
};

// 加载待处理请求
const loadPendingRequests = async () => {
  try {
    loadingRequests.value = true;
    pendingRequests.value = await window.electronAPI.friend.getPendingRequests();
  } catch (error) {
    console.error('加载好友请求失败:', error);
  } finally {
    loadingRequests.value = false;
  }
};

// 分组切换
const handleGroupChange = () => {
  loadFriends();
};

// 搜索
const handleSearch = () => {
  // filteredFriends 会自动更新
};

// 添加好友
const handleAddFriend = async () => {
  if (!addFriendForm.targetDid) {
    antMessage.warning('请输入好友 DID');
    return;
  }

  try {
    adding.value = true;
    await window.electronAPI.friend.sendRequest(addFriendForm.targetDid, addFriendForm.message);
    antMessage.success('好友请求已发送');
    showAddFriendModal.value = false;

    // 重置表单
    addFriendForm.targetDid = '';
    addFriendForm.message = '';
  } catch (error) {
    console.error('发送好友请求失败:', error);
    antMessage.error('发送好友请求失败: ' + error.message);
  } finally {
    adding.value = false;
  }
};

// 接受好友请求
const handleAcceptRequest = async (requestId) => {
  try {
    processingRequest.value = requestId;
    await window.electronAPI.friend.acceptRequest(requestId);
    antMessage.success('已接受好友请求');

    // 刷新列表
    await Promise.all([
      loadFriends(),
      loadPendingRequests(),
      loadStatistics(),
    ]);
  } catch (error) {
    console.error('接受好友请求失败:', error);
    antMessage.error('接受好友请求失败: ' + error.message);
  } finally {
    processingRequest.value = null;
  }
};

// 拒绝好友请求
const handleRejectRequest = async (requestId) => {
  try {
    processingRequest.value = requestId;
    await window.electronAPI.friend.rejectRequest(requestId);
    antMessage.success('已拒绝好友请求');

    // 刷新列表
    await loadPendingRequests();
  } catch (error) {
    console.error('拒绝好友请求失败:', error);
    antMessage.error('拒绝好友请求失败: ' + error.message);
  } finally {
    processingRequest.value = null;
  }
};

// 打开聊天
const handleOpenChat = async (friend) => {
  try {
    // 使用 socialStore 打开与好友的聊天
    await socialStore.openChatWithFriend(friend);

    // 跳转到聊天窗口页面
    router.push('/chat');

    antMessage.success(`已打开与 ${friend.nickname || friend.friend_did.substring(0, 16)} 的聊天`);
  } catch (error) {
    console.error('打开聊天失败:', error);
    antMessage.error('打开聊天失败');
  }
};

// 修改备注
const handleEditNickname = (friend) => {
  editNicknameForm.friendDid = friend.friend_did;
  editNicknameForm.nickname = friend.nickname || '';
  showEditNicknameModal.value = true;
};

const handleSaveNickname = async () => {
  try {
    await window.electronAPI.friend.updateNickname(
      editNicknameForm.friendDid,
      editNicknameForm.nickname
    );
    antMessage.success('备注已更新');
    showEditNicknameModal.value = false;
    await loadFriends();
  } catch (error) {
    console.error('更新备注失败:', error);
    antMessage.error('更新备注失败: ' + error.message);
  }
};

// 修改分组
const handleChangeGroup = (friend) => {
  changeGroupForm.friendDid = friend.friend_did;
  changeGroupForm.groupName = friend.group_name || '我的好友';
  showChangeGroupModal.value = true;
};

const handleSaveGroup = async () => {
  try {
    await window.electronAPI.friend.updateGroup(
      changeGroupForm.friendDid,
      changeGroupForm.groupName
    );
    antMessage.success('分组已更新');
    showChangeGroupModal.value = false;
    await Promise.all([loadFriends(), loadStatistics()]);
  } catch (error) {
    console.error('更新分组失败:', error);
    antMessage.error('更新分组失败: ' + error.message);
  }
};

// 删除好友
const handleRemoveFriend = (friend) => {
  antMessage.confirm({
    title: '确认删除好友',
    content: `确定要删除好友 ${friend.nickname || shortenDid(friend.friend_did)} 吗？`,
    async onOk() {
      try {
        await window.electronAPI.friend.remove(friend.friend_did);
        antMessage.success('已删除好友');
        await Promise.all([loadFriends(), loadStatistics()]);
      } catch (error) {
        console.error('删除好友失败:', error);
        antMessage.error('删除好友失败: ' + error.message);
      }
    },
  });
};

// 生命周期
onMounted(async () => {
  await Promise.all([
    loadFriends(),
    loadPendingRequests(),
    loadStatistics(),
  ]);

  // 定期刷新
  const refreshInterval = setInterval(() => {
    loadFriends();
    loadPendingRequests();
    loadStatistics();
  }, 30000); // 30 秒刷新一次

  // Store interval ID for cleanup
  window.__friendsRefreshInterval = refreshInterval;
});

onUnmounted(() => {
  if (window.__friendsRefreshInterval) {
    clearInterval(window.__friendsRefreshInterval);
  }
});
</script>

<style scoped>
.friends-container {
  padding: 20px;
}
</style>
