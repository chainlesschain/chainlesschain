<template>
  <div class="enterprise-dashboard">
    <a-page-header
      title="Organization Dashboard"
      :sub-title="organizationName"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-range-picker v-model:value="dateRange" @change="onDateRangeChange" />
        <a-button :loading="loading" @click="refreshData">
          <ReloadOutlined /> Refresh
        </a-button>
      </template>
    </a-page-header>

    <div class="dashboard-content">
      <!-- Overview Cards -->
      <a-row :gutter="[16, 16]" class="overview-cards">
        <a-col :xs="24" :sm="12" :lg="6">
          <a-card>
            <a-statistic
              title="Total Members"
              :value="stats.totalMembers"
              :prefix="h(TeamOutlined)"
            />
            <div class="stat-trend">
              <CaretUpOutlined
                v-if="stats.memberGrowth > 0"
                style="color: #52c41a"
              />
              <CaretDownOutlined
                v-else-if="stats.memberGrowth < 0"
                style="color: #ff4d4f"
              />
              <span>{{ Math.abs(stats.memberGrowth) }}% this month</span>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :sm="12" :lg="6">
          <a-card>
            <a-statistic
              title="Knowledge Items"
              :value="stats.totalKnowledge"
              :prefix="h(FileTextOutlined)"
            />
            <div class="stat-trend">
              <span>{{ stats.knowledgeCreatedToday }} created today</span>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :sm="12" :lg="6">
          <a-card>
            <a-statistic
              title="Active Collaborations"
              :value="stats.activeCollaborations"
              :prefix="h(EditOutlined)"
            />
            <div class="stat-trend">
              <span>{{ stats.onlineMembers }} members online</span>
            </div>
          </a-card>
        </a-col>

        <a-col :xs="24" :sm="12" :lg="6">
          <a-card>
            <a-statistic
              title="Storage Used"
              :value="formatBytes(stats.storageUsed)"
              :suffix="`/ ${formatBytes(stats.storageLimit)}`"
            />
            <a-progress
              :percent="(stats.storageUsed / stats.storageLimit) * 100"
              :show-info="false"
              :stroke-color="getStorageColor()"
            />
          </a-card>
        </a-col>
      </a-row>

      <!-- Activity Chart -->
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :lg="16">
          <a-card title="Activity Overview" :loading="loading">
            <div ref="activityChartRef" style="height: 300px" />
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="8">
          <a-card title="Activity Breakdown" :loading="loading">
            <div ref="activityPieChartRef" style="height: 300px" />
          </a-card>
        </a-col>
      </a-row>

      <!-- Knowledge Graph & Member Analytics -->
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :lg="12">
          <a-card title="Knowledge Graph" :loading="loading">
            <a-tabs v-model:active-key="graphTab">
              <a-tab-pane key="network" tab="Network View">
                <div ref="knowledgeGraphRef" style="height: 400px" />
              </a-tab-pane>
              <a-tab-pane key="tree" tab="Tree View">
                <div ref="knowledgeTreeRef" style="height: 400px" />
              </a-tab-pane>
            </a-tabs>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="12">
          <a-card title="Top Contributors" :loading="loading">
            <a-list
              :data-source="topContributors"
              :render-item="renderContributor"
            >
              <template #renderItem="{ item, index }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <a-badge
                        :count="index + 1"
                        :number-style="{
                          backgroundColor: getBadgeColor(index),
                        }"
                      >
                        <a-avatar>{{ item.name.charAt(0) }}</a-avatar>
                      </a-badge>
                    </template>
                    <template #title>
                      {{ item.name }}
                      <a-tag :color="getRoleColor(item.role)" size="small">
                        {{ item.role }}
                      </a-tag>
                    </template>
                    <template #description>
                      <div class="contributor-stats">
                        <span
                          ><FileTextOutlined />
                          {{ item.knowledgeCreated }} created</span
                        >
                        <span><EditOutlined /> {{ item.edits }} edits</span>
                        <span
                          ><CommentOutlined />
                          {{ item.comments }} comments</span
                        >
                      </div>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>
      </a-row>

      <!-- Recent Activity & Resource Usage -->
      <a-row :gutter="[16, 16]">
        <a-col :xs="24" :lg="16">
          <a-card title="Recent Activity" :loading="loading">
            <a-timeline>
              <a-timeline-item
                v-for="activity in recentActivities"
                :key="activity.id"
                :color="getActivityColor(activity.activity_type)"
              >
                <template #dot>
                  <component :is="getActivityIcon(activity.activity_type)" />
                </template>
                <div class="activity-item">
                  <div class="activity-header">
                    <strong>{{ activity.user_name }}</strong>
                    <span class="activity-action">{{
                      getActivityText(activity.activity_type)
                    }}</span>
                    <span class="activity-target">{{
                      activity.metadata?.title || "a document"
                    }}</span>
                  </div>
                  <div class="activity-time">
                    {{ formatTime(activity.created_at) }}
                  </div>
                </div>
              </a-timeline-item>
            </a-timeline>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="8">
          <a-card title="Resource Usage" :loading="loading">
            <div class="resource-item">
              <div class="resource-header">
                <span>Storage</span>
                <span
                  >{{ formatBytes(stats.storageUsed) }} /
                  {{ formatBytes(stats.storageLimit) }}</span
                >
              </div>
              <a-progress
                :percent="(stats.storageUsed / stats.storageLimit) * 100"
                :stroke-color="getStorageColor()"
              />
            </div>

            <div class="resource-item">
              <div class="resource-header">
                <span>Bandwidth (This Month)</span>
                <span>{{ formatBytes(stats.bandwidthUsed) }}</span>
              </div>
              <a-progress
                :percent="(stats.bandwidthUsed / stats.bandwidthLimit) * 100"
                :stroke-color="getBandwidthColor()"
              />
            </div>

            <div class="resource-item">
              <div class="resource-header">
                <span>P2P Network Health</span>
                <span>{{ stats.networkHealth }}%</span>
              </div>
              <a-progress
                :percent="stats.networkHealth"
                :stroke-color="getNetworkHealthColor()"
              />
            </div>

            <div class="resource-item">
              <div class="resource-header">
                <span>Active Connections</span>
                <span
                  >{{ stats.activeConnections }} /
                  {{ stats.maxConnections }}</span
                >
              </div>
              <a-progress
                :percent="
                  (stats.activeConnections / stats.maxConnections) * 100
                "
                status="normal"
              />
            </div>

            <a-divider />

            <div class="resource-breakdown">
              <h4>Storage Breakdown</h4>
              <div ref="storageBreakdownRef" style="height: 200px" />
            </div>
          </a-card>
        </a-col>
      </a-row>

      <!-- Member Analytics -->
      <a-row :gutter="[16, 16]">
        <a-col :span="24">
          <a-card title="Member Analytics" :loading="loading">
            <a-tabs v-model:active-key="analyticsTab">
              <a-tab-pane key="engagement" tab="Engagement">
                <div ref="engagementChartRef" style="height: 300px" />
              </a-tab-pane>

              <a-tab-pane key="activity" tab="Activity Heatmap">
                <div ref="heatmapChartRef" style="height: 300px" />
              </a-tab-pane>

              <a-tab-pane key="roles" tab="Role Distribution">
                <a-row :gutter="16">
                  <a-col :span="12">
                    <div ref="roleDistributionRef" style="height: 300px" />
                  </a-col>
                  <a-col :span="12">
                    <a-table
                      :columns="roleColumns"
                      :data-source="roleStats"
                      :pagination="false"
                      size="small"
                    />
                  </a-col>
                </a-row>
              </a-tab-pane>
            </a-tabs>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, onUnmounted, h, computed } from "vue";
