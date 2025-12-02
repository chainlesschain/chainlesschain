<template>
  <div class="log-list">
    <el-card class="search-card">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="设备ID">
          <el-input v-model="searchForm.deviceId" placeholder="设备ID" clearable />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-select v-model="searchForm.operation" placeholder="请选择" clearable>
            <el-option label="注册设备" value="REGISTER" />
            <el-option label="激活设备" value="ACTIVATE" />
            <el-option label="锁定设备" value="LOCK" />
            <el-option label="解锁设备" value="UNLOCK" />
            <el-option label="注销设备" value="DEACTIVATE" />
            <el-option label="创建备份" value="CREATE_BACKUP" />
            <el-option label="恢复数据" value="RESTORE_BACKUP" />
            <el-option label="密码恢复" value="PASSWORD_RECOVERY" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable>
            <el-option label="成功" value="SUCCESS" />
            <el-option label="失败" value="FAILED" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="searchForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
          <el-button type="success" @click="handleExport">
            <el-icon><Download /></el-icon>
            导出
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <template #header>
        <span>操作日志</span>
      </template>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="日志ID" width="80" />
        <el-table-column prop="deviceId" label="设备ID" width="180" show-overflow-tooltip />
        <el-table-column prop="userId" label="用户ID" width="100" />
        <el-table-column prop="operation" label="操作类型" width="150">
          <template #default="{ row }">
            <el-tag :type="getOperationType(row.operation)">
              {{ getOperationText(row.operation) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="operationDetail" label="操作详情" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ipAddress" label="IP地址" width="150" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'SUCCESS' ? 'success' : 'danger'">
              {{ row.status === 'SUCCESS' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="errorMessage" label="错误信息" width="200" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="操作时间" width="180" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="searchForm.page"
        v-model:page-size="searchForm.size"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="loadData"
        @current-change="loadData"
      />
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog v-model="detailDialogVisible" title="日志详情" width="700px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="日志ID">
          {{ currentLog.id }}
        </el-descriptions-item>
        <el-descriptions-item label="设备ID">
          {{ currentLog.deviceId }}
        </el-descriptions-item>
        <el-descriptions-item label="用户ID">
          {{ currentLog.userId || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="操作类型">
          <el-tag :type="getOperationType(currentLog.operation)">
            {{ getOperationText(currentLog.operation) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="IP地址">
          {{ currentLog.ipAddress }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="currentLog.status === 'SUCCESS' ? 'success' : 'danger'">
            {{ currentLog.status === 'SUCCESS' ? '成功' : '失败' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="操作时间" :span="2">
          {{ currentLog.createdAt }}
        </el-descriptions-item>
        <el-descriptions-item label="User Agent" :span="2">
          {{ currentLog.userAgent || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="操作详情" :span="2">
          <pre style="max-height: 200px; overflow: auto;">{{ formatJson(currentLog.operationDetail) }}</pre>
        </el-descriptions-item>
        <el-descriptions-item v-if="currentLog.errorMessage" label="错误信息" :span="2">
          <el-text type="danger">{{ currentLog.errorMessage }}</el-text>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const loading = ref(false)
const tableData = ref([])
const total = ref(0)
const detailDialogVisible = ref(false)
const currentLog = ref({})

const searchForm = reactive({
  deviceId: '',
  operation: '',
  status: '',
  dateRange: [],
  page: 1,
  size: 20
})

onMounted(() => {
  loadData()
})

const loadData = async () => {
  loading.value = true
  try {
    // Mock数据 - 实际应调用API
    const mockData = {
      records: [
        {
          id: 1,
          deviceId: 'uk_test_001',
          userId: 1,
          operation: 'REGISTER',
          operationDetail: '{"manufacturer":"飞天诚信","model":"FT-A22"}',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2024-12-02 10:00:00'
        },
        {
          id: 2,
          deviceId: 'uk_test_001',
          userId: 2,
          operation: 'ACTIVATE',
          operationDetail: '{"activationCode":"XXXX-XXXX-XXXX-XXXX"}',
          ipAddress: '192.168.1.101',
          userAgent: 'Mozilla/5.0...',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2024-12-02 11:30:00'
        },
        {
          id: 3,
          deviceId: 'uk_test_002',
          userId: 1,
          operation: 'LOCK',
          operationDetail: '{"reason":"异常行为"}',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2024-12-02 14:20:00'
        },
        {
          id: 4,
          deviceId: 'uk_test_003',
          userId: 3,
          operation: 'CREATE_BACKUP',
          operationDetail: '{"backupType":"FULL"}',
          ipAddress: '192.168.1.102',
          userAgent: 'Mozilla/5.0...',
          status: 'FAILED',
          errorMessage: '设备未激活',
          createdAt: '2024-12-02 15:00:00'
        }
      ],
      total: 4
    }
    tableData.value = mockData.records
    total.value = mockData.total
  } catch (error) {
    ElMessage.error('加载数据失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  searchForm.page = 1
  loadData()
}

const handleReset = () => {
  Object.assign(searchForm, {
    deviceId: '',
    operation: '',
    status: '',
    dateRange: [],
    page: 1,
    size: 20
  })
  loadData()
}

const handleView = (row) => {
  currentLog.value = row
  detailDialogVisible.value = true
}

const handleExport = () => {
  ElMessage.info('导出功能开发中...')
}

const getOperationType = (operation) => {
  const map = {
    REGISTER: 'primary',
    ACTIVATE: 'success',
    LOCK: 'warning',
    UNLOCK: 'success',
    DEACTIVATE: 'danger',
    CREATE_BACKUP: 'info',
    RESTORE_BACKUP: 'warning',
    PASSWORD_RECOVERY: 'warning'
  }
  return map[operation] || 'info'
}

const getOperationText = (operation) => {
  const map = {
    REGISTER: '注册设备',
    ACTIVATE: '激活设备',
    LOCK: '锁定设备',
    UNLOCK: '解锁设备',
    DEACTIVATE: '注销设备',
    CREATE_BACKUP: '创建备份',
    RESTORE_BACKUP: '恢复数据',
    PASSWORD_RECOVERY: '密码恢复'
  }
  return map[operation] || operation
}

const formatJson = (jsonStr) => {
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2)
  } catch {
    return jsonStr
  }
}
</script>

<style scoped>
.log-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.el-pagination {
  margin-top: 20px;
  justify-content: flex-end;
}

pre {
  background-color: #f5f7fa;
  padding: 10px;
  border-radius: 4px;
  font-size: 12px;
}
</style>
