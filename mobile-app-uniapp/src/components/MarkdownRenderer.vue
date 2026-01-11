<template>
  <view class="markdown-renderer">
    <mp-html
      :content="htmlContent"
      :tag-style="tagStyle"
      :show-img-menu="true"
      :preview-img="true"
      :selectable="true"
      @imgtap="handleImageTap"
      @linktap="handleLinkTap"
    />
  </view>
</template>

<script>
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'

export default {
  name: 'MarkdownRenderer',
  props: {
    content: {
      type: String,
      default: ''
    },
    theme: {
      type: String,
      default: 'light' // 'light' or 'dark'
    }
  },
  data() {
    return {
      tagStyle: {
        p: 'margin: 16rpx 0; line-height: 1.8; font-size: 15px;',
        h1: 'font-size: 24px; font-weight: bold; margin: 32rpx 0 20rpx; padding-bottom: 12rpx; border-bottom: 2rpx solid #eee;',
        h2: 'font-size: 22px; font-weight: bold; margin: 28rpx 0 16rpx;',
        h3: 'font-size: 20px; font-weight: bold; margin: 24rpx 0 12rpx;',
        h4: 'font-size: 18px; font-weight: bold; margin: 20rpx 0 12rpx;',
        h5: 'font-size: 16px; font-weight: bold; margin: 16rpx 0 8rpx;',
        h6: 'font-size: 15px; font-weight: bold; margin: 16rpx 0 8rpx;',
        blockquote: 'border-left: 4rpx solid #ddd; padding-left: 20rpx; margin: 16rpx 0; color: #666; font-style: italic;',
        code: 'background-color: #f5f5f5; padding: 4rpx 8rpx; border-radius: 4rpx; font-family: Consolas, Monaco, monospace; font-size: 14px; color: #e83e8c;',
        pre: 'background-color: #f6f8fa; padding: 20rpx; border-radius: 8rpx; overflow-x: auto; margin: 16rpx 0;',
        ul: 'margin: 16rpx 0; padding-left: 40rpx;',
        ol: 'margin: 16rpx 0; padding-left: 40rpx;',
        li: 'margin: 8rpx 0; line-height: 1.6;',
        a: 'color: #1890ff; text-decoration: underline;',
        img: 'max-width: 100%; height: auto; border-radius: 8rpx; margin: 16rpx 0;',
        table: 'border-collapse: collapse; width: 100%; margin: 16rpx 0;',
        th: 'border: 1rpx solid #ddd; padding: 12rpx; background-color: #f5f5f5; font-weight: bold;',
        td: 'border: 1rpx solid #ddd; padding: 12rpx;',
        hr: 'border: none; border-top: 2rpx solid #eee; margin: 24rpx 0;',
        strong: 'font-weight: bold;',
        em: 'font-style: italic;',
        del: 'text-decoration: line-through;'
      }
    }
  },
  computed: {
    htmlContent() {
      if (!this.content) return ''
      return this.markdownToHtml(this.content)
    }
  },
  methods: {
    /**
     * 将Markdown转换为HTML
     */
    markdownToHtml(markdown) {
      let html = markdown

      // 转义HTML特殊字符（除了已经是HTML标签的部分）
      // html = this.escapeHtml(html)

      // 1. 处理代码块（必须最先处理，避免内部内容被其他规则影响）
      html = this.processCodeBlocks(html)

      // 2. 处理标题
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>')
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>')
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>')
      html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>')
      html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>')

      // 3. 处理水平线
      html = html.replace(/^\s*[-*_]{3,}\s*$/gim, '<hr>')

      // 4. 处理引用块
      html = html.replace(/^&gt; (.*$)/gim, '<blockquote>$1</blockquote>')
      html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')

      // 5. 处理列表
      // 无序列表
      html = html.replace(/^\s*[-*+] (.*$)/gim, '<li>$1</li>')
      html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')

      // 有序列表
      html = html.replace(/^\s*\d+\. (.*$)/gim, '<li>$1</li>')

      // 6. 处理粗体和斜体
      html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
      html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
      html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
      html = html.replace(/_(.+?)_/g, '<em>$1</em>')

      // 7. 处理删除线
      html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')

      // 8. 处理行内代码
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

      // 9. 处理链接
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

      // 10. 处理图片
      html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

      // 11. 处理表格
      html = this.processTables(html)

      // 12. 处理段落
      html = html.replace(/\n\n/g, '</p><p>')
      html = '<p>' + html + '</p>'

      // 13. 处理换行
      html = html.replace(/\n/g, '<br>')

      // 14. 清理多余的标签
      html = html.replace(/<p><\/p>/g, '')
      html = html.replace(/<p>(<h[1-6]>)/g, '$1')
      html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1')
      html = html.replace(/<p>(<hr>)<\/p>/g, '$1')
      html = html.replace(/<p>(<ul>)/g, '$1')
      html = html.replace(/(<\/ul>)<\/p>/g, '$1')
      html = html.replace(/<p>(<ol>)/g, '$1')
      html = html.replace(/(<\/ol>)<\/p>/g, '$1')
      html = html.replace(/<p>(<blockquote>)/g, '$1')
      html = html.replace(/(<\/blockquote>)<\/p>/g, '$1')
      html = html.replace(/<p>(<pre>)/g, '$1')
      html = html.replace(/(<\/pre>)<\/p>/g, '$1')

      return html
    },

    /**
     * 处理代码块
     */
    processCodeBlocks(text) {
      // 处理围栏代码块 ```language\ncode\n```
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g

      return text.replace(codeBlockRegex, (match, language, code) => {
        // 如果指定了语言，使用highlight.js高亮
        if (language && hljs.getLanguage(language)) {
          try {
            const highlighted = hljs.highlight(code.trim(), { language }).value
            return `<pre><code class="language-${language}">${highlighted}</code></pre>`
          } catch (e) {
            console.error('代码高亮失败:', e)
          }
        }

        // 否则返回普通代码块
        return `<pre><code>${this.escapeHtml(code.trim())}</code></pre>`
      })
    },

    /**
     * 处理表格
     */
    processTables(text) {
      const lines = text.split('\n')
      let inTable = false
      let tableHtml = ''
      let result = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()

        // 检测表格行（包含 | 符号）
        if (line.includes('|')) {
          if (!inTable) {
            inTable = true
            tableHtml = '<table>'
          }

          // 跳过分隔行（如 |---|---|）
          if (/^\|?[\s-:|]+\|?$/.test(line)) {
            continue
          }

          // 解析表格行
          const cells = line.split('|').filter(cell => cell.trim())
          const isHeader = i === 0 || (i > 0 && /^\|?[\s-:|]+\|?$/.test(lines[i - 1]))

          if (isHeader) {
            tableHtml += '<tr>'
            cells.forEach(cell => {
              tableHtml += `<th>${cell.trim()}</th>`
            })
            tableHtml += '</tr>'
          } else {
            tableHtml += '<tr>'
            cells.forEach(cell => {
              tableHtml += `<td>${cell.trim()}</td>`
            })
            tableHtml += '</tr>'
          }
        } else {
          if (inTable) {
            tableHtml += '</table>'
            result.push(tableHtml)
            tableHtml = ''
            inTable = false
          }
          result.push(line)
        }
      }

      if (inTable) {
        tableHtml += '</table>'
        result.push(tableHtml)
      }

      return result.join('\n')
    },

    /**
     * 转义HTML特殊字符
     */
    escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }
      return text.replace(/[&<>"']/g, m => map[m])
    },

    /**
     * 处理图片点击
     */
    handleImageTap(e) {
      const { src } = e.detail

      // 获取所有图片URL
      const imgRegex = /<img[^>]+src="([^">]+)"/g
      const images = []
      let match

      while ((match = imgRegex.exec(this.htmlContent)) !== null) {
        images.push(match[1])
      }

      // 找到当前图片的索引
      const current = images.indexOf(src)

      // 预览图片
      uni.previewImage({
        urls: images,
        current: current >= 0 ? current : 0
      })
    },

    /**
     * 处理链接点击
     */
    handleLinkTap(e) {
      const { href } = e.detail

      // 如果是内部链接（知识库链接），跳转到对应页面
      if (href.startsWith('/pages/')) {
        uni.navigateTo({
          url: href
        })
        return
      }

      // 如果是外部链接，询问用户是否打开
      uni.showModal({
        title: '打开链接',
        content: `是否在浏览器中打开：\n${href}`,
        success: (res) => {
          if (res.confirm) {
            // #ifdef H5
            window.open(href, '_blank')
            // #endif

            // #ifndef H5
            uni.navigateTo({
              url: `/pages/webview/webview?url=${encodeURIComponent(href)}`
            })
            // #endif
          }
        }
      })
    }
  }
}
</script>