import { message } from "ant-design-vue";
import {
  TeamOutlined,
  FileTextOutlined,
  EditOutlined,
  CommentOutlined,
  ReloadOutlined,
  CaretUpOutlined,
  CaretDownOutlined,
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  ShareAltOutlined,
} from "@ant-design/icons-vue";
import { init } from "../utils/echartsConfig";

const props = defineProps({
  organizationId: {
    type: String,
    required: true,
  },
});

// 定时刷新间隔ID
let refreshInterval = null;

// Refs
const activityChartRef = ref(null);
const activityPieChartRef = ref(null);
const knowledgeGraphRef = ref(null);
const knowledgeTreeRef = ref(null);
const storageBreakdownRef = ref(null);
const engagementChartRef = ref(null);
const heatmapChartRef = ref(null);
const roleDistributionRef = ref(null);

// State
const loading = ref(false);
const organizationName = ref("");
const dateRange = ref([]);
const graphTab = ref("network");
const analyticsTab = ref("engagement");

const stats = ref({
  totalMembers: 0,
  memberGrowth: 0,
  totalKnowledge: 0,
  knowledgeCreatedToday: 0,
  activeCollaborations: 0,
  onlineMembers: 0,
  storageUsed: 0,
  storageLimit: 10 * 1024 * 1024 * 1024, // 10GB
  bandwidthUsed: 0,
  bandwidthLimit: 100 * 1024 * 1024 * 1024, // 100GB
  networkHealth: 0,
  activeConnections: 0,
  maxConnections: 100,
});

