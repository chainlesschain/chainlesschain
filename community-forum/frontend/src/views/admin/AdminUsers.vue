<template>
  <div class="admin-users">
    <div class="page-header">
      <h1>用户管理</h1>
      <div class="header-actions">
        <el-input
          v-model="searchQuery"
          placeholder="搜索用户..."
          :prefix-icon="Search"
          clearable
          style="width: 300px"
          @input="handleSearch"
        />
        <el-button :icon="Refresh" @click="loadUsers">刷新</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-bar">
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#409eff"><User /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ totalUsers }}</div>
            <div class="stat-label">总用户数</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#67c23a"><CircleCheck /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ activeUsers }}</div>
            <div class="stat-label">活跃用户</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#f56c6c"><CircleClose /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ bannedUsers }}</div>
            <div class="stat-label">封禁用户</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#e6a23c"><UserFilled /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ newUsersToday }}</div>
            <div class="stat-label">今日新增</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 用户列表 -->
    <el-card class="users-table-card">
      <template #header>
        <div class="card-header">
          <span>用户列表</span>
          <div class="header-filters">
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 150px">
              <el-option label="全部" value="" />
              <el-option label="正常" value="active" />
              <el-option label="封禁" value="banned" />
              <el-option label="待审核" value="pending" />
            </el-select>
            <el-select v-model="roleFilter" placeholder="角色筛选" clearable style="width: 150px">
              <el-option label="全部" value="" />
              <el-option label="管理员" value="admin" />
              <el-option label="普通用户" value="user" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="filteredUsers"
        style="width: 100%"
        stripe
      >
        <el-table-column type="selection" width="55" />
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="用户" min-width="200">
          <template #default="{ row }">
            <div class="user-cell">
              <el-avatar :size="40" :src="row.avatar" />
              <div class="user-info">
                <div class="user-name">
                  {{ row.nickname }}
                  <el-tag v-if="row.role === 'ADMIN'" size="small" type="danger">管理员</el-tag>
                </div>
                <div class="user-email">{{ row.username }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="认证设备" width="120">
          <template #default="{ row }">
            <el-tag :type="row.deviceType === 'U盾' ? 'success' : 'primary'">
              {{ row.deviceType }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="统计" width="250">
          <template #default="{ row }">
            <div class="user-stats">
              <span>帖子: {{ row.postsCount }}</span>
              <el-divider direction="vertical" />
              <span>回复: {{ row.repliesCount }}</span>
              <el-divider direction="vertical" />
              <span>获赞: {{ row.likesCount }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)">
              {{ getStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              text
              type="primary"
              @click="viewUser(row)"
            >
              查看
            </el-button>
            <el-button
              v-if="row.status === 'ACTIVE'"
              size="small"
              text
              type="warning"
              @click="banUser(row)"
            >
              封禁
            </el-button>
            <el-button
              v-else
              size="small"
              text
              type="success"
              @click="unbanUser(row)"
            >
              解封
            </el-button>
            <el-button
              size="small"
              text
              type="danger"
              @click="deleteUser(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadUsers"
          @size-change="loadUsers"
        />
      </div>
    </el-card>

    <!-- 用户详情对话框 -->
    <el-dialog
      v-model="showUserDialog"
      title="用户详情"
      width="600px"
    >
      <div v-if="selectedUser" class="user-detail">
        <div class="detail-header">
          <el-avatar :size="80" :src="selectedUser.avatar" />
          <div class="detail-info">
            <h3>{{ selectedUser.nickname }}</h3>
            <p>{{ selectedUser.username }}</p>
            <el-tag v-if="selectedUser.role === 'ADMIN'" type="danger">管理员</el-tag>
            <el-tag v-else type="info">普通用户</el-tag>
          </div>
        </div>
        <el-divider />
        <el-descriptions :column="2" border>
          <el-descriptions-item label="用户ID">{{ selectedUser.id }}</el-descriptions-item>
          <el-descriptions-item label="认证设备">{{ selectedUser.deviceType }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(selectedUser.status)">
              {{ getStatusLabel(selectedUser.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatDate(selectedUser.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="发帖数">{{ selectedUser.postsCount }}</el-descriptions-item>
          <el-descriptions-item label="回复数">{{ selectedUser.repliesCount }}</el-descriptions-item>
          <el-descriptions-item label="粉丝数">{{ selectedUser.followersCount }}</el-descriptions-item>
          <el-descriptions-item label="获赞数">{{ selectedUser.likesCount }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>

    <!-- 封禁对话框 -->
    <el-dialog
      v-model="showBanDialog"
      title="封禁用户"
      width="500px"
    >
      <el-form :model="banForm" label-width="100px">
        <el-form-item label="封禁原因">
          <el-input
            v-model="banForm.reason"
            type="textarea"
            :rows="4"
            placeholder="请输入封禁原因..."
          />
        </el-form-item>
        <el-form-item label="封禁时长">
          <el-select v-model="banForm.duration" style="width: 100%">
            <el-option label="永久" :value="0" />
            <el-option label="1天" :value="1" />
            <el-option label="3天" :value="3" />
            <el-option label="7天" :value="7" />
            <el-option label="30天" :value="30" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showBanDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmBan">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, Refresh, User, CircleCheck, CircleClose, UserFilled
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()

const loading = ref(false)
const searchQuery = ref('')
const statusFilter = ref('')
const roleFilter = ref('')
const users = ref([])
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const showUserDialog = ref(false)
const selectedUser = ref(null)
const showBanDialog = ref(false)
const banForm = reactive({
  reason: '',
  duration: 0
})

// 统计数据
const totalUsers = computed(() => users.value.length)
const activeUsers = computed(() => users.value.filter(u => u.status === 'ACTIVE').length)
const bannedUsers = computed(() => users.value.filter(u => u.status === 'BANNED').length)
const newUsersToday = computed(() => {
  const today = dayjs().startOf('day')
  return users.value.filter(u => dayjs(u.createdAt).isAfter(today)).length
})

// 过滤用户
const filteredUsers = computed(() => {
  let filtered = users.value

  if (searchQuery.value) {
    filtered = filtered.filter(u =>
      u.nickname.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  }

  if (statusFilter.value) {
    filtered = filtered.filter(u => u.status.toLowerCase() === statusFilter.value)
  }

  if (roleFilter.value) {
    filtered = filtered.filter(u => u.role.toLowerCase() === roleFilter.value)
  }

  return filtered
})

// 加载用户列表
const loadUsers = async () => {
  loading.value = true
  try {
    // 这里应该调用API
    // const response = await getUsers(pagination)

    // 模拟数据
    const mockUsers = []
    for (let i = 1; i <= 50; i++) {
      mockUsers.push({
        id: i,
        nickname: `用户${i}`,
        username: `user${i}@chainlesschain.com`,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`,
        role: i <= 3 ? 'ADMIN' : 'USER',
        deviceType: i % 2 === 0 ? 'U盾' : 'SIMKey',
        status: i > 45 ? 'BANNED' : 'ACTIVE',
        postsCount: Math.floor(Math.random() * 50),
        repliesCount: Math.floor(Math.random() * 200),
        likesCount: Math.floor(Math.random() * 500),
        followersCount: Math.floor(Math.random() * 100),
        createdAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    users.value = mockUsers
    pagination.total = mockUsers.length
  } catch (error) {
    ElMessage.error('加载用户失败')
  } finally {
    loading.value = false
  }
}

// 搜索处理
const handleSearch = () => {
  pagination.page = 1
}

// 获取状态类型
const getStatusType = (status) => {
  const types = {
    ACTIVE: 'success',
    BANNED: 'danger',
    PENDING: 'warning'
  }
  return types[status] || 'info'
}

// 获取状态标签
const getStatusLabel = (status) => {
  const labels = {
    ACTIVE: '正常',
    BANNED: '封禁',
    PENDING: '待审核'
  }
  return labels[status] || status
}

// 格式化日期
const formatDate = (date) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 查看用户
const viewUser = (user) => {
  selectedUser.value = user
  showUserDialog.value = true
}

// 封禁用户
const banUser = (user) => {
  selectedUser.value = user
  banForm.reason = ''
  banForm.duration = 0
  showBanDialog.value = true
}

// 确认封禁
const confirmBan = async () => {
  if (!banForm.reason.trim()) {
    ElMessage.warning('请输入封禁原因')
    return
  }

  try {
    // 这里应该调用API
    // await banUser(selectedUser.value.id, banForm)

    selectedUser.value.status = 'BANNED'
    showBanDialog.value = false
    ElMessage.success('封禁成功')
  } catch (error) {
    ElMessage.error('封禁失败')
  }
}

// 解封用户
const unbanUser = async (user) => {
  try {
    await ElMessageBox.confirm(
      `确定要解封用户"${user.nickname}"吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 这里应该调用API
    // await unbanUser(user.id)

    user.status = 'ACTIVE'
    ElMessage.success('解封成功')
  } catch (error) {
    // 取消
  }
}

// 删除用户
const deleteUser = async (user) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除用户"${user.nickname}"吗？此操作不可逆！`,
      '警告',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'error'
      }
    )

    // 这里应该调用API
    // await deleteUser(user.id)

    users.value = users.value.filter(u => u.id !== user.id)
    ElMessage.success('删除成功')
  } catch (error) {
    // 取消
  }
}

onMounted(() => {
  loadUsers()
})
</script>

<style scoped lang="scss">
.admin-users {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }
}

.stats-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;

  .stat-item {
    .stat-content {
      display: flex;
      align-items: center;
      gap: 16px;

      .stat-info {
        .stat-value {
          font-size: 28px;
          font-weight: 700;
          color: var(--el-text-color-primary);
          line-height: 1;
          margin-bottom: 4px;
        }

        .stat-label {
          font-size: 13px;
          color: var(--el-text-color-secondary);
        }
      }
    }
  }
}

.users-table-card {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .header-filters {
      display: flex;
      gap: 12px;
    }
  }

  .user-cell {
    display: flex;
    align-items: center;
    gap: 12px;

    .user-info {
      .user-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 500;
        color: var(--el-text-color-primary);
        margin-bottom: 4px;
      }

      .user-email {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }
  }

  .user-stats {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--el-text-color-secondary);

    span {
      white-space: nowrap;
    }
  }

  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 20px;
  }
}

.user-detail {
  .detail-header {
    display: flex;
    align-items: center;
    gap: 20px;

    .detail-info {
      h3 {
        margin: 0 0 8px;
        font-size: 20px;
        color: var(--el-text-color-primary);
      }

      p {
        margin: 0 0 8px;
        font-size: 14px;
        color: var(--el-text-color-secondary);
      }
    }
  }
}

@media (max-width: 768px) {
  .admin-users {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    h1 {
      font-size: 22px;
    }

    .header-actions {
      width: 100%;
      flex-direction: column;
    }
  }

  .stats-bar {
    grid-template-columns: 1fr;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 12px;

    .header-filters {
      width: 100%;
      flex-direction: column;
    }
  }
}
</style>
