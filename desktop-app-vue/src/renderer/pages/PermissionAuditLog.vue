<template>
  <div class="permission-audit-log">
    <a-spin :spinning="loading">
      <div class="audit-header">
        <a-space>
          <a-range-picker
            v-model:value="dateRange"
            show-time
            format="YYYY-MM-DD HH:mm:ss"
            @change="handleDateRangeChange"
          />
          <a-select
            v-model:value="actionFilter"
            placeholder="操作类型"
            style="width: 150px"
            @change="handleFilterChange"
          >
            <a-select-option value="">
              全部
            </a-select-option>
            <a-select-option value="grant">
              授予权限
            </a-select-option>
            <a-select-option value="revoke">
              撤销权限
            </a-select-option>
            <a-select-option value="create">
              创建
            </a-select-option>
            <a-select-option value="update">
              更新
            </a-select-option>
            <a-select-option value="delete">
              删除
            </a-select-option>
            <a-select-option value="check">
              权限检查
            </a-select-option>
          </a-select>
          <a-select
            v-model:value="severityFilter"
            placeholder="严重程度"
            style="width: 120px"
            @change="handleFilterChange"
          >
            <a-select-option value="">
              全部
            </a-select-option>
            <a-select-option value="info">
              信息
            </a-select-option>
            <a-select-option value="warning">
              警告
            </a-select-option>
            <a-select-option value="error">
              错误
            </a-select-option>
            <a-select-option value="critical">
              严重
            </a-select-option>
          </a-select>
          <a-input-search
            v-model:value="searchText"
            placeholder="搜索日志..."
            style="width: 300px"
            @search="handleSearch"
          />
          <a-button @click="handleExport">
            <template #icon>
              <ExportOutlined />
            </template>
            导出
          </a-button>
        </a-space>
      </div>

      <a-table
        :columns="columns"
        :data-source="filteredLogs"
        :pagination="pagination"
        :loading="loading"
        row-key="logId"
        :row-class-name="getRowClassName"
      >
        <template #expandedRowRender="{ record }">
          <div class="log-detail">
            <a-descriptions
              title="详细信息"
              bordered
              size="small"
            >
              <a-descriptions-item label="日志ID">
                {{ record.logId }}
              </a-descriptions-item>
              <a-descriptions-item label="操作者DID">
                {{ record.actorDID }}
              </a-descriptions-item>
              <a-descriptions-item label="目标ID">
                {{ record.targetId }}
              </a-descriptions-item>
              <a-descriptions-item label="IP地址">
                {{ record.ipAddress || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="用户代理">
                {{ record.userAgent || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="会话ID">
                {{ record.sessionId || '-' }}
              </a-descriptions-item>
            </a-descriptions>

            <a-divider>操作详情</a-divider>

            <pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow: auto;">{{ JSON.stringify(record.details, null, 2) }}</pre>

            <div
              v-if="record.changes"
              style="margin-top: 16px"
            >
              <a-divider>变更内容</a-divider>
              <a-table
                :columns="changeColumns"
                :data-source="record.changes"
                :pagination="false"
                size="small"
              >
                <template #bodyCell="{ column, record: change }">
                  <template v-if="column.key === 'oldValue'">
                    <code>{{ change.oldValue }}</code>
                  </template>
                  <template v-else-if="column.key === 'newValue'">
                    <code>{{ change.newValue }}</code>
                  </template>
                </template>
              </a-table>
            </div>
          </div>
        </template>

        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag :color="getActionColor(record.action)">
              {{ getActionLabel(record.action) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'severity'">
            <a-tag :color="getSeverityColor(record.severity)">
              {{ getSeverityLabel(record.severity) }}
            </a-tag>
          </template>

          <template v-else-if="column.key === 'result'">
            <a-tag
              v-if="record.result === 'success'"
              color="green"
            >
              成功
            </a-tag>
            <a-tag
              v-else
              color="red"
            >
              失败
            </a-tag>
          </template>

          <template v-else-if="column.key === 'actions'">
            <a-button
              type="link"
              size="small"
              @click="handleViewDetail(record)"
            >
              查看详情
            </a-button>
          </template>
        </template>
      </a-table>
    </a-spin>
  </div>
</template>

<script>
import { logger, createLogger } from '@/utils/logger';

import { defineComponent, ref, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import { ExportOutlined } from '@ant-design/icons-vue';
import dayjs from 'dayjs';

export default defineComponent({
  name: 'PermissionAuditLog',

  components: {
    ExportOutlined
  },

  props: {
    orgId: {
      type: String,
      required: true
    },
    logs: {
      type: Array,
      default: () => []
    }
  },

  emits: ['refresh'],

  setup(props, { emit }) {
    const loading = ref(false);
    const searchText = ref('');
    const dateRange = ref([]);
    const actionFilter = ref('');
    const severityFilter = ref('');

    const columns = [
      {
        title: '时间',
        dataIndex: 'timestamp',
        key: 'timestamp',
        width: 180,
        sorter: (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
      },
      {
        title: '操作类型',
        key: 'action',
        width: 120
      },
      {
        title: '严重程度',
        key: 'severity',
        width: 100
      },
      {
        title: '操作者',
        dataIndex: 'actorDID',
        key: 'actorDID',
        ellipsis: true,
        width: 200
      },
      {
        title: '描述',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true
      },
      {
        title: '结果',
        key: 'result',
        width: 80
      },
      {
        title: '操作',
        key: 'actions',
        width: 100,
        fixed: 'right'
      }
    ];

    const changeColumns = [
      {
        title: '字段',
        dataIndex: 'field',
        key: 'field',
        width: 150
      },
      {
        title: '旧值',
        key: 'oldValue',
        ellipsis: true
      },
      {
        title: '新值',
        key: 'newValue',
        ellipsis: true
      }
    ];

    const pagination = {
      pageSize: 20,
      showSizeChanger: true,
      showTotal: (total) => `共 ${total} 条`
    };

    const filteredLogs = computed(() => {
      let result = props.logs;

      // Date range filter
      if (dateRange.value && dateRange.value.length === 2) {
        const [start, end] = dateRange.value;
        result = result.filter(log => {
          const logTime = dayjs(log.timestamp);
          return logTime.isAfter(start) && logTime.isBefore(end);
        });
      }

      // Action filter
      if (actionFilter.value) {
        result = result.filter(log => log.action === actionFilter.value);
      }

      // Severity filter
      if (severityFilter.value) {
        result = result.filter(log => log.severity === severityFilter.value);
      }

      // Search filter
      if (searchText.value) {
        const search = searchText.value.toLowerCase();
        result = result.filter(log =>
          log.description?.toLowerCase().includes(search) ||
          log.actorDID?.toLowerCase().includes(search) ||
          log.targetId?.toLowerCase().includes(search)
        );
      }

      return result;
    });

    const getActionColor = (action) => {
      const colorMap = {
        'grant': 'green',
        'revoke': 'red',
        'create': 'blue',
        'update': 'orange',
        'delete': 'red',
        'check': 'cyan'
      };
      return colorMap[action] || 'default';
    };

    const getActionLabel = (action) => {
      const labelMap = {
        'grant': '授予权限',
        'revoke': '撤销权限',
        'create': '创建',
        'update': '更新',
        'delete': '删除',
        'check': '权限检查'
      };
      return labelMap[action] || action;
    };

    const getSeverityColor = (severity) => {
      const colorMap = {
        'info': 'blue',
        'warning': 'orange',
        'error': 'red',
        'critical': 'red'
      };
      return colorMap[severity] || 'default';
    };

    const getSeverityLabel = (severity) => {
      const labelMap = {
        'info': '信息',
        'warning': '警告',
        'error': '错误',
        'critical': '严重'
      };
      return labelMap[severity] || severity;
    };

    const getRowClassName = (record) => {
      if (record.severity === 'critical' || record.severity === 'error') {
        return 'error-row';
      }
      if (record.severity === 'warning') {
        return 'warning-row';
      }
      return '';
    };

    const handleDateRangeChange = () => {
      // Filter is handled by computed property
    };

    const handleFilterChange = () => {
      // Filter is handled by computed property
    };

    const handleSearch = () => {
      // Search is handled by computed property
    };

    const handleViewDetail = (record) => {
      // Expand row to show details
      logger.info('View detail:', record);
    };

    const handleExport = async () => {
      try {
        loading.value = true;

        const result = await window.electron.ipcRenderer.invoke('permission:export-audit-log', {
          orgId: props.orgId,
          filters: {
            dateRange: dateRange.value,
            action: actionFilter.value,
            severity: severityFilter.value,
            search: searchText.value
          }
        });

        if (result.success) {
          message.success('审计日志导出成功');
        } else {
          message.error(result.error || '导出失败');
        }
      } catch (error) {
        logger.error('Failed to export audit log:', error);
        message.error('导出失败');
      } finally {
        loading.value = false;
      }
    };

    return {
      loading,
      searchText,
      dateRange,
      actionFilter,
      severityFilter,
      columns,
      changeColumns,
      pagination,
      filteredLogs,
      getActionColor,
      getActionLabel,
      getSeverityColor,
      getSeverityLabel,
      getRowClassName,
      handleDateRangeChange,
      handleFilterChange,
      handleSearch,
      handleViewDetail,
      handleExport
    };
  }
});
</script>

<style scoped lang="less">
.permission-audit-log {
  .audit-header {
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .log-detail {
    padding: 16px;
    background: #fafafa;

    pre {
      max-height: 300px;
    }
  }

  :deep(.error-row) {
    background-color: #fff1f0;
  }

  :deep(.warning-row) {
    background-color: #fffbe6;
  }
}
</style>