const topContributors = ref([]);
const recentActivities = ref([]);
const roleStats = ref([]);

// Chart instances
let activityChart = null;
let activityPieChart = null;
let knowledgeGraph = null;
let knowledgeTree = null;
let storageBreakdownChart = null;
let engagementChart = null;
let heatmapChart = null;
let roleDistributionChart = null;

// Table columns
const roleColumns = [
  { title: "Role", dataIndex: "role", key: "role" },
  { title: "Count", dataIndex: "count", key: "count" },
  { title: "Percentage", dataIndex: "percentage", key: "percentage" },
];

// Initialize dashboard
onMounted(async () => {
  await loadOrganizationInfo();
  await loadDashboardData();
  initializeCharts();

  // Set up auto-refresh - 使用模块级变量存储 interval ID
  refreshInterval = setInterval(() => {
    loadDashboardData();
  }, 60000); // Refresh every minute
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  disposeCharts();
});

// Load organization info
async function loadOrganizationInfo() {
  try {
    const result = await window.electron.ipcRenderer.invoke(
      "organization:get-info",
      {
        orgId: props.organizationId,
      },
    );

    if (result.success) {
      organizationName.value = result.organization.name;
    }
  } catch (error) {
    logger.error("Error loading organization info:", error);
  }
}

// Load dashboard data
async function loadDashboardData() {
  try {
    loading.value = true;

    // Load stats
    const statsResult = await window.electron.ipcRenderer.invoke(
      "dashboard:get-stats",
      {
        orgId: props.organizationId,
        dateRange: dateRange.value,
      },
    );

    if (statsResult.success) {
      stats.value = { ...stats.value, ...statsResult.stats };
    }

    // Load top contributors
    const contributorsResult = await window.electron.ipcRenderer.invoke(
      "dashboard:get-top-contributors",
      {
        orgId: props.organizationId,
        limit: 10,
      },
    );

    if (contributorsResult.success) {
      topContributors.value = contributorsResult.contributors;
    }

    // Load recent activities
    const activitiesResult = await window.electron.ipcRenderer.invoke(
      "dashboard:get-recent-activities",
      {
        orgId: props.organizationId,
        limit: 20,
      },
    );

    if (activitiesResult.success) {
      recentActivities.value = activitiesResult.activities;
    }

    // Load role stats
    const roleStatsResult = await window.electron.ipcRenderer.invoke(
      "dashboard:get-role-stats",
      {
        orgId: props.organizationId,
      },
    );

    if (roleStatsResult.success) {
      roleStats.value = roleStatsResult.roles;
    }

    // Update charts
    updateCharts();
  } catch (error) {
    logger.error("Error loading dashboard data:", error);
    message.error("Failed to load dashboard data");
  } finally {
    loading.value = false;
  }
}

