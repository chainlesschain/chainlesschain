<template>
  <div class="app-version-list">
    <el-card class="search-card">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="APP类型">
          <el-select v-model="searchForm.appType" placeholder="请选择" clearable>
            <el-option label="Windows桌面版" value="PC_WINDOWS" />
            <el-option label="Mac桌面版" value="PC_MAC" />
            <el-option label="Linux桌面版" value="PC_LINUX" />
            <el-option label="Android移动版" value="MOBILE_ANDROID" />
            <el-option label="iOS移动版" value="MOBILE_IOS" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable>
            <el-option label="草稿" value="DRAFT" />
            <el-option label="测试中" value="TESTING" />
            <el-option label="已发布" value="PUBLISHED" />
            <el-option label="已废弃" value="DEPRECATED" />
          </el-select>
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
          <span>APP版本列表</span>
          <el-button type="primary" @click="$router.push('/app-versions/upload')">
            <el-icon><Upload /></el-icon>
            上传新版本
          </el-button>
        </div>
      </template>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="appName" label="APP名称" width="150" />
        <el-table-column prop="appType" label="类型" width="150">
          <template #default="{ row }">
            {{ getAppTypeText(row.appType) }}
          </template>
        </el-table-column>
        <el-table-column prop="versionName" label="版本号" width="100" />
        <el-table-column prop="versionCode" label="版本代码" width="100" />
        <el-table-column prop="fileSize" label="文件大小" width="120">
          <template #default="{ row }">
            {{ formatFileSize(row.fileSize) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="isForceUpdate" label="强制更新" width="100">
          <template #default="{ row }">
            <el-tag :type="row.isForceUpdate ? 'danger' : 'info'">
              {{ row.isForceUpdate ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="downloadCount" label="下载次数" width="100" />
        <el-table-column prop="publishedAt" label="发布时间" width="180" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              详情
            </el-button>
            <el-button
              v-if="row.status === 'DRAFT' || row.status === 'TESTING'"
              link
              type="success"
              size="small"
              @click="handlePublish(row)"
            >
              发布
            </el-button>
            <el-button
              v-if="row.status === 'PUBLISHED'"
              link
              type="warning"
              size="small"
              @click="handleDeprecate(row)"
            >
              废弃
            </el-button>
            <el-button link type="primary" size="small" @click="handleDownload(row)">
              下载
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
  appType: '',
  status: '',
  page: 1,
  size: 20
})

onMounted(() => {
  loadData()
})

const loadData = async () => {
  loading.value = true
  try {
    const { data } = await axios.get('/api/app-versions/list', { params: searchForm })
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
    appType: '',
    status: '',
    page: 1,
    size: 20
  })
  loadData()
}

const handleView = (row) => {
  ElMessageBox.alert(`
    <div style="text-align: left;">
      <p><strong>版本名称:</strong> ${row.versionName}</p>
      <p><strong>包名:</strong> ${row.packageName || '-'}</p>
      <p><strong>文件名:</strong> ${row.fileName}</p>
      <p><strong>文件哈希:</strong> ${row.fileHash || '-'}</p>
      <p><strong>更新日志:</strong></p>
      <pre style="max-height: 300px; overflow: auto;">${row.changelog || '无'}</pre>
    </div>
  `, '版本详情', {
    dangerouslyUseHTMLString: true,
    confirmButtonText: '关闭'
  })
}

const handlePublish = async (row) => {
  try {
    await ElMessageBox.confirm('确定要发布该版本吗?发布后用户即可下载更新', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.post(`/api/app-versions/${row.versionId}/publish`)
    ElMessage.success('版本已发布')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

const handleDeprecate = async (row) => {
  try {
    await ElMessageBox.confirm('确定要废弃该版本吗?', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await axios.post(`/api/app-versions/${row.versionId}/deprecate`)
    ElMessage.success('版本已废弃')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

const handleDownload = (row) => {
  if (row.fileUrl) {
    window.open(row.fileUrl, '_blank')
  } else {
    ElMessage.warning('下载地址不存在')
  }
}

const getAppTypeText = (type) => {
  const map = {
    PC_WINDOWS: 'Windows桌面版',
    PC_MAC: 'Mac桌面版',
    PC_LINUX: 'Linux桌面版',
    MOBILE_ANDROID: 'Android移动版',
    MOBILE_IOS: 'iOS移动版'
  }
  return map[type] || type
}

const getStatusType = (status) => {
  const map = {
    DRAFT: 'info',
    TESTING: 'warning',
    PUBLISHED: 'success',
    DEPRECATED: 'danger'
  }
  return map[status] || 'info'
}

const getStatusText = (status) => {
  const map = {
    DRAFT: '草稿',
    TESTING: '测试中',
    PUBLISHED: '已发布',
    DEPRECATED: '已废弃'
  }
  return map[status] || status
}

const formatFileSize = (bytes) => {
  if (!bytes) return '-'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}
</script>

<style scoped>
.app-version-list {
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
