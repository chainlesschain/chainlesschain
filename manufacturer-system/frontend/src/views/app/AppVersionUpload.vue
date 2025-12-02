<template>
  <div class="app-version-upload">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>上传APP版本</span>
          <el-button @click="$router.back()">
            <el-icon><ArrowLeft /></el-icon>
            返回
          </el-button>
        </div>
      </template>

      <el-steps :active="currentStep" align-center style="margin-bottom: 40px">
        <el-step title="选择平台" icon="Platform" />
        <el-step title="上传文件" icon="Upload" />
        <el-step title="填写信息" icon="Edit" />
        <el-step title="完成" icon="Check" />
      </el-steps>

      <!-- 步骤1: 选择平台 -->
      <div v-show="currentStep === 0" class="step-content">
        <h3>选择APP类型</h3>
        <el-row :gutter="20" style="margin-top: 30px">
          <el-col :span="8" v-for="platform in platforms" :key="platform.value">
            <el-card
              :class="['platform-card', { active: uploadForm.appType === platform.value }]"
              @click="selectPlatform(platform.value)"
            >
              <div class="platform-content">
                <el-icon :size="60" :color="platform.color">
                  <component :is="platform.icon" />
                </el-icon>
                <h4>{{ platform.label }}</h4>
                <p>{{ platform.desc }}</p>
              </div>
            </el-card>
          </el-col>
        </el-row>
        <div class="step-actions">
          <el-button type="primary" @click="nextStep" :disabled="!uploadForm.appType">
            下一步
          </el-button>
        </div>
      </div>

      <!-- 步骤2: 上传文件 -->
      <div v-show="currentStep === 1" class="step-content">
        <h3>上传安装包文件</h3>
        <el-upload
          ref="uploadRef"
          drag
          action="#"
          :auto-upload="false"
          :on-change="handleFileChange"
          :limit="1"
          :accept="getAcceptTypes()"
          :show-file-list="false"
          style="margin-top: 30px"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">
            拖拽文件到此处或 <em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              支持 {{ getAcceptTypes() }} 格式，文件大小不超过 2GB
            </div>
          </template>
        </el-upload>

        <div v-if="uploadedFile" class="file-preview">
          <el-card>
            <div class="file-info">
              <el-icon :size="40" color="#409EFF"><Document /></el-icon>
              <div class="file-details">
                <div class="file-name">{{ uploadedFile.name }}</div>
                <div class="file-meta">
                  大小: {{ formatFileSize(uploadedFile.size) }} |
                  类型: {{ uploadedFile.type || '未知' }}
                </div>
              </div>
              <el-button type="danger" circle @click="removeFile">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </el-card>
        </div>

        <div class="step-actions">
          <el-button @click="prevStep">上一步</el-button>
          <el-button type="primary" @click="nextStep" :disabled="!uploadedFile">
            下一步
          </el-button>
        </div>
      </div>

      <!-- 步骤3: 填写信息 -->
      <div v-show="currentStep === 2" class="step-content">
        <h3>填写版本信息</h3>
        <el-form :model="uploadForm" :rules="formRules" ref="formRef" label-width="120px" style="margin-top: 30px">
          <el-form-item label="版本名称" prop="versionName">
            <el-input v-model="uploadForm.versionName" placeholder="如: 1.0.0" />
          </el-form-item>

          <el-form-item label="版本代码" prop="versionCode">
            <el-input-number v-model="uploadForm.versionCode" :min="1" placeholder="如: 1" />
          </el-form-item>

          <el-form-item label="APP名称" prop="appName">
            <el-input v-model="uploadForm.appName" placeholder="如: ChainlessChain桌面版" />
          </el-form-item>

          <el-form-item label="包名">
            <el-input v-model="uploadForm.packageName" placeholder="如: com.chainlesschain.desktop" />
          </el-form-item>

          <el-form-item label="最低版本">
            <el-input v-model="uploadForm.minSupportedVersion" placeholder="支持的最低版本号" />
          </el-form-item>

          <el-form-item label="强制更新">
            <el-switch v-model="uploadForm.isForceUpdate" />
          </el-form-item>

          <el-form-item label="更新日志" prop="changelog">
            <el-input
              v-model="uploadForm.changelog"
              type="textarea"
              :rows="8"
              placeholder="请输入更新日志(Markdown格式)&#10;如:&#10;## v1.0.0&#10;- 新增功能1&#10;- 修复bug2"
            />
          </el-form-item>

          <el-form-item label="发布说明">
            <el-input
              v-model="uploadForm.releaseNotes"
              type="textarea"
              :rows="4"
              placeholder="发布说明"
            />
          </el-form-item>
        </el-form>

        <div class="step-actions">
          <el-button @click="prevStep">上一步</el-button>
          <el-button type="primary" @click="handleSubmit" :loading="uploading">
            提交上传
          </el-button>
        </div>
      </div>

      <!-- 步骤4: 完成 -->
      <div v-show="currentStep === 3" class="step-content">
        <el-result
          icon="success"
          title="上传成功!"
          sub-title="APP版本已成功上传，现在可以进行测试或发布"
        >
          <template #extra>
            <el-button type="primary" @click="$router.push('/app-versions')">
              查看版本列表
            </el-button>
            <el-button @click="resetForm">继续上传</el-button>
          </template>
        </el-result>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const router = useRouter()
