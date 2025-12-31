<template>
  <div class="version-diff">
    <!-- 对比头部 -->
    <div class="diff-header">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-card size="small">
            <template #title>
              <span class="version-title">
                当前版本 (v{{ currentVersion.version }})
              </span>
            </template>
            <div class="version-meta">
              <div class="meta-item">
                <UserOutlined />
                {{ getUserName(currentVersion.updated_by) }}
              </div>
              <div class="meta-item">
                <ClockCircleOutlined />
                {{ formatDate(currentVersion.updated_at) }}
              </div>
            </div>
          </a-card>
        </a-col>
        <a-col :span="12">
          <a-card size="small">
            <template #title>
              <span class="version-title">
                目标版本 (v{{ targetVersion.version }})
              </span>
            </template>
            <div class="version-meta">
              <div class="meta-item">
                <UserOutlined />
                {{ getUserName(targetVersion.updated_by) }}
              </div>
              <div class="meta-item">
                <ClockCircleOutlined />
                {{ formatDate(targetVersion.updated_at) }}
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 对比统计 -->
    <a-alert
      :message="getDiffSummary()"
      type="info"
      show-icon
      style="margin: 16px 0"
    >
      <template #icon>
        <InfoCircleOutlined />
      </template>
    </a-alert>

    <!-- 对比模式切换 -->
    <a-radio-group v-model:value="diffMode" button-style="solid" style="margin-bottom: 16px">
      <a-radio-button value="split">分屏对比</a-radio-button>
      <a-radio-button value="unified">统一对比</a-radio-button>
      <a-radio-button value="inline">行内对比</a-radio-button>
    </a-radio-group>

    <!-- 对比内容 -->
    <div class="diff-content">
      <!-- 分屏模式 -->
      <div v-if="diffMode === 'split'" class="split-view">
        <a-row :gutter="16">
          <a-col :span="12">
            <div class="diff-pane">
              <h4>当前版本内容</h4>
              <pre class="content-text">{{ currentVersion.content }}</pre>
            </div>
          </a-col>
          <a-col :span="12">
            <div class="diff-pane">
              <h4>目标版本内容</h4>
              <pre class="content-text">{{ targetVersion.content }}</pre>
            </div>
          </a-col>
        </a-row>
      </div>

      <!-- 统一模式 -->
      <div v-else-if="diffMode === 'unified'" class="unified-view">
        <div v-for="(change, index) in diffChanges" :key="index" class="diff-line">
          <div
            :class="['line-content', `line-${change.type}`]"
            v-html="change.content"
          />
        </div>
      </div>

      <!-- 行内模式 -->
      <div v-else class="inline-view">
        <div v-for="(line, index) in inlineDiff" :key="index" class="inline-line">
          <span class="line-number">{{ index + 1 }}</span>
          <span
            :class="['line-text', line.changed ? 'line-changed' : '']"
            v-html="line.content"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  UserOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined
} from '@ant-design/icons-vue';

// ==================== Props ====================
const props = defineProps({
  currentVersion: {
    type: Object,
    required: true
  },
  targetVersion: {
    type: Object,
    required: true
  }
});

// ==================== State ====================
const diffMode = ref('split');

// ==================== Computed ====================

/**
 * 计算差异变更
 */
const diffChanges = computed(() => {
  const current = props.currentVersion.content || '';
  const target = props.targetVersion.content || '';

  // 简单的逐行对比（生产环境应使用 diff 库如 diff-match-patch）
  const currentLines = current.split('\n');
  const targetLines = target.split('\n');

  const changes = [];
  const maxLines = Math.max(currentLines.length, targetLines.length);

  for (let i = 0; i < maxLines; i++) {
    const currentLine = currentLines[i] || '';
    const targetLine = targetLines[i] || '';

    if (currentLine === targetLine) {
      changes.push({
        type: 'unchanged',
        content: escapeHtml(currentLine)
      });
    } else {
      if (currentLine && !targetLine) {
        changes.push({
          type: 'deleted',
          content: `<span class="deleted-text">- ${escapeHtml(currentLine)}</span>`
        });
      } else if (!currentLine && targetLine) {
        changes.push({
          type: 'added',
          content: `<span class="added-text">+ ${escapeHtml(targetLine)}</span>`
        });
      } else {
        changes.push({
          type: 'modified',
          content: `
            <span class="deleted-text">- ${escapeHtml(currentLine)}</span><br>
            <span class="added-text">+ ${escapeHtml(targetLine)}</span>
          `
        });
      }
    }
  }

  return changes;
});

