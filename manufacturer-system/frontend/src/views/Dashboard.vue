<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon" style="background: #ecf5ff">
              <el-icon :size="40" color="#409EFF"><Cpu /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalDevices }}</div>
              <div class="stat-label">设备总数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon" style="background: #f0f9ff">
              <el-icon :size="40" color="#67C23A"><CircleCheck /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.activeDevices }}</div>
              <div class="stat-label">已激活设备</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon" style="background: #fef0f0">
              <el-icon :size="40" color="#F56C6C"><User /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalUsers }}</div>
              <div class="stat-label">用户总数</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon" style="background: #fdf6ec">
              <el-icon :size="40" color="#E6A23C"><Download /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalDownloads }}</div>
              <div class="stat-label">APP下载量</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区域 -->
    <el-row :gutter="20" class="charts-row">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>设备激活趋势</span>
          </template>
          <div ref="activationChartRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>设备类型分布</span>
          </template>
          <div ref="deviceTypeChartRef" style="height: 300px"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="charts-row">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>APP下载统计</span>
          </template>
          <div ref="downloadChartRef" style="height: 300px"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>最近操作</span>
          </template>
          <el-timeline>
            <el-timeline-item
              v-for="activity in recentActivities"
              :key="activity.id"
              :timestamp="activity.timestamp"
              :type="activity.type"
            >
              {{ activity.content }}
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'

const activationChartRef = ref()
const deviceTypeChartRef = ref()
const downloadChartRef = ref()

let activationChart = null
let deviceTypeChart = null
let downloadChart = null

const stats = reactive({
  totalDevices: 1523,
  activeDevices: 1245,
  totalUsers: 856,
  totalDownloads: 3842
})

const recentActivities = ref([
  {
    id: 1,
    content: '用户 张三 激活了设备 uk_test_001',
    timestamp: '2024-12-02 10:30:00',
    type: 'success'
  },
  {
    id: 2,
    content: '管理员上传了新版本 v1.2.0',
    timestamp: '2024-12-02 09:15:00',
    type: 'primary'
  },
  {
    id: 3,
    content: '批量注册了 50 个设备',
    timestamp: '2024-12-01 16:20:00',
    type: 'warning'
  },
  {
    id: 4,
    content: '用户 李四 创建了数据备份',
    timestamp: '2024-12-01 14:10:00',
    type: 'info'
  }
])

onMounted(() => {
  initActivationChart()
  initDeviceTypeChart()
  initDownloadChart()
})

onBeforeUnmount(() => {
  if (activationChart) activationChart.dispose()
  if (deviceTypeChart) deviceTypeChart.dispose()
  if (downloadChart) downloadChart.dispose()
})

const initActivationChart = () => {
  activationChart = echarts.init(activationChartRef.value)

  const option = {
    tooltip: {
      trigger: 'axis'
    },
    legend: {
      data: ['激活数量']
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: '激活数量',
        type: 'line',
        data: [120, 132, 101, 134, 90, 230, 210, 182, 191, 234, 290, 330],
        smooth: true,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64, 158, 255, 0.3)' },
            { offset: 1, color: 'rgba(64, 158, 255, 0)' }
          ])
        }
      }
    ]
  }

  activationChart.setOption(option)
}

const initDeviceTypeChart = () => {
  deviceTypeChart = echarts.init(deviceTypeChartRef.value)

  const option = {
    tooltip: {
      trigger: 'item'
    },
    legend: {
      orient: 'vertical',
      left: 'left'
    },
    series: [
      {
        name: '设备类型',
        type: 'pie',
        radius: '50%',
        data: [
          { value: 823, name: 'U盾' },
          { value: 700, name: 'SIMKey' }
        ],
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      }
    ]
  }

  deviceTypeChart.setOption(option)
}

const initDownloadChart = () => {
  downloadChart = echarts.init(downloadChartRef.value)

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      }
    },
    legend: {
      data: ['Windows', 'Android', 'Mac', 'iOS']
    },
    xAxis: {
      type: 'category',
      data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    },
    yAxis: {
      type: 'value'
    },
    series: [
      {
        name: 'Windows',
        type: 'bar',
        data: [120, 132, 101, 134, 90, 230, 210]
      },
      {
        name: 'Android',
        type: 'bar',
        data: [220, 182, 191, 234, 290, 330, 310]
      },
      {
        name: 'Mac',
        type: 'bar',
        data: [150, 232, 201, 154, 190, 330, 410]
      },
      {
        name: 'iOS',
        type: 'bar',
        data: [320, 332, 301, 334, 390, 330, 320]
      }
    ]
  }

  downloadChart.setOption(option)
}
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stats-row {
  margin-bottom: 20px;
}

.charts-row {
  margin-bottom: 20px;
}

.stat-card {
  cursor: pointer;
  transition: all 0.3s;
}

.stat-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 20px;
}

.stat-icon {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 14px;
  color: #909399;
}
</style>
