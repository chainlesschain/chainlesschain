/**
 * OfficeSkill - Office 文档处理技能
 *
 * 支持 Excel (.xlsx)、Word (.docx)、PowerPoint (.pptx) 等 Office 文档的创建和处理。
 *
 * @module ai-engine/cowork/skills/office-skill
 */

const { BaseSkill } = require('./base-skill');
const fs = require('fs').promises;

/**
 * OfficeSkill 类
 */
class OfficeSkill extends BaseSkill {
  constructor(options = {}) {
    super({
      skillId: 'office-skill',
      name: 'Office Document Processor',
      description: 'Create and process Excel, Word, PowerPoint documents',
      version: '1.0.0',
      category: 'office',
      capabilities: [
        'create_excel',
        'create_word',
        'create_powerpoint',
        'read_excel',
        'read_word',
        'format_document',
        'data_analysis',
        'chart_generation',
      ],
      supportedFileTypes: ['.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'],
      ...options,
    });

    // Office 库加载（延迟加载）
    this.excelLib = null; // ExcelJS
    this.wordLib = null; // docx
    this.pptLib = null; // pptxgenjs
  }

  /**
   * 判断是否能处理任务（重写父类方法）
   * @param {Object} task - 任务对象
   * @returns {number} 匹配分数 (0-100)
   */
  canHandle(task) {
    if (!this.config.enabled) {
      return 0;
    }

    let score = 0;

    // 检查 type 是否为 "office"
    if (task.type === 'office') {
      score += 50;
    }

    // 检查 operation 是否匹配能力
    if (task.operation) {
      const operationSnakeCase = task.operation
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, ''); // createExcel -> create_excel

      if (this.capabilities.includes(operationSnakeCase)) {
        score += 50;
      }
    }

    // 基于文件类型匹配
    if (task.fileType && this.supportedFileTypes.includes(task.fileType)) {
      score += 30;
    }

    // 如果没有匹配，使用父类的默认逻辑
    if (score === 0) {
      return super.canHandle(task);
    }

