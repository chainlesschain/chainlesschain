<template>
  <div class="permission-statistics-tab">
    <a-spin :spinning="loading">
      <a-row
        :gutter="16"
        style="margin-bottom: 24px"
      >
        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总角色数"
              :value="statistics?.totalRoles || 0"
              :value-style="{ color: '#3f8600' }"
            >
              <template #prefix>
                <TeamOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>

        <a-col :span="6">
          <a-card>
            <a-statistic
              title="总权限数"
              :value="statistics?.totalPermissions || 0"
              :value-style="{ color: '#1890ff' }"
            >
              <template #prefix>
                <SafetyOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>

        <a-col :span="6">
          <a-card>
            <a-statistic
              title="活跃覆盖规则"
              :value="statistics?.activeOverrides || 0"
              :value-style="{ color: '#fa8c16' }"
            >
              <template #prefix>
                <ExceptionOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>

        <a-col :span="6">
          <a-card>
            <a-statistic
              title="权限组数"
              :value="statistics?.totalGroups || 0"
              :value-style="{ color: '#722ed1' }"
            >
              <template #prefix>
                <GroupOutlined />
              </template>
            </a-statistic>
          </a-card>
        </a-col>
      </a-row>

      <a-row
        :gutter="16"
        style="margin-bottom: 24px"
      >
        <a-col :span="12">
          <a-card
            title="角色权限分布"
            :bordered="false"
          >
            <div
              ref="roleChartRef"
              style="height: 300px"
            />
          </a-card>
        </a-col>

        <a-col :span="12">
          <a-card
            title="资源类型分布"
            :bordered="false"
          >
            <div
              ref="resourceChartRef"
              style="height: 300px"
            />
          </a-card>
        </a-col>
      </a-row>

      <a-row
        :gutter="16"
        style="margin-bottom: 24px"
      >
        <a-col :span="24">
          <a-card
            title="权限使用趋势"
            :bordered="false"
          >
            <div
              ref="trendChartRef"
              style="height: 300px"
            />
          </a-card>
        </a-col>
      </a-row>

      <a-row :gutter="16">
        <a-col :span="12">
          <a-card
            title="最常用权限 Top 10"
            :bordered="false"
          >
            <a-list
              :data-source="statistics?.topPermissions || []"
              :loading="loading"
            >
              <template #renderItem="{ item, index }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <a-badge
                        :count="index + 1"
                        :number-style="{ backgroundColor: getBadgeColor(index) }"
                      />
                      <span style="margin-left: 12px">{{ item.permission }}</span>
                    </template>
                    <template #description>
                      使用次数: {{ item.count }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>

        <a-col :span="12">
          <a-card
            title="最活跃用户 Top 10"
            :bordered="false"
          >
            <a-list
              :data-source="statistics?.topUsers || []"
              :loading="loading"
            >
              <template #renderItem="{ item, index }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #title>
                      <a-badge
                        :count="index + 1"
                        :number-style="{ backgroundColor: getBadgeColor(index) }"
                      />
                      <span style="margin-left: 12px">{{ item.userDID }}</span>
                    </template>
                    <template #description>
                      操作次数: {{ item.actionCount }}
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>
      </a-row>

      <a-row
        :gutter="16"
        style="margin-top: 24px"
      >
        <a-col :span="24">
          <a-card
            title="权限审计摘要"
            :bordered="false"
          >
            <a-descriptions
              bordered
              size="small"
            >
              <a-descriptions-item label="今日权限变更">
                {{ statistics?.todayChanges || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="本周权限变更">
                {{ statistics?.weekChanges || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="本月权限变更">
                {{ statistics?.monthChanges || 0 }}
              </a-descriptions-item>
              <a-descriptions-item label="异常操作数">
                <a-tag color="red">
                  {{ statistics?.anomalies || 0 }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="待审核操作">
                <a-tag color="orange">
                  {{ statistics?.pendingReviews || 0 }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="最后更新时间">
                {{ statistics?.lastUpdated || '-' }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>
  </div>
</template>

<script>
import { defineComponent, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { TeamOutlined, SafetyOutlined, ExceptionOutlined, GroupOutlined } from '@ant-design/icons-vue';
import * as echarts from 'echarts';

export default defineComponent({
  name: 'PermissionStatisticsTab',

  components: {
    TeamOutlined,
    SafetyOutlined,
    ExceptionOutlined,
    GroupOutlined
  },

  props: {
    orgId: {
      type: String,
      required: true
    },
    statistics: {
      type: Object,
      default: () => null
    }
  },

  emits: ['refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const roleChartRef = ref(null);
    const resourceChartRef = ref(null);
    const trendChartRef = ref(null);

    let roleChart = null;
    let resourceChart = null;
    let trendChart = null;

    const getBadgeColor = (index) => {
      if (index === 0) {return '#f5222d';}
      if (index === 1) {return '#fa8c16';}
      if (index === 2) {return '#faad14';}
      return '#1890ff';
    };

    const initRoleChart = () => {
      if (!roleChartRef.value || !props.statistics?.roleDistribution) {return;}

      roleChart = echarts.init(roleChartRef.value);
      const option = {
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)'
        },
        legend: {
          orient: 'vertical',
          left: 'left'
        },
        series: [
          {
            name: '角色权限',
            type: 'pie',
            radius: '50%',
            data: props.statistics.roleDistribution.map(item => ({
              name: item.roleName,
              value: item.permissionCount
            })),
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }
        ]
      };
      roleChart.setOption(option);
    };

    const initResourceChart = () => {
      if (!resourceChartRef.value || !props.statistics?.resourceDistribution) {return;}

      resourceChart = echarts.init(resourceChartRef.value);
      const option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          }
        },
        xAxis: {
          type: 'category',
          data: props.statistics.resourceDistribution.map(item => item.resourceType)
        },
        yAxis: {
          type: 'value'
        },
        series: [
          {
            name: '资源数量',
            type: 'bar',
            data: props.statistics.resourceDistribution.map(item => item.count),
            itemStyle: {
              color: '#1890ff'
            }
          }
        ]
      };
      resourceChart.setOption(option);
    };

    const initTrendChart = () => {
      if (!trendChartRef.value || !props.statistics?.usageTrend) {return;}

      trendChart = echarts.init(trendChartRef.value);
      const option = {
        tooltip: {
          trigger: 'axis'
        },
        legend: {
          data: ['权限授予', '权限撤销', '权限查询']
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: props.statistics.usageTrend.map(item => item.date)
        },
        yAxis: {
          type: 'value'
        },
        series: [
          {
            name: '权限授予',
            type: 'line',
            data: props.statistics.usageTrend.map(item => item.grants),
            smooth: true,
            itemStyle: { color: '#52c41a' }
          },
          {
            name: '权限撤销',
            type: 'line',
            data: props.statistics.usageTrend.map(item => item.revokes),
            smooth: true,
            itemStyle: { color: '#f5222d' }
          },
          {
            name: '权限查询',
            type: 'line',
            data: props.statistics.usageTrend.map(item => item.checks),
            smooth: true,
            itemStyle: { color: '#1890ff' }
          }
        ]
      };
      trendChart.setOption(option);
    };

    const initCharts = async () => {
      await nextTick();
      initRoleChart();
      initResourceChart();
      initTrendChart();
    };

    const resizeCharts = () => {
      roleChart?.resize();
      resourceChart?.resize();
      trendChart?.resize();
    };

    watch(() => props.statistics, () => {
      if (props.statistics) {
        initCharts();
      }
    }, { deep: true });

    onMounted(() => {
      if (props.statistics) {
        initCharts();
      }
      window.addEventListener('resize', resizeCharts);
    });

    onUnmounted(() => {
      roleChart?.dispose();
      resourceChart?.dispose();
      trendChart?.dispose();
      window.removeEventListener('resize', resizeCharts);
    });

    return {
      loading,
      roleChartRef,
      resourceChartRef,
      trendChartRef,
      getBadgeColor
    };
  }
});
</script>

<style scoped lang="less">
.permission-statistics-tab {
  :deep(.ant-card) {
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  :deep(.ant-statistic-title) {
    font-size: 14px;
    color: rgba(0, 0, 0, 0.65);
  }

  :deep(.ant-statistic-content) {
    font-size: 24px;
    font-weight: 600;
  }
}
</style>
