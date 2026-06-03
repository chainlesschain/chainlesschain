<template>
  <div class="device-register">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>注册设备</span>
          <el-button @click="$router.back()">
            <el-icon><ArrowLeft /></el-icon>
            返回
          </el-button>
        </div>
      </template>

      <el-tabs v-model="activeTab" type="border-card">
        <!-- 单个注册 -->
        <el-tab-pane label="单个注册" name="single">
          <el-form :model="singleForm" :rules="rules" ref="singleFormRef" label-width="120px">
            <el-form-item label="设备类型" prop="deviceType">
              <el-select v-model="singleForm.deviceType" placeholder="请选择设备类型">
                <el-option label="U盾" value="UKEY" />
                <el-option label="SIMKey" value="SIMKEY" />
              </el-select>
            </el-form-item>

            <el-form-item label="序列号" prop="serialNumber">
              <el-input v-model="singleForm.serialNumber" placeholder="请输入设备序列号" />
            </el-form-item>

            <el-form-item label="制造商" prop="manufacturer">
              <el-input v-model="singleForm.manufacturer" placeholder="如: 飞天诚信" />
            </el-form-item>

            <el-form-item label="型号" prop="model">
              <el-input v-model="singleForm.model" placeholder="如: FT-A22" />
            </el-form-item>

            <el-form-item label="硬件版本">
              <el-input v-model="singleForm.hardwareVersion" placeholder="如: 1.0" />
            </el-form-item>

            <el-form-item label="固件版本">
              <el-input v-model="singleForm.firmwareVersion" placeholder="如: 2.1.0" />
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="handleSingleSubmit" :loading="submitting">
                <el-icon><Check /></el-icon>
                注册设备
              </el-button>
              <el-button @click="handleReset">重置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 批量注册 -->
        <el-tab-pane label="批量注册" name="batch">
          <div class="batch-register">
            <el-alert
              title="批量注册说明"
              type="info"
              :closable="false"
              style="margin-bottom: 20px"
            >
              <template #default>
                <p>1. 下载模板文件，按照格式填写设备信息</p>
                <p>2. 支持Excel(.xlsx)或CSV(.csv)格式</p>
                <p>3. 每次最多导入1000个设备</p>
              </template>
            </el-alert>

            <div class="actions">
              <el-button type="success" @click="handleDownloadTemplate">
                <el-icon><Download /></el-icon>
                下载模板
              </el-button>
              <el-upload
                ref="uploadRef"
                action="#"
                :auto-upload="false"
                :on-change="handleFileChange"
                :limit="1"
                accept=".xlsx,.xls,.csv"
                :show-file-list="false"
              >
                <el-button type="primary">
                  <el-icon><Upload /></el-icon>
                  选择文件
                </el-button>
              </el-upload>
            </div>

            <div v-if="uploadFile" class="file-info">
              <el-tag type="success" closable @close="handleRemoveFile">
                {{ uploadFile.name }}
              </el-tag>
              <span class="file-size">{{ formatFileSize(uploadFile.size) }}</span>
            </div>

            <!-- 手动添加 -->
            <el-divider>或手动添加</el-divider>

            <el-button type="primary" plain @click="handleAddDevice">
              <el-icon><Plus /></el-icon>
              添加设备
            </el-button>

            <el-table :data="batchDevices" style="margin-top: 20px" max-height="400">
              <el-table-column type="index" label="#" width="50" />
              <el-table-column label="设备类型" width="120">
                <template #default="{ row, $index }">
                  <el-select v-model="row.deviceType" size="small">
                    <el-option label="U盾" value="UKEY" />
                    <el-option label="SIMKey" value="SIMKEY" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="序列号" width="180">
                <template #default="{ row }">
                  <el-input v-model="row.serialNumber" size="small" placeholder="必填" />
                </template>
              </el-table-column>
              <el-table-column label="制造商" width="150">
                <template #default="{ row }">
                  <el-input v-model="row.manufacturer" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="型号" width="120">
                <template #default="{ row }">
                  <el-input v-model="row.model" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="硬件版本" width="100">
                <template #default="{ row }">
                  <el-input v-model="row.hardwareVersion" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="固件版本" width="100">
                <template #default="{ row }">
                  <el-input v-model="row.firmwareVersion" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ $index }">
                  <el-button
                    link
                    type="danger"
                    size="small"
                    @click="handleRemoveDevice($index)"
                  >
                    删除
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <div style="margin-top: 20px">
              <el-button
                type="primary"
                @click="handleBatchSubmit"
                :loading="submitting"
                :disabled="batchDevices.length === 0 && !uploadFile"
              >
                <el-icon><Check /></el-icon>
                批量注册 ({{ batchDevices.length }}个)
              </el-button>
              <el-button @click="handleClearBatch">清空</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 注册结果对话框 -->
    <el-dialog v-model="resultDialogVisible" title="注册结果" width="500px">
      <el-result
        :icon="registerResult.success ? 'success' : 'warning'"
        :title="registerResult.success ? '注册成功' : '注册完成'"
        :sub-title="getResultSubtitle()"
      >
        <template #extra>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="成功">
              <el-tag type="success">{{ registerResult.registered }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="失败">
              <el-tag type="danger">{{ registerResult.failed }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="总计" :span="2">
              {{ registerResult.total }}
            </el-descriptions-item>
          </el-descriptions>
        </template>
      </el-result>
      <template #footer>
        <el-button type="primary" @click="handleViewDevices">查看设备</el-button>
        <el-button @click="resultDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const activeTab = ref('single')
const submitting = ref(false)
const singleFormRef = ref()
const uploadRef = ref()
const uploadFile = ref(null)
const resultDialogVisible = ref(false)

const singleForm = reactive({
  deviceType: 'UKEY',
  serialNumber: '',
  manufacturer: '',
  model: '',
  hardwareVersion: '',
  firmwareVersion: ''
})

const batchDevices = ref([])

const registerResult = reactive({
  success: false,
  registered: 0,
  failed: 0,
  total: 0
})

const rules = {
  deviceType: [{ required: true, message: '请选择设备类型', trigger: 'change' }],
  serialNumber: [{ required: true, message: '请输入序列号', trigger: 'blur' }],
  manufacturer: [{ required: true, message: '请输入制造商', trigger: 'blur' }],
  model: [{ required: true, message: '请输入型号', trigger: 'blur' }]
}

const handleSingleSubmit = async () => {
  try {
    await singleFormRef.value.validate()
    submitting.value = true

    const { data } = await axios.post('/api/devices/register', {
      devices: [singleForm]
    })

    Object.assign(registerResult, data.data)
    registerResult.success = data.data.failed === 0
    resultDialogVisible.value = true

    if (registerResult.success) {
      handleReset()
    }
  } catch (error) {
    if (error.response) {
      ElMessage.error(error.response.data.message || '注册失败')
    }
  } finally {
    submitting.value = false
  }
}

const handleReset = () => {
  singleFormRef.value?.resetFields()
}

const handleAddDevice = () => {
  batchDevices.value.push({
    deviceType: 'UKEY',
    serialNumber: '',
    manufacturer: '',
    model: '',
    hardwareVersion: '',
    firmwareVersion: ''
  })
}

const handleRemoveDevice = (index) => {
  batchDevices.value.splice(index, 1)
}

const handleClearBatch = () => {
  batchDevices.value = []
  uploadFile.value = null
}

const handleFileChange = (file) => {
  uploadFile.value = file.raw
  ElMessage.success('文件已选择: ' + file.name)
}

const handleRemoveFile = () => {
  uploadFile.value = null
}

const handleDownloadTemplate = () => {
  // 创建CSV模板
  const template = [
    'deviceType,serialNumber,manufacturer,model,hardwareVersion,firmwareVersion',
    'UKEY,UK20240101001,飞天诚信,FT-A22,1.0,2.1.0',
    'SIMKEY,SK20240101001,中国移动,CM-SIM-01,1.0,1.5.0'
  ].join('\n')

  const blob = new Blob(['\uFEFF' + template], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = '设备注册模板.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

const handleBatchSubmit = async () => {
  if (uploadFile.value) {
    ElMessage.info('文件上传功能开发中，请使用手动添加')
    return
  }

  if (batchDevices.value.length === 0) {
    ElMessage.warning('请至少添加一个设备')
    return
  }

  // 验证必填字段
  const invalidDevices = batchDevices.value.filter(
    (device) => !device.deviceType || !device.serialNumber
  )
  if (invalidDevices.length > 0) {
    ElMessage.warning('请填写所有设备的类型和序列号')
    return
  }

  submitting.value = true
  try {
    const { data } = await axios.post('/api/devices/register', {
      devices: batchDevices.value
    })

    Object.assign(registerResult, data.data)
    registerResult.success = data.data.failed === 0
    resultDialogVisible.value = true

    if (registerResult.success) {
      handleClearBatch()
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '批量注册失败')
  } finally {
    submitting.value = false
  }
}

const handleViewDevices = () => {
  resultDialogVisible.value = false
  router.push('/devices')
}

const getResultSubtitle = () => {
  if (registerResult.failed === 0) {
    return `成功注册${registerResult.registered}个设备`
  }
  return `成功${registerResult.registered}个，失败${registerResult.failed}个`
}

const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
</script>

<style scoped>
.device-register {
  max-width: 1200px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.batch-register {
  padding: 20px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.file-size {
  color: #909399;
  font-size: 12px;
}
</style>
