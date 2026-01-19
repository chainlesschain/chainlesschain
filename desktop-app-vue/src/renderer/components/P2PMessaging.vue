<template>
  <div class="p2p-messaging">
    <a-card
      title="P2P 加密消息"
      :loading="loading"
    >
      <template #extra>
        <a-space>
          <a-badge
            :count="onlinePeersCount"
            :number-style="{ backgroundColor: '#52c41a' }"
          >
            <a-button>
              <template #icon>
                <team-outlined />
              </template>
              在线节点
            </a-button>
          </a-badge>
          <a-button @click="showDeviceStatsModal = true">
            <template #icon>
              <mobile-outlined />
            </template>
            设备统计
          </a-button>
          <a-badge
            :count="syncStats.totalMessages"
            :number-style="{ backgroundColor: '#1890ff' }"
          >
            <a-button @click="showSyncStatsModal = true">
              <template #icon>
                <sync-outlined />
              </template>
              同步队列
            </a-button>
          </a-badge>
          <a-button @click="loadAllData">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 当前设备信息 -->
      <a-alert
        v-if="currentDevice"
        type="info"
        style="margin-bottom: 16px"
        show-icon
      >
        <template #message>
          <a-space>
            <span><strong>当前设备:</strong> {{ currentDevice.deviceName }}</span>
            <a-tag color="blue">
              {{ currentDevice.platform }}
            </a-tag>
            <a-tag color="green">
              {{ currentDevice.deviceId.slice(0, 8) }}...
            </a-tag>
          </a-space>
        </template>
      </a-alert>

      <!-- 节点信息 -->
      <a-descriptions
        v-if="nodeInfo"
        bordered
        size="small"
        :column="2"
        style="margin-bottom: 16px"
      >
        <a-descriptions-item label="节点 ID">
          <a-typography-text copyable>
            {{ shortenPeerId(nodeInfo.peerId) }}
          </a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="连接节点">
          <a-badge
            :count="nodeInfo.connectedPeers"
            :number-style="{ backgroundColor: '#52c41a' }"
          />
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
            <a-tag color="blue">
              {{ peers.length }} 个节点
            </a-tag>
          </div>
        </template>
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip title="查看设备">
                <a-button
                  type="link"
                  size="small"
                  @click="handleViewDevices(item)"
                >
                  <template #icon>
                    <mobile-outlined />
                  </template>
                  设备 ({{ getPeerDeviceCount(item.peerId) }})
                </a-button>
              </a-tooltip>
              <a-tooltip :title="hasAnyEncryptionSession(item.peerId) ? '已建立加密会话' : '未建立加密会话'">
                <a-badge :status="hasAnyEncryptionSession(item.peerId) ? 'success' : 'default'" />
              </a-tooltip>
              <a-tooltip title="语音通话">
                <a-button
                  type="link"
                  size="small"
                  :disabled="!hasAnyEncryptionSession(item.peerId)"
                  @click="handleVoiceCall(item)"
                >
                  <template #icon>
                    <phone-outlined />
                  </template>
                </a-button>
              </a-tooltip>
              <a-tooltip title="视频通话">
                <a-button
                  type="link"
                  size="small"
                  :disabled="!hasAnyEncryptionSession(item.peerId)"
                  @click="handleVideoCall(item)"
                >
                  <template #icon>
                    <video-camera-outlined />
                  </template>
                </a-button>
              </a-tooltip>
              <a-button
                type="link"
                size="small"
                :disabled="!hasAnyEncryptionSession(item.peerId)"
                @click="handleOpenChat(item)"
              >
                <template #icon>
                  <message-outlined />
                </template>
                聊天
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
                  <template #icon>
                    <user-outlined />
                  </template>
                </a-avatar>
              </template>
              <template #title>
                <a-typography-text copyable>
                  {{ shortenPeerId(item.peerId) }}
                </a-typography-text>
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
      <a-card
        size="small"
        title="连接新节点"
      >
        <a-form
          layout="inline"
          @submit.prevent="handleConnect"
        >
          <a-form-item label="Multiaddr">
            <a-input
              v-model:value="connectAddress"
              placeholder="/ip4/127.0.0.1/tcp/9001/p2p/..."
              style="width: 400px"
            />
          </a-form-item>
          <a-form-item>
            <a-button
              type="primary"
              html-type="submit"
              :loading="connecting"
            >
              连接
            </a-button>
          </a-form-item>
        </a-form>
      </a-card>
    </a-card>

    <!-- 设备列表模态框 -->
    <a-modal
      v-model:open="showDevicesModal"
      :title="`${currentPeerDevices?.peerId ? shortenPeerId(currentPeerDevices.peerId) : ''} 的设备列表`"
      width="600px"
      :footer="null"
    >
      <a-list
        :data-source="currentPeerDevices?.devices || []"
        item-layout="horizontal"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip :title="hasEncryptionSession(currentPeerDevices.peerId, item.deviceId) ? '已建立加密' : '未加密'">
                <a-badge :status="hasEncryptionSession(currentPeerDevices.peerId, item.deviceId) ? 'success' : 'default'" />
              </a-tooltip>
              <a-button
                v-if="!hasEncryptionSession(currentPeerDevices.peerId, item.deviceId)"
                type="link"
                size="small"
                @click="handleKeyExchange(currentPeerDevices.peerId, item.deviceId)"
              >
                <template #icon>
                  <safety-outlined />
                </template>
                建立加密
              </a-button>
              <a-button
                v-else
                type="link"
                size="small"
                @click="handleChatWithDevice(currentPeerDevices.peerId, item.deviceId)"
              >
                <template #icon>
                  <message-outlined />
                </template>
                聊天
              </a-button>
            </template>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar :style="{ backgroundColor: getDeviceColor(item.platform) }">
                  <template #icon>
                    <mobile-outlined v-if="item.platform === 'android' || item.platform === 'ios'" />
                    <laptop-outlined v-else />
                  </template>
                </a-avatar>
              </template>
              <template #title>
                {{ item.deviceName }}
              </template>
              <template #description>
                <a-space>
                  <a-tag>{{ item.platform }}</a-tag>
                  <a-tag color="blue">
                    {{ item.deviceId.slice(0, 8) }}...
                  </a-tag>
                  <span style="font-size: 12px; color: #999">
                    最后活跃: {{ formatTime(item.lastActiveAt) }}
                  </span>
                </a-space>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
        <template #empty>
          <a-empty description="暂无设备信息" />
        </template>
      </a-list>
    </a-modal>

    <!-- 设备统计模态框 -->
    <a-modal
      v-model:open="showDeviceStatsModal"
      title="设备统计"
      width="500px"
      :footer="null"
    >
      <a-descriptions
        bordered
        :column="1"
      >
        <a-descriptions-item label="用户总数">
          {{ deviceStats.userCount }}
        </a-descriptions-item>
        <a-descriptions-item label="设备总数">
          {{ deviceStats.totalDevices }}
        </a-descriptions-item>
        <a-descriptions-item label="当前设备">
          {{ deviceStats.currentDevice?.deviceName || 'N/A' }}
        </a-descriptions-item>
        <a-descriptions-item label="设备 ID">
          <a-typography-text copyable>
            {{ deviceStats.currentDevice?.deviceId || 'N/A' }}
          </a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="平台">
          {{ deviceStats.currentDevice?.platform || 'N/A' }}
        </a-descriptions-item>
        <a-descriptions-item label="版本">
          {{ deviceStats.currentDevice?.version || 'N/A' }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>

    <!-- 同步统计模态框 -->
    <a-modal
      v-model:open="showSyncStatsModal"
      title="消息同步统计"
      width="600px"
      :footer="null"
    >
      <a-descriptions
        bordered
        :column="2"
      >
        <a-descriptions-item
          label="队列消息总数"
          :span="2"
        >
          {{ syncStats.totalMessages }}
        </a-descriptions-item>
        <a-descriptions-item label="设备队列数">
          {{ syncStats.deviceCount }}
        </a-descriptions-item>
        <a-descriptions-item label="活动同步">
          {{ syncStats.activeSyncs }}
        </a-descriptions-item>
        <a-descriptions-item
          label="消息状态跟踪"
          :span="2"
        >
          {{ syncStats.statusCount }}
        </a-descriptions-item>
      </a-descriptions>

      <a-divider>各设备队列详情</a-divider>

      <a-list
        v-if="Object.keys(syncStats.deviceQueues || {}).length > 0"
        bordered
      >
        <a-list-item
          v-for="(count, deviceId) in syncStats.deviceQueues"
          :key="deviceId"
        >
          <a-list-item-meta>
            <template #title>
              设备: {{ deviceId.slice(0, 12) }}...
            </template>
            <template #description>
              队列消息: {{ count }} 条
            </template>
          </a-list-item-meta>
          <template #actions>
            <a-button
              type="link"
              size="small"
              @click="handleStartSync(deviceId)"
            >
              立即同步
            </a-button>
          </template>
        </a-list-item>
      </a-list>

      <a-empty
        v-else
        description="暂无队列消息"
      />
    </a-modal>

    <!-- 聊天对话框 -->
    <a-modal
      v-model:open="showChatModal"
      :title="getChatTitle()"
      width="600px"
      :footer="null"
      @cancel="handleCloseChat"
    >
      <div class="chat-container">
        <!-- 设备选择器 -->
        <div
          v-if="currentChatDevices.length > 1"
          class="device-selector"
        >
          <a-select
            v-model:value="currentChatDeviceId"
            style="width: 100%; margin-bottom: 12px"
            placeholder="选择设备"
            @change="handleDeviceChange"
          >
            <a-select-option
              v-for="device in currentChatDevices"
              :key="device.deviceId"
              :value="device.deviceId"
            >
              <a-space>
                <mobile-outlined v-if="device.platform === 'android' || device.platform === 'ios'" />
                <laptop-outlined v-else />
                {{ device.deviceName }}
                <a-tag
                  v-if="hasEncryptionSession(currentChatPeer, device.deviceId)"
                  color="green"
                  size="small"
                >
                  已加密
                </a-tag>
              </a-space>
            </a-select-option>
          </a-select>
        </div>

        <!-- 消息列表 -->
        <div
          ref="messageList"
          class="message-list"
        >
          <div
            v-for="msg in chatMessages"
            :key="msg.id"
            :class="['message-item', msg.isSent ? 'sent' : 'received']"
          >
            <div class="message-bubble">
              <div class="message-content">
                {{ msg.content }}
              </div>
              <div class="message-time">
                {{ formatTime(msg.timestamp) }}
                <safety-certificate-outlined
                  v-if="msg.encrypted"
                  style="margin-left: 4px; color: #52c41a"
                />
                <span
                  v-if="msg.deviceName"
                  style="margin-left: 4px; font-size: 10px"
                >
                  ({{ msg.deviceName }})
                </span>
                <span
                  v-if="msg.status"
                  style="margin-left: 4px; font-size: 10px"
                >
                  <span
                    v-if="msg.status === 'queued'"
                    title="消息已入队,等待发送"
                  >⏳</span>
                  <span
                    v-else-if="msg.status === 'sent'"
                    title="已发送"
                  >✓</span>
                  <span
                    v-else-if="msg.status === 'delivered'"
                    title="已送达"
                  >✓✓</span>
                  <span
                    v-else-if="msg.status === 'read'"
                    title="已读"
                    style="color: #1890ff"
                  >✓✓</span>
                  <span
                    v-else-if="msg.status === 'failed'"
                    title="发送失败"
                  >✗</span>
                </span>
              </div>
            </div>
          </div>
          <div
            v-if="chatMessages.length === 0"
            class="empty-messages"
          >
            <a-empty description="暂无消息">
              <template #description>
                <span v-if="!hasEncryptionSession(currentChatPeer, currentChatDeviceId)">
                  请先建立加密会话
                </span>
                <span v-else>暂无消息</span>
              </template>
            </a-empty>
          </div>
        </div>

        <!-- 输入框 -->
        <div class="message-input">
          <a-input-group compact>
            <a-input
              v-model:value="messageInput"
              placeholder="输入消息 (端到端加密)..."
              :disabled="!hasEncryptionSession(currentChatPeer, currentChatDeviceId)"
              style="width: calc(100% - 80px)"
              @keyup.enter="handleSendMessage"
            />
            <a-button
              type="primary"
              :loading="sending"
              :disabled="!hasEncryptionSession(currentChatPeer, currentChatDeviceId)"
              @click="handleSendMessage"
            >
              发送
            </a-button>
          </a-input-group>
          <div
            v-if="!hasEncryptionSession(currentChatPeer, currentChatDeviceId)"
            style="margin-top: 8px"
          >
            <a-button
              type="link"
              size="small"
              @click="handleKeyExchange(currentChatPeer, currentChatDeviceId)"
            >
              <template #icon>
                <safety-outlined />
              </template>
              点击建立加密会话
            </a-button>
          </div>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { message as antMessage } from 'ant-design-vue';
import { useSocialStore } from '../stores/social';
import {
  TeamOutlined,
  ReloadOutlined,
  MessageOutlined,
  SafetyOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  MobileOutlined,
  LaptopOutlined,
  SyncOutlined,
  PhoneOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons-vue';

// 状态
// 社交模块 Store
const socialStore = useSocialStore();

const loading = ref(false);
const connecting = ref(false);
const sending = ref(false);
const nodeInfo = ref(null);
const peers = ref([]);
const connectAddress = ref('');
const encryptionSessions = reactive(new Map()); // Map<peerId-deviceId, boolean>
const onlinePeersCount = ref(0);
const currentDevice = ref(null);
const deviceStats = ref({
  userCount: 0,
  totalDevices: 0,
  currentDevice: null,
});

// 设备相关
const peerDevices = reactive(new Map()); // Map<peerId, Device[]>
const showDevicesModal = ref(false);
const showDeviceStatsModal = ref(false);
const currentPeerDevices = ref(null);

// 同步相关
const syncStats = ref({
  totalMessages: 0,
  deviceCount: 0,
  deviceQueues: {},
  statusCount: 0,
  activeSyncs: 0,
});
const showSyncStatsModal = ref(false);

// 聊天相关
const showChatModal = ref(false);
const currentChatPeer = ref('');
const currentChatDeviceId = ref('');
const currentChatDevices = ref([]);
const chatMessages = ref([]);
const messageInput = ref('');
const messageList = ref(null);

// 缩短 Peer ID 显示
const shortenPeerId = (peerId) => {
  if (!peerId) {return '';}
  return peerId.length > 20 ? `${peerId.slice(0, 10)}...${peerId.slice(-8)}` : peerId;
};

// 获取会话标识
const getSessionKey = (peerId, deviceId) => {
  return `${peerId}-${deviceId}`;
};

// 检查是否有加密会话
const hasEncryptionSession = (peerId, deviceId) => {
  const key = getSessionKey(peerId, deviceId);
  return encryptionSessions.has(key);
};

// 检查是否有任何加密会话
const hasAnyEncryptionSession = (peerId) => {
  for (const key of encryptionSessions.keys()) {
    if (key.startsWith(peerId + '-')) {
      return true;
    }
  }
  return false;
};

// 获取设备数量
const getPeerDeviceCount = (peerId) => {
  const devices = peerDevices.get(peerId);
  return devices ? devices.length : 0;
};

// 获取设备颜色
const getDeviceColor = (platform) => {
  const colors = {
    'win32': '#1890ff',
    'darwin': '#722ed1',
    'linux': '#fa8c16',
    'android': '#52c41a',
    'ios': '#13c2c2',
  };
  return colors[platform] || '#999';
};

// 格式化时间
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  // 如果是今天
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  // 如果是最近7天
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    return `${days}天前`;
  }

  // 否则显示日期
  return date.toLocaleDateString('zh-CN');
};

