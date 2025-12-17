<template>
  <div class="create-post-page">
    <div class="page-header">
      <h1>发布帖子</h1>
      <p class="subtitle">分享你的想法、提出问题或展示作品</p>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-position="top"
      class="post-form"
    >
      <!-- 标题 -->
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="form.title"
          placeholder="请输入帖子标题（建议10-100字）"
          maxlength="100"
          show-word-limit
          size="large"
        />
      </el-form-item>

      <!-- 分类和标签 -->
      <div class="form-row">
        <el-form-item label="分类" prop="categoryId" class="form-col">
          <el-select
            v-model="form.categoryId"
            placeholder="选择分类"
            size="large"
            style="width: 100%"
          >
            <el-option
              v-for="category in categories"
              :key="category.id"
              :label="category.name"
              :value="category.id"
            >
              <span>{{ category.icon }} {{ category.name }}</span>
              <span style="color: var(--el-text-color-secondary); font-size: 12px">
                - {{ category.description }}
              </span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="标签" prop="tags" class="form-col">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            placeholder="添加标签（最多5个）"
            size="large"
            style="width: 100%"
            :multiple-limit="5"
          >
            <el-option
              v-for="tag in popularTags"
              :key="tag.id"
              :label="tag.name"
              :value="tag.name"
            />
          </el-select>
        </el-form-item>
      </div>

      <!-- 内容编辑器 -->
      <el-form-item label="内容" prop="content">
        <div class="editor-container">
          <el-tabs v-model="activeTab" class="editor-tabs">
            <el-tab-pane label="编辑" name="edit">
              <!-- 工具栏 -->
              <div class="editor-toolbar">
                <el-button-group>
                  <el-button size="small" @click="insertMarkdown('**', '**')">
                    <strong>B</strong>
                  </el-button>
                  <el-button size="small" @click="insertMarkdown('*', '*')">
                    <em>I</em>
                  </el-button>
                  <el-button size="small" @click="insertMarkdown('~~', '~~')">
                    <del>S</del>
                  </el-button>
                </el-button-group>

                <el-button-group style="margin-left: 8px">
                  <el-button size="small" @click="insertMarkdown('# ', '')">H1</el-button>
                  <el-button size="small" @click="insertMarkdown('## ', '')">H2</el-button>
                  <el-button size="small" @click="insertMarkdown('### ', '')">H3</el-button>
                </el-button-group>

                <el-button-group style="margin-left: 8px">
                  <el-button size="small" @click="insertMarkdown('- ', '')">
                    <el-icon><List /></el-icon>
                  </el-button>
                  <el-button size="small" @click="insertMarkdown('1. ', '')">
                    <el-icon><Sort /></el-icon>
                  </el-button>
                  <el-button size="small" @click="insertMarkdown('> ', '')">
                    <el-icon><ChatLineSquare /></el-icon>
                  </el-button>
                </el-button-group>

                <el-button-group style="margin-left: 8px">
                  <el-button size="small" @click="insertMarkdown('[链接文字](', 'url)')">
                    <el-icon><Link /></el-icon>
                  </el-button>
                  <el-button size="small" @click="insertMarkdown('![图片描述](', 'url)')">
                    <el-icon><Picture /></el-icon>
                  </el-button>
                  <el-button size="small" @click="insertCodeBlock">
                    <el-icon><Tickets /></el-icon>
                  </el-button>
                </el-button-group>

                <el-button
                  size="small"
                  style="margin-left: auto"
                  @click="activeTab = 'preview'"
                >
                  <el-icon><View /></el-icon>
                  预览
                </el-button>
              </div>

              <!-- 文本编辑区 -->
              <el-input
                ref="editorRef"
                v-model="form.content"
                type="textarea"
                :rows="18"
                placeholder="使用 Markdown 语法编写内容...

