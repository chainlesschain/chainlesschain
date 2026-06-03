<template>
  <div class="backup-list">
    <el-card class="search-card">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="设备ID">
          <el-input v-model="searchForm.deviceId" placeholder="设备ID" clearable />
        </el-form-item>
        <el-form-item label="用户ID">
          <el-input v-model="searchForm.userId" placeholder="用户ID" clearable />
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
          <span>备份列表</span>
          <el-button type="primary" @click="createDialogVisible = true">
            <el-icon><Plus /></el-icon>
            创建备份
          </el-button>
        </div>
      </template>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="备份ID" width="80" />
        <el-table-column prop="deviceId" label="设备ID" width="180" />
        <el-table-column prop="userId" label="用户ID" width="100" />
        <el-table-column prop="backupType" label="备份类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.backupType === 'FULL' ? 'primary' : 'warning'">
              {{ row.backupType === 'FULL' ? '完整' : '增量' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="backupHash" label="数据哈希" width="180" show-overflow-tooltip />
        <el-table-column prop="encryptionMethod" label="加密方式" width="120" />
        <el-table-column prop="restoreCount" label="恢复次数" width="100" />
        <el-table-column prop="lastRestoredAt" label="最后恢复时间" width="180" />
        <el-table-column prop="expiresAt" label="过期时间" width="180" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              详情
            </el-button>
            <el-button link type="success" size="small" @click="handleRestore(row)">
              恢复
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">
              删除
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

    <!-- 创建备份对话框 -->
    <el-dialog v-model="createDialogVisible" title="创建备份" width="600px">
      <el-form :model="createForm" label-width="120px">
        <el-form-item label="设备ID" required>
          <el-input v-model="createForm.deviceId" placeholder="请输入设备ID" />
        </el-form-item>
        <el-form-item label="用户ID" required>
          <el-input v-model="createForm.userId" placeholder="请输入用户ID" />
        </el-form-item>
        <el-form-item label="备份类型">
          <el-radio-group v-model="createForm.backupType">
            <el-radio value="FULL">完整备份</el-radio>
            <el-radio value="INCREMENTAL">增量备份</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="加密方式">
          <el-select v-model="createForm.encryptionMethod" placeholder="请选择">
            <el-option label="AES-256-GCM" value="AES-256-GCM" />
            <el-option label="ChaCha20-Poly1305" value="ChaCha20-Poly1305" />
          </el-select>
        </el-form-item>
        <el-form-item label="备份数据">
          <el-input
            v-model="createForm.encryptedData"
            type="textarea"
            :rows="6"
            placeholder="请输入加密后的备份数据(Base64)"
          />
        </el-form-item>
        <el-form-item label="有效期(天)">
          <el-input-number v-model="createForm.validityDays" :min="1" :max="3650" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleCreate" :loading="creating">
          创建备份
        </el-button>
      </template>
    </el-dialog>

    <!-- 恢复备份对话框 -->
    <el-dialog v-model="restoreDialogVisible" title="恢复数据" width="600px">
      <el-alert
        title="警告"
        type="warning"
        :closable="false"
        style="margin-bottom: 20px"
      >
        恢复数据将覆盖目标设备上的现有数据，此操作不可撤销！
      </el-alert>
      <el-form :model="restoreForm" label-width="120px">
        <el-form-item label="备份ID">
          <el-input v-model="currentBackup.id" disabled />
        </el-form-item>
        <el-form-item label="原设备ID">
          <el-input v-model="currentBackup.deviceId" disabled />
        </el-form-item>
        <el-form-item label="目标设备ID" required>
          <el-input
            v-model="restoreForm.targetDeviceId"
            placeholder="请输入要恢复到的设备ID"
          />
        </el-form-item>
        <el-form-item label="验证密码" required>
          <el-input
            v-model="restoreForm.password"
            type="password"
            placeholder="请输入管理员密码进行验证"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="restoreDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmRestore" :loading="restoring">
          确认恢复
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
const createDialogVisible = ref(false)
const restoreDialogVisible = ref(false)
const creating = ref(false)
const restoring = ref(false)

const searchForm = reactive({
  deviceId: '',
  userId: '',
  page: 1,
  size: 20
})

const createForm = reactive({
  deviceId: '',
  userId: '',
  backupType: 'FULL',
  encryptionMethod: 'AES-256-GCM',
  encryptedData: '',
  validityDays: 730
})

const currentBackup = ref({})
const restoreForm = reactive({
  targetDeviceId: '',
  password: ''
})

onMounted(() => {
  loadData()
})

const loadData = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/backup/list', { params: searchForm })
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
    deviceId: '',
    userId: '',
    page: 1,
    size: 20
  })
  loadData()
}

const handleView = (row) => {
  ElMessageBox.alert(
    `
    <div style="text-align: left;">
      <p><strong>备份ID:</strong> ${row.id}</p>
      <p><strong>设备ID:</strong> ${row.deviceId}</p>
      <p><strong>用户ID:</strong> ${row.userId}</p>
      <p><strong>备份类型:</strong> ${row.backupType}</p>
      <p><strong>加密方式:</strong> ${row.encryptionMethod}</p>
      <p><strong>数据哈希:</strong> ${row.backupHash}</p>
      <p><strong>恢复次数:</strong> ${row.restoreCount}</p>
      <p><strong>创建时间:</strong> ${row.createdAt}</p>
      <p><strong>过期时间:</strong> ${row.expiresAt || '永久'}</p>
    </div>
  `,
    '备份详情',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '关闭'
    }
  )
}

const handleCreate = async () => {
  if (!createForm.deviceId || !createForm.userId || !createForm.encryptedData) {
    ElMessage.warning('请填写必填项')
    return
  }

  creating.value = true
  try {
    await axios.post('/api/backup/create', createForm)
    ElMessage.success('备份创建成功')
    createDialogVisible.value = false
    loadData()
    // 重置表单
    Object.assign(createForm, {
      deviceId: '',
      userId: '',
      backupType: 'FULL',
      encryptionMethod: 'AES-256-GCM',
      encryptedData: '',
      validityDays: 730
    })
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '创建失败')
  } finally {
    creating.value = false
  }
}

const handleRestore = (row) => {
  currentBackup.value = row
  restoreForm.targetDeviceId = ''
  restoreForm.password = ''
  restoreDialogVisible.value = true
}

const confirmRestore = async () => {
  if (!restoreForm.targetDeviceId || !restoreForm.password) {
    ElMessage.warning('请填写所有字段')
    return
  }

  restoring.value = true
  try {
    await axios.post('/api/backup/restore', {
      backupId: currentBackup.value.id,
      deviceId: restoreForm.targetDeviceId
    })
    ElMessage.success('数据恢复成功')
    restoreDialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '恢复失败')
  } finally {
    restoring.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除这个备份吗？此操作不可恢复！', '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'error'
    })
    await axios.delete(`/api/backup/${row.id}`)
    ElMessage.success('备份已删除')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}
</script>

<style scoped>
.backup-list {
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