// 获取聊天标题
const getChatTitle = () => {
  const peerIdShort = shortenPeerId(currentChatPeer.value);
  if (currentChatDeviceId.value && currentChatDevices.value.length > 0) {
    const device = currentChatDevices.value.find(d => d.deviceId === currentChatDeviceId.value);
    if (device) {
      return `与 ${peerIdShort} (${device.deviceName}) 聊天`;
    }
  }
  return `与 ${peerIdShort} 聊天`;
};

// 加载所有数据
const loadAllData = async () => {
  await Promise.all([
    loadNodeInfo(),
    loadPeers(),
    loadCurrentDevice(),
    loadDeviceStatistics(),
    loadSyncStatistics(),
  ]);
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
    logger.error('加载节点信息失败:', error);
  } finally {
    loading.value = false;
  }
};

// 加载当前设备
const loadCurrentDevice = async () => {
  try {
    const device = await window.electronAPI.p2p.getCurrentDevice();
    if (device) {
      currentDevice.value = device;
    }
  } catch (error) {
    logger.error('加载当前设备失败:', error);
  }
};

// 加载设备统计
const loadDeviceStatistics = async () => {
  try {
    const stats = await window.electronAPI.p2p.getDeviceStatistics();
    if (stats) {
      deviceStats.value = stats;
    }
  } catch (error) {
    logger.error('加载设备统计失败:', error);
  }
};

