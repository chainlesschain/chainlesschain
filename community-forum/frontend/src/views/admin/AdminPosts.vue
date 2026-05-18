<template>
  <div class="admin-posts">
    <div class="page-header">
      <h1>内容审核</h1>
      <div class="header-actions">
        <el-input
          v-model="searchQuery"
          placeholder="搜索帖子..."
          :prefix-icon="Search"
          clearable
          style="width: 300px"
          @input="handleSearch"
        />
        <el-button :icon="Refresh" @click="loadPosts">刷新</el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-bar">
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#409eff"><Document /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ totalPosts }}</div>
            <div class="stat-label">总帖子数</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#e6a23c"><Clock /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ pendingPosts }}</div>
            <div class="stat-label">待审核</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#f56c6c"><Warning /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ reportedPosts }}</div>
            <div class="stat-label">被举报</div>
          </div>
        </div>
      </el-card>
      <el-card class="stat-item">
        <div class="stat-content">
          <el-icon :size="32" color="#909399"><Delete /></el-icon>
          <div class="stat-info">
            <div class="stat-value">{{ deletedPosts }}</div>
            <div class="stat-label">已删除</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Tab切换 -->
    <el-card class="posts-card">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="全部帖子" name="all">
          <PostsTable
            :posts="filteredPosts"
            :loading="loading"
            @approve="approvePost"
            @reject="rejectPost"
            @delete="deletePost"
            @view="viewPost"
          />
        </el-tab-pane>

        <el-tab-pane name="pending">
          <template #label>
            <el-badge :value="pendingPosts" :max="99">
              <span>待审核</span>
            </el-badge>
          </template>
          <PostsTable
            :posts="pendingPostsList"
            :loading="loading"
            show-review-actions
            @approve="approvePost"
            @reject="rejectPost"
            @view="viewPost"
          />
        </el-tab-pane>

        <el-tab-pane name="reported">
          <template #label>
            <el-badge :value="reportedPosts" :max="99" type="danger">
              <span>被举报</span>
            </el-badge>
          </template>
          <PostsTable
            :posts="reportedPostsList"
            :loading="loading"
            show-report-info
            @approve="approvePost"
            @reject="rejectPost"
            @delete="deletePost"
            @view="viewPost"
          />
        </el-tab-pane>

        <el-tab-pane label="已删除" name="deleted">
          <PostsTable
            :posts="deletedPostsList"
            :loading="loading"
            show-restore
            @restore="restorePost"
            @view="viewPost"
          />
        </el-tab-pane>
      </el-tabs>

      <!-- 分页 -->
      <div class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="loadPosts"
          @size-change="loadPosts"
        />
      </div>
    </el-card>

    <!-- 帖子详情对话框 -->
    <el-dialog
      v-model="showPostDialog"
      title="帖子详情"
      width="800px"
      top="5vh"
    >
      <div v-if="selectedPost" class="post-detail">
        <div class="post-header">
          <h2>{{ selectedPost.title }}</h2>
          <div class="post-meta">
            <el-tag :type="getStatusType(selectedPost.status)">
              {{ getStatusLabel(selectedPost.status) }}
            </el-tag>
            <span>作者: {{ selectedPost.author.nickname }}</span>
            <span>发布时间: {{ formatDate(selectedPost.createdAt) }}</span>
          </div>
        </div>
        <el-divider />
        <div class="post-content" v-html="selectedPost.content"></div>
        <el-divider />
        <div class="post-stats">
          <span><el-icon><View /></el-icon> {{ selectedPost.viewsCount }} 浏览</span>
          <span><el-icon><ChatDotRound /></el-icon> {{ selectedPost.repliesCount }} 回复</span>
          <span><el-icon><Star /></el-icon> {{ selectedPost.likesCount }} 点赞</span>
        </div>
        <div v-if="selectedPost.reports && selectedPost.reports.length > 0" class="post-reports">
          <h4>举报记录</h4>
          <el-table :data="selectedPost.reports" style="width: 100%">
            <el-table-column prop="reason" label="举报原因" />
            <el-table-column prop="reporter" label="举报人" width="120" />
            <el-table-column prop="time" label="举报时间" width="180">
              <template #default="{ row }">
                {{ formatDate(row.time) }}
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showPostDialog = false">关闭</el-button>
          <el-button
            v-if="selectedPost?.status === 'PENDING'"
            type="danger"
            @click="rejectPost(selectedPost)"
          >
            拒绝
          </el-button>
          <el-button
            v-if="selectedPost?.status === 'PENDING'"
            type="success"
            @click="approvePost(selectedPost)"
          >
            通过
          </el-button>
          <el-button
            v-if="selectedPost?.status === 'ACTIVE'"
            type="danger"
            @click="deletePost(selectedPost)"
          >
            删除
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 拒绝原因对话框 -->
    <el-dialog
      v-model="showRejectDialog"
      title="拒绝原因"
      width="500px"
    >
      <el-form :model="rejectForm" label-width="100px">
        <el-form-item label="拒绝原因">
          <el-input
            v-model="rejectForm.reason"
            type="textarea"
            :rows="4"
            placeholder="请输入拒绝原因..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRejectDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmReject">确认拒绝</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, Refresh, Document, Clock, Warning, Delete,
  View, ChatDotRound, Star
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import PostsTable from './components/PostsTable.vue'

const router = useRouter()

const loading = ref(false)
const searchQuery = ref('')
const activeTab = ref('all')
const posts = ref([])
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const showPostDialog = ref(false)
const selectedPost = ref(null)
const showRejectDialog = ref(false)
const rejectForm = reactive({
  reason: ''
})

