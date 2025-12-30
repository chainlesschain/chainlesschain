/**
 * Markdown增强导出插件
 * 提供Markdown美化、导出PDF/HTML等功能
 */

const fs = require('fs');
const path = require('path');

/**
 * Markdown美化
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function markdownBeautify(params) {
  const { markdown, options = {} } = params;
  const { indentSize = 2, lineWidth = 80, addTableOfContents = false } = options;

  console.log('[MarkdownExporter] 美化Markdown文档');

  try {
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'Markdown内容不能为空'
      };
    }

    // 统计信息
    const lines = markdown.split('\n');
    const headings = (markdown.match(/^#{1,6}\s+.+$/gm) || []).length;
    const codeBlocks = (markdown.match(/```/g) || []).length / 2;

    // 简单的美化逻辑
    let beautified = markdown;

    // 1. 统一标题格式 (确保 # 后有空格)
    beautified = beautified.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

    // 2. 确保代码块前后有空行
    beautified = beautified.replace(/([^\n])\n```/g, '$1\n\n```');
    beautified = beautified.replace(/```\n([^\n])/g, '```\n\n$1');

    // 3. 确保列表项格式正确
    beautified = beautified.replace(/^([*-])\s*/gm, '$1 ');

    // 4. 移除多余的空行（最多保留2个连续空行）
    beautified = beautified.replace(/\n{4,}/g, '\n\n\n');

    // 5. 如果需要添加目录
    if (addTableOfContents && headings > 0) {
      const tocResult = await markdownToc({ markdown: beautified });
      if (tocResult.success) {
        beautified = tocResult.toc + '\n\n' + beautified;
      }
    }

    return {
      success: true,
      beautified: beautified,
      stats: {
        lines: beautified.split('\n').length,
        headings: headings,
        codeBlocks: Math.floor(codeBlocks)
      }
    };
  } catch (error) {
    console.error('[MarkdownExporter] 美化失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 生成Markdown目录
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function markdownToc(params) {
  const { markdown, options = {} } = params;
  const { maxDepth = 3, ordered = false } = options;

  console.log('[MarkdownExporter] 生成Markdown目录');

  try {
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'Markdown内容不能为空'
      };
    }

    // 提取标题
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;

    while ((match = headingRegex.exec(markdown)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();

      if (level <= maxDepth) {
        headings.push({ level, text });
      }
    }

    if (headings.length === 0) {
      return {
        success: false,
        error: '文档中没有找到标题'
      };
    }

    // 生成目录
    const tocLines = ['## 目录\n'];
    let counter = ordered ? [0, 0, 0, 0, 0, 0] : null;

    for (const heading of headings) {
      const indent = '  '.repeat(heading.level - 1);
      const anchor = heading.text.toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '');

      let prefix;
      if (ordered) {
        counter[heading.level - 1]++;
        // 重置更深层级的计数器
        for (let i = heading.level; i < counter.length; i++) {
          counter[i] = 0;
        }
        prefix = counter.slice(0, heading.level).filter(n => n > 0).join('.') + '.';
      } else {
        prefix = '-';
      }

      tocLines.push(`${indent}${prefix} [${heading.text}](#${anchor})`);
    }

    const toc = tocLines.join('\n');

    return {
      success: true,
      toc: toc,
      headingCount: headings.length
    };
  } catch (error) {
    console.error('[MarkdownExporter] 生成目录失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 导出为HTML
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function markdownToHtml(params) {
  const { markdown, outputPath, options = {} } = params;
  const { includeCSS = true, theme = 'github', standalone = true } = options;

  console.log('[MarkdownExporter] 导出为HTML');

  try {
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'Markdown内容不能为空'
      };
    }

    // 简单的Markdown到HTML转换（实际应使用marked等库）
    let html = markdown;

    // 转换标题
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 转换粗体和斜体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 转换代码块
    html = html.replace(/```(\w+)?\n([\s\S]+?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // 转换链接
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

    // 转换段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // 如果需要完整的HTML文档
    if (standalone) {
      const css = includeCSS ? `
        <style>
          body { max-width: 800px; margin: 50px auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.6; }
          h1, h2, h3 { margin-top: 24px; margin-bottom: 16px; font-weight: 600; }
          h1 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
          code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-size: 85%; }
          pre { background: #f6f8fa; padding: 16px; overflow: auto; border-radius: 6px; }
          a { color: #0366d6; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      ` : '';

      html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Export</title>
  ${css}
</head>
<body>
  ${html}
</body>
</html>`;
    }

    // 如果提供了输出路径，写入文件
    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputPath, html, 'utf-8');
      console.log(`[MarkdownExporter] HTML已保存到: ${outputPath}`);
    }

    return {
      success: true,
      html: html,
      outputPath: outputPath || null
    };
  } catch (error) {
    console.error('[MarkdownExporter] 导出HTML失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 导出为PDF
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function markdownToPdf(params) {
  const { markdown, outputPath, options = {} } = params;
  const { theme = 'github', pageSize = 'A4' } = options;

  console.log('[MarkdownExporter] 导出为PDF');

  try {
    if (!markdown || markdown.trim().length === 0) {
      return {
        success: false,
        error: 'Markdown内容不能为空'
      };
    }

    // 实际应用中需要使用 puppeteer 或类似工具
    // 这里仅作为示例返回模拟结果
    return {
      success: false,
      error: 'PDF导出功能需要安装 puppeteer 依赖，这是一个示例插件，仅提供框架实现',
      note: '实际使用时需要安装 puppeteer 并实现 HTML to PDF 转换'
    };
  } catch (error) {
    console.error('[MarkdownExporter] 导出PDF失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 插件激活钩子
 */
async function activate(context) {
  console.log('[MarkdownExporter] 插件已激活');

  // 注册工具处理函数
  context.registerTool('markdown_beautify', markdownBeautify);
  context.registerTool('markdown_to_html', markdownToHtml);
  context.registerTool('markdown_to_pdf', markdownToPdf);
  context.registerTool('markdown_toc', markdownToc);

  const config = context.getConfig();
  console.log('[MarkdownExporter] 配置:', config);
}

/**
 * 插件停用钩子
 */
async function deactivate(context) {
  console.log('[MarkdownExporter] 插件已停用');
}

module.exports = {
  activate,
  deactivate
};