// 加载同步统计
const loadSyncStatistics = async () => {
  try {
    const stats = await window.electronAPI.p2p.getSyncStatistics();
    if (stats) {
      syncStats.value = stats;
    }
  } catch (error) {
    logger.error('加载同步统计失败:', error);
  }
};

// 启动设备同步
const handleStartSync = async (deviceId) => {
  try {
    await window.electronAPI.p2p.startDeviceSync(deviceId);
    antMessage.success('已启动设备同步');
    // 刷新统计
    await loadSyncStatistics();
  } catch (error) {
    logger.error('启动设备同步失败:', error);
    antMessage.error('启动设备同步失败: ' + error.message);
  }
};

// 加载对等节点列表
const loadPeers = async () => {
  try {
    const peerList = await window.electronAPI.p2p.getPeers();
    peers.value = peerList || [];
    onlinePeersCount.value = peerList?.length || 0;

    // 为每个节点加载设备列表
    for (const peer of peers.value) {
      await loadPeerDevices(peer.peerId);
    }

    // 检查每个设备的加密会话状态
    for (const peer of peers.value) {
      const devices = peerDevices.get(peer.peerId) || [];
      for (const device of devices) {
        const hasSession = await window.electronAPI.p2p.hasEncryptedSession(peer.peerId);
        if (hasSession) {
          const key = getSessionKey(peer.peerId, device.deviceId);
          encryptionSessions.set(key, true);
        }
      }
    }
  } catch (error) {
    logger.error('加载对等节点失败:', error);
  }
};