    return Math.min(100, score);
  }

  /**
   * 执行技能
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async execute(task, context = {}) {
    const { type, operation, input } = task;

    // 兼容两种模式：type 或 operation
    let taskType = type;
    if (type === 'office' && operation) {
      // 将 camelCase 转换为 snake_case
      taskType = operation
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, ''); // createExcel -> create_excel
    }

    // 兼容性：如果没有input字段但有operation字段，说明整个task对象就是输入
    let inputData = input;
    if (!input && operation) {
      // 将task对象作为输入，但移除operation和type字段
      const { operation: _, type: __, ...rest } = task;
      inputData = rest;
    }

    switch (taskType) {
      case 'create_excel':
        return await this.createExcel(inputData, context);

      case 'create_word':
        return await this.createWord(inputData, context);

      case 'create_powerpoint':
      case 'create_power_point': // 兼容性：支持两种格式
        return await this.createPowerPoint(inputData, context);

      case 'read_excel':
        return await this.readExcel(inputData, context);

      case 'read_word':
        return await this.readWord(inputData, context);

      case 'data_analysis':
        return await this.performDataAnalysis(inputData, context);

      default:
        throw new Error(`Unsupported task type: ${taskType}`);
    }
  }

  // ==========================================
  // Excel 操作
  // ==========================================

  /**
   * 创建 Excel 文件
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async createExcel(input, context = {}) {
    // 兼容两种输入格式
    let filePath, data, options;

    if (input.filePath && input.data) {
      // 标准格式: { filePath, data, options }
      ({ filePath, data, options = {} } = input);
    } else if (input.outputPath && (input.rows || input.columns || input.sheetName)) {
      // 测试格式: { outputPath, rows, columns, sheetName, operation }
      filePath = input.outputPath;
      data = {
        rows: input.rows || [],
        columns: input.columns || [],
        sheetName: input.sheetName || 'Sheet1',
      };
      options = {};
    } else {
      // 验证输入
      const validation = this.validateInput(input, {
        filePath: { type: 'string', required: true },
        data: { type: 'object', required: true },
      });

      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
      }

      ({ filePath, data, options = {} } = input);
    }

    // 延迟加载 ExcelJS
    if (!this.excelLib) {
      try {
        this.excelLib = require('exceljs');
      } catch (_error) {
        throw new Error('ExcelJS library not available. Please install: npm install exceljs');
      }
    }

    const workbook = new this.excelLib.Workbook();

    // 处理多个工作表
    if (data.sheets && Array.isArray(data.sheets)) {
      for (const sheetData of data.sheets) {
        await this._createExcelSheet(workbook, sheetData, options);
      }
    } else {
      // 单个工作表
      const sheetData = {
        name: data.sheetName || 'Sheet1',
        columns: data.columns,
        data: data.rows || [],
      };
      await this._createExcelSheet(workbook, sheetData, options);
    }

    // 保存文件
    await workbook.xlsx.writeFile(filePath);

    this._log(`Excel 文件已创建: ${filePath}`);

    // 如果提供了 fileSandbox，记录审计日志
    if (context.fileSandbox && context.teamId) {
      try {
        await context.fileSandbox.recordAuditLog({
          teamId: context.teamId,
          agentId: context.agentId || null,
          operation: 'WRITE',
          path: filePath,
          success: true,
          metadata: {
            fileType: 'xlsx',
            sheets: workbook.worksheets.length,
          },
        });
      } catch (_error) {
        this._log('记录审计日志失败', 'warn');
      }
    }

    return {
      success: true,
      result: {
        filePath,
        sheets: workbook.worksheets.length,
      },
    };
  }

  /**
   * 创建 Excel 工作表
   * @private
   */
  async _createExcelSheet(workbook, sheetData, _options) {
    const worksheet = workbook.addWorksheet(sheetData.name || 'Sheet1');

    // 添加列定义
    if (sheetData.columns) {
      worksheet.columns = sheetData.columns;
    }

    // 添加数据行
    if (sheetData.data && Array.isArray(sheetData.data)) {
      for (const row of sheetData.data) {
        worksheet.addRow(row);
      }
    }
  }

  /**
   * 读取 Excel 文件
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async readExcel(input, _context = {}) {
    const { filePath, sheetName } = input;

    // 延迟加载 ExcelJS
    if (!this.excelLib) {
      try {
        this.excelLib = require('exceljs');
      } catch (_error) {
        throw new Error('ExcelJS library not available');
      }
    }

    const workbook = new this.excelLib.Workbook();
    await workbook.xlsx.readFile(filePath);

    const result = {
      sheets: [],
      metadata: {
        totalSheets: workbook.worksheets.length,
      },
    };

    // 读取指定工作表或所有工作表
    const worksheets = sheetName
      ? [workbook.getWorksheet(sheetName)]
      : workbook.worksheets;

    for (const worksheet of worksheets) {
      if (!worksheet) continue;

      const sheetData = {
        name: worksheet.name,
        rows: [],
        rowCount: worksheet.rowCount,
        columnCount: worksheet.columnCount,
      };

      // 读取数据
      worksheet.eachRow((row) => {
        sheetData.rows.push(row.values.slice(1)); // 去除第一个空元素
      });

      result.sheets.push(sheetData);
    }

    this._log(`Excel 文件已读取: ${filePath}, 工作表数: ${result.sheets.length}`);

    return result;
  }

  // ==========================================
  // Word 操作
  // ==========================================

  /**
   * 创建 Word 文档
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async createWord(input, _context = {}) {
    const { filePath, content } = input;

    // 延迟加载 docx
    if (!this.wordLib) {
      try {
        const docx = require('docx');
        this.wordLib = {
          Document: docx.Document,
          Packer: docx.Packer,
          Paragraph: docx.Paragraph,
          HeadingLevel: docx.HeadingLevel,
        };
      } catch (_error) {
        throw new Error('docx library not available. Please install: npm install docx');
      }
    }

    const { Document, Packer, Paragraph, HeadingLevel } = this.wordLib;

    // 构建段落
    const sections = [];
    const children = [];

    if (content.title) {
      children.push(
        new Paragraph({
          text: content.title,
          heading: HeadingLevel.HEADING_1,
        })
      );
    }

    if (content.paragraphs && Array.isArray(content.paragraphs)) {
      for (const para of content.paragraphs) {
        if (typeof para === 'string') {
          children.push(new Paragraph({ text: para }));
        } else if (para.heading) {
          children.push(
            new Paragraph({
              text: para.text,
              heading: HeadingLevel[`HEADING_${para.level || 2}`],
            })
          );
        } else {
          children.push(new Paragraph({ text: para.text || para }));
        }
      }
    }

    sections.push({ children });

    const doc = new Document({ sections });

    // 生成缓冲区并保存
    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(filePath, buffer);

    this._log(`Word 文档已创建: ${filePath}`);

    return {
      success: true,
      filePath,
      paragraphCount: content.paragraphs?.length || 0,
    };
  }

  /**
   * 读取 Word 文档
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async readWord(_input, _context = {}) {
    // 简化实现：读取文本内容
    // 实际应用中需要使用 mammoth 或 docx 库来解析
    throw new Error('Word document reading not yet implemented. Use a library like mammoth.js');
  }

  // ==========================================
  // PowerPoint 操作
  // ==========================================

  /**
   * 创建 PowerPoint 演示文稿
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async createPowerPoint(input, _context = {}) {
    const { filePath, slides, options = {} } = input;

    // 延迟加载 pptxgenjs
    if (!this.pptLib) {
      try {
        const PptxGenJS = require('pptxgenjs');
        this.pptLib = PptxGenJS;
      } catch (_error) {
        throw new Error('pptxgenjs library not available. Please install: npm install pptxgenjs');
      }
    }

    const pptx = new this.pptLib();

    // 设置演示文稿属性
    if (options.title) {
      pptx.title = options.title;
    }

    if (options.author) {
      pptx.author = options.author;
    }

    // 创建幻灯片
    if (slides && Array.isArray(slides)) {
      for (const slideData of slides) {
        const slide = pptx.addSlide();

        // 添加标题
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.5,
            fontSize: 32,
            bold: true,
            color: '363636',
          });
        }

        // 添加内容
        if (slideData.content) {
          slide.addText(slideData.content, {
            x: 0.5,
            y: 1.5,
            fontSize: 18,
            color: '666666',
          });
        }

        // 添加图表
        if (slideData.chart) {
          this._addChartToSlide(slide, slideData.chart);
        }
      }
    }

    // 保存文件
    await pptx.writeFile({ fileName: filePath });

    this._log(`PowerPoint 文件已创建: ${filePath}`);

    return {
      success: true,
      filePath,
      slideCount: slides?.length || 0,
    };
  }

  /**
   * 添加图表到幻灯片
   * @private
   */
  _addChartToSlide(slide, chartData) {
    const { type, data, options = {} } = chartData;

    const chartConfig = {
      x: options.x || 1,
      y: options.y || 3,
      w: options.w || 8,
      h: options.h || 4,
      chartType: type || 'bar',
      data,
    };

    slide.addChart(chartConfig.chartType, chartConfig.data, chartConfig);
  }

  // ==========================================
  // 数据分析
  // ==========================================

  /**
   * 执行数据分析
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果
   */
  async performDataAnalysis(input, context = {}) {
    const { data, analysis = [] } = input;

    const results = {};

    for (const analysisType of analysis) {
      switch (analysisType) {
        case 'summary':
          results.summary = this._calculateSummary(data);
          break;

        case 'statistics':
          results.statistics = this._calculateStatistics(data);
          break;

        case 'groupBy':
          results.groupBy = this._groupByColumn(data, input.groupByColumn);
          break;

        default:
          this._log(`未知的分析类型: ${analysisType}`, 'warn');
      }
    }

    return results;
  }

  /**
   * 计算摘要
   * @private
   */
  _calculateSummary(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return { rowCount: 0, columnCount: 0 };
    }

    return {
      rowCount: data.length,
      columnCount: Object.keys(data[0] || {}).length,
      columns: Object.keys(data[0] || {}),
    };
  }

  /**
   * 计算统计信息
   * @private
   */
  _calculateStatistics(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return {};
    }

    const stats = {};
    const columns = Object.keys(data[0]);

    for (const column of columns) {
      const values = data.map(row => row[column]).filter(v => typeof v === 'number');

      if (values.length > 0) {
        stats[column] = {
          count: values.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        };
      }
    }

    return stats;
  }

  /**
   * 按列分组
   * @private
   */
  _groupByColumn(data, column) {
    if (!Array.isArray(data) || data.length === 0 || !column) {
      return {};
    }

    const groups = {};

    for (const row of data) {
      const key = row[column];
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(row);
    }

    return groups;
  }
}

module.exports = { OfficeSkill };
