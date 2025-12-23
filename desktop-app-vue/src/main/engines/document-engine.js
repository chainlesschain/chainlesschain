/**
 * 文档处理引擎
 * 负责Word/PDF/Markdown文档的生成和处理
 * 支持3种模板: 商务报告、学术论文、用户手册
 */

const fs = require('fs').promises;
const path = require('path');

class DocumentEngine {
  constructor() {
    // 文档模板定义
    this.templates = {
      business_report: {
        name: '商务报告',
        description: '商务报告模板，适合企业汇报、项目总结',
        sections: ['摘要', '背景', '分析', '结论', '建议'],
      },
      academic_paper: {
        name: '学术论文',
        description: '学术论文模板，符合学术规范',
        sections: ['摘要', '引言', '文献综述', '方法', '结果', '讨论', '结论', '参考文献'],
      },
      user_manual: {
        name: '用户手册',
        description: '用户手册模板，产品说明文档',
        sections: ['简介', '快速开始', '功能说明', '常见问题', '故障排除'],
      },
    };
  }

  /**
   * 生成文档
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateDocument(options = {}) {
    const {
      template = 'business_report',
      title = '文档标题',
      author = '作者',
      date = new Date().toLocaleDateString('zh-CN'),
      format = 'markdown', // markdown | html | pdf
      projectPath,
      content = {},
    } = options;

    if (!projectPath) {
      throw new Error('未指定项目路径');
    }

    console.log(`[Document Engine] 生成${this.templates[template]?.name || template}...`);

    try {
      // 创建项目目录
      await fs.mkdir(projectPath, { recursive: true });

      // 根据格式生成文档
      let documentContent;
      let fileName;

      if (format === 'markdown') {
        documentContent = this.generateMarkdown(template, {
          title,
          author,
          date,
          content,
        });
        fileName = 'document.md';
      } else if (format === 'html') {
        documentContent = this.generateHTML(template, {
          title,
          author,
          date,
          content,
        });
        fileName = 'document.html';
      } else {
        // PDF需要额外的库支持，这里先生成Markdown
        documentContent = this.generateMarkdown(template, {
          title,
          author,
          date,
          content,
        });
        fileName = 'document.md';
      }

      // 写入文档文件
      const filePath = path.join(projectPath, fileName);
      await fs.writeFile(filePath, documentContent, 'utf-8');

      // 生成README
      const readme = this.generateReadme(title, template);
      await fs.writeFile(
        path.join(projectPath, 'README.md'),
        readme,
        'utf-8'
      );

      console.log(`[Document Engine] 文档生成成功: ${filePath}`);

      return {
        success: true,
        projectPath,
        template,
        format,
        fileName,
        filePath,
      };
    } catch (error) {
      console.error('[Document Engine] 生成文档失败:', error);
      throw new Error(`生成文档失败: ${error.message}`);
    }
  }

  /**
   * 生成Markdown格式文档
   * @private
   */
  generateMarkdown(template, options) {
    const { title, author, date, content } = options;
    const templateConfig = this.templates[template];

    let markdown = `# ${title}\n\n`;
    markdown += `**作者**: ${author}\n\n`;
    markdown += `**日期**: ${date}\n\n`;
    markdown += `---\n\n`;

    // 根据模板添加章节
    if (template === 'business_report') {
      markdown += this.generateBusinessReportMarkdown(content);
    } else if (template === 'academic_paper') {
      markdown += this.generateAcademicPaperMarkdown(content);
    } else if (template === 'user_manual') {
      markdown += this.generateUserManualMarkdown(content);
    } else {
      // 默认格式
      for (const section of templateConfig.sections) {
        markdown += `## ${section}\n\n`;
        markdown += `${content[section] || '待填写内容...'}\n\n`;
      }
    }

    return markdown;
  }

  /**
   * 生成商务报告Markdown
   * @private
   */
  generateBusinessReportMarkdown(content) {
    return `## 执行摘要

${content.summary || '本报告总结了...'}

## 项目背景

${content.background || '项目背景介绍...'}

### 目标

- 目标1
- 目标2
- 目标3

## 数据分析

${content.analysis || '基于收集的数据，我们进行了以下分析...'}

### 关键发现

1. 发现1
2. 发现2
3. 发现3

## 结论

${content.conclusion || '基于以上分析，我们得出以下结论...'}

## 建议

${content.recommendations || '我们建议采取以下措施...'}

1. 建议1
2. 建议2
3. 建议3

---

**附录**: 相关数据和图表
`;
  }

