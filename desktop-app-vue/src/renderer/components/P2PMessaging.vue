<template>
  <div class="p2p-messaging">
    <a-card title="P2P 加密消息" :loading="loading">
      <template #extra>
        <a-space>
          <a-badge :count="onlinePeersCount" :number-style="{ backgroundColor: '#52c41a' }">
            <a-button>
              <template #icon><team-outlined /></template>
              在线节点
            </a-button>
          </a-badge>
          <a-button @click="loadNodeInfo">
            <template #icon><reload-outlined /></template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 节点信息 -->
      <a-descriptions v-if="nodeInfo" bordered size="small" :column="2" style="margin-bottom: 16px">
        <a-descriptions-item label="节点 ID">
          <a-typography-text copyable>{{ shortenPeerId(nodeInfo.peerId) }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="连接节点">
          <a-badge :count="nodeInfo.connectedPeers" :number-style="{ backgroundColor: '#52c41a' }" />
        </a-descriptions-item>
      </a-descriptions>

      <!-- 对等节点列表 -->
      <a-list
        :data-source="peers"
        item-layout="horizontal"
        style="margin-bottom: 16px"
      >
        <template #header>
          <div style="display: flex; align-items: center; justify-content: space-between">
            <strong>连接的节点</strong>
            <a-tag color="blue">{{ peers.length }} 个节点</a-tag>
          </div>
        </template>
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip :title="hasEncryptionSession(item.peerId) ? '已建立加密会话' : '未建立加密会话'">
                <a-badge :status="hasEncryptionSession(item.peerId) ? 'success' : 'default'" />
              </a-tooltip>
              <a-button
                type="link"
                size="small"
                @click="handleOpenChat(item)"
                :disabled="!hasEncryptionSession(item.peerId)"
              >
                <template #icon><message-outlined /></template>
                聊天
              </a-button>
              <a-button
                v-if="!hasEncryptionSession(item.peerId)"
                type="link"
                size="small"
                @click="handleKeyExchange(item.peerId)"
              >
                <template #icon><safety-outlined /></template>
                建立加密
              </a-button>
              <a-button
                type="link"
                size="small"
                danger
                @click="handleDisconnect(item.peerId)"
              >
                断开
              </a-button>
            </template>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar style="background-color: #1890ff">
                  <template #icon><user-outlined /></template>
                </a-avatar>
              </template>
              <template #title>
                <a-typography-text copyable>{{ shortenPeerId(item.peerId) }}</a-typography-text>
              </template>
              <template #description>
                <a-space>
                  <a-tag :color="item.status === 'open' ? 'success' : 'default'">
                    {{ item.status }}
                  </a-tag>
                  <span style="font-size: 12px; color: #999">{{ item.remoteAddr }}</span>
                </a-space>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>

      <!-- 连接新节点 -->
      <a-card size="small" title="连接新节点">
        <a-form layout="inline" @submit.prevent="handleConnect">
          <a-form-item label="Multiaddr">
            <a-input
              v-model:value="connectAddress"
              placeholder="/ip4/127.0.0.1/tcp/9001/p2p/..."
              style="width: 400px"
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" html-type="submit" :loading="connecting">
              连接
            </a-button>
          </a-form-item>
        </a-form>
      </a-card>
    </a-card>

    <!-- 聊天对话框 -->
    <a-modal
      v-model:visible="showChatModal"
      :title="`与 ${shortenPeerId(currentChatPeer)} 聊天`"
      width="600px"
      :footer="null"
      @cancel="handleCloseChat"
    >
      <div class="chat-container">
        <!-- 消息列表 -->
        <div class="message-list" ref="messageList">
          <div
            v-for="msg in chatMessages"
            :key="msg.id"
            :class="['message-item', msg.isSent ? 'sent' : 'received']"
          >
            <div class="message-bubble">
              <div class="message-content">{{ msg.content }}</div>
              <div class="message-time">
                {{ formatTime(msg.timestamp) }}
                <safety-certificate-outlined v-if="msg.encrypted" style="margin-left: 4px; color: #52c41a" />
              </div>
            </div>
          </div>
          <div v-if="chatMessages.length === 0" class="empty-messages">
            <a-empty description="暂无消息" />
          </div>
        </div>

        <!-- 输入框 -->
        <div class="message-input">
          <a-input-group compact>
            <a-input
              v-model:value="messageInput"
              placeholder="输入消息 (端到端加密)..."
              @keyup.enter="handleSendMessage"
              style="width: calc(100% - 80px)"
            />
            <a-button type="primary" @click="handleSendMessage" :loading="sending">
              发送
            </a-button>
          </a-input-group>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import {
  TeamOutlined,
  ReloadOutlined,
  MessageOutlined,
  SafetyOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons-vue';

// 状态
const loading = ref(false);
const connecting = ref(false);
const sending = ref(false);
const nodeInfo = ref(null);
const peers = ref([]);
const connectAddress = ref('');
const encryptionSessions = reactive(new Set());
const onlinePeersCount = ref(0);

// 聊天相关
const showChatModal = ref(false);
const currentChatPeer = ref('');
const chatMessages = ref([]);
const messageInput = ref('');
const messageList = ref(null);

// 缩短 Peer ID 显示
const shortenPeerId = (peerId) => {
  if (!peerId) return '';
  return peerId.length > 20 ? `${peerId.slice(0, 10)}...${peerId.slice(-8)}` : peerId;
};

// 检查是否有加密会话
const hasEncryptionSession = (peerId) => {
  return encryptionSessions.has(peerId);
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

// 加载节点信息
const loadNodeInfo = async () => {
  try {
    loading.value = true;
    const info = await window.electronAPI.p2p.getNodeInfo();
    if (info) {
      nodeInfo.value = info;
    }
  } catch (error) {
    console.error('加载节点信息失败:', error);
  } finally {
    loading.value = false;
  }
};

// 加载对等节点列表
const loadPeers = async () => {
  try {
    const peerList = await window.electronAPI.p2p.getPeers();
    peers.value = peerList || [];
    onlinePeersCount.value = peerList?.length || 0;

    // 检查每个节点的加密会话状态
    for (const peer of peers.value) {
      const hasSession = await window.electronAPI.p2p.hasEncryptedSession(peer.peerId);
      if (hasSession) {
        encryptionSessions.add(peer.peerId);
      }
    }
  } catch (error) {
    console.error('加载对等节点失败:', error);
  }
};

// 连接新节点
const handleConnect = async () => {
  if (!connectAddress.value) {
    antMessage.warning('请输入节点地址');
    return;
  }

  try {
    connecting.value = true;
    await window.electronAPI.p2p.connect(connectAddress.value);
    antMessage.success('连接成功');
    connectAddress.value = '';
    await loadPeers();
  } catch (error) {
    console.error('连接失败:', error);
    antMessage.error('连接失败: ' + error.message);
  } finally {
    connecting.value = false;
  }
};

// 断开连接
const handleDisconnect = async (peerId) => {
  try {
    await window.electronAPI.p2p.disconnect(peerId);
    antMessage.success('已断开连接');
    encryptionSessions.delete(peerId);
    await loadPeers();
  } catch (error) {
    console.error('断开连接失败:', error);
    antMessage.error('断开连接失败: ' + error.message);
  }
};

// 发起密钥交换
const handleKeyExchange = async (peerId) => {
  try {
    loading.value = true;
    await window.electronAPI.p2p.initiateKeyExchange(peerId);
    antMessage.success('密钥交换成功，已建立加密会话');
    encryptionSessions.add(peerId);
  } catch (error) {
    console.error('密钥交换失败:', error);
    antMessage.error('密钥交换失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 打开聊天窗口
const handleOpenChat = (peer) => {
  currentChatPeer.value = peer.peerId;
  showChatModal.value = true;
  // 加载该对话的历史消息（如果有的话）
  loadChatHistory(peer.peerId);
};

// 关闭聊天窗口
const handleCloseChat = () => {
  showChatModal.value = false;
  currentChatPeer.value = '';
  chatMessages.value = [];
};

// 加载聊天历史（暂时使用内存存储）
const chatHistoryStore = new Map();

const loadChatHistory = (peerId) => {
  const history = chatHistoryStore.get(peerId) || [];
  chatMessages.value = history;
  nextTick(() => {
    scrollToBottom();
  });
};

// 发送消息
const handleSendMessage = async () => {
  if (!messageInput.value.trim()) {
    return;
  }

  const content = messageInput.value.trim();
  const messageId = Date.now();

  try {
    sending.value = true;

    // 发送加密消息
    await window.electronAPI.p2p.sendEncryptedMessage(currentChatPeer.value, content);

    // 添加到消息列表
    const newMessage = {
      id: messageId,
      content,
      timestamp: Date.now(),
      isSent: true,
      encrypted: true,
    };

    chatMessages.value.push(newMessage);

    // 保存到历史记录
    const history = chatHistoryStore.get(currentChatPeer.value) || [];
    history.push(newMessage);
    chatHistoryStore.set(currentChatPeer.value, history);

    // 清空输入框
    messageInput.value = '';

    // 滚动到底部
    nextTick(() => {
      scrollToBottom();
    });

    antMessage.success('消息已发送（加密）');
  } catch (error) {
    console.error('发送消息失败:', error);
    antMessage.error('发送失败: ' + error.message);
  } finally {
    sending.value = false;
  }
};

// 滚动到底部
const scrollToBottom = () => {
  if (messageList.value) {
    messageList.value.scrollTop = messageList.value.scrollHeight;
  }
};

// 接收消息事件处理
const handleEncryptedMessageReceived = (data) => {
  console.log('收到加密消息:', data);

  const newMessage = {
    id: Date.now(),
    content: data.message,
    timestamp: Date.now(),
    isSent: false,
    encrypted: true,
  };

  // 如果当前正在与该节点聊天，直接添加到消息列表
  if (currentChatPeer.value === data.from) {
    chatMessages.value.push(newMessage);
    nextTick(() => {
      scrollToBottom();
    });
  }

  // 保存到历史记录
  const history = chatHistoryStore.get(data.from) || [];
  history.push(newMessage);
  chatHistoryStore.set(data.from, history);

  // 显示通知
  antMessage.info(`收到来自 ${shortenPeerId(data.from)} 的加密消息`);
};

// 密钥交换成功事件处理
const handleKeyExchangeSuccess = (data) => {
  console.log('密钥交换成功:', data);
  encryptionSessions.add(data.peerId);
  antMessage.success(`与 ${shortenPeerId(data.peerId)} 的加密会话已建立`);
};

// 生命周期
onMounted(async () => {
  await loadNodeInfo();
  await loadPeers();

  // 监听 P2P 事件
  window.electronAPI.p2p.on('p2p:encrypted-message', handleEncryptedMessageReceived);
  window.electronAPI.p2p.on('p2p:key-exchange-success', handleKeyExchangeSuccess);

  // 定期刷新节点列表
  const refreshInterval = setInterval(() => {
    loadPeers();
  }, 10000); // 每 10 秒刷新一次

  onUnmounted(() => {
    clearInterval(refreshInterval);
    window.electronAPI.p2p.off('p2p:encrypted-message', handleEncryptedMessageReceived);
    window.electronAPI.p2p.off('p2p:key-exchange-success', handleKeyExchangeSuccess);
  });
});
</script>

<style scoped>
.p2p-messaging {
  padding: 20px;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 500px;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background-color: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 12px;
}

.message-item {
  display: flex;
  margin-bottom: 12px;
}

.message-item.sent {
  justify-content: flex-end;
}

.message-item.received {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 8px;
  word-break: break-word;
}

.message-item.sent .message-bubble {
  background-color: #1890ff;
  color: white;
}

.message-item.received .message-bubble {
  background-color: white;
  color: #333;
  border: 1px solid #d9d9d9;
}

.message-content {
  margin-bottom: 4px;
}

.message-time {
  font-size: 11px;
  opacity: 0.7;
  text-align: right;
}

.empty-messages {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.message-input {
  padding-top: 8px;
  border-top: 1px solid #d9d9d9;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}
</style>