支持的语法：
# 标题
**粗体** *斜体*
- 列表项
> 引用
[链接](url)
![图片](url)
```代码块```"
                class="editor-textarea"
              />
            </el-tab-pane>

            <el-tab-pane label="预览" name="preview">
              <div class="preview-container">
                <div v-if="form.content" class="markdown-body" v-html="renderedContent"></div>
                <el-empty v-else description="暂无内容" />
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </el-form-item>

      <!-- 提交按钮 -->
      <el-form-item class="form-actions">
        <el-button
          type="primary"
          size="large"
          :loading="submitting"
          @click="handleSubmit"
        >
          {{ submitting ? '发布中...' : '发布帖子' }}
        </el-button>
        <el-button
          size="large"
          :loading="savingDraft"
          @click="handleSaveDraft"
        >
          保存草稿
        </el-button>
        <el-button
          size="large"
          @click="router.push('/')"
        >
          取消
        </el-button>
      </el-form-item>
    </el-form>

    <!-- 提示卡片 -->
    <el-card class="tips-card">
      <template #header>
        <div class="card-header">
          <el-icon><InfoFilled /></el-icon>
          <span>发帖提示</span>
        </div>
      </template>
      <ul class="tips-list">
        <li>标题应简洁明了，准确描述帖子内容</li>
        <li>选择合适的分类，便于其他用户找到你的帖子</li>
        <li>添加相关标签，帮助内容归类</li>
        <li>支持Markdown语法，可以插入代码、图片和链接</li>
        <li>请遵守社区规范，友善交流</li>
      </ul>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import {
  List, Sort, ChatLineSquare, Link, Picture, Tickets, View, InfoFilled
} from '@element-plus/icons-vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const editorRef = ref()
const activeTab = ref('edit')
const submitting = ref(false)
const savingDraft = ref(false)

// 表单数据
const form = reactive({
  title: '',
  categoryId: null,
  tags: [],
  content: ''
})

// 分类列表
const categories = ref([
  { id: 1, name: '问答', slug: 'qa', icon: '❓', description: '提问和回答' },
  { id: 2, name: '讨论', slug: 'discussion', icon: '💬', description: '技术交流' },
  { id: 3, name: '反馈', slug: 'feedback', icon: '📝', description: 'Bug和建议' },
  { id: 4, name: '公告', slug: 'announcement', icon: '📢', description: '官方公告' },
  { id: 5, name: '展示', slug: 'showcase', icon: '🎨', description: '作品展示' }
])

// 热门标签
const popularTags = ref([
  { id: 1, name: 'U盾' },
  { id: 2, name: 'SIMKey' },
  { id: 3, name: 'AI训练' },
  { id: 4, name: '去中心化' },
  { id: 5, name: 'Python' },
  { id: 6, name: 'JavaScript' },
  { id: 7, name: '安装问题' },
  { id: 8, name: '性能优化' },
  { id: 9, name: '教程' },
  { id: 10, name: '最佳实践' }
])

// 表单验证规则
const rules = {
  title: [
    { required: true, message: '请输入帖子标题', trigger: 'blur' },
    { min: 5, max: 100, message: '标题长度应在5-100字之间', trigger: 'blur' }
  ],
  categoryId: [
    { required: true, message: '请选择分类', trigger: 'change' }
  ],
  content: [
    { required: true, message: '请输入帖子内容', trigger: 'blur' },
    { min: 10, message: '内容至少需要10个字符', trigger: 'blur' }
  ]
}

// Markdown渲染器
const md = new MarkdownIt({
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value
      } catch {}
    }
    return ''
  }
})

// 渲染的内容
const renderedContent = computed(() => {
  return form.content ? md.render(form.content) : ''
})

// 插入Markdown语法
const insertMarkdown = (prefix, suffix) => {
  const textarea = editorRef.value?.textarea
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = form.content.substring(start, end) || '文字'

  const before = form.content.substring(0, start)
  const after = form.content.substring(end)

  form.content = before + prefix + selectedText + suffix + after

  // 重新聚焦并设置光标位置
  setTimeout(() => {
    textarea.focus()
    const newCursorPos = start + prefix.length + selectedText.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
  }, 0)
}

// 插入代码块
const insertCodeBlock = () => {
  const textarea = editorRef.value?.textarea
  if (!textarea) return

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = form.content.substring(start, end) || '// 代码'

  const before = form.content.substring(0, start)
  const after = form.content.substring(end)

  form.content = before + '```javascript\n' + selectedText + '\n```\n' + after

  setTimeout(() => {
    textarea.focus()
  }, 0)
}

// 提交帖子
const handleSubmit = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) {
      ElMessage.warning('请完善表单信息')
      return
    }

    submitting.value = true
    try {
      // 这里应该调用API
      // await createPost(form)

      // 模拟延迟
      await new Promise(resolve => setTimeout(resolve, 1500))

      ElMessage.success('发布成功！')
      router.push('/')
    } catch (error) {
      ElMessage.error('发布失败，请重试')
    } finally {
      submitting.value = false
    }
  })
}

