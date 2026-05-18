<template>
  <div class="admin-dashboard">
    <div class="page-header">
      <h1>数据概览</h1>
      <el-button :icon="Refresh" @click="refreshData">刷新数据</el-button>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <el-card
        v-for="stat in stats"
        :key="stat.key"
        class="stat-card"
        :style="{ background: stat.gradient }"
      >
        <div class="stat-content">
          <div class="stat-icon">
            <el-icon :size="40">
              <component :is="stat.icon" />
            </el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ stat.value }}</div>
            <div class="stat-label">{{ stat.label }}</div>
            <div class="stat-change" :class="{ positive: stat.change > 0, negative: stat.change < 0 }">
              <el-icon>
                <component :is="stat.change > 0 ? TopRight : BottomRight" />
              </el-icon>
              {{ Math.abs(stat.change) }}%
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 图表区域 -->
    <div class="charts-grid">
      <el-card class="chart-card">
        <template #header>
          <div class="card-header">
            <span>用户增长趋势</span>
            <el-radio-group v-model="userChartPeriod" size="small">
              <el-radio-button label="week">近7天</el-radio-button>
              <el-radio-button label="month">近30天</el-radio-button>
              <el-radio-button label="year">近一年</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div class="chart-placeholder">
          <el-icon :size="60" color="#909399"><TrendCharts /></el-icon>
          <p>用户增长趋势图</p>
          <el-text type="info">建议集成 ECharts 或 Chart.js 进行数据可视化</el-text>
        </div>
      </el-card>

      <el-card class="chart-card">
        <template #header>
          <div class="card-header">
            <span>内容统计</span>
            <el-radio-group v-model="contentChartType" size="small">
              <el-radio-button label="category">分类</el-radio-button>
              <el-radio-button label="tag">标签</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <div class="chart-placeholder">
          <el-icon :size="60" color="#909399"><PieChart /></el-icon>
          <p>内容分布图</p>
          <el-text type="info">建议集成图表库展示分类/标签分布</el-text>
        </div>
      </el-card>
    </div>

    <!-- 最新活动 -->
    <el-card class="activity-card">
      <template #header>
        <div class="card-header">
          <span>最新活动</span>
          <el-button text @click="viewAllActivities">查看全部</el-button>
        </div>
      </template>
      <el-timeline>
        <el-timeline-item
          v-for="activity in recentActivities"
          :key="activity.id"
          :timestamp="formatTime(activity.time)"
          :type="activity.type"
          placement="top"
        >
          <el-card>
            <div class="activity-content">
              <div class="activity-icon" :style="{ background: getActivityColor(activity.action) }">
                <el-icon :size="20">
                  <component :is="getActivityIcon(activity.action)" />
                </el-icon>
              </div>
              <div class="activity-info">
                <p class="activity-title">{{ activity.title }}</p>
                <p class="activity-desc">{{ activity.description }}</p>
              </div>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <!-- 快捷操作 -->
    <el-card class="quick-actions-card">
      <template #header>
        <span>快捷操作</span>
      </template>
      <div class="quick-actions">
        <el-button
          v-for="action in quickActions"
          :key="action.name"
          :icon="action.icon"
          :type="action.type"
          @click="handleQuickAction(action.name)"
        >
          {{ action.label }}
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Refresh, User, Document, ChatDotRound, View,
  TopRight, BottomRight, TrendCharts, PieChart,
  Plus, Delete, Warning, Check
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const router = useRouter()

const userChartPeriod = ref('week')
const contentChartType = ref('category')

// 统计数据
const stats = reactive([
  {
    key: 'users',
    label: '总用户数',
    value: 1234,
    change: 12.5,
    icon: User,
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },
  {
    key: 'posts',
    label: '总帖子数',
    value: 5678,
    change: 8.3,
    icon: Document,
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
  },
  {
    key: 'replies',
    label: '总回复数',
    value: 12345,
    change: 15.2,
    icon: ChatDotRound,
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
  },
  {
    key: 'views',
    label: '总浏览量',
    value: 98765,
    change: -3.1,
    icon: View,
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
  }
])

