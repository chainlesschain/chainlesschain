/**
 * PDF生成引擎
 * 使用Electron的printToPDF功能将HTML转换为PDF
 */
const path = require('path');
const fs = require('fs-extra');
const { BrowserWindow } = require('electron');

class PDFEngine {
  constructor() {
    this.name = 'PDFEngine';
  }

  /**
   * 将Markdown转换为PDF
   */
  async markdownToPDF(markdownContent, outputPath, options = {}) {
    try {
      console.log('[PDFEngine] 开始Markdown转PDF:', outputPath);

      // 1. Markdown → HTML
      const html = await this.markdownToHTML(markdownContent, options);

      // 2. HTML → PDF
      await this.htmlToPDF(html, outputPath, options);

      const stats = await fs.stat(outputPath);

      console.log('[PDFEngine] PDF生成成功:', outputPath, `大小: ${(stats.size / 1024).toFixed(2)} KB`);

      return {
        success: true,
        outputPath,
        size: stats.size
      };
    } catch (error) {
      console.error('[PDFEngine] PDF生成失败:', error);
      throw error;
    }
  }

  /**
   * Markdown转HTML
   */
  async markdownToHTML(markdown, options) {
    const { marked } = require('marked');

    // 配置marked
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: true,
      mangle: false
    });

    const bodyContent = marked.parse(markdown);

    // 生成完整HTML
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${options.title || 'Document'}</title>
  <style>
    @page {
      margin: 2cm;
      size: ${options.pageSize || 'A4'};
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      font-size: 14px;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: #1a1a1a;
    }

    h1 {
      font-size: 2em;
      border-bottom: 2px solid #eaecef;
      padding-bottom: 0.3em;
    }

    h2 {
      font-size: 1.5em;
      border-bottom: 1px solid #eaecef;
      padding-bottom: 0.3em;
    }

    h3 {
      font-size: 1.25em;
    }

    h4 {
      font-size: 1em;
    }

    h5 {
      font-size: 0.875em;
    }

    h6 {
      font-size: 0.85em;
      color: #6a737d;
    }

    p {
      margin-top: 0;
      margin-bottom: 16px;
    }

    code {
      background-color: #f6f8fa;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', Consolas, Monaco, monospace;
      font-size: 0.9em;
      color: #e01e5a;
    }

    pre {
      background-color: #f6f8fa;
      padding: 16px;
      overflow: auto;
      border-radius: 6px;
      margin-bottom: 16px;
      line-height: 1.45;
    }

    pre code {
      background-color: transparent;
      padding: 0;
      color: #333;
      font-size: 0.85em;
    }

    blockquote {
      border-left: 4px solid #dfe2e5;
      padding: 0 15px;
      color: #6a737d;
      margin: 0 0 16px 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
      display: table;
    }

    table th,
    table td {
      border: 1px solid #dfe2e5;
      padding: 8px 13px;
      text-align: left;
    }

    table th {
      background-color: #f6f8fa;
      font-weight: 600;
    }

    table tr:nth-child(2n) {
      background-color: #f6f8fa;
    }

    img {
      max-width: 100%;
      box-sizing: border-box;
      background-color: #fff;
    }

    ul, ol {
      padding-left: 2em;
      margin-bottom: 16px;
    }

    li {
      margin-bottom: 4px;
    }

    a {
      color: #0366d6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    hr {
      height: 0.25em;
      padding: 0;
      margin: 24px 0;
      background-color: #e1e4e8;
      border: 0;
    }

    ${options.customCSS || ''}
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>
    `;

    return html;
  }

  /**
   * HTML转PDF（使用Electron的printToPDF）
   */
  async htmlToPDF(html, outputPath, options = {}) {
    let win = null;

    try {
      // 创建隐藏的浏览器窗口
      win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });

      // 加载HTML内容
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // 等待页面加载完成
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 生成PDF
      const pdfData = await win.webContents.printToPDF({
        marginsType: 0,
        printBackground: true,
        printSelectionOnly: false,
        landscape: options.landscape || false,
        pageSize: options.pageSize || 'A4',
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0
        },
        preferCSSPageSize: true
      });

      // 确保输出目录存在
      await fs.ensureDir(path.dirname(outputPath));

      // 保存PDF文件
      await fs.writeFile(outputPath, pdfData);

      console.log('[PDFEngine] PDF文件已保存:', outputPath);

    } catch (error) {
      console.error('[PDFEngine] HTML转PDF失败:', error);
      throw error;
    } finally {
      // 关闭窗口
      if (win && !win.isDestroyed()) {
        win.close();
        win = null;
      }
    }
  }

  /**
   * HTML文件转PDF
   */
  async htmlFileToPDF(htmlPath, outputPath, options = {}) {
    try {
      const html = await fs.readFile(htmlPath, 'utf-8');
      await this.htmlToPDF(html, outputPath, options);

      return {
        success: true,
        outputPath,
        size: (await fs.stat(outputPath)).size
      };
    } catch (error) {
      console.error('[PDFEngine] HTML文件转PDF失败:', error);
      throw error;
    }
  }

  /**
   * 文本文件转PDF
   */
  async textFileToPDF(textPath, outputPath, options = {}) {
    try {
      const content = await fs.readFile(textPath, 'utf-8');

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${options.title || path.basename(textPath)}</title>
  <style>
    @page {
      margin: 2cm;
    }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>${content}</body>
</html>
      `;

      await this.htmlToPDF(html, outputPath, options);

      return {
        success: true,
        outputPath,
        size: (await fs.stat(outputPath)).size
      };
    } catch (error) {
      console.error('[PDFEngine] 文本文件转PDF失败:', error);
      throw error;
    }
  }

  /**
   * 批量转换
   */
  async batchConvert(files, outputDir, options = {}) {
    const results = [];

    for (const file of files) {
      try {
        const ext = path.extname(file).toLowerCase();
        const basename = path.basename(file, ext);
        const outputPath = path.join(outputDir, `${basename}.pdf`);

        let result;

        if (ext === '.md' || ext === '.markdown') {
          const content = await fs.readFile(file, 'utf-8');
          result = await this.markdownToPDF(content, outputPath, {
            ...options,
            title: basename
          });
        } else if (ext === '.html' || ext === '.htm') {
          result = await this.htmlFileToPDF(file, outputPath, options);
        } else if (ext === '.txt') {
          result = await this.textFileToPDF(file, outputPath, {
            ...options,
            title: basename
          });
        } else {
          throw new Error(`不支持的文件类型: ${ext}`);
        }

        results.push({
          input: file,
          output: outputPath,
          success: true,
          ...result
        });

      } catch (error) {
        console.error('[PDFEngine] 转换失败:', file, error);
        results.push({
          input: file,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 处理项目任务（用于任务规划系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 执行结果
   */
  async handleProjectTask(params) {
    const { description, projectPath, llmManager, action = 'create_pdf' } = params;

    console.log('[PDFEngine] 处理PDF文档生成任务');
    console.log('[PDFEngine] 描述:', description);
    console.log('[PDFEngine] 操作:', action);

    try {
      // 使用LLM生成Markdown内容
      const markdownContent = await this.generateMarkdownContentFromDescription(description, llmManager);

      // 生成PDF文件
      const title = this.extractTitle(markdownContent) || 'document';
      const fileName = `${title}.pdf`;
      const outputPath = path.join(projectPath, fileName);

      const result = await this.markdownToPDF(markdownContent, outputPath, {
        title,
        pageSize: 'A4'
      });

      return {
        type: 'pdf-document',
        success: true,
        ...result,
        title
      };
    } catch (error) {
      console.error('[PDFEngine] 任务执行失败:', error);
      throw error;
    }
  }

  /**
   * 从描述生成Markdown内容
   * @param {string} description - 文档描述
   * @param {Object} llmManager - LLM管理器
   * @returns {Promise<string>} Markdown内容
   */
  async generateMarkdownContentFromDescription(description, llmManager) {
    const prompt = `请根据以下描述生成一份完整的文档内容（Markdown格式）：

${description}

要求：
1. 使用Markdown格式
2. 包含标题（# 一级标题）
3. 合理使用二级、三级标题组织结构
4. 内容要充实、专业、完整
5. 如果需要，可以包含列表、表格等元素
6. 确保内容有实际价值，不要使用占位符

请直接输出Markdown内容，不要添加代码块标记。`;

    try {
      let responseText;

      // 尝试使用本地LLM
      if (llmManager && llmManager.isInitialized) {
        console.log('[PDFEngine] 使用本地LLM生成文档内容');
        const response = await llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 3000
        });
        responseText = response.text;
      } else {
        // 降级到后端AI服务
        console.log('[PDFEngine] 本地LLM不可用，使用后端AI服务');
        responseText = await this.queryBackendAI(prompt);
      }

      return responseText.trim();
    } catch (error) {
      console.error('[PDFEngine] 生成文档内容失败:', error);
      // 返回默认内容
      return `# ${description.substring(0, 50)}

## 概述

本文档根据用户需求自动生成。

## 内容

${description}

## 结论

请根据实际需求补充详细内容。`;
    }
  }

  /**
   * 从Markdown内容中提取标题
   */
  extractTitle(markdownContent) {
    const lines = markdownContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        return line.substring(2).trim().replace(/[\/\\:*?"<>|]/g, '-');
      }
    }
    return 'document';
  }

  /**
   * 查询后端AI服务（降级方案）
   */
  async queryBackendAI(prompt) {
    const http = require('http');

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      });

      const options = {
        hostname: 'localhost',
        port: 8001,
        path: '/api/chat/stream',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 60000
      };

      const req = http.request(options, (res) => {
        let fullText = '';
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          // 处理SSE流
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'content' && data.content) {
                  fullText += data.content;
                } else if (data.type === 'done') {
                  resolve(fullText);
                  return;
                } else if (data.type === 'error') {
                  reject(new Error(data.error));
                  return;
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        });

        res.on('end', () => {
          if (fullText) {
            resolve(fullText);
          } else {
            reject(new Error('后端AI服务未返回内容'));
          }
        });

        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('后端AI服务请求超时'));
      });

      req.write(postData);
      req.end();
    });
  }
}

// 单例实例
let pdfEngineInstance = null;

/**
 * 获取PDF引擎实例
 */
function getPDFEngine() {
  if (!pdfEngineInstance) {
    pdfEngineInstance = new PDFEngine();
  }
  return pdfEngineInstance;
}

module.exports = {
  PDFEngine,
  getPDFEngine
};
