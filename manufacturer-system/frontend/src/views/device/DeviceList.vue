<template>
  <div class="device-list">
    <el-card class="search-card">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="设备类型">
          <el-select v-model="searchForm.deviceType" placeholder="请选择" clearable>
            <el-option label="U盾" value="UKEY" />
            <el-option label="SIMKey" value="SIMKEY" />
          </el-select>
        </el-form-item>
        <el-form-item label="设备状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable>
            <el-option label="未激活" value="INACTIVE" />
            <el-option label="已激活" value="ACTIVE" />
            <el-option label="已锁定" value="LOCKED" />
            <el-option label="已注销" value="DEACTIVATED" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="设备ID/序列号" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card">
      <template #header>
        <div class="card-header">
          <span>设备列表</span>
          <el-button type="primary" @click="$router.push('/devices/register')">
            <el-icon><Plus /></el-icon>
            注册设备
          </el-button>
        </div>
      </template>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="deviceId" label="设备ID" width="180" />
        <el-table-column prop="deviceType" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.deviceType === 'UKEY' ? 'primary' : 'success'">
              {{ row.deviceType === 'UKEY' ? 'U盾' : 'SIMKey' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="serialNumber" label="序列号" width="150" />
        <el-table-column prop="manufacturer" label="制造商" width="120" />
        <el-table-column prop="model" label="型号" width="100" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="activationCode" label="激活码" width="180" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              详情
            </el-button>
            <el-button
              v-if="row.status === 'INACTIVE'"
              link
              type="success"
              size="small"
              @click="handleActivate(row)"
            >
              激活
            </el-button>
            <el-button
              v-if="row.status === 'ACTIVE'"
              link
              type="warning"
              size="small"
              @click="handleLock(row)"
            >
              锁定
            </el-button>
            <el-button
              v-if="row.status === 'LOCKED'"
              link
              type="success"
              size="small"
              @click="handleUnlock(row)"
            >
              解锁
            </el-button>
            <el-button link type="danger" size="small" @click="handleDeactivate(row)">
              注销
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

    <!-- 激活对话框 -->
    <el-dialog v-model="activateDialogVisible" title="激活设备" width="500px">
      <el-form :model="activateForm" label-width="100px">
        <el-form-item label="设备ID">
          <el-input v-model="currentDevice.deviceId" disabled />
        </el-form-item>
        <el-form-item label="激活码">
          <el-input v-model="currentDevice.activationCode" disabled />
        </el-form-item>
        <el-form-item label="用户ID" required>
          <el-input v-model="activateForm.userId" placeholder="请输入用户ID" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="activateDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmActivate" :loading="activating">
          确定激活
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'

const loading = ref(false)
const tableData = ref([])
const total = ref(0)

const searchForm = reactive({
  deviceType: '',
  status: '',
  keyword: '',
  page: 1,
  size: 20
})

const activateDialogVisible = ref(false)
const activating = ref(false)
const currentDevice = ref({})
const activateForm = reactive({
  userId: ''
})

onMounted(() => {
  loadData()
})

const loadData = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/devices/list', { params: searchForm })
    tableData.value = data.data.records || []
    total.value = data.data.total || 0
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
    deviceType: '',
    status: '',
    keyword: '',
    page: 1,
    size: 20
  })
  loadData()
}

const handleView = (row) => {
  ElMessageBox.alert(JSON.stringify(row, null, 2), '设备详情', {
    confirmButtonText: '关闭'
  })
}

const handleActivate = (row) => {
  currentDevice.value = row
  activateForm.userId = ''
  activateDialogVisible.value = true
}

const confirmActivate = async () => {
  if (!activateForm.userId) {
    ElMessage.warning('请输入用户ID')
    return
  }

  activating.value = true
  try {
    await axios.post('/api/devices/activate', {
      activationCode: currentDevice.value.activationCode,
      deviceId: currentDevice.value.deviceId,
      userId: parseInt(activateForm.userId)
    })
    ElMessage.success('设备激活成功')
    activateDialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '激活失败')
  } finally {
    activating.value = false
  }
}

const handleLock = async (row) => {
  try {
    await ElMessageBox.confirm('确定要锁定该设备吗?', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.post(`/api/devices/${row.deviceId}/lock`, null, {
      params: { reason: '管理员手动锁定' }
    })
    ElMessage.success('设备已锁定')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

const handleUnlock = async (row) => {
  try {
    await axios.post(`/api/devices/${row.deviceId}/unlock`)
    ElMessage.success('设备已解锁')
    loadData()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleDeactivate = async (row) => {
  try {
    await ElMessageBox.confirm('确定要注销该设备吗?此操作不可恢复!', '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'error'
    })
    await axios.post(`/api/devices/${row.deviceId}/deactivate`)
    ElMessage.success('设备已注销')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

const getStatusType = (status) => {
  const map = {
    INACTIVE: 'info',
    ACTIVE: 'success',
    LOCKED: 'warning',
    DEACTIVATED: 'danger'
  }
  return map[status] || 'info'
}

const getStatusText = (status) => {
  const map = {
    INACTIVE: '未激活',
    ACTIVE: '已激活',
    LOCKED: '已锁定',
    DEACTIVATED: '已注销'
  }
  return map[status] || status
}
</script>

<style scoped>
.device-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.el-pagination {
  margin-top: 20px;
  justify-content: flex-end;
}
</style>