// 加载对等节点的设备列表
const loadPeerDevices = async (peerId) => {
  try {
    const devices = await window.electronAPI.p2p.getUserDevices(peerId);
    if (devices && devices.length > 0) {
      peerDevices.set(peerId, devices);
    }
  } catch (error) {
    logger.error('加载设备列表失败:', error);
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
    logger.error('连接失败:', error);
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

    // 清除该节点的所有加密会话
    const devices = peerDevices.get(peerId) || [];
    for (const device of devices) {
      const key = getSessionKey(peerId, device.deviceId);
      encryptionSessions.delete(key);
    }

    peerDevices.delete(peerId);
    await loadPeers();
  } catch (error) {
    logger.error('断开连接失败:', error);
    antMessage.error('断开连接失败: ' + error.message);
  }
};

// 查看设备
const handleViewDevices = async (peer) => {
  await loadPeerDevices(peer.peerId);
  const devices = peerDevices.get(peer.peerId) || [];

  currentPeerDevices.value = {
    peerId: peer.peerId,
    devices,
  };

  showDevicesModal.value = true;
};

// 发起密钥交换
const handleKeyExchange = async (peerId, deviceId = null) => {
  try {
    loading.value = true;
    await window.electronAPI.p2p.initiateKeyExchange(peerId, deviceId);
    antMessage.success('密钥交换成功，已建立加密会话');

    const key = getSessionKey(peerId, deviceId);
    encryptionSessions.set(key, true);

    // 刷新设备列表
    await loadPeerDevices(peerId);
  } catch (error) {
    logger.error('密钥交换失败:', error);
    antMessage.error('密钥交换失败: ' + error.message);
  } finally {
    loading.value = false;
  }
};

