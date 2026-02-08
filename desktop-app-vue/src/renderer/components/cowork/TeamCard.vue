<template>
  <a-card
    class="team-card"
    :class="`team-status-${team.status}`"
    hoverable
    @click="emit('viewDetail', team)"
  >
    <!-- 卡片头部 -->
    <template #title>
      <div class="team-card-title">
        <TeamOutlined class="team-icon" />
        <span class="team-name">{{ team.name }}</span>
      </div>
    </template>

    <!-- 操作按钮 -->
    <template #extra>
      <a-dropdown :trigger="['click']" @click.stop>
        <a-button type="text" size="small">
          <MoreOutlined />
        </a-button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="view" @click.stop="emit('viewDetail', team)">
              <EyeOutlined />
              查看详情
            </a-menu-item>
            <a-menu-item
              v-if="team.status === 'active'"
              key="pause"
              @click.stop="emit('pause', team)"
            >
              <PauseCircleOutlined />
              暂停团队
            </a-menu-item>
            <a-menu-item
              v-if="team.status === 'paused'"
              key="resume"
              @click.stop="emit('resume', team)"
            >
              <PlayCircleOutlined />
              恢复团队
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item
              key="destroy"
              danger
              @click.stop="emit('destroy', team)"
            >
              <DeleteOutlined />
              销毁团队
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
    </template>

    <!-- 卡片内容 -->
    <div class="team-card-content">
      <!-- 状态标签 -->
      <div class="team-status-badge">
        <a-tag :color="getStatusColor(team.status)">
          {{ getStatusText(team.status) }}
        </a-tag>
      </div>

      <!-- 描述 -->
      <div v-if="team.description" class="team-description">
        {{ team.description }}
      </div>

      <!-- 统计信息 -->
      <div class="team-stats">
        <div class="stat-item">
          <UserOutlined class="stat-icon" />
          <span class="stat-label">成员:</span>
          <span class="stat-value">
            {{ team.memberCount || 0 }} /
            {{ team.maxAgents || team.config?.maxAgents || 5 }}
          </span>
        </div>

        <div class="stat-item">
          <UnorderedListOutlined class="stat-icon" />
          <span class="stat-label">任务:</span>
          <span class="stat-value">{{ team.taskCount || 0 }}</span>
        </div>

        <div class="stat-item">
          <FieldTimeOutlined class="stat-icon" />
          <span class="stat-label">创建时间:</span>
          <span class="stat-value">{{ formatDate(team.createdAt) }}</span>
        </div>
      </div>

      <!-- 进度条（如果团队有任务在进行中） -->
      <div
        v-if="team.status === 'active' && team.progress !== undefined"
        class="team-progress"
      >
        <a-progress
          :percent="team.progress"
          :status="team.progress === 100 ? 'success' : 'active'"
          size="small"
        />
      </div>
    </div>
  </a-card>
</template>

<script setup>
import {
  TeamOutlined,
  UserOutlined,
  UnorderedListOutlined,
  FieldTimeOutlined,
  MoreOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

// Props
const props = defineProps({
  team: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(["viewDetail", "destroy", "pause", "resume"]);

// ==========================================
// 辅助函数
// ==========================================

function getStatusColor(status) {
  const colors = {
    active: "green",
    paused: "orange",
    completed: "blue",
    failed: "red",
    destroyed: "default",
  };
  return colors[status] || "default";
}

function getStatusText(status) {
  const texts = {
    active: "活跃",
    paused: "暂停",
    completed: "已完成",
    failed: "失败",
    destroyed: "已销毁",
  };
  return texts[status] || status;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return "-";
  }

  try {
    return formatDistanceToNow(new Date(timestamp), {
      locale: zhCN,
      addSuffix: true,
    });
  } catch (error) {
    return "-";
  }
}
</script>

<style scoped lang="scss">
.team-card {
  border-radius: 8px;
  transition: all 0.3s;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  &.team-status-active {
    border-left: 4px solid #52c41a;
  }

  &.team-status-paused {
    border-left: 4px solid #faad14;
  }

  &.team-status-completed {
    border-left: 4px solid #1890ff;
  }

  &.team-status-failed {
    border-left: 4px solid #f5222d;
  }

  .team-card-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 600;

    .team-icon {
      color: #1890ff;
      font-size: 18px;
    }

    .team-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .team-card-content {
    .team-status-badge {
      margin-bottom: 12px;
    }

    .team-description {
      color: #595959;
      font-size: 14px;
      margin-bottom: 16px;
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .team-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .stat-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: #595959;

        .stat-icon {
          color: #8c8c8c;
          font-size: 14px;
        }

        .stat-label {
          color: #8c8c8c;
        }

        .stat-value {
          font-weight: 500;
          color: #262626;
        }
      }
    }

    .team-progress {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #f0f0f0;
    }
  }
}
</style>
