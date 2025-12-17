<template>
  <el-table
    v-loading="loading"
    :data="posts"
    style="width: 100%"
    stripe
  >
    <el-table-column type="selection" width="55" />
    <el-table-column prop="id" label="ID" width="80" />
    <el-table-column label="标题" min-width="300">
      <template #default="{ row }">
        <div class="title-cell">
          <span class="title-text">{{ row.title }}</span>
          <el-tag v-if="row.reportCount > 0" type="danger" size="small">
            {{ row.reportCount }} 条举报
          </el-tag>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="作者" width="150">
      <template #default="{ row }">
        <div class="author-cell">
          <el-avatar :size="32" :src="row.author.avatar" />
          <span>{{ row.author.nickname }}</span>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="分类" width="100">
      <template #default="{ row }">
        <el-tag size="small">{{ row.category.name }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="统计" width="200">
      <template #default="{ row }">
        <div class="stats-cell">
          <span>{{ row.viewsCount }} 浏览</span>
          <span>{{ row.repliesCount }} 回复</span>
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
    <el-table-column label="发布时间" width="180">
      <template #default="{ row }">
        {{ formatDate(row.createdAt) }}
      </template>
    </el-table-column>
    <el-table-column label="操作" width="240" fixed="right">
      <template #default="{ row }">
        <el-button
          size="small"
          text
          type="primary"
          @click="$emit('view', row)"
        >
          查看
        </el-button>
        <el-button
          v-if="showReviewActions && row.status === 'PENDING'"
          size="small"
          text
          type="success"
          @click="$emit('approve', row)"
        >
          通过
        </el-button>
        <el-button
          v-if="showReviewActions && row.status === 'PENDING'"
          size="small"
          text
          type="danger"
          @click="$emit('reject', row)"
        >
          拒绝
        </el-button>
        <el-button
          v-if="!showRestore && row.status !== 'DELETED'"
          size="small"
          text
          type="danger"
          @click="$emit('delete', row)"
        >
          删除
        </el-button>
        <el-button
          v-if="showRestore"
          size="small"
          text
          type="success"
          @click="$emit('restore', row)"
        >
          恢复
        </el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup>
import dayjs from 'dayjs'

defineProps({
  posts: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  showReviewActions: {
    type: Boolean,
    default: false
  },
  showReportInfo: {
    type: Boolean,
    default: false
  },
  showRestore: {
    type: Boolean,
    default: false
  }
})

defineEmits(['approve', 'reject', 'delete', 'restore', 'view'])

const getStatusType = (status) => {
  const types = {
    ACTIVE: 'success',
    PENDING: 'warning',
    DELETED: 'info',
    REJECTED: 'danger'
  }
  return types[status] || 'info'
}

const getStatusLabel = (status) => {
  const labels = {
    ACTIVE: '正常',
    PENDING: '待审核',
    DELETED: '已删除',
    REJECTED: '已拒绝'
  }
  return labels[status] || status
}

const formatDate = (date) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}
</script>

<style scoped lang="scss">
.title-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .title-text {
    font-size: 14px;
    color: var(--el-text-color-primary);
    font-weight: 500;
  }
}

.author-cell {
  display: flex;
  align-items: center;
  gap: 8px;

  span {
    font-size: 13px;
    color: var(--el-text-color-primary);
  }
}

.stats-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
