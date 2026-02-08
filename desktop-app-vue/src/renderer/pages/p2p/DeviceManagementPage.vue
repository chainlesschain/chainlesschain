<template>
  <div class="device-management-page">
    <a-page-header
      title="设备管理"
      subtitle="管理您的P2P连接设备"
      @back="handleBack"
    >
      <template #extra>
        <a-button type="primary" @click="handleRefresh">
          <ReloadOutlined />
          刷新
        </a-button>
      </template>
    </a-page-header>

    <div class="management-content">
      <!-- Current Device Info -->
      <a-card title="当前设备" class="current-device-card">
        <a-descriptions :column="2" bordered>
          <a-descriptions-item label="设备ID">
            <span class="monospace">{{ currentDevice.deviceId }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="设备名称">
            {{ currentDevice.deviceName }}
          </a-descriptions-item>
          <a-descriptions-item label="DID">
            <span class="monospace">{{ currentDevice.did }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="在线状态">
            <a-tag color="success">
              <CheckCircleOutlined />
              在线
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>

      <!-- Paired Devices -->
      <a-card title="已配对设备" class="paired-devices-card">
        <template #extra>
          <a-space>
            <a-input-search
              v-model:value="searchText"
              placeholder="搜索设备"
              style="width: 200px"
              @search="handleSearch"
            />
          </a-space>
        </template>

        <a-spin :spinning="loading">
          <a-table
            :columns="columns"
            :data-source="filteredDevices"
            :pagination="pagination"
            row-key="deviceId"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'deviceName'">
                <div class="device-name-cell">
                  <a-avatar
                    :style="{
                      backgroundColor: getDeviceColor(record.deviceId),
                    }"
                  >
                    {{ record.deviceName.charAt(0).toUpperCase() }}
                  </a-avatar>
                  <span style="margin-left: 8px">{{ record.deviceName }}</span>
                </div>
              </template>

              <template v-else-if="column.key === 'status'">
                <a-tag :color="record.isOnline ? 'success' : 'default'">
                  {{ record.isOnline ? "在线" : "离线" }}
                </a-tag>
              </template>

              <template v-else-if="column.key === 'verified'">
                <a-tag :color="record.isVerified ? 'green' : 'orange'">
                  <SafetyOutlined v-if="record.isVerified" />
                  <ExclamationCircleOutlined v-else />
                  {{ record.isVerified ? "已验证" : "未验证" }}
                </a-tag>
              </template>

              <template v-else-if="column.key === 'lastSeen'">
                {{ formatRelativeTime(record.lastSeen) }}
              </template>

              <template v-else-if="column.key === 'actions'">
                <a-space>
                  <a-button size="small" @click="handleChat(record)">
                    <MessageOutlined />
                    聊天
                  </a-button>
                  <a-button size="small" @click="handleVerify(record)">
                    <SafetyOutlined />
                    验证
                  </a-button>
                  <a-dropdown>
                    <template #overlay>
                      <a-menu>
                        <a-menu-item @click="handleViewDetails(record)">
                          <InfoCircleOutlined />
                          查看详情
                        </a-menu-item>
                        <a-menu-item @click="handleRename(record)">
                          <EditOutlined />
                          重命名
                        </a-menu-item>
                        <a-menu-divider />
                        <a-menu-item danger @click="handleRemove(record)">
                          <DeleteOutlined />
                          移除设备
                        </a-menu-item>
                      </a-menu>
                    </template>
                    <a-button size="small">
                      <MoreOutlined />
                    </a-button>
                  </a-dropdown>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-spin>
      </a-card>
    </div>

    <!-- Rename Modal -->
    <a-modal
      v-model:open="renameModalVisible"
      title="重命名设备"
      @ok="handleRenameConfirm"
    >
      <a-form layout="vertical">
        <a-form-item label="新名称">
          <a-input
            v-model:value="newDeviceName"
            placeholder="输入新的设备名称"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script>
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import {
  ReloadOutlined,
  CheckCircleOutlined,
  SafetyOutlined,
  ExclamationCircleOutlined,
  MessageOutlined,
  InfoCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from "@ant-design/icons-vue";

export default {
  name: "DeviceManagementPage",
  components: {
    ReloadOutlined,
    CheckCircleOutlined,
    SafetyOutlined,
    ExclamationCircleOutlined,
    MessageOutlined,
    InfoCircleOutlined,
    EditOutlined,
    DeleteOutlined,
    MoreOutlined,
  },
  setup() {
    const router = useRouter();

    const loading = ref(false);
    const searchText = ref("");
    const devices = ref([]);
    const renameModalVisible = ref(false);
    const selectedDevice = ref(null);
    const newDeviceName = ref("");

    const currentDevice = ref({
      deviceId: "device-" + Math.random().toString(36).substr(2, 9),
      deviceName: "我的设备",
      did: "did:key:" + Math.random().toString(36).substr(2, 16),
    });

    const columns = [
      {
        title: "设备名称",
        key: "deviceName",
        dataIndex: "deviceName",
      },
      {
        title: "设备ID",
        key: "deviceId",
        dataIndex: "deviceId",
        ellipsis: true,
      },
      {
        title: "状态",
        key: "status",
        width: 100,
      },
      {
        title: "验证状态",
        key: "verified",
        width: 120,
      },
      {
        title: "最后在线",
        key: "lastSeen",
        width: 150,
      },
      {
        title: "操作",
        key: "actions",
        width: 220,
      },
    ];

    const pagination = {
      pageSize: 10,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 台设备`,
    };

    const filteredDevices = computed(() => {
      if (!searchText.value) {
        return devices.value;
      }

      const text = searchText.value.toLowerCase();
      return devices.value.filter(
        (device) =>
          device.deviceName.toLowerCase().includes(text) ||
          device.deviceId.toLowerCase().includes(text),
      );
    });

    const handleBack = () => {
      router.back();
    };

    const handleRefresh = async () => {
      loading.value = true;
      try {
        await loadDevices();
        message.success("刷新成功");
      } catch (error) {
        console.error("Refresh error:", error);
        message.error("刷新失败");
      } finally {
        loading.value = false;
      }
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    const getDeviceColor = (deviceId) => {
      const colors = ["#1890ff", "#52c41a", "#fa8c16", "#eb2f96", "#722ed1"];
      const index =
        Math.abs(
          deviceId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0),
        ) % colors.length;
      return colors[index];
    };

    const formatRelativeTime = (timestamp) => {
      if (!timestamp) {
        return "从未";
      }

      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) {
        return "刚刚";
      }
      if (minutes < 60) {
        return `${minutes}分钟前`;
      }
      if (hours < 24) {
        return `${hours}小时前`;
      }
      return `${days}天前`;
    };

    const handleChat = (device) => {
      router.push({
        name: "P2PMessaging",
        query: { deviceId: device.deviceId },
      });
    };

    const handleVerify = (device) => {
      router.push({
        name: "SafetyNumbers",
        query: { peerId: device.deviceId },
      });
    };

    const handleViewDetails = (device) => {
      Modal.info({
        title: "设备详情",
        width: 600,
        content: `
          <div>
            <p><strong>设备ID:</strong> ${device.deviceId}</p>
            <p><strong>设备名称:</strong> ${device.deviceName}</p>
            <p><strong>验证状态:</strong> ${device.isVerified ? "已验证" : "未验证"}</p>
            <p><strong>在线状态:</strong> ${device.isOnline ? "在线" : "离线"}</p>
            <p><strong>配对时间:</strong> ${new Date(device.pairedAt).toLocaleString("zh-CN")}</p>
            <p><strong>最后在线:</strong> ${new Date(device.lastSeen).toLocaleString("zh-CN")}</p>
          </div>
        `,
      });
    };

    const handleRename = (device) => {
      selectedDevice.value = device;
      newDeviceName.value = device.deviceName;
      renameModalVisible.value = true;
    };

    const handleRenameConfirm = async () => {
      if (!newDeviceName.value.trim()) {
        message.error("请输入设备名称");
        return;
      }

      try {
        await window.electron.invoke("p2p:rename-device", {
          deviceId: selectedDevice.value.deviceId,
          newName: newDeviceName.value,
        });

        selectedDevice.value.deviceName = newDeviceName.value;
        renameModalVisible.value = false;
        message.success("重命名成功");
      } catch (error) {
        console.error("Rename error:", error);
        message.error("重命名失败");
      }
    };

    const handleRemove = (device) => {
      Modal.confirm({
        title: "确认移除设备",
        content: `确定要移除设备 "${device.deviceName}" 吗?这将删除所有相关的消息记录。`,
        okText: "确认",
        cancelText: "取消",
        okType: "danger",
        onOk: async () => {
          try {
            await window.electron.invoke("p2p:remove-device", {
              deviceId: device.deviceId,
            });

            devices.value = devices.value.filter(
              (d) => d.deviceId !== device.deviceId,
            );
            message.success("设备已移除");
          } catch (error) {
            console.error("Remove error:", error);
            message.error("移除失败");
          }
        },
      });
    };

    const loadDevices = async () => {
      try {
        const result = await window.electron.invoke("p2p:list-devices");
        devices.value = result.devices || generateDummyDevices();
      } catch (error) {
        console.error("Load devices error:", error);
        devices.value = generateDummyDevices();
      }
    };

    const generateDummyDevices = () => {
      const dummyDevices = [];
      const names = [
        "Alice的设备",
        "Bob的设备",
        "Charlie的手机",
        "David的电脑",
        "Eve的平板",
      ];

      for (let i = 0; i < 5; i++) {
        dummyDevices.push({
          deviceId: "device-" + Math.random().toString(36).substr(2, 9),
          deviceName: names[i],
          isOnline: Math.random() > 0.5,
          isVerified: Math.random() > 0.3,
          lastSeen: Date.now() - Math.floor(Math.random() * 86400000),
          pairedAt: Date.now() - Math.floor(Math.random() * 604800000),
        });
      }

      return dummyDevices;
    };

    onMounted(() => {
      loadDevices();
    });

    return {
      loading,
      searchText,
      devices,
      filteredDevices,
      currentDevice,
      columns,
      pagination,
      renameModalVisible,
      selectedDevice,
      newDeviceName,
      handleBack,
      handleRefresh,
      handleSearch,
      getDeviceColor,
      formatRelativeTime,
      handleChat,
      handleVerify,
      handleViewDetails,
      handleRename,
      handleRenameConfirm,
      handleRemove,
    };
  },
};
</script>

<style scoped lang="scss">
.device-management-page {
  min-height: 100vh;
  background-color: #f0f2f5;

  .management-content {
    padding: 24px;

    .current-device-card {
      margin-bottom: 24px;

      .monospace {
        font-family: monospace;
        background-color: #f5f5f5;
        padding: 2px 6px;
        border-radius: 3px;
      }
    }

    .paired-devices-card {
      .device-name-cell {
        display: flex;
        align-items: center;
      }
    }
  }
}
</style>
