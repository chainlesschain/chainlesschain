/**
 * 轻量级语法高亮工具
 *
 * 支持的语言：
 * - JavaScript/TypeScript
 * - HTML
 * - CSS/SCSS
 * - JSON
 * - Python
 * - Java
 * - Markdown
 */

class SyntaxHighlighter {
  constructor() {
    // 颜色主题 (One Dark Pro)
    this.colors = {
      keyword: '#c678dd',      // 紫色 - 关键字
      string: '#98c379',       // 绿色 - 字符串
      comment: '#5c6370',      // 灰色 - 注释
      number: '#d19a66',       // 橙色 - 数字
      function: '#61afef',     // 蓝色 - 函数
      className: '#e5c07b',    // 黄色 - 类名
      operator: '#56b6c2',     // 青色 - 操作符
      tag: '#e06c75',          // 红色 - HTML标签
      attribute: '#d19a66',    // 橙色 - 属性
      default: '#abb2bf'       // 默认文本颜色
    }

    // JavaScript/TypeScript 关键字
    this.jsKeywords = [
      'abstract', 'await', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
      'const', 'continue', 'debugger', 'default', 'delete', 'do', 'double', 'else', 'enum',
      'export', 'extends', 'false', 'final', 'finally', 'float', 'for', 'function', 'goto',
      'if', 'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'let', 'long',
      'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
      'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
      'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with', 'yield', 'async',
      'of', 'from', 'as', 'type', 'namespace', 'module', 'declare', 'readonly', 'any',
      'unknown', 'never', 'undefined', 'symbol', 'object', 'string', 'number', 'bigint'
    ]

    // Python 关键字
    this.pythonKeywords = [
      'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
      'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
      'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
      'return', 'try', 'while', 'with', 'yield', 'self', 'cls'
    ]

    // CSS 属性
    this.cssProperties = [
      'color', 'background', 'border', 'margin', 'padding', 'display', 'position', 'width',
      'height', 'font', 'text', 'flex', 'grid', 'align', 'justify', 'transform', 'transition',
      'animation', 'opacity', 'z-index', 'overflow', 'cursor', 'box-shadow', 'border-radius'
    ]
  }

  /**
   * 高亮代码
   */
  highlight(code, language) {
    if (!code) return []

    const lang = this.detectLanguage(language)

    switch (lang) {
      case 'javascript':
      case 'typescript':
      case 'jsx':
      case 'tsx':
        return this.highlightJavaScript(code)
      case 'html':
      case 'vue':
        return this.highlightHTML(code)
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        return this.highlightCSS(code)
      case 'json':
        return this.highlightJSON(code)
      case 'python':
        return this.highlightPython(code)
      case 'java':
        return this.highlightJava(code)
      case 'markdown':
        return this.highlightMarkdown(code)
      default:
        return this.highlightPlainText(code)
    }
  }

  /**
   * 检测语言类型
   */
  detectLanguage(filename) {
    if (!filename) return 'text'

    const ext = filename.split('.').pop().toLowerCase()

    const langMap = {
      js: 'javascript',
      jsx: 'jsx',
      ts: 'typescript',
      tsx: 'tsx',
      vue: 'vue',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      py: 'python',
      java: 'java',
      md: 'markdown',
      txt: 'text'
    }

    return langMap[ext] || 'text'
  }