// Initialize charts
function initializeCharts() {
  activityChart = init(activityChartRef.value);
  activityPieChart = init(activityPieChartRef.value);
  knowledgeGraph = init(knowledgeGraphRef.value);
  knowledgeTree = init(knowledgeTreeRef.value);
  storageBreakdownChart = init(storageBreakdownRef.value);
  engagementChart = init(engagementChartRef.value);
  heatmapChart = init(heatmapChartRef.value);
  roleDistributionChart = init(roleDistributionRef.value);

  // Handle window resize
  window.addEventListener("resize", handleResize);
}

// Update charts with data
async function updateCharts() {
  await updateActivityChart();
  await updateActivityPieChart();
  await updateKnowledgeGraph();
  await updateStorageBreakdown();
  await updateEngagementChart();
  await updateHeatmapChart();
  await updateRoleDistribution();
}

// Update activity chart
async function updateActivityChart() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-activity-timeline",
    {
      orgId: props.organizationId,
      days: 30,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "axis",
    },
    legend: {
      data: ["Creates", "Edits", "Views", "Comments"],
    },
    xAxis: {
      type: "category",
      data: result.timeline.map((t) => t.date),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "Creates",
        type: "line",
        data: result.timeline.map((t) => t.creates),
        smooth: true,
      },
      {
        name: "Edits",
        type: "line",
        data: result.timeline.map((t) => t.edits),
        smooth: true,
      },
      {
        name: "Views",
        type: "line",
        data: result.timeline.map((t) => t.views),
        smooth: true,
      },
      {
        name: "Comments",
        type: "line",
        data: result.timeline.map((t) => t.comments),
        smooth: true,
      },
    ],
  };

  activityChart.setOption(option);
}

// Update activity pie chart
async function updateActivityPieChart() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-activity-breakdown",
    {
      orgId: props.organizationId,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "item",
    },
    series: [
      {
        type: "pie",
        radius: "50%",
        data: result.breakdown,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  activityPieChart.setOption(option);
}

// Update knowledge graph
async function updateKnowledgeGraph() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-knowledge-graph",
    {
      orgId: props.organizationId,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {},
    series: [
      {
        type: "graph",
        layout: "force",
        data: result.nodes,
        links: result.links,
        roam: true,
        label: {
          show: true,
          position: "right",
        },
        force: {
          repulsion: 100,
        },
      },
    ],
  };

  knowledgeGraph.setOption(option);
}

// Update storage breakdown
async function updateStorageBreakdown() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-storage-breakdown",
    {
      orgId: props.organizationId,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "item",
    },
    series: [
      {
        type: "pie",
        radius: ["40%", "70%"],
        data: result.breakdown,
      },
    ],
  };

  storageBreakdownChart.setOption(option);
}

// Update engagement chart
async function updateEngagementChart() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-member-engagement",
    {
      orgId: props.organizationId,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "category",
      data: result.members.map((m) => m.name),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        type: "bar",
        data: result.members.map((m) => m.engagementScore),
      },
    ],
  };

  engagementChart.setOption(option);
}

// Update heatmap chart
async function updateHeatmapChart() {
  const result = await window.electron.ipcRenderer.invoke(
    "dashboard:get-activity-heatmap",
    {
      orgId: props.organizationId,
    },
  );

  if (!result.success) {
    return;
  }

  const option = {
    tooltip: {
      position: "top",
    },
    grid: {
      height: "50%",
      top: "10%",
    },
    xAxis: {
      type: "category",
      data: result.hours,
      splitArea: {
        show: true,
      },
    },
    yAxis: {
      type: "category",
      data: result.days,
      splitArea: {
        show: true,
      },
    },
    visualMap: {
      min: 0,
      max: result.maxValue,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: "15%",
    },
    series: [
      {
        type: "heatmap",
        data: result.data,
        label: {
          show: true,
        },
      },
    ],
  };

  heatmapChart.setOption(option);
}

// Update role distribution
function updateRoleDistribution() {
  const option = {
    tooltip: {
      trigger: "item",
    },
    series: [
      {
        type: "pie",
        radius: "50%",
        data: roleStats.value.map((r) => ({
          name: r.role,
          value: r.count,
        })),
      },
    ],
  };

  roleDistributionChart.setOption(option);
}