  /**
   * 生成学术论文Markdown
   * @private
   */
  generateAcademicPaperMarkdown(content) {
    return `## 摘要

${content.abstract || '本文研究了...'}

**关键词**: ${content.keywords || '关键词1, 关键词2, 关键词3'}

## 1. 引言

${content.introduction || '本研究的背景和目的...'}

### 1.1 研究背景

${content.background || '相关研究背景...'}

### 1.2 研究目的

${content.purpose || '本研究旨在...'}

## 2. 文献综述

${content.literature_review || '现有研究表明...'}

## 3. 研究方法

${content.methodology || '本研究采用...方法'}

### 3.1 数据收集

${content.data_collection || '数据收集方式...'}

### 3.2 分析方法

${content.analysis_method || '分析方法说明...'}

## 4. 研究结果

${content.results || '研究结果如下...'}

## 5. 讨论

${content.discussion || '研究结果的讨论和解释...'}

## 6. 结论

${content.conclusion || '本研究的主要结论...'}

### 6.1 研究贡献

${content.contributions || '本研究的贡献包括...'}

### 6.2 研究局限

${content.limitations || '本研究的局限性...'}

### 6.3 未来研究方向

${content.future_work || '未来可以进一步研究...'}

## 参考文献

${content.references || `1. 作者. (年份). 文献标题. 期刊名称.
2. 作者. (年份). 文献标题. 期刊名称.`}
`;
  }

  /**
   * 生成用户手册Markdown
   * @private
   */
  generateUserManualMarkdown(content) {
    return `## 简介

${content.introduction || '欢迎使用本产品。本手册将帮助您快速上手。'}

### 产品概述

${content.overview || '产品功能概述...'}

### 系统要求

- 操作系统: Windows 10/11, macOS 10.15+
- 内存: 4GB以上
- 硬盘空间: 500MB

## 快速开始

${content.quick_start || '按照以下步骤快速开始使用：'}

### 安装步骤

1. 下载安装包
2. 运行安装程序
3. 按照向导完成安装
4. 启动应用程序

### 首次配置

${content.first_time_setup || '首次使用需要进行以下配置...'}

## 功能说明

${content.features || '本产品提供以下主要功能：'}

### 功能1

详细说明...

### 功能2

详细说明...

### 功能3

详细说明...

## 常见问题

${content.faq || '以下是用户常见问题及解答：'}

**Q: 如何...?**
A: 您可以...

**Q: 为什么...?**
A: 这是因为...

## 故障排除

${content.troubleshooting || '如果遇到问题，请尝试以下解决方案：'}

### 问题1: 无法启动

解决方案: ...

### 问题2: 功能异常

解决方案: ...

## 联系支持

如需帮助，请联系我们的技术支持团队：

- Email: support@example.com
- 电话: 400-xxx-xxxx
- 在线客服: http://support.example.com
`;
  }

  /**
   * 生成HTML格式文档
   * @private
   */
  generateHTML(template, options) {
    const { title, author, date, content } = options;
    const markdownContent = this.generateMarkdown(template, options);

    // 简单的Markdown to HTML转换
    const htmlContent = this.markdownToHTML(markdownContent);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3 {
      color: #2c3e50;
      margin-top: 1.5em;
    }
    h1 {
      border-bottom: 3px solid #3498db;
      padding-bottom: 0.5em;
    }
    h2 {
      border-bottom: 1px solid #bdc3c7;
      padding-bottom: 0.3em;
    }
    code {
      background: #f4f4f4;
      padding: 2px 5px;
      border-radius: 3px;
    }
    pre {
      background: #f4f4f4;
      padding: 1rem;
      border-radius: 5px;
      overflow-x: auto;
    }
    blockquote {
      border-left: 4px solid #3498db;
      padding-left: 1rem;
      margin-left: 0;
      color: #7f8c8d;
    }
    ul, ol {
      margin-left: 1.5rem;
    }
    @media print {
      body {
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
  }

  /**
   * 简单的Markdown转HTML
   * @private
   */
  markdownToHTML(markdown) {
    let html = markdown;

    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 列表
    html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // 段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // 分隔线
    html = html.replace(/^---$/gm, '<hr>');

    return html;
  }

  /**
   * 生成README
   * @private
   */
  generateReadme(title, template) {
    return `# ${title}

## 文档信息

- **模板类型**: ${this.templates[template]?.name || template}
- **创建时间**: ${new Date().toLocaleString('zh-CN')}
- **生成工具**: ChainlessChain Document Engine

## 说明

本文档使用ChainlessChain文档引擎自动生成。

## 编辑文档

可以使用任何Markdown编辑器或文本编辑器编辑 \`document.md\` 文件。

推荐编辑器:
- VS Code
- Typora
- Mark Text

## 转换格式

### 转换为PDF

可以使用以下工具将Markdown转换为PDF:
- Pandoc
- Typora (导出功能)
- VS Code + Markdown PDF插件

### 转换为Word

可以使用Pandoc:
\`\`\`bash
pandoc document.md -o document.docx
\`\`\`
`;
  }

  /**
   * 获取所有模板
   * @returns {Object} 模板列表
   */
  getTemplates() {
    return this.templates;
  }
}

module.exports = DocumentEngine;