const formRef = ref()
const uploadRef = ref()
const currentStep = ref(0)
const uploading = ref(false)
const uploadedFile = ref(null)

const platforms = [
  {
    value: 'PC_WINDOWS',
    label: 'Windows',
    desc: 'Windows桌面应用',
    icon: 'Monitor',
    color: '#0078D4'
  },
  {
    value: 'PC_MAC',
    label: 'macOS',
    desc: 'Mac桌面应用',
    icon: 'Monitor',
    color: '#000000'
  },
  {
    value: 'PC_LINUX',
    label: 'Linux',
    desc: 'Linux桌面应用',
    icon: 'Monitor',
    color: '#FCC624'
  },
  {
    value: 'MOBILE_ANDROID',
    label: 'Android',
    desc: 'Android移动应用',
    icon: 'Iphone',
    color: '#3DDC84'
  },
  {
    value: 'MOBILE_IOS',
    label: 'iOS',
    desc: 'iOS移动应用',
    icon: 'Iphone',
    color: '#147EFB'
  }
]

const uploadForm = reactive({
  appType: '',
  versionName: '',
  versionCode: 1,
  appName: '',
  packageName: '',
  minSupportedVersion: '',
  isForceUpdate: false,
  changelog: '',
  releaseNotes: ''
})

const formRules = {
  versionName: [{ required: true, message: '请输入版本名称', trigger: 'blur' }],
  versionCode: [{ required: true, message: '请输入版本代码', trigger: 'blur' }],
  appName: [{ required: true, message: '请输入APP名称', trigger: 'blur' }],
  changelog: [{ required: true, message: '请输入更新日志', trigger: 'blur' }]
}

const selectPlatform = (value) => {
  uploadForm.appType = value
}

const nextStep = () => {
  if (currentStep.value < 3) {
    currentStep.value++
  }
}

const prevStep = () => {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

const getAcceptTypes = () => {
  const map = {
    PC_WINDOWS: '.exe,.msi',
    PC_MAC: '.dmg,.pkg',
    PC_LINUX: '.deb,.rpm,.AppImage',
    MOBILE_ANDROID: '.apk',
    MOBILE_IOS: '.ipa'
  }
  return map[uploadForm.appType] || '*'
}

const handleFileChange = (file) => {
  uploadedFile.value = file.raw
  ElMessage.success('文件已选择')
}

const removeFile = () => {
  uploadedFile.value = null
}

const handleSubmit = async () => {
  try {
    await formRef.value.validate()

    if (!uploadedFile.value) {
      ElMessage.warning('请先上传文件')
      return
    }

    uploading.value = true

    // 创建FormData
    const formData = new FormData()
    formData.append('file', uploadedFile.value)
    formData.append('appType', uploadForm.appType)
    formData.append('versionName', uploadForm.versionName)
    formData.append('versionCode', uploadForm.versionCode)
    formData.append('appName', uploadForm.appName)
    formData.append('packageName', uploadForm.packageName || '')
    formData.append('minSupportedVersion', uploadForm.minSupportedVersion || '')
    formData.append('isForceUpdate', uploadForm.isForceUpdate ? '1' : '0')
    formData.append('changelog', uploadForm.changelog)
    formData.append('releaseNotes', uploadForm.releaseNotes || '')

    // 模拟上传
    setTimeout(() => {
      ElMessage.success('上传成功')
      currentStep.value = 3
      uploading.value = false
    }, 2000)

    // 实际API调用
    // await axios.post('/api/app-versions/upload', formData, {
    //   headers: { 'Content-Type': 'multipart/form-data' }
    // })
  } catch (error) {
    uploading.value = false
    if (error.response) {
      ElMessage.error(error.response.data.message || '上传失败')
    }
  }
}

const resetForm = () => {
  currentStep.value = 0
  uploadedFile.value = null
  Object.assign(uploadForm, {
    appType: '',
    versionName: '',
    versionCode: 1,
    appName: '',
    packageName: '',
    minSupportedVersion: '',
    isForceUpdate: false,
    changelog: '',
    releaseNotes: ''
  })
}

const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
</script>

<style scoped>
.app-version-upload {
  max-width: 1000px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.step-content {
  padding: 20px;
}

.step-content h3 {
  text-align: center;
  margin-bottom: 20px;
  color: #303133;
}

.platform-card {
  cursor: pointer;
  transition: all 0.3s;
  margin-bottom: 20px;
}

.platform-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.platform-card.active {
  border-color: #409EFF;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
}

.platform-content {
  text-align: center;
  padding: 20px;
}

.platform-content h4 {
  margin: 15px 0 5px;
  color: #303133;
}

.platform-content p {
  margin: 0;
  font-size: 12px;
  color: #909399;
}

.file-preview {
  margin-top: 30px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 15px;
}

.file-details {
  flex: 1;
}

.file-name {
  font-size: 16px;
  font-weight: bold;
  color: #303133;
  margin-bottom: 5px;
}

.file-meta {
  font-size: 12px;
  color: #909399;
}

.step-actions {
  margin-top: 40px;
  text-align: center;
}

.step-actions .el-button {
  min-width: 120px;
}
</style>