// 打开聊天窗口
const handleOpenChat = async (peer) => {
  // 加载设备列表
  await loadPeerDevices(peer.peerId);
  const devices = peerDevices.get(peer.peerId) || [];

  // 如果有设备，选择第一个已加密的设备或第一个设备
  let targetDeviceId = null;
  if (devices.length > 0) {
    const encryptedDevice = devices.find(d => hasEncryptionSession(peer.peerId, d.deviceId));
    targetDeviceId = encryptedDevice ? encryptedDevice.deviceId : devices[0].deviceId;
  }

  currentChatPeer.value = peer.peerId;
  currentChatDeviceId.value = targetDeviceId;
  currentChatDevices.value = devices;
  showChatModal.value = true;

  // 加载该对话的历史消息
  loadChatHistory(peer.peerId, targetDeviceId);
};

// 语音通话
const handleVoiceCall = async (peer) => {
  try {
    const peerId = peer.peerId;
    const nickname = shortenPeerId(peerId);

    antMessage.loading(`正在呼叫 ${nickname}...`, 0);

    const result = await window.electronAPI.p2p.startVoiceCall(peerId);

    antMessage.destroy();

    if (result.success) {
      antMessage.success(`语音通话已建立`);
    } else {
      antMessage.error(`语音通话失败: ${result.error || '未知错误'}`);
    }
  } catch (error) {
    antMessage.destroy();
    logger.error('发起语音通话失败:', error);
    antMessage.error('发起语音通话失败');
  }
};