/**
 * 行内差异
 */
const inlineDiff = computed(() => {
  const current = props.currentVersion.content || '';
  const target = props.targetVersion.content || '';

  const currentLines = current.split('\n');
  const targetLines = target.split('\n');

  return currentLines.map((line, index) => ({
    content: escapeHtml(line),
    changed: line !== (targetLines[index] || '')
  }));
});

// ==================== Methods ====================

/**
 * 获取差异摘要
 */
function getDiffSummary() {
  const current = props.currentVersion.content || '';
  const target = props.targetVersion.content || '';

  const currentLines = current.split('\n').length;
  const targetLines = target.split('\n').length;

  const addedLines = Math.max(0, targetLines - currentLines);
  const deletedLines = Math.max(0, currentLines - targetLines);

  if (addedLines === 0 && deletedLines === 0) {
    return '两个版本的行数相同，可能存在内容修改';
  }

  const parts = [];
  if (addedLines > 0) parts.push(`+${addedLines} 行`);
  if (deletedLines > 0) parts.push(`-${deletedLines} 行`);

  return `差异统计：${parts.join(', ')}`;
}

/**
 * 获取用户名
 */
function getUserName(did) {
  if (!did) return '未知';
  if (did.length > 20) {
    return `${did.slice(0, 10)}...${did.slice(-6)}`;
  }
  return did;
}

/**
 * 格式化日期
 */
function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
</script>

<style scoped lang="less">
.version-diff {
  .diff-header {
    .version-title {
      font-weight: 600;
      font-size: 15px;
    }

    .version-meta {
      .meta-item {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        color: #666;
        font-size: 13px;

        :deep(.anticon) {
          color: #999;
        }

        &:last-child {
          margin-bottom: 0;
        }
      }
    }
  }

  .diff-content {
    margin-top: 16px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    max-height: 500px;
    overflow-y: auto;

    .split-view {
      padding: 16px;

      .diff-pane {
        h4 {
          margin: 0 0 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f0f0f0;
          font-size: 14px;
          font-weight: 600;
        }

        .content-text {
          margin: 0;
          padding: 12px;
          background-color: #f5f5f5;
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 400px;
          overflow-y: auto;
        }
      }
    }

    .unified-view {
      padding: 8px 0;

      .diff-line {
        padding: 4px 16px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;

        .line-content {
          &.line-unchanged {
            color: #333;
          }

          &.line-added {
            background-color: #e6ffed;
            color: #24292e;
          }

          &.line-deleted {
            background-color: #ffeef0;
            color: #24292e;
          }

          &.line-modified {
            background-color: #fff8c5;
          }

          :deep(.deleted-text) {
            background-color: #ffebe9;
            color: #d73a49;
            text-decoration: line-through;
          }

          :deep(.added-text) {
            background-color: #acf2bd;
            color: #22863a;
          }
        }
      }
    }

    .inline-view {
      padding: 8px 0;

      .inline-line {
        display: flex;
        padding: 4px 0;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;

        &:hover {
          background-color: #f5f5f5;
        }

        .line-number {
          flex-shrink: 0;
          width: 50px;
          padding: 0 12px;
          text-align: right;
          color: #999;
          user-select: none;
          border-right: 1px solid #e1e4e8;
        }

        .line-text {
          flex: 1;
          padding: 0 16px;
          white-space: pre-wrap;
          word-break: break-word;

          &.line-changed {
            background-color: #fff8c5;
          }
        }
      }
    }
  }
}
</style>