// Handle window resize
function handleResize() {
  activityChart?.resize();
  activityPieChart?.resize();
  knowledgeGraph?.resize();
  knowledgeTree?.resize();
  storageBreakdownChart?.resize();
  engagementChart?.resize();
  heatmapChart?.resize();
  roleDistributionChart?.resize();
}

// Dispose charts
function disposeCharts() {
  activityChart?.dispose();
  activityPieChart?.dispose();
  knowledgeGraph?.dispose();
  knowledgeTree?.dispose();
  storageBreakdownChart?.dispose();
  engagementChart?.dispose();
  heatmapChart?.dispose();
  roleDistributionChart?.dispose();

  window.removeEventListener("resize", handleResize);
}

// Refresh data
async function refreshData() {
  await loadDashboardData();
  message.success("Dashboard refreshed");
}

// Date range change handler
function onDateRangeChange() {
  loadDashboardData();
}

// Helper functions
function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "Just now";
  }
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}m ago`;
  }
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}h ago`;
  }
  if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

function getStorageColor() {
  const percent = (stats.value.storageUsed / stats.value.storageLimit) * 100;
  if (percent > 90) {
    return "#ff4d4f";
  }
  if (percent > 75) {
    return "#faad14";
  }
  return "#52c41a";
}

function getBandwidthColor() {
  const percent =
    (stats.value.bandwidthUsed / stats.value.bandwidthLimit) * 100;
  if (percent > 90) {
    return "#ff4d4f";
  }
  if (percent > 75) {
    return "#faad14";
  }
  return "#1890ff";
}

function getNetworkHealthColor() {
  if (stats.value.networkHealth > 80) {
    return "#52c41a";
  }
  if (stats.value.networkHealth > 50) {
    return "#faad14";
  }
  return "#ff4d4f";
}

function getBadgeColor(index) {
  const colors = ["#f5222d", "#fa8c16", "#faad14"];
  return colors[index] || "#1890ff";
}

function getRoleColor(role) {
  const colors = {
    owner: "red",
    admin: "orange",
    editor: "blue",
    member: "green",
    viewer: "default",
  };
  return colors[role] || "default";
}

function getActivityColor(type) {
  const colors = {
    create: "green",
    edit: "blue",
    view: "gray",
    comment: "purple",
    share: "orange",
    delete: "red",
  };
  return colors[type] || "blue";
}

function getActivityIcon(type) {
  const icons = {
    create: PlusOutlined,
    edit: EditOutlined,
    view: EyeOutlined,
    comment: CommentOutlined,
    share: ShareAltOutlined,
    delete: DeleteOutlined,
  };
  return icons[type] || FileTextOutlined;
}

function getActivityText(type) {
  const texts = {
    create: "created",
    edit: "edited",
    view: "viewed",
    comment: "commented on",
    share: "shared",
    delete: "deleted",
  };
  return texts[type] || "interacted with";
}
</script>

<style scoped lang="scss">
.enterprise-dashboard {
  .dashboard-content {
    padding: 24px;

    .overview-cards {
      margin-bottom: 24px;

      .stat-trend {
        margin-top: 8px;
        font-size: 12px;
        color: #666;

        .anticon {
          margin-right: 4px;
        }
      }
    }

    .contributor-stats {
      display: flex;
      gap: 16px;
      font-size: 12px;

      span {
        display: flex;
        align-items: center;
        gap: 4px;
      }
    }

    .activity-item {
      .activity-header {
        margin-bottom: 4px;

        .activity-action {
          margin: 0 4px;
          color: #666;
        }

        .activity-target {
          color: #1890ff;
        }
      }

      .activity-time {
        font-size: 12px;
        color: #999;
      }
    }

    .resource-item {
      margin-bottom: 24px;

      .resource-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;

        span:first-child {
          font-weight: 500;
        }

        span:last-child {
          color: #666;
        }
      }
    }

    .resource-breakdown {
      h4 {
        margin-bottom: 16px;
      }
    }
  }
}
</style>