<style lang="scss" scoped>
.markdown-renderer {
  width: 100%;
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-primary);
  word-wrap: break-word;
  overflow-wrap: break-word;

  // 代码块样式增强
  :deep(pre) {
    background-color: #f6f8fa;
    border-radius: 8rpx;
    padding: 24rpx;
    overflow-x: auto;
    margin: 20rpx 0;

    code {
      background-color: transparent;
      padding: 0;
      color: inherit;
      font-size: 13px;
      line-height: 1.6;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    }
  }

  // 行内代码样式
  :deep(code) {
    background-color: rgba(175, 184, 193, 0.2);
    padding: 4rpx 8rpx;
    border-radius: 6rpx;
    font-size: 14px;
    color: #e83e8c;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }

  // 引用块样式
  :deep(blockquote) {
    border-left: 4rpx solid #dfe2e5;
    padding-left: 20rpx;
    margin: 20rpx 0;
    color: #6a737d;
    font-style: italic;

    p {
      margin: 8rpx 0;
    }
  }

  // 表格样式
  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 20rpx 0;
    font-size: 14px;
    overflow-x: auto;
    display: block;

    th, td {
      border: 1rpx solid #dfe2e5;
      padding: 12rpx 16rpx;
      text-align: left;
    }

    th {
      background-color: #f6f8fa;
      font-weight: 600;
    }

    tr:nth-child(even) {
      background-color: #f6f8fa;
    }
  }

  // 图片样式
  :deep(img) {
    max-width: 100%;
    height: auto;
    border-radius: 8rpx;
    margin: 20rpx 0;
    display: block;
  }

  // 链接样式
  :deep(a) {
    color: #1890ff;
    text-decoration: none;
    border-bottom: 1rpx solid #1890ff;
    transition: all 0.2s;

    &:active {
      opacity: 0.7;
    }
  }

  // 列表样式
  :deep(ul), :deep(ol) {
    padding-left: 40rpx;
    margin: 16rpx 0;

    li {
      margin: 8rpx 0;
      line-height: 1.8;
    }
  }

  // 水平线样式
  :deep(hr) {
    border: none;
    border-top: 2rpx solid #eaecef;
    margin: 32rpx 0;
  }

  // 标题样式
  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    font-weight: 600;
    line-height: 1.4;
    margin-top: 32rpx;
    margin-bottom: 16rpx;
  }

  :deep(h1) {
    font-size: 24px;
    padding-bottom: 12rpx;
    border-bottom: 2rpx solid #eaecef;
  }

  :deep(h2) {
    font-size: 22px;
  }

  :deep(h3) {
    font-size: 20px;
  }

  :deep(h4) {
    font-size: 18px;
  }

  :deep(h5) {
    font-size: 16px;
  }

  :deep(h6) {
    font-size: 15px;
  }

  // 段落样式
  :deep(p) {
    margin: 16rpx 0;
    line-height: 1.8;
  }

  // 粗体和斜体
  :deep(strong) {
    font-weight: 600;
  }

  :deep(em) {
    font-style: italic;
  }

  // 删除线
  :deep(del) {
    text-decoration: line-through;
    opacity: 0.7;
  }
}

// 暗色主题支持
@media (prefers-color-scheme: dark) {
  .markdown-renderer {
    :deep(pre) {
      background-color: #161b22;
    }

    :deep(code) {
      background-color: rgba(110, 118, 129, 0.4);
    }

    :deep(blockquote) {
      border-left-color: #3b434b;
      color: #8b949e;
    }

    :deep(table) {
      th, td {
        border-color: #3b434b;
      }

      th {
        background-color: #161b22;
      }

      tr:nth-child(even) {
        background-color: #161b22;
      }
    }

    :deep(hr) {
      border-top-color: #3b434b;
    }

    :deep(h1) {
      border-bottom-color: #3b434b;
    }
  }
}
</style>