  /**
   * 高亮 JavaScript/TypeScript
   */
  highlightJavaScript(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []
      let currentPos = 0

      // 注释检测
      const singleLineComment = line.indexOf('//')
      const multiLineComment = line.indexOf('/*')

      if (singleLineComment !== -1) {
        // 单行注释
        if (currentPos < singleLineComment) {
          tokens.push(...this.tokenizeJS(line.substring(currentPos, singleLineComment)))
        }
        tokens.push({
          type: 'comment',
          value: line.substring(singleLineComment),
          color: this.colors.comment
        })
        return tokens
      }

      return this.tokenizeJS(line)
    })
  }

  /**
   * JS 分词
   */
  tokenizeJS(line) {
    const tokens = []

    // 正则表达式匹配
    const regex = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+\.?\d*\b)|(\b(?:function|class|const|let|var|if|else|for|while|return|import|export|from|async|await|new|this|super|extends|implements)\b)|(\b[A-Z][a-zA-Z0-9]*\b)|([+\-*/%=<>!&|^~?:])/g

    let lastIndex = 0
    let match

    while ((match = regex.exec(line)) !== null) {
      // 添加中间的普通文本
      if (match.index > lastIndex) {
        tokens.push({
          type: 'text',
          value: line.substring(lastIndex, match.index),
          color: this.colors.default
        })
      }

      // 判断匹配类型
      if (match[1] || match[2]) {
        // 注释
        tokens.push({
          type: 'comment',
          value: match[0],
          color: this.colors.comment
        })
      } else if (match[3]) {
        // 字符串
        tokens.push({
          type: 'string',
          value: match[0],
          color: this.colors.string
        })
      } else if (match[4]) {
        // 数字
        tokens.push({
          type: 'number',
          value: match[0],
          color: this.colors.number
        })
      } else if (match[5]) {
        // 关键字
        tokens.push({
          type: 'keyword',
          value: match[0],
          color: this.colors.keyword
        })
      } else if (match[6]) {
        // 类名（大写开头）
        tokens.push({
          type: 'class',
          value: match[0],
          color: this.colors.className
        })
      } else if (match[7]) {
        // 操作符
        tokens.push({
          type: 'operator',
          value: match[0],
          color: this.colors.operator
        })
      }

      lastIndex = regex.lastIndex
    }

    // 添加剩余文本
    if (lastIndex < line.length) {
      tokens.push({
        type: 'text',
        value: line.substring(lastIndex),
        color: this.colors.default
      })
    }

    return tokens
  }

  /**
   * 高亮 HTML
   */
  highlightHTML(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []
      const regex = /(<\/?[a-zA-Z][a-zA-Z0-9]*)|(\s[a-zA-Z-]+)=(["'])([^"']*)\3|(>)|(&[a-zA-Z]+;)|(<!--[\s\S]*?-->)/g

      let lastIndex = 0
      let match

      while ((match = regex.exec(line)) !== null) {
        // 添加中间的普通文本
        if (match.index > lastIndex) {
          tokens.push({
            type: 'text',
            value: line.substring(lastIndex, match.index),
            color: this.colors.default
          })
        }

        if (match[0].startsWith('<!--')) {
          // 注释
          tokens.push({
            type: 'comment',
            value: match[0],
            color: this.colors.comment
          })
        } else if (match[1]) {
          // 标签
          tokens.push({
            type: 'tag',
            value: match[0],
            color: this.colors.tag
          })
        } else if (match[2]) {
          // 属性名
          tokens.push({
            type: 'attribute',
            value: match[2],
            color: this.colors.attribute
          })
          tokens.push({
            type: 'operator',
            value: '=',
            color: this.colors.operator
          })
          // 属性值
          tokens.push({
            type: 'string',
            value: match[3] + match[4] + match[3],
            color: this.colors.string
          })
        } else {
          tokens.push({
            type: 'text',
            value: match[0],
            color: this.colors.default
          })
        }

        lastIndex = regex.lastIndex
      }

      // 添加剩余文本
      if (lastIndex < line.length) {
        tokens.push({
          type: 'text',
          value: line.substring(lastIndex),
          color: this.colors.default
        })
      }

      return tokens
    })
  }

  /**
   * 高亮 CSS
   */
  highlightCSS(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []

      // CSS 注释
      if (line.trim().startsWith('/*') || line.includes('*/')) {
        tokens.push({
          type: 'comment',
          value: line,
          color: this.colors.comment
        })
        return tokens
      }

      // 选择器、属性、值的简单匹配
      const regex = /([.#]?[a-zA-Z-]+)(\s*:\s*)([^;]+)(;?)/g
      let match

      if ((match = regex.exec(line)) !== null) {
        tokens.push({
          type: 'attribute',
          value: match[1],
          color: this.colors.attribute
        })
        tokens.push({
          type: 'operator',
          value: match[2],
          color: this.colors.operator
        })
        tokens.push({
          type: 'string',
          value: match[3],
          color: this.colors.string
        })
        if (match[4]) {
          tokens.push({
            type: 'text',
            value: match[4],
            color: this.colors.default
          })
        }
      } else {
        tokens.push({
          type: 'text',
          value: line,
          color: this.colors.default
        })
      }

      return tokens
    })
  }

  /**
   * 高亮 JSON
   */
  highlightJSON(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []
      const regex = /("(?:[^"\\]|\\.)*")(\s*:\s*)?|(\btrue\b|\bfalse\b|\bnull\b)|(\b-?\d+\.?\d*\b)|([{}[\],])/g

      let lastIndex = 0
      let match

      while ((match = regex.exec(line)) !== null) {
        // 添加中间的空白
        if (match.index > lastIndex) {
          tokens.push({
            type: 'text',
            value: line.substring(lastIndex, match.index),
            color: this.colors.default
          })
        }

        if (match[1]) {
          // 字符串（键或值）
          const color = match[2] ? this.colors.attribute : this.colors.string
          tokens.push({
            type: 'string',
            value: match[1],
            color
          })
          if (match[2]) {
            tokens.push({
              type: 'operator',
              value: match[2],
              color: this.colors.operator
            })
          }
        } else if (match[3]) {
          // 布尔值和null
          tokens.push({
            type: 'keyword',
            value: match[3],
            color: this.colors.keyword
          })
        } else if (match[4]) {
          // 数字
          tokens.push({
            type: 'number',
            value: match[4],
            color: this.colors.number
          })
        } else if (match[5]) {
          // 括号和逗号
          tokens.push({
            type: 'operator',
            value: match[5],
            color: this.colors.operator
          })
        }

        lastIndex = regex.lastIndex
      }

      // 添加剩余文本
      if (lastIndex < line.length) {
        tokens.push({
          type: 'text',
          value: line.substring(lastIndex),
          color: this.colors.default
        })
      }

      return tokens
    })
  }

  /**
   * 高亮 Python
   */
  highlightPython(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []

      // Python 注释
      if (line.trim().startsWith('#')) {
        tokens.push({
          type: 'comment',
          value: line,
          color: this.colors.comment
        })
        return tokens
      }

      // 简化的 Python 语法
      const regex = /(#.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|'''[\s\S]*?'''|"""[\s\S]*?""")|(\b\d+\.?\d*\b)|(\b(?:def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|lambda|yield|async|await|pass|break|continue|True|False|None|self|cls)\b)/g

      let lastIndex = 0
      let match

      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          tokens.push({
            type: 'text',
            value: line.substring(lastIndex, match.index),
            color: this.colors.default
          })
        }

        if (match[1]) {
          // 注释
          tokens.push({
            type: 'comment',
            value: match[0],
            color: this.colors.comment
          })
        } else if (match[2]) {
          // 字符串
          tokens.push({
            type: 'string',
            value: match[0],
            color: this.colors.string
          })
        } else if (match[3]) {
          // 数字
          tokens.push({
            type: 'number',
            value: match[0],
            color: this.colors.number
          })
        } else if (match[4]) {
          // 关键字
          tokens.push({
            type: 'keyword',
            value: match[0],
            color: this.colors.keyword
          })
        }

        lastIndex = regex.lastIndex
      }

      if (lastIndex < line.length) {
        tokens.push({
          type: 'text',
          value: line.substring(lastIndex),
          color: this.colors.default
        })
      }

      return tokens
    })
  }

  /**
   * 高亮 Java (与JavaScript类似)
   */
  highlightJava(code) {
    return this.highlightJavaScript(code)
  }

  /**
   * 高亮 Markdown
   */
  highlightMarkdown(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      const tokens = []

      // 标题
      if (line.startsWith('#')) {
        tokens.push({
          type: 'keyword',
          value: line,
          color: this.colors.keyword
        })
        return tokens
      }

      // 代码块
      if (line.startsWith('```')) {
        tokens.push({
          type: 'string',
          value: line,
          color: this.colors.string
        })
        return tokens
      }

      // 列表
      if (/^[\s]*[-*+]\s/.test(line)) {
        tokens.push({
          type: 'operator',
          value: line,
          color: this.colors.operator
        })
        return tokens
      }

      // 默认
      tokens.push({
        type: 'text',
        value: line,
        color: this.colors.default
      })
      return tokens
    })
  }

  /**
   * 纯文本（不高亮）
   */
  highlightPlainText(code) {
    const lines = code.split('\n')
    return lines.map(line => {
      return [{
        type: 'text',
        value: line,
        color: this.colors.default
      }]
    })
  }
}

// 导出单例
export default new SyntaxHighlighter()
