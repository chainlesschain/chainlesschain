<template>
  <div>
    <!-- 传输层配置 -->
    <a-card title="传输层配置" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="WebRTC 传输">
          <a-switch
            v-model:checked="config.p2p.transports.webrtc.enabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra>
            <span style="color: #52c41a">推荐</span> -
            适合大多数NAT环境，提供最佳穿透能力
          </template>
        </a-form-item>

        <a-form-item label="WebSocket 传输">
          <a-switch
            v-model:checked="config.p2p.transports.websocket.enabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> HTTP兼容，防火墙友好，适合企业网络环境 </template>
        </a-form-item>

        <a-form-item label="TCP 传输">
          <a-switch
            v-model:checked="config.p2p.transports.tcp.enabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 直连传输，局域网性能最佳（向后兼容必需） </template>
        </a-form-item>

        <a-form-item label="智能自动选择">
          <a-switch
            v-model:checked="config.p2p.transports.autoSelect"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra> 根据NAT类型自动选择最优传输层 </template>
        </a-form-item>

        <a-form-item label="WebSocket 端口">
          <a-input-number
            v-model:value="config.p2p.websocket.port"
            :min="1024"
            :max="65535"
            style="width: 200px"
          />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- WebRTC 配置 -->
    <a-card title="WebRTC 配置" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="WebRTC 端口">
          <a-input-number
            v-model:value="config.p2p.webrtc.port"
            :min="1024"
            :max="65535"
            style="width: 200px"
          />
          <template #extra> WebRTC监听端口（UDP） </template>
        </a-form-item>

        <a-form-item label="ICE 传输策略">
          <a-select
            v-model:value="config.p2p.webrtc.iceTransportPolicy"
            style="width: 200px"
          >
            <a-select-option value="all"> 全部（STUN + TURN） </a-select-option>
            <a-select-option value="relay"> 仅中继（TURN） </a-select-option>
          </a-select>
          <template #extra>
            'all' 尝试所有候选，'relay' 强制使用TURN中继（更私密但速度慢）
          </template>
        </a-form-item>

        <a-form-item label="ICE 候选池大小">
          <a-slider
            v-model:value="config.p2p.webrtc.iceCandidatePoolSize"
            :min="0"
            :max="20"
            :marks="{ 0: '0', 5: '5', 10: '10', 15: '15', 20: '20' }"
          />
          <template #extra>
            预先收集的ICE候选数量，增加可加快连接建立速度
          </template>
        </a-form-item>

        <a-divider>STUN 服务器</a-divider>

        <a-alert
          message="快速配置本地STUN/TURN服务器"
          description="如果您已经使用Docker启动了本地coturn服务器，点击下方按钮可以自动配置"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        >
          <template #action>
            <a-button
              size="small"
              type="primary"
              @click="handleQuickSetupLocalCoturn"
            >
              <ThunderboltOutlined />
              一键配置
            </a-button>
          </template>
        </a-alert>

        <a-form-item label="STUN 服务器列表">
          <a-space direction="vertical" style="width: 100%">
            <a-tag
              v-for="(server, index) in config.p2p.stun.servers"
              :key="index"
              closable
              @close="handleRemoveStunServer(index)"
            >
              {{ server }}
            </a-tag>
            <a-input-group compact>
              <a-input
                v-model:value="newStunServer"
                placeholder="stun:stun.example.com:19302"
                style="width: calc(100% - 80px)"
                @press-enter="handleAddStunServer"
              />
              <a-button type="primary" @click="handleAddStunServer">
                添加
              </a-button>
            </a-input-group>
          </a-space>
          <template #extra> STUN服务器用于NAT穿透和公网IP发现 </template>
        </a-form-item>

        <a-divider>TURN 服务器</a-divider>

        <a-form-item label="启用 TURN">
          <a-switch
            v-model:checked="config.p2p.turn.enabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra>
            TURN服务器用于在无法建立直接P2P连接时提供中继服务
          </template>
        </a-form-item>

        <a-form-item v-if="config.p2p.turn.enabled" label="TURN 服务器列表">
          <a-space direction="vertical" style="width: 100%">
            <a-card
              v-for="(server, index) in config.p2p.turn.servers"
              :key="index"
              size="small"
              style="margin-bottom: 8px"
            >
              <template #extra>
                <a-button
                  type="text"
                  danger
                  size="small"
                  @click="handleRemoveTurnServer(index)"
                >
                  删除
                </a-button>
              </template>
              <a-descriptions :column="1" size="small">
                <a-descriptions-item label="URL">
                  {{ server.urls }}
                </a-descriptions-item>
                <a-descriptions-item label="用户名">
                  {{ server.username || "-" }}
                </a-descriptions-item>
                <a-descriptions-item label="凭证">
                  {{ server.credential ? "***" : "-" }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>

            <a-button
              type="dashed"
              block
              @click="showAddTurnServerModal = true"
            >
              + 添加 TURN 服务器
            </a-button>
          </a-space>
          <template #extra> 生产环境建议配置自建TURN服务器 </template>
        </a-form-item>
      </a-form>
    </a-card>

    <!-- NAT 穿透状态 -->
    <a-card title="NAT 穿透状态" style="margin-bottom: 16px">
      <a-space direction="vertical" size="middle" style="width: 100%">
        <a-row :gutter="16">
          <a-col :span="6">
            <a-statistic title="NAT 类型">
              <template #formatter>
                <a-tag :color="getNATTypeColor(natInfo?.type)">
                  {{ getNATTypeName(natInfo?.type) }}
                </a-tag>
              </template>
            </a-statistic>
          </a-col>
          <a-col :span="6">
            <a-statistic
              title="公网 IP"
              :value="natInfo?.publicIP || '未检测'"
            />
          </a-col>
          <a-col :span="6">
            <a-statistic title="本地 IP" :value="natInfo?.localIP || '未知'" />
          </a-col>
          <a-col :span="6">
            <a-button
              type="primary"
              :loading="detectingNAT"
              @click="handleDetectNAT"
            >
              <ReloadOutlined />
              重新检测
            </a-button>
          </a-col>
        </a-row>

        <a-alert
          v-if="natInfo?.description"
          :message="natInfo.description"
          :type="natInfo.type === 'symmetric' ? 'warning' : 'info'"
          show-icon
        />

        <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
          <a-form-item label="自动检测 NAT">
            <a-switch
              v-model:checked="config.p2p.nat.autoDetect"
              checked-children="启用"
              un-checked-children="禁用"
            />
            <template #extra>
              启动时自动检测NAT类型并选择最优传输策略
            </template>
          </a-form-item>

          <a-form-item label="检测间隔">
            <a-input-number
              v-model:value="config.p2p.nat.detectionInterval"
              :min="60000"
              :max="86400000"
              :step="60000"
              :formatter="(value) => `${Math.floor(value / 60000)} 分钟`"
              :parser="(value) => parseInt(value) * 60000"
              style="width: 200px"
            />
            <template #extra> 定期重新检测NAT类型（网络环境变化时） </template>
          </a-form-item>
        </a-form>
      </a-space>
    </a-card>

    <!-- Circuit Relay 设置 -->
    <a-card title="Circuit Relay 中继设置" style="margin-bottom: 16px">
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="启用中继">
          <a-switch
            v-model:checked="config.p2p.relay.enabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra>
            通过中继节点建立连接（NAT穿透的后备方案）
          </template>
        </a-form-item>

        <a-form-item label="最大预留数量">
          <a-slider
            v-model:value="config.p2p.relay.maxReservations"
            :min="1"
            :max="5"
            :marks="{ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }"
          />
          <template #extra> 同时保持的中继节点预留数量 </template>
        </a-form-item>

        <a-form-item label="自动升级直连">
          <a-switch
            v-model:checked="config.p2p.relay.autoUpgrade"
            checked-children="启用"
            un-checked-children="禁用"
          />
          <template #extra>
            通过DCUTr尝试将中继连接升级为直连（提升性能）
          </template>
        </a-form-item>

        <a-form-item label="当前中继节点">
          <a-button :loading="refreshingRelays" @click="handleRefreshRelays">
            <ReloadOutlined />
            刷新列表
          </a-button>
          <a-list
            v-if="relayInfo.length > 0"
            :data-source="relayInfo"
            style="margin-top: 12px"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #title>
                    {{ item.peerId.substring(0, 20) }}...
                  </template>
                  <template #description>
                    {{ item.addr }}
                  </template>
                </a-list-item-meta>
                <template #extra>
                  <a-tag :color="item.status === 'open' ? 'green' : 'orange'">
                    {{ item.status }}
                  </a-tag>
                </template>
              </a-list-item>
            </template>
          </a-list>
          <a-empty v-else description="暂无中继连接" style="margin-top: 12px" />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- WebRTC 连接质量监控 -->
    <a-card title="WebRTC 连接质量监控" style="margin-bottom: 16px">
      <a-space direction="vertical" size="middle" style="width: 100%">
        <a-button
          type="primary"
          :loading="refreshingWebRTCQuality"
          @click="handleRefreshWebRTCQuality"
        >
          <ReloadOutlined />
          刷新质量报告
        </a-button>

        <a-empty
          v-if="!webrtcQualityReports || webrtcQualityReports.length === 0"
          description="暂无WebRTC连接"
        />

        <div v-else>
          <a-card
            v-for="report in webrtcQualityReports"
            :key="report.peerId"
            size="small"
            style="margin-bottom: 12px"
          >
            <template #title>
              <a-space>
                <span>{{ report.peerId.substring(0, 20) }}...</span>
                <a-tag :color="getQualityColor(report.quality)">
                  {{ getQualityLabel(report.quality) }}
                </a-tag>
              </a-space>
            </template>

            <a-descriptions :column="2" size="small" bordered>
              <a-descriptions-item label="丢包率">
                <a-tag :color="report.metrics.packetLoss > 5 ? 'red' : 'green'">
                  {{ report.metrics.packetLoss.toFixed(2) }}%
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="延迟 (RTT)">
                <a-tag :color="report.metrics.rtt > 300 ? 'red' : 'green'">
                  {{ report.metrics.rtt }} ms
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="抖动 (Jitter)">
                <a-tag :color="report.metrics.jitter > 50 ? 'red' : 'green'">
                  {{ report.metrics.jitter }} ms
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="带宽">
                {{ (report.metrics.bandwidth / 1000).toFixed(2) }} kbps
              </a-descriptions-item>
              <a-descriptions-item label="运行时间" :span="2">
                {{ formatUptime(report.uptime) }}
              </a-descriptions-item>
            </a-descriptions>

            <a-alert
              v-if="report.alerts && report.alerts.length > 0"
              type="warning"
              style="margin-top: 12px"
            >
              <template #message>
                <div v-for="(alert, index) in report.alerts" :key="index">
                  <a-tag
                    :color="alert.severity === 'critical' ? 'red' : 'orange'"
                  >
                    {{ alert.type }}
                  </a-tag>
                  {{ alert.message }}
                </div>
              </template>
            </a-alert>

            <a-collapse
              v-if="report.suggestions && report.suggestions.length > 0"
              style="margin-top: 12px"
            >
              <a-collapse-panel key="1" header="优化建议">
                <a-list size="small" :data-source="report.suggestions">
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <a-list-item-meta>
                        <template #title>
                          <a-tag :color="getPriorityColor(item.priority)">
                            {{ item.priority }}
                          </a-tag>
                          {{ item.issue }}
                        </template>
                        <template #description>
                          {{ item.suggestion }}
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>
              </a-collapse-panel>
            </a-collapse>
          </a-card>
        </div>
      </a-space>
    </a-card>

    <!-- 网络诊断 -->
    <a-card title="网络诊断">
      <a-space direction="vertical" size="middle" style="width: 100%">
        <a-button
          type="primary"
          :loading="runningDiagnostics"
          @click="handleRunDiagnostics"
        >
          <ExperimentOutlined />
          运行完整诊断
        </a-button>

        <a-descriptions v-if="diagnosticResults" bordered :column="3">
          <a-descriptions-item label="总传输层">
            {{ diagnosticResults.summary?.totalTransports || 0 }}
          </a-descriptions-item>
          <a-descriptions-item label="可用传输层">
            <a-tag color="green">
              {{ diagnosticResults.summary?.availableTransports || 0 }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="活跃连接">
            {{ diagnosticResults.summary?.activeConnections || 0 }}
          </a-descriptions-item>
        </a-descriptions>

        <a-table
          v-if="diagnosticResults?.transports"
          :columns="diagnosticColumns"
          :data-source="formatDiagnosticData(diagnosticResults.transports)"
          :pagination="false"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <a-tag :color="record.available ? 'green' : 'red'">
                {{ record.available ? "可用" : "不可用" }}
              </a-tag>
            </template>
            <template v-if="column.key === 'addresses'">
              <div v-if="record.listenAddresses">
                <div
                  v-for="(addr, i) in record.listenAddresses"
                  :key="i"
                  style="font-size: 12px"
                >
                  {{ addr }}
                </div>
              </div>
              <span v-else>-</span>
            </template>
            <template v-if="column.key === 'error'">
              <a-tooltip v-if="record.error" :title="record.error">
                <a-tag color="red"> 有错误 </a-tag>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </template>
        </a-table>
      </a-space>
    </a-card>

    <!-- 添加 TURN 服务器模态框 -->
    <a-modal
      v-model:open="showAddTurnServerModal"
      title="添加 TURN 服务器"
      @ok="handleAddTurnServer"
      @cancel="resetTurnServerForm"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="服务器 URL" required>
          <a-input
            v-model:value="newTurnServer.urls"
            placeholder="turn:turn.example.com:3478"
          />
        </a-form-item>
        <a-form-item label="用户名">
          <a-input
            v-model:value="newTurnServer.username"
            placeholder="username"
          />
        </a-form-item>
        <a-form-item label="凭证/密码">
          <a-input-password
            v-model:value="newTurnServer.credential"
            placeholder="password"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  ReloadOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons-vue";

const config = defineModel("config", { type: Object, required: true });

const natInfo = ref(null);
const relayInfo = ref([]);
const diagnosticResults = ref(null);
const detectingNAT = ref(false);
const refreshingRelays = ref(false);
const runningDiagnostics = ref(false);

const newStunServer = ref("");
const showAddTurnServerModal = ref(false);
const newTurnServer = ref({
  urls: "",
  username: "",
  credential: "",
});

const webrtcQualityReports = ref([]);
const refreshingWebRTCQuality = ref(false);

const diagnosticColumns = [
  { title: "传输层", dataIndex: "transport", key: "transport" },
  { title: "状态", dataIndex: "available", key: "status" },
  { title: "监听地址", dataIndex: "listenAddresses", key: "addresses" },
  { title: "错误信息", dataIndex: "error", key: "error" },
];

const getNATTypeName = (type) => {
  const names = {
    none: "无NAT（公网IP）",
    "full-cone": "完全锥形NAT",
    restricted: "受限锥形NAT",
    "port-restricted": "端口受限NAT",
    symmetric: "对称NAT",
    unknown: "未知",
  };
  return names[type] || "未检测";
};

const getNATTypeColor = (type) => {
  const colors = {
    none: "green",
    "full-cone": "green",
    restricted: "blue",
    "port-restricted": "orange",
    symmetric: "red",
    unknown: "gray",
  };
  return colors[type] || "gray";
};

const formatDiagnosticData = (transports) => {
  return Object.entries(transports).map(([transport, info]) => ({
    transport: transport.toUpperCase(),
    available: info.available,
    listenAddresses: info.listenAddresses,
    error: info.error,
  }));
};

const handleDetectNAT = async () => {
  detectingNAT.value = true;
  try {
    natInfo.value = await window.electronAPI.p2p.detectNAT();
    message.success("NAT检测完成");
  } catch (error) {
    logger.error("NAT检测失败:", error);
    message.error("NAT检测失败：" + error.message);
  } finally {
    detectingNAT.value = false;
  }
};

const handleRefreshRelays = async () => {
  refreshingRelays.value = true;
  try {
    relayInfo.value = await window.electronAPI.p2p.getRelayInfo();
    message.success("中继信息已更新");
  } catch (error) {
    logger.error("获取中继信息失败:", error);
    message.error("获取中继信息失败：" + error.message);
  } finally {
    refreshingRelays.value = false;
  }
};

const handleRunDiagnostics = async () => {
  runningDiagnostics.value = true;
  try {
    diagnosticResults.value = await window.electronAPI.p2p.runDiagnostics();
    message.success("诊断完成");
  } catch (error) {
    logger.error("诊断失败:", error);
    message.error("诊断失败：" + error.message);
  } finally {
    runningDiagnostics.value = false;
  }
};

const handleAddStunServer = () => {
  if (!newStunServer.value) {
    message.warning("请输入STUN服务器地址");
    return;
  }
  if (!newStunServer.value.startsWith("stun:")) {
    message.error("STUN服务器地址格式错误，应以 stun: 开头");
    return;
  }
  if (config.value.p2p.stun.servers.includes(newStunServer.value)) {
    message.warning("该STUN服务器已存在");
    return;
  }
  config.value.p2p.stun.servers.push(newStunServer.value);
  newStunServer.value = "";
  message.success("STUN服务器已添加");
};

const handleRemoveStunServer = (index) => {
  config.value.p2p.stun.servers.splice(index, 1);
  message.success("STUN服务器已删除");
};

const handleAddTurnServer = () => {
  if (!newTurnServer.value.urls) {
    message.warning("请输入TURN服务器地址");
    return;
  }
  if (
    !newTurnServer.value.urls.startsWith("turn:") &&
    !newTurnServer.value.urls.startsWith("turns:")
  ) {
    message.error("TURN服务器地址格式错误，应以 turn: 或 turns: 开头");
    return;
  }
  config.value.p2p.turn.servers.push({
    urls: newTurnServer.value.urls,
    username: newTurnServer.value.username || undefined,
    credential: newTurnServer.value.credential || undefined,
  });
  resetTurnServerForm();
  showAddTurnServerModal.value = false;
  message.success("TURN服务器已添加");
};

const handleRemoveTurnServer = (index) => {
  config.value.p2p.turn.servers.splice(index, 1);
  message.success("TURN服务器已删除");
};

const resetTurnServerForm = () => {
  newTurnServer.value = {
    urls: "",
    username: "",
    credential: "",
  };
};

const handleQuickSetupLocalCoturn = () => {
  const localStunServer = "stun:localhost:3478";
  if (!config.value.p2p.stun.servers.includes(localStunServer)) {
    config.value.p2p.stun.servers.unshift(localStunServer);
  }

  config.value.p2p.turn.enabled = true;

  const localTurnServer = {
    urls: "turn:localhost:3478",
    username: "chainlesschain",
    credential: "chainlesschain2024",
  };

  const exists = config.value.p2p.turn.servers.some(
    (server) => server.urls === localTurnServer.urls,
  );
  if (!exists) {
    config.value.p2p.turn.servers.unshift(localTurnServer);
  }

  message.success("本地coturn服务器配置已完成！请确保Docker容器正在运行。");
};

const handleRefreshWebRTCQuality = async () => {
  refreshingWebRTCQuality.value = true;
  try {
    const reports = await window.electronAPI.p2p.getWebRTCQualityReport();
    if (reports && Array.isArray(reports)) {
      webrtcQualityReports.value = await Promise.all(
        reports.map(async (report) => {
          const suggestions =
            await window.electronAPI.p2p.getWebRTCOptimizationSuggestions(
              report.peerId,
            );
          return { ...report, suggestions };
        }),
      );
    } else {
      webrtcQualityReports.value = [];
    }
    message.success("WebRTC质量报告已更新");
  } catch (error) {
    logger.error("获取WebRTC质量报告失败:", error);
    message.error("获取WebRTC质量报告失败：" + error.message);
  } finally {
    refreshingWebRTCQuality.value = false;
  }
};

const getQualityColor = (quality) => {
  const colorMap = {
    excellent: "green",
    good: "blue",
    fair: "orange",
    poor: "red",
    critical: "red",
  };
  return colorMap[quality] || "default";
};

const getQualityLabel = (quality) => {
  const labelMap = {
    excellent: "优秀",
    good: "良好",
    fair: "一般",
    poor: "较差",
    critical: "严重",
  };
  return labelMap[quality] || quality;
};

const getPriorityColor = (priority) => {
  const colorMap = {
    high: "red",
    medium: "orange",
    low: "blue",
  };
  return colorMap[priority] || "default";
};

const formatUptime = (uptime) => {
  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
};

onMounted(async () => {
  try {
    natInfo.value = await window.electronAPI.p2p.getNATInfo();
  } catch (error) {
    logger.error("加载NAT信息失败:", error);
  }
});
</script>
