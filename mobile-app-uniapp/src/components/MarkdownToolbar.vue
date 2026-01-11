<template>
  <view class="markdown-toolbar">
    <scroll-view class="toolbar-scroll" scroll-x>
      <view class="toolbar-buttons">
        <view
          class="toolbar-btn"
          v-for="tool in tools"
          :key="tool.id"
          @click="handleToolClick(tool)"
        >
          <text class="btn-icon">{{ tool.icon }}</text>
          <text class="btn-label">{{ tool.label }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
export default {
  name: 'MarkdownToolbar',
  data() {
    return {
      tools: [
        { id: 'h1', icon: 'H1', label: '标题1', prefix: '# ', suffix: '' },
        { id: 'h2', icon: 'H2', label: '标题2', prefix: '## ', suffix: '' },
        { id: 'h3', icon: 'H3', label: '标题3', prefix: '### ', suffix: '' },
        { id: 'bold', icon: 'B', label: '粗体', prefix: '**', suffix: '**' },
        { id: 'italic', icon: 'I', label: '斜体', prefix: '*', suffix: '*' },
        { id: 'strikethrough', icon: 'S', label: '删除线', prefix: '~~', suffix: '~~' },
        { id: 'code', icon: '</>', label: '代码', prefix: '`', suffix: '`' },
        { id: 'codeblock', icon: '{ }', label: '代码块', prefix: '```\n', suffix: '\n```' },
        { id: 'quote', icon: '❝', label: '引用', prefix: '> ', suffix: '' },
        { id: 'ul', icon: '•', label: '列表', prefix: '- ', suffix: '' },
        { id: 'ol', icon: '1.', label: '序号', prefix: '1. ', suffix: '' },
        { id: 'checkbox', icon: '☑', label: '任务', prefix: '- [ ] ', suffix: '' },
        { id: 'link', icon: '🔗', label: '链接', prefix: '[', suffix: '](url)' },
        { id: 'image', icon: '🖼', label: '图片', prefix: '![', suffix: '](url)' },
        { id: 'table', icon: '⊞', label: '表格', prefix: '', suffix: '', action: 'insertTable' },
        { id: 'hr', icon: '—', label: '分割线', prefix: '\n---\n', suffix: '' }
      ]
    }
  },
  methods: {
    handleToolClick(tool) {
      if (tool.action === 'insertTable') {
        this.insertTable()
      } else if (tool.id === 'image') {
        this.insertImage()
      } else {
        this.$emit('insert', {
          prefix: tool.prefix,
          suffix: tool.suffix,
          placeholder: tool.label
        })
      }
    },

    insertTable() {
      const tableTemplate = `
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 内容 | 内容 | 内容 |
| 内容 | 内容 | 内容 |
`
      this.$emit('insert', {
        prefix: tableTemplate,
        suffix: '',
        placeholder: ''
      })
    },

    insertImage() {
      // 触发图片上传事件
      this.$emit('upload-image')
    }
  }
}
</script>

<style lang="scss" scoped>
.markdown-toolbar {
  background-color: var(--bg-card);
  border-top: 1rpx solid var(--border-color);
  padding: 16rpx 0;

  .toolbar-scroll {
    white-space: nowrap;

    .toolbar-buttons {
      display: inline-flex;
      gap: 8rpx;
      padding: 0 24rpx;

      .toolbar-btn {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-width: 100rpx;
        padding: 12rpx 16rpx;
        background-color: var(--bg-input);
        border-radius: 12rpx;
        transition: all 0.2s;

        &:active {
          background-color: var(--bg-hover);
          transform: scale(0.95);
        }

        .btn-icon {
          font-size: 16px;
          font-weight: bold;
          color: var(--text-primary);
          margin-bottom: 4rpx;
        }

        .btn-label {
          font-size: 10px;
          color: var(--text-tertiary);
          white-space: nowrap;
        }
      }
    }
  }
}
</style>