// 统计数据
const totalPosts = computed(() => posts.value.length)
const pendingPosts = computed(() => posts.value.filter(p => p.status === 'PENDING').length)
const reportedPosts = computed(() => posts.value.filter(p => p.reportCount > 0).length)
const deletedPosts = computed(() => posts.value.filter(p => p.status === 'DELETED').length)

// 过滤帖子
const filteredPosts = computed(() => {
  let filtered = posts.value

  if (searchQuery.value) {
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  }

  return filtered
})

const pendingPostsList = computed(() =>
  filteredPosts.value.filter(p => p.status === 'PENDING')
)

const reportedPostsList = computed(() =>
  filteredPosts.value.filter(p => p.reportCount > 0 && p.status === 'ACTIVE')
)

const deletedPostsList = computed(() =>
  filteredPosts.value.filter(p => p.status === 'DELETED')
)

// 加载帖子列表
const loadPosts = async () => {
  loading.value = true
  try {
    // 这里应该调用API
    // const response = await getPosts(pagination)

    // 模拟数据
    const mockPosts = []
    for (let i = 1; i <= 50; i++) {
      mockPosts.push({
        id: i,
        title: `帖子标题 ${i} - ${i % 3 === 0 ? 'ChainlessChain使用技巧' : 'AI训练经验分享'}`,
        content: `<p>这是帖子内容 ${i}。包含了详细的技术讨论和经验分享...</p>`,
        author: {
          id: i,
          nickname: `用户${i}`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${i}`
        },
        category: {
          id: i % 4 + 1,
          name: ['问答', '讨论', '反馈', '公告'][i % 4],
          slug: ['qa', 'discussion', 'feedback', 'announcement'][i % 4]
        },
        status: i <= 5 ? 'PENDING' : i > 45 ? 'DELETED' : 'ACTIVE',
        reportCount: i % 10 === 0 ? Math.floor(Math.random() * 5) + 1 : 0,
        reports: i % 10 === 0 ? [
          {
            reason: '内容不当',
            reporter: '用户A',
            time: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString()
          }
        ] : [],
        viewsCount: Math.floor(Math.random() * 1000),
        repliesCount: Math.floor(Math.random() * 50),
        likesCount: Math.floor(Math.random() * 100),
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
    posts.value = mockPosts
    pagination.total = mockPosts.length
  } catch (error) {
    ElMessage.error('加载帖子失败')
  } finally {
    loading.value = false
  }
}

// 搜索处理
const handleSearch = () => {
  pagination.page = 1
}

// Tab切换
const handleTabChange = () => {
  pagination.page = 1
}

// 获取状态类型
const getStatusType = (status) => {
  const types = {
    ACTIVE: 'success',
    PENDING: 'warning',
    DELETED: 'info',
    REJECTED: 'danger'
  }
  return types[status] || 'info'
}

// 获取状态标签
const getStatusLabel = (status) => {
  const labels = {
    ACTIVE: '正常',
    PENDING: '待审核',
    DELETED: '已删除',
    REJECTED: '已拒绝'
  }
  return labels[status] || status
}

// 格式化日期
const formatDate = (date) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

// 查看帖子
const viewPost = (post) => {
  selectedPost.value = post
  showPostDialog.value = true
}

// 通过审核
const approvePost = async (post) => {
  try {
    await ElMessageBox.confirm(
      `确定要通过帖子"${post.title}"吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'success'
      }
    )

    // 这里应该调用API
    // await approvePost(post.id)

    post.status = 'ACTIVE'
    showPostDialog.value = false
    ElMessage.success('审核通过')
  } catch (error) {
    // 取消
  }
}

// 拒绝审核
const rejectPost = (post) => {
  selectedPost.value = post
  rejectForm.reason = ''
  showRejectDialog.value = true
}

// 确认拒绝
const confirmReject = async () => {
  if (!rejectForm.reason.trim()) {
    ElMessage.warning('请输入拒绝原因')
    return
  }

  try {
    // 这里应该调用API
    // await rejectPost(selectedPost.value.id, rejectForm)

    selectedPost.value.status = 'REJECTED'
    showRejectDialog.value = false
    showPostDialog.value = false
    ElMessage.success('已拒绝')
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

// 删除帖子
const deletePost = async (post) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除帖子"${post.title}"吗？`,
      '警告',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'error'
      }
    )

    // 这里应该调用API
    // await deletePost(post.id)

    post.status = 'DELETED'
    showPostDialog.value = false
    ElMessage.success('删除成功')
  } catch (error) {
    // 取消
  }
}

// 恢复帖子
const restorePost = async (post) => {
  try {
    await ElMessageBox.confirm(
      `确定要恢复帖子"${post.title}"吗？`,
      '提示',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'success'
      }
    )

    // 这里应该调用API
    // await restorePost(post.id)

    post.status = 'ACTIVE'
    ElMessage.success('恢复成功')
  } catch (error) {
    // 取消
  }
}

onMounted(() => {
  loadPosts()
})
</script>

<style scoped lang="scss">
.admin-posts {
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

.posts-card {
  .pagination {
    display: flex;
    justify-content: center;
    margin-top: 20px;
  }
}

.post-detail {
  .post-header {
    h2 {
      margin: 0 0 12px;
      font-size: 22px;
      color: var(--el-text-color-primary);
    }

    .post-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
      color: var(--el-text-color-secondary);
    }
  }

  .post-content {
    max-height: 400px;
    overflow-y: auto;
    padding: 16px;
    background: var(--el-fill-color-light);
    border-radius: 8px;
  }

  .post-stats {
    display: flex;
    gap: 24px;
    font-size: 14px;
    color: var(--el-text-color-secondary);

    span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }

  .post-reports {
    margin-top: 16px;

    h4 {
      margin: 0 0 12px;
      font-size: 16px;
      color: var(--el-text-color-primary);
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 768px) {
  .admin-posts {
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
}
</style>
