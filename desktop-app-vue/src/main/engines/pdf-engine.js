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
