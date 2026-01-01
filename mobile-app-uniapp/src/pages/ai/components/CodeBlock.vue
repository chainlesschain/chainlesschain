<template>
  <view class="code-block">
    <!-- 代码块头部 -->
    <view class="code-header">
      <view class="language-badge">
        <text class="language-text">{{ displayLanguage }}</text>
      </view>
      <view class="copy-button" @click="copyCode">
        <text class="copy-icon">{{ copied ? '✓' : '📋' }}</text>
        <text class="copy-text">{{ copied ? '已复制' : '复制' }}</text>
      </view>
    </view>

    <!-- 代码内容 -->
    <scroll-view class="code-content" scroll-x>
      <view class="code-wrapper">
        <!-- 使用highlight.js高亮（如果支持的语言） -->
        <text
          v-if="highlightedCode"
          class="code-text highlighted"
          :class="'language-' + language"
          v-html="highlightedCode"
        ></text>

        <!-- 纯文本显示（不支持的语言） -->
        <text v-else class="code-text">{{ code }}</text>
      </view>
    </scroll-view>
  </view>
</template>

<script>
import hljs from '@/utils/highlight'

export default {
  name: 'CodeBlock',
  props: {
    code: {
      type: String,
      required: true
    },
    language: {
      type: String,
      default: 'plaintext'
    }
  },
  data() {
    return {
      copied: false,
      highlightedCode: '',
      supportedLanguages: ['javascript', 'js', 'python', 'py', 'java', 'html', 'xml', 'css', 'json']
    }
  },
  computed: {
    displayLanguage() {
      const langMap = {
        javascript: 'JavaScript',
        js: 'JavaScript',
        python: 'Python',
        py: 'Python',
        java: 'Java',
        html: 'HTML',
        xml: 'HTML',
        css: 'CSS',
        json: 'JSON',
        typescript: 'TypeScript',
        ts: 'TypeScript',
        plaintext: 'Text'
      }
      return langMap[this.language.toLowerCase()] || this.language.toUpperCase()
    }
  },
  mounted() {
    this.highlightCode()
  },
  watch: {
    code() {
      this.highlightCode()
    },
    language() {
      this.highlightCode()
    }
  },
  methods: {
    /**
     * 代码高亮处理
     */
    highlightCode() {
      const lang = this.language.toLowerCase()

      // 检查是否为支持的语言
      if (!this.supportedLanguages.includes(lang) || !hljs) {
        this.highlightedCode = ''
        return
      }

      try {
        // 语言别名映射
        const langAliases = {
          'js': 'javascript',
          'py': 'python',
          'xml': 'html',
          'ts': 'typescript'
        }

        const targetLang = langAliases[lang] || lang

        // 使用highlight.js高亮
        const result = hljs.highlight(this.code, {
          language: targetLang,
          ignoreIllegals: true
        })

        this.highlightedCode = result.value
      } catch (error) {
        console.error('代码高亮失败:', error)
        this.highlightedCode = ''
      }
    },

    /**
     * 复制代码到剪贴板
     */
    copyCode() {
      if (this.copied) return

      uni.setClipboardData({
        data: this.code,
        success: () => {
          this.copied = true

          // 2秒后重置复制状态
          setTimeout(() => {
            this.copied = false
          }, 2000)

          uni.showToast({
            title: '代码已复制',
            icon: 'success',
            duration: 1500
          })
        },
        fail: () => {
          uni.showToast({
            title: '复制失败',
            icon: 'none'
          })
        }
      })
    }
  }
}
</script>

<style scoped>
.code-block {
  background: #1e1e1e;
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #3d3d3d;
}

.language-badge {
  background: rgba(102, 126, 234, 0.2);
  padding: 4px 10px;
  border-radius: 4px;
}

.language-text {
  font-size: 12px;
  color: #667eea;
  font-weight: 600;
  text-transform: uppercase;
}

.copy-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.copy-button:active {
  background: rgba(255, 255, 255, 0.15);
}

.copy-icon {
  font-size: 14px;
}

.copy-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
}

.code-content {
  width: 100%;
  max-height: 400px;
  overflow-x: auto;
  overflow-y: auto;
}

.code-wrapper {
  padding: 12px;
  min-width: 100%;
}

.code-text {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #d4d4d4;
  white-space: pre;
  display: block;
  word-wrap: normal;
  word-break: normal;
}

/* highlight.js 样式覆盖（VS Code Dark+ 主题） */
.code-text.highlighted ::v-deep .hljs-keyword {
  color: #569cd6;
}

.code-text.highlighted ::v-deep .hljs-string {
  color: #ce9178;
}

.code-text.highlighted ::v-deep .hljs-number {
  color: #b5cea8;
}

.code-text.highlighted ::v-deep .hljs-comment {
  color: #6a9955;
  font-style: italic;
}

.code-text.highlighted ::v-deep .hljs-function {
  color: #dcdcaa;
}

.code-text.highlighted ::v-deep .hljs-variable {
  color: #9cdcfe;
}

.code-text.highlighted ::v-deep .hljs-class {
  color: #4ec9b0;
}

.code-text.highlighted ::v-deep .hljs-attr {
  color: #9cdcfe;
}

.code-text.highlighted ::v-deep .hljs-tag {
  color: #569cd6;
}

.code-text.highlighted ::v-deep .hljs-name {
  color: #4ec9b0;
}

.code-text.highlighted ::v-deep .hljs-selector-tag {
  color: #d7ba7d;
}

.code-text.highlighted ::v-deep .hljs-selector-class {
  color: #d7ba7d;
}

.code-text.highlighted ::v-deep .hljs-selector-id {
  color: #d7ba7d;
}

.code-text.highlighted ::v-deep .hljs-built_in {
  color: #4ec9b0;
}

.code-text.highlighted ::v-deep .hljs-literal {
  color: #569cd6;
}

.code-text.highlighted ::v-deep .hljs-title {
  color: #dcdcaa;
}

.code-text.highlighted ::v-deep .hljs-params {
  color: #9cdcfe;
}

.code-text.highlighted ::v-deep .hljs-meta {
  color: #9cdcfe;
}

.code-text.highlighted ::v-deep .hljs-regexp {
  color: #d16969;
}
</style>
