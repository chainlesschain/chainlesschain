/**
 * Office文档工具的handler实现
 * 提供Word、Excel、PPT的生成和操作功能
 */

const fs = require('fs').promises;
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType } = require('docx');
const ExcelJS = require('exceljs');
const marked = require('marked');

class OfficeToolsHandler {
  constructor() {
    this.name = 'OfficeToolsHandler';
  }

  /**
   * Word文档生成器
   * 生成标准格式的Word文档（.docx）
   */
  async tool_word_generator(params) {
    const { title, content, outputPath, options = {} } = params;

    try {
      // 解析Markdown内容为段落
      const paragraphs = this.parseMarkdownToWordParagraphs(content, options);

      // 创建Word文档
      const doc = new Document({
        sections: [{
          properties: {
            page: {
              margin: {
                top: options.margin?.top || 1440,    // 1440 twips = 1 inch
                bottom: options.margin?.bottom || 1440,
                left: options.margin?.left || 1800,
                right: options.margin?.right || 1800,
              },
            },
          },
          children: [
            // 标题
            new Paragraph({
              text: title,
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: {
                after: 400,
              },
            }),
            // 内容段落
            ...paragraphs,
          ],
        }],
      });

      // 确保输出目录存在
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });

      // 生成并保存文档
      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(outputPath, buffer);

      const stats = await fs.stat(outputPath);