// 视频通话
const handleVideoCall = async (peer) => {
  try {
    const peerId = peer.peerId;
    const nickname = shortenPeerId(peerId);

    antMessage.loading(`正在呼叫 ${nickname}...`, 0);

    const result = await window.electronAPI.p2p.startVideoCall(peerId);

    antMessage.destroy();

    if (result.success) {
      antMessage.success(`视频通话已建立`);
    } else {
      antMessage.error(`视频通话失败: ${result.error || '未知错误'}`);
    }
  } catch (error) {
    antMessage.destroy();
    logger.error('发起视频通话失败:', error);
    antMessage.error('发起视频通话失败');
  }
};

// 与特定设备聊天
const handleChatWithDevice = (peerId, deviceId) => {
  const devices = peerDevices.get(peerId) || [];

  currentChatPeer.value = peerId;
  currentChatDeviceId.value = deviceId;
  currentChatDevices.value = devices;
  showChatModal.value = true;
  showDevicesModal.value = false;

  loadChatHistory(peerId, deviceId);
};

// 设备切换
const handleDeviceChange = (deviceId) => {
  loadChatHistory(currentChatPeer.value, deviceId);
};

// 关闭聊天窗口
const handleCloseChat = () => {
  showChatModal.value = false;
  currentChatPeer.value = '';
  currentChatDeviceId.value = '';
  currentChatDevices.value = [];
  chatMessages.value = [];
};

// 加载聊天历史（暂时使用内存存储）
const chatHistoryStore = new Map();