// 保存草稿
const handleSaveDraft = async () => {
  savingDraft.value = true
  try {
    // 这里应该调用API
    // await saveDraft(form)

    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 1000))

    ElMessage.success('草稿已保存')
  } catch (error) {
    ElMessage.error('保存失败')
  } finally {
    savingDraft.value = false
  }
}
</script>

<style scoped lang="scss">
.create-post-page {
  max-width: 1000px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 24px;
}

.page-header {
  grid-column: 1 / -1;
  margin-bottom: 8px;

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }

  .subtitle {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }
}

.post-form {
  background: var(--el-bg-color);
  padding: 24px;
  border-radius: 8px;

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;

    .form-col {
      margin-bottom: 0;
    }
  }

  .editor-container {
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
    overflow: hidden;

    .editor-tabs {
      :deep(.el-tabs__header) {
        margin: 0;
        background: var(--el-fill-color-light);
        padding: 0 12px;
      }

      :deep(.el-tabs__content) {
        padding: 0;
      }
    }

    .editor-toolbar {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      background: var(--el-fill-color-lighter);
      border-bottom: 1px solid var(--el-border-color);
      gap: 4px;
      flex-wrap: wrap;
    }

    .editor-textarea {
      :deep(.el-textarea__inner) {
        border: none;
        border-radius: 0;
        box-shadow: none;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.6;
      }
    }

    .preview-container {
      min-height: 500px;
      padding: 16px;
      background: var(--el-bg-color);

      .markdown-body {
        line-height: 1.8;
        font-size: 15px;
        color: var(--el-text-color-regular);

        :deep(h1), :deep(h2), :deep(h3) {
          margin-top: 24px;
          margin-bottom: 16px;
          font-weight: 600;
          line-height: 1.3;
        }

        :deep(h1) { font-size: 24px; }
        :deep(h2) { font-size: 20px; }
        :deep(h3) { font-size: 18px; }

        :deep(p) {
          margin-bottom: 16px;
        }

        :deep(ul), :deep(ol) {
          padding-left: 28px;
          margin-bottom: 16px;
        }

        :deep(li) {
          margin-bottom: 8px;
        }

        :deep(code) {
          padding: 2px 6px;
          background: var(--el-fill-color-light);
          border-radius: 4px;
          font-size: 14px;
          font-family: 'Consolas', 'Monaco', monospace;
        }

        :deep(pre) {
          padding: 16px;
          background: var(--el-fill-color);
          border-radius: 8px;
          overflow-x: auto;
          margin-bottom: 16px;

          code {
            padding: 0;
            background: none;
          }
        }

        :deep(blockquote) {
          padding: 12px 16px;
          margin: 16px 0;
          border-left: 4px solid var(--el-color-primary);
          background: var(--el-fill-color-light);
          color: var(--el-text-color-secondary);
        }

        :deep(img) {
          max-width: 100%;
          border-radius: 4px;
        }

        :deep(a) {
          color: var(--el-color-primary);
          text-decoration: none;

          &:hover {
            text-decoration: underline;
          }
        }
      }
    }
  }

  .form-actions {
    margin-top: 24px;
    margin-bottom: 0;

    :deep(.el-form-item__content) {
      display: flex;
      gap: 12px;
    }
  }
}

.tips-card {
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }

  .tips-list {
    margin: 0;
    padding-left: 20px;

    li {
      margin-bottom: 12px;
      line-height: 1.6;
      color: var(--el-text-color-regular);

      &:last-child {
        margin-bottom: 0;
      }
    }
  }
}

@media (max-width: 1200px) {
  .create-post-page {
    grid-template-columns: 1fr;

    .tips-card {
      order: -1;
    }
  }
}

@media (max-width: 768px) {
  .create-post-page {
    padding: 0;
  }

  .page-header {
    padding: 16px;

    h1 {
      font-size: 22px;
    }
  }

  .post-form {
    border-radius: 0;
    padding: 16px;

    .form-row {
      grid-template-columns: 1fr;

      .form-col {
        margin-bottom: 18px;
      }
    }

    .editor-toolbar {
      .el-button-group {
        margin-left: 0 !important;
        margin-top: 4px;
      }
    }

    .form-actions {
      :deep(.el-form-item__content) {
        flex-direction: column;

        .el-button {
          width: 100%;
        }
      }
    }
  }

  .tips-card {
    border-radius: 0;
  }
}
</style>