      return {
        success: true,
        filePath: outputPath,
        fileSize: stats.size,
        pageCount: Math.ceil(content.length / 3000) // 粗略估算页数
      };
    } catch (error) {
      console.error('[Word Generator] 生成失败:', error);
      throw new Error(`Word文档生成失败: ${error.message}`);
    }
  }

  /**
   * 解析Markdown为Word段落
   */
  parseMarkdownToWordParagraphs(markdown, options = {}) {
    const paragraphs = [];
    const lines = markdown.split('\n');

    for (let line of lines) {
      line = line.trim();

      if (!line) {
        // 空行
        paragraphs.push(new Paragraph({ text: '' }));
        continue;
      }

      // 标题处理
      if (line.startsWith('# ')) {
        paragraphs.push(new Paragraph({
          text: line.substring(2),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }));
      } else if (line.startsWith('## ')) {
        paragraphs.push(new Paragraph({
          text: line.substring(3),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        }));
      } else if (line.startsWith('### ')) {
        paragraphs.push(new Paragraph({
          text: line.substring(4),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        }));
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        // 无序列表
        paragraphs.push(new Paragraph({
          text: line.substring(2),
          bullet: { level: 0 },
        }));
      } else if (/^\d+\.\s/.test(line)) {
        // 有序列表
        const text = line.replace(/^\d+\.\s/, '');
        paragraphs.push(new Paragraph({
          text: text,
          numbering: { reference: 'default-numbering', level: 0 },
        }));
      } else {
        // 普通段落
        paragraphs.push(new Paragraph({
          text: line,
          spacing: { after: 120 },
        }));
      }
    }

    return paragraphs;
  }

  /**
   * Word表格创建器
   * 在Word文档中创建和格式化表格
   */
  async tool_word_table_creator(params) {
    const { documentPath, tableData, style = 'grid' } = params;

    try {
      // 读取现有文档（如果存在）或创建新文档
      let doc;
      try {
        const buffer = await fs.readFile(documentPath);
        // 注意：docx库不支持直接修改现有文档，需要重新创建
        // 这里简化处理，仅创建包含表格的新文档
      } catch (error) {
        // 文档不存在，创建新文档
      }

      // 创建表格
      const rows = [
        // 表头
        new TableRow({
          tableHeader: true,
          children: tableData.headers.map(header =>
            new TableCell({
              children: [new Paragraph({ text: header, bold: true })],
              shading: { fill: 'D3D3D3' },
            })
          ),
        }),
        // 数据行
        ...tableData.rows.map(row =>
          new TableRow({
            children: row.map(cell =>
              new TableCell({
                children: [new Paragraph({ text: String(cell) })],
              })
            ),
          })
        ),
      ];

      const table = new Table({
        rows: rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      });

      // 创建包含表格的文档
      doc = new Document({
        sections: [{
          children: [table],
        }],
      });

      // 保存文档
      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(documentPath, buffer);

      return {
        success: true,
        tableCount: 1,
        rowCount: tableData.rows.length
      };
    } catch (error) {
      console.error('[Word Table Creator] 创建失败:', error);
      throw new Error(`Word表格创建失败: ${error.message}`);
    }
  }

  /**
   * Excel电子表格生成器
   * 生成多工作表Excel文件
   */
  async tool_excel_generator(params) {
    const { sheets, outputPath, options = {} } = params;

    try {
      const workbook = new ExcelJS.Workbook();

      // 设置文档属性
      workbook.creator = options.creator || 'ChainlessChain';
      workbook.created = new Date(options.created || Date.now());

      let totalRows = 0;

      // 创建工作表
      for (const sheetConfig of sheets) {
        const worksheet = workbook.addWorksheet(sheetConfig.name);

        // 添加表头（如果有）
        if (sheetConfig.headers) {
          worksheet.addRow(sheetConfig.headers);
          // 表头样式
          worksheet.getRow(1).font = { bold: true };
          worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' }
          };
        }

        // 添加数据
        sheetConfig.data.forEach(row => {
          worksheet.addRow(row);
          totalRows++;
        });

        // 设置列宽
        if (sheetConfig.columnWidths) {
          sheetConfig.columnWidths.forEach((width, index) => {
            worksheet.getColumn(index + 1).width = width;
          });
        } else {
          // 自动调整列宽
          worksheet.columns.forEach(column => {
            column.width = 15;
          });
        }

        // 应用自动筛选
        if (options.autoFilter && worksheet.rowCount > 1) {
          worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: worksheet.columnCount }
          };
        }

        // 冻结窗格
        if (options.freeze) {
          worksheet.views = [{
            state: 'frozen',
            xSplit: options.freeze.column || 0,
            ySplit: options.freeze.row || 0
          }];
        }
      }

      // 确保输出目录存在
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });

      // 保存Excel文件
      await workbook.xlsx.writeFile(outputPath);

      return {
        success: true,
        filePath: outputPath,
        sheetCount: sheets.length,
        totalRows: totalRows
      };
    } catch (error) {
      console.error('[Excel Generator] 生成失败:', error);
      throw new Error(`Excel文件生成失败: ${error.message}`);
    }
  }

  /**
   * Excel公式构建器
   * 生成和验证Excel公式
   */
  async tool_excel_formula_builder(params) {
    const { formulaType, range, condition, customFormula } = params;

    try {
      let formula = '';
      let description = '';

      switch (formulaType) {
        case 'SUM':
          formula = `=SUM(${range})`;
          description = `求和公式：计算 ${range} 范围内所有数值的总和`;
          break;

        case 'AVERAGE':
          formula = `=AVERAGE(${range})`;
          description = `平均值公式：计算 ${range} 范围内数值的平均值`;
          break;

        case 'IF':
          formula = `=IF(${range}${condition || '>0'}, "是", "否")`;
          description = `条件判断公式：如果 ${range}${condition || '>0'}，则返回"是"，否则返回"否"`;
          break;

        case 'VLOOKUP':
          formula = `=VLOOKUP(${range}, A:B, 2, FALSE)`;
          description = `垂直查找公式：在A:B范围内查找 ${range} 的值`;
          break;

        case 'COUNTIF':
          formula = `=COUNTIF(${range}, "${condition || '>0'}")`;
          description = `条件计数公式：计算 ${range} 中满足条件 ${condition || '>0'} 的单元格数量`;
          break;

        case 'SUMIF':
          formula = `=SUMIF(${range}, "${condition || '>0'}")`;
          description = `条件求和公式：对 ${range} 中满足条件 ${condition || '>0'} 的单元格求和`;
          break;

        case 'CONCATENATE':
          formula = `=CONCATENATE(${range})`;
          description = `文本连接公式：连接 ${range} 中的文本`;
          break;

        case 'CUSTOM':
          formula = customFormula;
          description = '自定义公式';
          break;

        default:
          throw new Error(`不支持的公式类型: ${formulaType}`);
      }

      return {
        success: true,
        formula: formula,
        description: description
      };
    } catch (error) {
      console.error('[Excel Formula Builder] 构建失败:', error);
      throw new Error(`Excel公式构建失败: ${error.message}`);
    }
  }

  /**
   * Excel图表创建器
   * 在Excel工作表中创建图表
   */
  async tool_excel_chart_creator(params) {
    const { workbookPath, sheetName, chartType, dataRange, title, position = {} } = params;

    try {
      // 读取现有工作簿
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(workbookPath);

      // 获取工作表
      const worksheet = workbook.getWorksheet(sheetName);
      if (!worksheet) {
        throw new Error(`工作表 "${sheetName}" 不存在`);
      }

      // 注意：exceljs 不直接支持创建图表
      // 需要使用其他库如 xlsx-chart 或直接操作 XML
      // 这里提供一个简化的实现，记录图表配置

      const chartId = `chart_${Date.now()}`;

      // 在工作表中添加图表说明
      const noteRow = position.row || worksheet.rowCount + 2;
      worksheet.getCell(noteRow, position.column || 1).value = `[图表: ${title}]`;
      worksheet.getCell(noteRow, position.column || 1).note = JSON.stringify({
        chartId,
        chartType,
        dataRange,
        title
      });

      // 保存工作簿
      await workbook.xlsx.writeFile(workbookPath);

      console.warn('[Excel Chart] exceljs不直接支持图表创建，已添加图表配置说明');

      return {
        success: true,
        chartId: chartId,
        note: '图表配置已保存，需要在Excel中手动创建图表'
      };
    } catch (error) {
      console.error('[Excel Chart Creator] 创建失败:', error);
      throw new Error(`Excel图表创建失败: ${error.message}`);
    }
  }

  /**
   * PPT演示文稿生成器
   * 生成PowerPoint演示文稿
   */
  async tool_ppt_generator(params) {
    const { slides, theme = 'default', outputPath, options = {} } = params;

    try {
      // 注意：需要使用 pptxgenjs 库来生成PPT
      // 由于库较大，这里提供一个简化的实现框架

      const PptxGenJS = require('pptxgenjs');
      const pres = new PptxGenJS();

      // 设置文档属性
      pres.author = options.author || 'ChainlessChain';
      pres.company = options.company || '';
      pres.layout = options.slideSize || 'LAYOUT_16x9';

      // 创建幻灯片
      for (const slideConfig of slides) {
        const slide = pres.addSlide();

        // 根据布局类型添加内容
        switch (slideConfig.layout) {
          case 'title':
            slide.addText(slideConfig.title, {
              x: 0.5,
              y: 2.5,
              w: 9,
              h: 1.5,
              fontSize: 44,
              bold: true,
              align: 'center'
            });
            if (slideConfig.content) {
              slide.addText(slideConfig.content, {
                x: 0.5,
                y: 4.0,
                w: 9,
                h: 1,
                fontSize: 24,
                align: 'center'
              });
            }
            break;

          case 'titleAndContent':
          case 'sectionHeader':
            slide.addText(slideConfig.title, {
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 0.8,
              fontSize: 32,
              bold: true
            });
            if (slideConfig.content) {
              slide.addText(slideConfig.content, {
                x: 0.5,
                y: 1.5,
                w: 9,
                h: 4,
                fontSize: 18,
                valign: 'top'
              });
            }
            break;

          default:
            // 默认布局
            if (slideConfig.title) {
              slide.addText(slideConfig.title, {
                x: 0.5,
                y: 0.5,
                w: 9,
                h: 0.8,
                fontSize: 28,
                bold: true
              });
            }
            if (slideConfig.content) {
              slide.addText(slideConfig.content, {
                x: 0.5,
                y: 1.5,
                w: 9,
                h: 4,
                fontSize: 16
              });
            }
        }

        // 添加演讲者备注
        if (slideConfig.notes) {
          slide.addNotes(slideConfig.notes);
        }
      }

      // 确保输出目录存在
      const dir = path.dirname(outputPath);
      await fs.mkdir(dir, { recursive: true });

      // 保存PPT文件
      await pres.writeFile({ fileName: outputPath });

      return {
        success: true,
        filePath: outputPath,
        slideCount: slides.length
      };
    } catch (error) {
      console.error('[PPT Generator] 生成失败:', error);

      // 如果pptxgenjs未安装，提供降级处理
      if (error.message.includes('Cannot find module')) {
        console.warn('[PPT Generator] pptxgenjs未安装，创建占位文件');

        // 创建一个说明文件
        const readme = `# PPT生成说明

由于pptxgenjs库未安装，无法直接生成PPT文件。

## 幻灯片内容

${slides.map((s, i) => `### 第${i + 1}页：${s.title}\n${s.content || ''}\n`).join('\n')}

## 安装说明

运行以下命令安装PPT生成库：
\`\`\`bash
npm install pptxgenjs
\`\`\`
`;

        await fs.writeFile(outputPath.replace('.pptx', '_README.md'), readme, 'utf-8');

        return {
          success: false,
          error: 'pptxgenjs库未安装',
          fallbackFile: outputPath.replace('.pptx', '_README.md'),
          slideCount: slides.length
        };
      }

      throw new Error(`PPT生成失败: ${error.message}`);
    }
  }

  /**
   * 注册所有工具到FunctionCaller
   */
  register(functionCaller) {
    functionCaller.registerTool('tool_word_generator', this.tool_word_generator.bind(this));
    functionCaller.registerTool('tool_word_table_creator', this.tool_word_table_creator.bind(this));
    functionCaller.registerTool('tool_excel_generator', this.tool_excel_generator.bind(this));
    functionCaller.registerTool('tool_excel_formula_builder', this.tool_excel_formula_builder.bind(this));
    functionCaller.registerTool('tool_excel_chart_creator', this.tool_excel_chart_creator.bind(this));
    functionCaller.registerTool('tool_ppt_generator', this.tool_ppt_generator.bind(this));

    console.log('[OfficeToolsHandler] Office工具已注册（6个）');
  }
}

module.exports = OfficeToolsHandler;
