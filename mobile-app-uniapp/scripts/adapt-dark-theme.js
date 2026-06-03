/**
 * 批量适配深色主题
 * 将硬编码的颜色替换为CSS变量
 */
const fs = require('fs')
const path = require('path')

// 颜色映射表
const colorMap = {
  // 背景色
  '#f8f8f8': 'var(--bg-page)',
  '#ffffff': 'var(--bg-card)',
  '#f5f5f5': 'var(--bg-input)',
  '#f0f0f0': 'var(--bg-hover)',

  // 文字色
  '#333333': 'var(--text-primary)',
  '#333': 'var(--text-primary)',
  '#666666': 'var(--text-secondary)',
  '#666': 'var(--text-secondary)',
  '#999999': 'var(--text-tertiary)',
  '#999': 'var(--text-tertiary)',

  // 边框色
  'rgba(0, 0, 0, 0.05)': 'var(--shadow-sm)',
  'rgba(0, 0, 0, 0.06)': 'var(--shadow-sm)',
  'rgba(0, 0, 0, 0.08)': 'var(--shadow-md)',
  'rgba(0, 0, 0, 0.1)': 'var(--shadow-md)',
  'rgba(0, 0, 0, 0.12)': 'var(--shadow-lg)',

  // 主题色保持不变
  '#3cc51f': 'var(--color-primary)',
  '#52c41a': 'var(--color-success)',
  '#fa8c16': 'var(--color-warning)',
  '#ff4d4f': 'var(--color-error)',
  '#1890ff': 'var(--color-info)'
}

// 需要处理的文件模式
const filePatterns = [
  'pages/**/*.vue',
  'components/**/*.vue'
]

/**
 * 替换文件中的颜色
 */
function replaceColorsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8')
    let modified = false

    // 替换颜色
    for (const [oldColor, newColor] of Object.entries(colorMap)) {
      const regex = new RegExp(oldColor.replace(/[()]/g, '\\$&'), 'gi')
      if (regex.test(content)) {
        content = content.replace(regex, newColor)
        modified = true
      }
    }

    // 如果有修改，写回文件
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8')
      console.log(`✓ 已适配: ${filePath}`)
      return true
    }

    return false
  } catch (error) {
    console.error(`✗ 处理失败: ${filePath}`, error.message)
    return false
  }
}

/**
 * 遍历目录查找.vue文件
 */
function walkDirectory(dir, callback) {
  const files = fs.readdirSync(dir)

  files.forEach(file => {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)

    if (stat.isDirectory()) {
      walkDirectory(filePath, callback)
    } else if (file.endsWith('.vue')) {
      callback(filePath)
    }
  })
}

// 主函数
function main() {
  console.log('开始批量适配深色主题...\n')

  const baseDir = path.join(__dirname, '..')
  const pagesDir = path.join(baseDir, 'pages')

  let count = 0
  walkDirectory(pagesDir, (filePath) => {
    if (replaceColorsInFile(filePath)) {
      count++
    }
  })

  console.log(`\n完成！共适配 ${count} 个文件`)
}

main()
