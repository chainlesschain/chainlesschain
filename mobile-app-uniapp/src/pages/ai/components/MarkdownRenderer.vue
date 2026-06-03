<template>
  <view class="markdown-renderer">
    <view v-if="codeBlocks.length === 0" class="markdown-content">
      <mp-html
        :content="htmlContent"
        :selectable="true"
        :tagStyle="tagStyle"
      />
    </view>

    <!-- 包含代码块的渲染（分段处理） -->
    <view v-else class="markdown-with-code">
      <view v-for="(segment, index) in segments" :key="index">
        <!-- 普通Markdown内容 -->
        <view v-if="segment.type === 'text'" class="markdown-content">
          <mp-html
            :content="segment.content"
            :selectable="true"
            :tagStyle="tagStyle"
          />
        </view>

        <!-- 代码块 -->
        <CodeBlock
          v-else-if="segment.type === 'code'"
          :code="segment.code"
          :language="segment.language"
        />
      </view>
    </view>
  </view>
</template>

<script>
import CodeBlock from './CodeBlock.vue'

export default {
  name: 'MarkdownRenderer',
  components: {
    CodeBlock
  },
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      codeBlocks: [],
      segments: [],
      tagStyle: {
        h1: 'font-size: 28px; font-weight: bold; color: #1a1a1a; margin: 16px 0 12px;',
        h2: 'font-size: 24px; font-weight: bold; color: #1a1a1a; margin: 14px 0 10px;',
        h3: 'font-size: 20px; font-weight: 600; color: #333; margin: 12px 0 8px;',
        p: 'font-size: 15px; line-height: 1.6; color: #333; margin: 8px 0;',
        strong: 'font-weight: 600; color: #1a1a1a;',
        em: 'font-style: italic; color: #666;',
        code: 'font-family: Consolas, Monaco, monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 14px; color: #d63384;',
        a: 'color: #667eea; text-decoration: underline;',
        li: 'font-size: 15px; line-height: 1.6; color: #333; margin: 4px 0;',
        ul: 'margin: 8px 0; padding-left: 20px;',
        ol: 'margin: 8px 0; padding-left: 20px;',
        blockquote: 'border-left: 4px solid #667eea; padding-left: 12px; margin: 12px 0; color: #666; font-style: italic;'
      }
    }
  },
  computed: {
    htmlContent() {
      if (!this.content) return ''
      return this.markdownToHtml(this.content)
    }
  },
  watch: {
    content: {
      handler(newVal) {
        if (newVal) {
          this.parseContent()
        }
      },
      immediate: true
    }
  },
  methods: {
    /**
     * 解析内容，提取代码块和普通文本
     */
    parseContent() {
      const content = this.content || ''
      this.codeBlocks = []
      this.segments = []

      // 匹配代码块：```language\n代码\n```
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g
      let lastIndex = 0
      let match

      while ((match = codeBlockRegex.exec(content)) !== null) {
        // 添加代码块前的文本
        if (match.index > lastIndex) {
          const textBefore = content.substring(lastIndex, match.index)
          this.segments.push({
            type: 'text',
            content: this.markdownToHtml(textBefore)
          })
        }

        // 添加代码块
        this.segments.push({
          type: 'code',
          language: match[1] || 'plaintext',
          code: match[2].trim()
        })

        this.codeBlocks.push({
          language: match[1] || 'plaintext',
          code: match[2].trim()
        })

        lastIndex = match.index + match[0].length
      }

      // 添加最后剩余的文本
      if (lastIndex < content.length) {
        const textAfter = content.substring(lastIndex)
        this.segments.push({
          type: 'text',
          content: this.markdownToHtml(textAfter)
        })
      }

      // 如果没有代码块，segments为空，htmlContent会直接渲染
    },

    /**
     * 将Markdown转换为HTML
     */
    markdownToHtml(md) {
      if (!md) return ''

      let html = md

      // 转义HTML特殊字符（除了已处理的标签）
      html = html.replace(/&/g, '&amp;')
                 .replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;')

      // 标题（必须在行首）
      html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
                 .replace(/^## (.*)$/gm, '<h2>$1</h2>')
                 .replace(/^# (.*)$/gm, '<h1>$1</h1>')

      // 粗体和斜体
      html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
                 .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                 .replace(/\*(.+?)\*/g, '<em>$1</em>')

      // 行内代码
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

      // 链接
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

      // 图片（暂时只解析，不特殊处理）
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

      // 无序列表
      html = html.replace(/^[\*\-\+] (.*)$/gm, '<li>$1</li>')
      html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

      // 有序列表
      html = html.replace(/^\d+\. (.*)$/gm, '<li>$1</li>')

      // 引用
      html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')

      // 换行处理
      html = html.replace(/\n\n/g, '</p><p>')
      html = html.replace(/\n/g, '<br/>')

      // 包裹段落
      if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<ol') && !html.startsWith('<blockquote')) {
        html = `<p>${html}</p>`
      }

      return html
    }
  }
}
</script>

<style scoped>
.markdown-renderer {
  width: 100%;
}

.markdown-content {
  font-size: 15px;
  line-height: 1.6;
  color: #333;
}

.markdown-with-code {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* mp-html 全局样式覆盖（如果需要） */
::v-deep .mp-html {
  max-width: 100%;
}

::v-deep .mp-html img {
  max-width: 100%;
  border-radius: 8px;
  margin: 8px 0;
}

::v-deep .mp-html table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

::v-deep .mp-html th,
::v-deep .mp-html td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}

::v-deep .mp-html th {
  background-color: #f5f5f5;
  font-weight: 600;
}
</style>
