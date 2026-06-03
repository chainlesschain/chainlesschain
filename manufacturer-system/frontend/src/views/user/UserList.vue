<template>
  <div class="user-list">
    <el-card class="search-card">
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="用户名">
          <el-input v-model="searchForm.username" placeholder="用户名" clearable />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="searchForm.role" placeholder="请选择" clearable>
            <el-option label="管理员" value="ADMIN" />
            <el-option label="经销商" value="DISTRIBUTOR" />
            <el-option label="普通用户" value="USER" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="请选择" clearable>
            <el-option label="正常" value="ACTIVE" />
            <el-option label="锁定" value="LOCKED" />
            <el-option label="已删除" value="DELETED" />
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
          <span>用户列表</span>
          <el-button type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon>
            添加用户
          </el-button>
        </div>
      </template>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" label="用户名" width="150" />
        <el-table-column prop="realName" label="真实姓名" width="120" />
        <el-table-column prop="email" label="邮箱" width="200" />
        <el-table-column prop="phone" label="手机号" width="150" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag :type="getRoleType(row.role)">
              {{ getRoleText(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="注册时间" width="180" />
        <el-table-column prop="lastLoginAt" label="最后登录" width="180" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleView(row)">
              详情
            </el-button>
            <el-button link type="warning" size="small" @click="handleEdit(row)">
              编辑
            </el-button>
            <el-button
              v-if="row.status === 'ACTIVE'"
              link
              type="danger"
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

    <!-- 添加/编辑用户对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑用户' : '添加用户'"
      width="600px"
    >
      <el-form :model="userForm" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="userForm.username" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="真实姓名" prop="realName">
          <el-input v-model="userForm.realName" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="userForm.email" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="userForm.phone" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="userForm.role">
            <el-option label="管理员" value="ADMIN" />
            <el-option label="经销商" value="DISTRIBUTOR" />
            <el-option label="普通用户" value="USER" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!isEdit" label="密码" prop="password">
          <el-input v-model="userForm.password" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看详情对话框 -->
    <el-dialog v-model="viewDialogVisible" title="用户详情" width="600px">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="用户ID">
          {{ currentUser.id }}
        </el-descriptions-item>
        <el-descriptions-item label="用户名">
          {{ currentUser.username }}
        </el-descriptions-item>
        <el-descriptions-item label="真实姓名">
          {{ currentUser.realName || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="角色">
          <el-tag :type="getRoleType(currentUser.role)">
            {{ getRoleText(currentUser.role) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="邮箱">
          {{ currentUser.email || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="手机号">
          {{ currentUser.phone || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="getStatusType(currentUser.status)">
            {{ getStatusText(currentUser.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">
          {{ currentUser.createdAt }}
        </el-descriptions-item>
        <el-descriptions-item label="最后登录" :span="2">
          {{ currentUser.lastLoginAt || '从未登录' }}
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="viewDialogVisible = false">关闭</el-button>
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
const dialogVisible = ref(false)
const viewDialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const formRef = ref()

const searchForm = reactive({
  username: '',
  role: '',
  status: '',
  page: 1,
  size: 20
})

const userForm = reactive({
  id: null,
  username: '',
  realName: '',
  email: '',
  phone: '',
  role: 'USER',
  password: ''
})

const currentUser = ref({})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  email: [{ type: 'email', message: '请输入正确的邮箱', trigger: 'blur' }],
  phone: [
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' }
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  password: [{ required: true, min: 6, message: '密码至少6位', trigger: 'blur' }]
}

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
          username: 'admin',
          realName: '系统管理员',
          email: 'admin@chainlesschain.com',
          phone: '13800138000',
          role: 'ADMIN',
          status: 'ACTIVE',
          createdAt: '2024-01-01 10:00:00',
          lastLoginAt: '2024-12-02 09:30:00'
        },
        {
          id: 2,
          username: 'distributor1',
          realName: '张三',
          email: 'zhang@example.com',
          phone: '13900139000',
          role: 'DISTRIBUTOR',
          status: 'ACTIVE',
          createdAt: '2024-01-15 14:20:00',
          lastLoginAt: '2024-12-01 16:45:00'
        },
        {
          id: 3,
          username: 'user1',
          realName: '李四',
          email: 'li@example.com',
          phone: '13700137000',
          role: 'USER',
          status: 'ACTIVE',
          createdAt: '2024-02-01 09:00:00',
          lastLoginAt: '2024-11-30 11:20:00'
        }
      ],
      total: 3
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
    username: '',
    role: '',
    status: '',
    page: 1,
    size: 20
  })
  loadData()
}

const handleAdd = () => {
  isEdit.value = false
  Object.assign(userForm, {
    id: null,
    username: '',
    realName: '',
    email: '',
    phone: '',
    role: 'USER',
    password: ''
  })
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  Object.assign(userForm, {
    id: row.id,
    username: row.username,
    realName: row.realName,
    email: row.email,
    phone: row.phone,
    role: row.role
  })
  dialogVisible.value = true
}

const handleView = (row) => {
  currentUser.value = row
  viewDialogVisible.value = true
}

const handleSubmit = async () => {
  try {
    await formRef.value.validate()
    submitting.value = true

    if (isEdit.value) {
      ElMessage.success('用户信息已更新')
    } else {
      ElMessage.success('用户添加成功')
    }

    dialogVisible.value = false
    loadData()
  } catch (error) {
    console.error('表单验证失败', error)
  } finally {
    submitting.value = false
  }
}

const handleLock = async (row) => {
  try {
    await ElMessageBox.confirm('确定要锁定该用户吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    ElMessage.success('用户已锁定')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('操作失败')
    }
  }
}

const handleUnlock = async (row) => {
  try {
    ElMessage.success('用户已解锁')
    loadData()
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该用户吗？此操作不可恢复！', '警告', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'error'
    })
    ElMessage.success('用户已删除')
    loadData()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败')
    }
  }
}

const getRoleType = (role) => {
  const map = {
    ADMIN: 'danger',
    DISTRIBUTOR: 'warning',
    USER: 'primary'
  }
  return map[role] || 'info'
}

const getRoleText = (role) => {
  const map = {
    ADMIN: '管理员',
    DISTRIBUTOR: '经销商',
    USER: '普通用户'
  }
  return map[role] || role
}

const getStatusType = (status) => {
  const map = {
    ACTIVE: 'success',
    LOCKED: 'warning',
    DELETED: 'danger'
  }
  return map[status] || 'info'
}

const getStatusText = (status) => {
  const map = {
    ACTIVE: '正常',
    LOCKED: '锁定',
    DELETED: '已删除'
  }
  return map[status] || status
}
</script>

<style scoped>
.user-list {
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