const loadChatHistory = (peerId, deviceId) => {
  const key = getSessionKey(peerId, deviceId);
  const history = chatHistoryStore.get(key) || [];
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

  if (!hasEncryptionSession(currentChatPeer.value, currentChatDeviceId.value)) {
    antMessage.warning('请先建立加密会话');
    return;
  }

  const content = messageInput.value.trim();
  const messageId = Date.now();

  try {
    sending.value = true;

    // 发送加密消息,传入设备 ID
    const result = await window.electronAPI.p2p.sendEncryptedMessage(
      currentChatPeer.value,
      content,
      currentChatDeviceId.value
    );

    // 根据发送结果创建消息
    const newMessage = {
      id: messageId,
      content,
      timestamp: Date.now(),
      isSent: true,
      encrypted: true,
      deviceName: currentDevice.value?.deviceName,
      status: result.status || 'sent', // 'sent' 或 'queued'
      messageId: result.messageId, // 如果是队列消息,保存消息 ID
    };

    chatMessages.value.push(newMessage);

    // 保存到历史记录（内存）
    const key = getSessionKey(currentChatPeer.value, currentChatDeviceId.value);
    const history = chatHistoryStore.get(key) || [];
    history.push(newMessage);
    chatHistoryStore.set(key, history);

    // 【新增】保存到数据库持久化
    try {
      await window.electron.ipcRenderer.invoke('chat:save-message', {
        id: `msg_${messageId}_${Math.random().toString(36).substr(2, 9)}`,
        sessionId: `session_${currentChatPeer.value}_${currentChatDeviceId.value}`,
        senderDid: await socialStore.getCurrentUserDid(),
        receiverDid: currentChatPeer.value,
        content: content,
        messageType: 'text',
        encrypted: 1,
        status: result.status || 'sent',
        deviceId: currentChatDeviceId.value,
        timestamp: Date.now()
      });
    } catch (dbError) {
      logger.error('保存消息到数据库失败:', dbError);
      // 不影响消息发送，只记录错误
    }

    // 清空输入框
    messageInput.value = '';

    // 滚动到底部
    nextTick(() => {
      scrollToBottom();
    });

    // 显示不同的提示信息
    if (result.status === 'queued') {
      antMessage.info(`消息已加入队列(对方离线)`);
      // 刷新同步统计
      await loadSyncStatistics();
    } else {
      antMessage.success('消息已发送（加密）');
    }
  } catch (error) {
    logger.error('发送消息失败:', error);
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
  logger.info('收到加密消息:', data);

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

  // 保存到历史记录（内存）
  const devices = peerDevices.get(data.from) || [];
  const deviceId = devices.length > 0 ? devices[0].deviceId : 'unknown';
  const key = getSessionKey(data.from, deviceId);
  const history = chatHistoryStore.get(key) || [];
  history.push(newMessage);
  chatHistoryStore.set(key, history);

  // 【新增】保存到数据库并通过 socialStore 处理
  (async () => {
    try {
      await socialStore.receiveMessage({
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        senderDid: data.from,
        content: data.message,
        messageType: 'text',
        timestamp: Date.now()
      });
    } catch (dbError) {
      logger.error('保存接收消息到数据库失败:', dbError);
    }
  })();

  // 显示通知
  antMessage.info(`收到来自 ${shortenPeerId(data.from)} 的加密消息`);
};

// 密钥交换成功事件处理
const handleKeyExchangeSuccess = (data) => {
  logger.info('密钥交换成功:', data);

  const key = getSessionKey(data.peerId, data.deviceId);
  encryptionSessions.set(key, true);

  antMessage.success(`与 ${shortenPeerId(data.peerId)} 的设备 ${data.deviceId?.slice(0, 8)}... 建立了加密会话`);
};

// 生命周期
onMounted(async () => {
  await loadAllData();

  // 监听 P2P 事件
  window.electronAPI.p2p.on('p2p:encrypted-message', handleEncryptedMessageReceived);
  window.electronAPI.p2p.on('p2p:key-exchange-success', handleKeyExchangeSuccess);

  // 定期刷新节点列表和设备信息
  const refreshInterval = setInterval(() => {
    loadPeers();
    loadDeviceStatistics();
    loadSyncStatistics();
  }, 10000); // 每 10 秒刷新一次

  // Store interval ID for cleanup
  window.__p2pRefreshInterval = refreshInterval;
});

onUnmounted(() => {
  if (window.__p2pRefreshInterval) {
    clearInterval(window.__p2pRefreshInterval);
  }
  window.electronAPI.p2p.off('p2p:encrypted-message', handleEncryptedMessageReceived);
  window.electronAPI.p2p.off('p2p:key-exchange-success', handleKeyExchangeSuccess);
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

.device-selector {
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
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
</style>
