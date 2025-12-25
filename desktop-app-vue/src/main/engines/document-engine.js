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

  /**
   * 导出为PDF
   * @param {string} markdownPath - Markdown文件路径
   * @param {string} outputPath - 输出PDF路径
   */
  async exportToPDF(markdownPath, outputPath) {
    console.log('[Document Engine] 导出PDF:', markdownPath);

    try {
      // 读取Markdown内容
      const markdownContent = await fs.readFile(markdownPath, 'utf-8');

      // 转换为HTML
      const htmlContent = this.markdownToHTML(markdownContent);

      // 创建完整HTML
      const fullHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.8;
      color: #333;
    }
    h1, h2, h3 { color: #2c3e50; margin-top: 1.5em; }
    h1 { font-size: 2.5em; border-bottom: 3px solid #3498db; padding-bottom: 0.5em; }
    h2 { font-size: 2em; border-bottom: 1px solid #bdc3c7; padding-bottom: 0.3em; }
    h3 { font-size: 1.5em; }
    p { margin: 1em 0; }
    ul, ol { margin-left: 2em; }
    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 1rem; border-radius: 5px; overflow-x: auto; }
    blockquote { border-left: 4px solid #3498db; padding-left: 1rem; margin-left: 0; color: #7f8c8d; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #3498db; color: white; }
    @page { margin: 2cm; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

      // 保存临时HTML文件
      const tempHTMLPath = markdownPath.replace(/\.md$/, '_temp.html');
      await fs.writeFile(tempHTMLPath, fullHTML, 'utf-8');

      // 注意：真正的PDF生成需要puppeteer或类似工具
      // 这里提供两种方案：
      // 方案1: 使用puppeteer（需要安装）
      // 方案2: 提示用户使用浏览器打印或pandoc工具

      console.log('[Document Engine] 提示：完整的PDF导出需要安装puppeteer');
      console.log('[Document Engine] 临时方案：已生成HTML文件，可通过浏览器打印为PDF');

      // 尝试使用puppeteer（如果已安装）
      try {
        const puppeteer = require('puppeteer');
        console.log('[Document Engine] 使用puppeteer生成PDF...');

        const browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        await page.goto(`file://${tempHTMLPath}`, { waitUntil: 'networkidle0' });
        await page.pdf({
          path: outputPath,
          format: 'A4',
          margin: {
            top: '2cm',
            right: '2cm',
            bottom: '2cm',
            left: '2cm'
          },
          printBackground: true
        });
        await browser.close();

        // 删除临时HTML
        await fs.unlink(tempHTMLPath);

        console.log('[Document Engine] PDF生成成功:', outputPath);
        return { success: true, path: outputPath };
      } catch (puppeteerError) {
        console.warn('[Document Engine] puppeteer不可用，已生成HTML文件作为替代');

        // 返回HTML路径作为替代
        return {
          success: true,
          path: tempHTMLPath,
          message: 'PDF导出需要puppeteer库。已生成HTML文件，可通过浏览器打印为PDF。',
          alternative: true
        };
      }
    } catch (error) {
      console.error('[Document Engine] 导出PDF失败:', error);
      throw error;
    }
  }

  /**
   * 导出为Word文档
   * @param {string} markdownPath - Markdown文件路径
   * @param {string} outputPath - 输出Docx路径
   */
  async exportToDocx(markdownPath, outputPath) {
    console.log('[Document Engine] 导出Word文档:', markdownPath);

    try {
      // 注意：完整的Docx导出需要docx库或pandoc
      // 这里提供基本实现

      // 检查是否有pandoc（最佳方案）
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execPromise = promisify(exec);

      try {
        // 尝试使用pandoc
        await execPromise(`pandoc "${markdownPath}" -o "${outputPath}"`);
        console.log('[Document Engine] Word文档生成成功（使用pandoc）');
        return { success: true, path: outputPath, method: 'pandoc' };
      } catch (pandocError) {
        console.warn('[Document Engine] pandoc不可用，尝试使用docx库...');

        // 尝试使用docx库（如果已安装）
        try {
          const docx = require('docx');
          const markdownContent = await fs.readFile(markdownPath, 'utf-8');

          // 简单的Markdown解析和文档创建
          const doc = this.createDocxFromMarkdown(markdownContent, docx);

          const buffer = await docx.Packer.toBuffer(doc);
          await fs.writeFile(outputPath, buffer);

          console.log('[Document Engine] Word文档生成成功（使用docx库）');
          return { success: true, path: outputPath, method: 'docx' };
        } catch (docxError) {
          console.warn('[Document Engine] docx库不可用');

          // 降级方案：生成HTML并提示用户
          const htmlPath = outputPath.replace(/\.docx?$/, '.html');
          const markdownContent = await fs.readFile(markdownPath, 'utf-8');
          const htmlContent = this.markdownToHTML(markdownContent);
          const fullHTML = this.generateHTML('business_report', {
            title: 'Document',
            author: '',
            date: '',
            content: {}
          }).replace(/<body>[\s\S]*<\/body>/, `<body>${htmlContent}</body>`);

          await fs.writeFile(htmlPath, fullHTML, 'utf-8');

          return {
            success: true,
            path: htmlPath,
            message: 'Word导出需要pandoc或docx库。已生成HTML文件，可通过Word打开并另存为。',
            alternative: true
          };
        }
      }
    } catch (error) {
      console.error('[Document Engine] 导出Word文档失败:', error);
      throw error;
    }
  }

  /**
   * 从Markdown创建Docx文档（使用docx库）
   * @private
   */
  createDocxFromMarkdown(markdownContent, docx) {
    const { Document, Paragraph, TextRun, HeadingLevel } = docx;

    const lines = markdownContent.split('\n');
    const paragraphs = [];

    for (const line of lines) {
      if (line.startsWith('# ')) {
        paragraphs.push(
          new Paragraph({
            text: line.substring(2),
            heading: HeadingLevel.HEADING_1
          })
        );
      } else if (line.startsWith('## ')) {
        paragraphs.push(
          new Paragraph({
            text: line.substring(3),
            heading: HeadingLevel.HEADING_2
          })
        );
      } else if (line.startsWith('### ')) {
        paragraphs.push(
          new Paragraph({
            text: line.substring(4),
            heading: HeadingLevel.HEADING_3
          })
        );
      } else if (line.trim()) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(line)]
          })
        );
      } else {
        paragraphs.push(new Paragraph({ text: '' }));
      }
    }

    return new Document({
      sections: [{ children: paragraphs }]
    });
  }

  /**
   * 多格式导出
   * @param {string} sourcePath - 源文件路径
   * @param {string} format - 目标格式（pdf/docx/html/txt）
   * @param {string} outputPath - 输出路径（可选）
   */
  async exportTo(sourcePath, format, outputPath = null) {
    console.log(`[Document Engine] 导出为${format}:`, sourcePath);

    // 确定输出路径
    if (!outputPath) {
      outputPath = sourcePath.replace(/\.[^.]+$/, `.${format}`);
    }

    switch (format.toLowerCase()) {
      case 'pdf':
        return await this.exportToPDF(sourcePath, outputPath);

      case 'docx':
      case 'doc':
        return await this.exportToDocx(sourcePath, outputPath);

      case 'html':
        const markdownContent = await fs.readFile(sourcePath, 'utf-8');
        const htmlContent = this.markdownToHTML(markdownContent);
        const fullHTML = this.generateHTML('business_report', {
          title: 'Document',
          author: '',
          date: '',
          content: {}
        }).replace(/<body>[\s\S]*<\/body>/, `<body>${htmlContent}</body>`);
        await fs.writeFile(outputPath, fullHTML, 'utf-8');
        return { success: true, path: outputPath };

      case 'txt':
        const txtContent = await fs.readFile(sourcePath, 'utf-8');
        // 移除Markdown标记
        const plainText = txtContent
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/\[(.+?)\]\(.+?\)/g, '$1');
        await fs.writeFile(outputPath, plainText, 'utf-8');
        return { success: true, path: outputPath };

      default:
        throw new Error(`不支持的格式: ${format}`);
    }
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   */
  async handleProjectTask(params) {
    let { action, description, outputFiles, projectPath, llmManager } = params;

    console.log(`[Document Engine] 处理任务 - ${action}`);

    // 如果没有提供项目路径，创建临时目录
    if (!projectPath) {
      const { app } = require('electron');
      const userDataPath = app.getPath('userData');
      projectPath = path.join(userDataPath, 'temp', `doc_${Date.now()}`);
      console.log('[Document Engine] 未提供项目路径，使用临时目录:', projectPath);

      // 确保目录存在
      await fs.mkdir(projectPath, { recursive: true });
    }

    try {
      switch (action) {
        case 'create_document':
          return await this.createDocumentFromDescription(description, projectPath, llmManager);

        case 'create_markdown':
          return await this.createMarkdownFromDescription(description, projectPath, llmManager);

        case 'export_pdf':
          return await this.exportDocumentToPDF(projectPath, outputFiles);

        case 'export_docx':
          return await this.exportDocumentToDocx(projectPath, outputFiles);

        case 'export_html':
          return await this.exportDocumentToHTML(projectPath, outputFiles);

        default:
          return await this.createDocumentFromDescription(description, projectPath, llmManager);
      }
    } catch (error) {
      console.error('[Document Engine] 任务执行失败:', error);
      throw error;
    }
  }

  /**
   * 根据描述创建文档（使用LLM）
   */
  async createDocumentFromDescription(description, projectPath, llmManager) {
    console.log('[Document Engine] 使用LLM生成文档');

    const prompt = `请根据以下描述生成一份完整的文档内容（Markdown格式）：

${description}

要求：
1. 包含合适的标题和章节结构
2. 内容详实、逻辑清晰
3. 使用Markdown格式
4. 包含必要的列表、表格等元素`;

    let response;
    try {
      response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 3000
      });
    } catch (llmError) {
      console.warn('[Document Engine] 本地LLM失败，尝试使用后端AI服务:', llmError.message);
      // 降级到后端AI服务
      response = await this.queryBackendAI(prompt, {
        temperature: 0.7
      });
    }

    // 保存为Markdown文件
    const fileName = `document_${Date.now()}.md`;
    const filePath = path.join(projectPath, fileName);
    await fs.writeFile(filePath, response.text, 'utf-8');

    console.log('[Document Engine] 文档生成成功:', filePath);

    return {
      type: 'document',
      path: filePath,
      content: response.text
    };
  }

  /**
   * 查询后端AI服务（降级方案）
   */
  async queryBackendAI(prompt, options = {}) {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    const backendURL = process.env.AI_SERVICE_URL || 'http://localhost:8001';
    console.log('[Document Engine] 调用后端AI服务:', backendURL);

    return new Promise((resolve, reject) => {
      const url = new URL('/api/chat/stream', backendURL);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ];

      const postData = JSON.stringify({
        messages,
        temperature: options.temperature || 0.7
      });

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 600000 // 10 分钟
      };

      const req = httpModule.request(requestOptions, (res) => {
        let fullText = '';
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          // 按行处理SSE
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6).trim();
                if (jsonStr) {
                  const data = JSON.parse(jsonStr);

                  if (data.type === 'content' && data.content) {
                    fullText += data.content;
                  } else if (data.type === 'error') {
                    reject(new Error(data.error));
                    return;
                  } else if (data.type === 'done') {
                    resolve({
                      text: fullText,
                      tokens: Math.ceil(fullText.length / 4)
                    });
                    return;
                  }
                }
              } catch (parseError) {
                // 忽略解析错误
              }
            }
          }
        });

        res.on('end', () => {
          if (fullText) {
            resolve({
              text: fullText,
              tokens: Math.ceil(fullText.length / 4)
            });
          } else {
            reject(new Error('后端AI服务未返回任何内容'));
          }
        });

        res.on('error', (err) => {
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('后端AI服务请求超时'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 创建Markdown文档
   */
  async createMarkdownFromDescription(description, projectPath, llmManager) {
    return await this.createDocumentFromDescription(description, projectPath, llmManager);
  }

  /**
   * 导出项目文档为PDF
   */
  async exportDocumentToPDF(projectPath, outputFiles) {
    const mdFiles = await this.findMarkdownFiles(projectPath);

    if (mdFiles.length === 0) {
      throw new Error('未找到Markdown文件');
    }

    const sourcePath = mdFiles[0];
    const outputPath = outputFiles && outputFiles[0]
      ? path.join(projectPath, outputFiles[0])
      : sourcePath.replace(/\.md$/, '.pdf');

    return await this.exportToPDF(sourcePath, outputPath);
  }

  /**
   * 导出项目文档为Word
   */
  async exportDocumentToDocx(projectPath, outputFiles) {
    const mdFiles = await this.findMarkdownFiles(projectPath);

    if (mdFiles.length === 0) {
      throw new Error('未找到Markdown文件');
    }

    const sourcePath = mdFiles[0];
    const outputPath = outputFiles && outputFiles[0]
      ? path.join(projectPath, outputFiles[0])
      : sourcePath.replace(/\.md$/, '.docx');

    return await this.exportToDocx(sourcePath, outputPath);
  }

  /**
   * 导出项目文档为HTML
   */
  async exportDocumentToHTML(projectPath, outputFiles) {
    const mdFiles = await this.findMarkdownFiles(projectPath);

    if (mdFiles.length === 0) {
      throw new Error('未找到Markdown文件');
    }

    const sourcePath = mdFiles[0];
    const outputPath = outputFiles && outputFiles[0]
      ? path.join(projectPath, outputFiles[0])
      : sourcePath.replace(/\.md$/, '.html');

    return await this.exportTo(sourcePath, 'html', outputPath);
  }

  /**
   * 查找项目中的Markdown文件
   */
  async findMarkdownFiles(projectPath) {
    const files = await fs.readdir(projectPath);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(projectPath, f));
  }
}

module.exports = DocumentEngine;