// 最新活动
const recentActivities = ref([
  {
    id: 1,
    action: 'user_register',
    title: '新用户注册',
    description: '用户"技术达人"完成注册',
    time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    type: 'primary'
  },
  {
    id: 2,
    action: 'post_create',
    title: '新帖子发布',
    description: '用户"AI爱好者"发布了新帖子《ChainlessChain使用技巧》',
    time: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    type: 'success'
  },
  {
    id: 3,
    action: 'post_report',
    title: '内容举报',
    description: '帖子《测试标题》被举报，需要审核',
    time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    type: 'warning'
  },
  {
    id: 4,
    action: 'user_ban',
    title: '用户封禁',
    description: '用户"违规账号"因违规被封禁',
    time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    type: 'danger'
  },
  {
    id: 5,
    action: 'post_approve',
    title: '内容审核通过',
    description: '帖子《新功能介绍》审核通过',
    time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    type: 'success'
  }
])

// 快捷操作
const quickActions = [
  { name: 'create_announcement', label: '发布公告', icon: Plus, type: 'primary' },
  { name: 'review_posts', label: '审核帖子', icon: Check, type: 'success' },
  { name: 'manage_users', label: '用户管理', icon: User, type: 'info' },
  { name: 'view_reports', label: '查看举报', icon: Warning, type: 'warning' },
  { name: 'clear_cache', label: '清理缓存', icon: Delete, type: 'danger' }
]

// 格式化时间
const formatTime = (time) => {
  return dayjs(time).fromNow()
}

// 获取活动图标
const getActivityIcon = (action) => {
  const icons = {
    user_register: User,
    post_create: Document,
    post_report: Warning,
    user_ban: Delete,
    post_approve: Check
  }
  return icons[action] || Document
}

// 获取活动颜色
const getActivityColor = (action) => {
  const colors = {
    user_register: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    post_create: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    post_report: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    user_ban: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    post_approve: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)'
  }
  return colors[action] || colors.post_create
}

// 刷新数据
const refreshData = async () => {
  try {
    // 这里应该调用API
    // await refreshDashboardData()
    ElMessage.success('数据已刷新')
  } catch (error) {
    ElMessage.error('刷新失败')
  }
}

// 查看所有活动
const viewAllActivities = () => {
  ElMessage.info('查看所有活动功能开发中...')
}

// 快捷操作处理
const handleQuickAction = (actionName) => {
  switch (actionName) {
    case 'create_announcement':
      router.push('/create?category=announcement')
      break
    case 'review_posts':
      router.push('/admin/posts')
      break
    case 'manage_users':
      router.push('/admin/users')
      break
    case 'view_reports':
      ElMessage.info('查看举报功能开发中...')
      break
    case 'clear_cache':
      ElMessage.info('清理缓存功能开发中...')
      break
  }
}

onMounted(() => {
  // 加载数据
})
</script>

<style scoped lang="scss">
.admin-dashboard {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 24px;

  .stat-card {
    border: none;
    color: white;

    :deep(.el-card__body) {
      padding: 24px;
    }

    .stat-content {
      display: flex;
      align-items: center;
      gap: 20px;

      .stat-icon {
        width: 64px;
        height: 64px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        backdrop-filter: blur(10px);
      }

      .stat-info {
        flex: 1;

        .stat-value {
          font-size: 32px;
          font-weight: 700;
          line-height: 1;
          margin-bottom: 8px;
        }

        .stat-label {
          font-size: 14px;
          opacity: 0.9;
          margin-bottom: 8px;
        }

        .stat-change {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.2);

          &.positive {
            color: #67c23a;
            background: rgba(103, 194, 58, 0.2);
          }

          &.negative {
            color: #f56c6c;
            background: rgba(245, 108, 108, 0.2);
          }
        }
      }
    }
  }
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 20px;
  margin-bottom: 24px;

  .chart-card {
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chart-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      background: var(--el-fill-color-light);
      border-radius: 8px;

      p {
        margin: 16px 0 8px;
        font-size: 16px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
    }
  }
}

.activity-card {
  margin-bottom: 24px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .activity-content {
    display: flex;
    gap: 16px;
    align-items: center;

    .activity-icon {
      width: 48px;
      height: 48px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: white;
    }

    .activity-info {
      flex: 1;

      .activity-title {
        margin: 0 0 4px;
        font-size: 15px;
        font-weight: 600;
        color: var(--el-text-color-primary);
      }

      .activity-desc {
        margin: 0;
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }
  }
}

.quick-actions-card {
  .quick-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
}

@media (max-width: 768px) {
  .admin-dashboard {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h1 {
      font-size: 22px;
    }
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }
}
</style>
