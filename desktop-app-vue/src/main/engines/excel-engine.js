/**
 * Excel处理引擎
 * 提供Excel文件的读取、写入、编辑和转换功能
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { getFileHandler } = require('../utils/file-handler');
const { getFileCache } = require('../utils/file-cache');

class ExcelEngine {
  constructor() {
    this.supportedFormats = ['.xlsx', '.xls', '.csv'];
    this.fileHandler = getFileHandler();
    this.fileCache = getFileCache();
  }

  /**
   * 读取Excel文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 包含工作表数据的对象
   */
  async readExcel(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.csv') {
        return await this.readCSV(filePath);
      } else if (ext === '.xlsx' || ext === '.xls') {
        // 使用exceljs读取Excel文件
        try {
          const ExcelJS = require('exceljs');
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.readFile(filePath);

          const sheets = [];
          workbook.eachSheet((worksheet, sheetId) => {
            const sheetData = {
              name: worksheet.name,
              id: sheetId,
              rows: [],
              columns: [],
              merges: [],
              styles: {},
            };

            // 读取列信息
            worksheet.columns.forEach((col, index) => {
              if (col.header) {
                sheetData.columns.push({
                  index,
                  header: col.header,
                  key: col.key,
                  width: col.width || 100,
                });
              }
            });

            // 读取行数据
            worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
              const rowData = {
                rowNumber,
                values: [],
                height: row.height || 20,
              };

              row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const cellData = {
                  col: colNumber,
                  value: cell.value,
                  type: cell.type,
                  formula: cell.formula,
                  style: this.extractCellStyle(cell),
                };

                rowData.values.push(cellData);
              });

              sheetData.rows.push(rowData);
            });

            // 读取合并单元格
            if (worksheet.model && worksheet.model.merges) {
              sheetData.merges = worksheet.model.merges;
            }

            sheets.push(sheetData);
          });

          return {
            type: 'excel',
            sheets,
            metadata: {
              creator: workbook.creator,
              lastModifiedBy: workbook.lastModifiedBy,
              created: workbook.created,
              modified: workbook.modified,
            },
          };
        } catch (excelError) {
          console.error('[ExcelEngine] ExcelJS not available, fallback to CSV:', excelError);
          // 降级到CSV模式
          return {
            type: 'excel',
            sheets: [{
              name: 'Sheet1',
              id: 1,
              rows: [],
              columns: [],
              error: 'ExcelJS库未安装，请运行: npm install exceljs',
            }],
          };
        }
      } else {
        throw new Error(`不支持的文件格式: ${ext}`);
      }
    } catch (error) {
      console.error('[ExcelEngine] Read error:', error);
      throw error;
    }
  }

  /**
   * 读取CSV文件
   */
  async readCSV(filePath) {
    // 先检查缓存
    const cachedResult = await this.fileCache.getCachedParseResult(filePath, 'csv');
    if (cachedResult) {
      return cachedResult;
    }

    // 检查是否为大文件
    const isLarge = await this.fileHandler.isLargeFile(filePath);

    let result;

    if (isLarge) {
      console.log('[ExcelEngine] 检测到大文件，使用流式处理');
      result = await this.readLargeCSV(filePath);
    } else {
      // 小文件使用原有逻辑
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = Papa.parse(content, {
        header: false,
        skipEmptyLines: false,
      });

      // 转换为标准表格格式
      const rows = parsed.data.map((rowValues, rowNumber) => ({
        rowNumber: rowNumber + 1,
        values: rowValues.map((value, colNumber) => ({
          col: colNumber + 1,
          value: value,
          type: 'string',
        })),
        height: 20,
      }));

      // 提取列信息(使用第一行作为表头)
      const columns = parsed.data[0]?.map((header, index) => ({
        index,
        header: header || `Column ${index + 1}`,
        width: 100,
      })) || [];

      result = {
        type: 'csv',
        sheets: [{
          name: 'Sheet1',
          id: 1,
          rows,
          columns,
          merges: [],
        }],
      };
    }

    // 缓存结果（对于小文件）
    if (!isLarge) {
      await this.fileCache.cacheParseResult(filePath, 'csv', result);
    }

    return result;
  }

  /**
   * 流式读取大CSV文件
   */
  async readLargeCSV(filePath) {
    return new Promise((resolve, reject) => {
      const rows = [];
      let columns = [];
      let rowNumber = 0;

      const readStream = fsSync.createReadStream(filePath, { encoding: 'utf-8' });

      Papa.parse(readStream, {
        header: false,
        skipEmptyLines: false,
        step: (result) => {
          rowNumber++;

          // 第一行作为列头
          if (rowNumber === 1) {
            columns = result.data.map((header, index) => ({
              index,
              header: header || `Column ${index + 1}`,
              width: 100,
            }));
          }

          // 转换行数据
          const row = {
            rowNumber,
            values: result.data.map((value, colNumber) => ({
              col: colNumber + 1,
              value: value,
              type: 'string',
            })),
            height: 20,
          };

          rows.push(row);

          // 内存管理：每处理1000行检查一次内存
          if (rowNumber % 1000 === 0) {
            const memStatus = this.fileHandler.checkAvailableMemory();
            if (!memStatus.isAvailable) {
              console.warn('[ExcelEngine] 内存使用率过高，暂停解析');
              readStream.pause();
              setTimeout(() => {
                if (global.gc) {global.gc();}
                readStream.resume();
              }, 100);
            }
          }
        },
        complete: () => {
          console.log(`[ExcelEngine] CSV解析完成，共 ${rowNumber} 行`);
          resolve({
            type: 'csv',
            sheets: [{
              name: 'Sheet1',
              id: 1,
              rows,
              columns,
              merges: [],
            }],
          });
        },
        error: (error) => {
          console.error('[ExcelEngine] CSV解析失败:', error);
          reject(error);
        },
      });
    });
  }

  /**
   * 写入Excel文件
   * @param {string} filePath - 文件路径
   * @param {Object} data - 表格数据
   */
  async writeExcel(filePath, data) {
    try {
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.csv') {
        return await this.writeCSV(filePath, data);
      } else if (ext === '.xlsx' || ext === '.xls') {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();

        // 设置元数据
        if (data.metadata) {
          workbook.creator = data.metadata.creator || 'ChainlessChain';
          workbook.lastModifiedBy = data.metadata.lastModifiedBy || 'ChainlessChain';
          workbook.created = data.metadata.created || new Date();
          workbook.modified = data.metadata.modified || new Date();
        }

        // 处理每个工作表
        for (const sheetData of data.sheets) {
          const worksheet = workbook.addWorksheet(sheetData.name);

          // 设置列
          if (sheetData.columns && sheetData.columns.length > 0) {
            worksheet.columns = sheetData.columns.map(col => ({
              header: col.header,
              key: col.key || `col_${col.index}`,
              width: col.width / 10 || 10, // 转换为Excel宽度单位
            }));
          }

          // 写入数据行
          if (sheetData.rows) {
            sheetData.rows.forEach((rowData, rowIndex) => {
              const row = worksheet.getRow(rowData.rowNumber || rowIndex + 1);

              // 设置行高
              if (rowData.height) {
                row.height = rowData.height;
              }

              // 写入单元格数据
              rowData.values.forEach((cellData) => {
                const cell = row.getCell(cellData.col);
                cell.value = cellData.value;

                // 应用样式
                if (cellData.style) {
                  this.applyCellStyle(cell, cellData.style);
                }

                // 应用公式
                if (cellData.formula) {
                  cell.value = { formula: cellData.formula };
                }
              });

              row.commit();
            });
          }

          // 应用合并单元格
          if (sheetData.merges) {
            sheetData.merges.forEach(merge => {
              worksheet.mergeCells(merge);
            });
          }
        }

        await workbook.xlsx.writeFile(filePath);
        return { success: true, filePath };
      }
    } catch (error) {
      console.error('[ExcelEngine] Write error:', error);
      throw error;
    }
  }

  /**
   * 写入CSV文件
   */
  async writeCSV(filePath, data) {
    try {
      const sheet = data.sheets[0]; // CSV只支持单个工作表
      if (!sheet || !sheet.rows) {
        throw new Error('没有有效的数据行');
      }

      // 转换为二维数组
      const csvData = sheet.rows.map(row =>
        row.values.map(cell => cell.value ?? '')
      );

      const csv = Papa.unparse(csvData);
      await fs.writeFile(filePath, csv, 'utf-8');

      return { success: true, filePath };
    } catch (error) {
      console.error('[ExcelEngine] Write CSV error:', error);
      throw error;
    }
  }

  /**
   * 转换Excel为JSON
   */
  async excelToJSON(filePath, options = {}) {
    // 检查缓存
    const cacheKey = `json:${options.sheetIndex || 0}`;
    const cachedResult = await this.fileCache.getCachedParseResult(filePath, cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const data = await this.readExcel(filePath);
    const sheet = data.sheets[options.sheetIndex || 0];

    if (!sheet) {
      throw new Error('工作表不存在');
    }

    // 使用第一行作为键
    const headers = sheet.rows[0]?.values.map(cell => cell.value) || [];
    const jsonData = [];

    for (let i = 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const obj = {};

      row.values.forEach((cell, index) => {
        const key = headers[index] || `column_${index}`;
        obj[key] = cell.value;
      });

      jsonData.push(obj);
    }

    // 缓存JSON结果（如果数据不太大）
    if (jsonData.length < 10000) {
      await this.fileCache.cacheParseResult(filePath, cacheKey, jsonData);
    }

    return jsonData;
  }

  /**
   * 转换JSON为Excel
   */
  async jsonToExcel(jsonData, filePath, options = {}) {
    if (!Array.isArray(jsonData) || jsonData.length === 0) {
      throw new Error('JSON数据必须是非空数组');
    }

    // 提取键作为表头
    const headers = Object.keys(jsonData[0]);

    // 构建表格数据
    const rows = [
      // 表头行
      {
        rowNumber: 1,
        values: headers.map((header, index) => ({
          col: index + 1,
          value: header,
          type: 'string',
          style: {
            font: { bold: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } },
          },
        })),
        height: 25,
      },
      // 数据行
      ...jsonData.map((obj, rowIndex) => ({
        rowNumber: rowIndex + 2,
        values: headers.map((header, colIndex) => ({
          col: colIndex + 1,
          value: obj[header],
          type: typeof obj[header] === 'number' ? 'number' : 'string',
        })),
        height: 20,
      })),
    ];

    const columns = headers.map((header, index) => ({
      index,
      header,
      width: 150,
    }));

    const data = {
      sheets: [{
        name: options.sheetName || 'Sheet1',
        id: 1,
        rows,
        columns,
      }],
      metadata: {
        creator: 'ChainlessChain',
        created: new Date(),
      },
    };

    return await this.writeExcel(filePath, data);
  }

  /**
   * 提取单元格样式
   */
  extractCellStyle(cell) {
    const style = {};

    if (cell.font) {
      style.font = {
        name: cell.font.name,
        size: cell.font.size,
        bold: cell.font.bold,
        italic: cell.font.italic,
        underline: cell.font.underline,
        color: cell.font.color,
      };
    }

    if (cell.fill) {
      style.fill = cell.fill;
    }

    if (cell.alignment) {
      style.alignment = cell.alignment;
    }

    if (cell.border) {
      style.border = cell.border;
    }

    if (cell.numFmt) {
      style.numFmt = cell.numFmt;
    }

    return style;
  }

  /**
   * 应用单元格样式
   */
  applyCellStyle(cell, style) {
    if (style.font) {
      cell.font = style.font;
    }

    if (style.fill) {
      cell.fill = style.fill;
    }

    if (style.alignment) {
      cell.alignment = style.alignment;
    }

    if (style.border) {
      cell.border = style.border;
    }

    if (style.numFmt) {
      cell.numFmt = style.numFmt;
    }
  }

  /**
   * 数据验证
   */
  validateExcelData(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: '数据格式无效' };
    }

    if (!data.sheets || !Array.isArray(data.sheets) || data.sheets.length === 0) {
      return { valid: false, error: '必须包含至少一个工作表' };
    }

    for (const sheet of data.sheets) {
      if (!sheet.name) {
        return { valid: false, error: '工作表必须有名称' };
      }

      if (!sheet.rows || !Array.isArray(sheet.rows)) {
        return { valid: false, error: '工作表必须包含rows数组' };
      }
    }

    return { valid: true };
  }

  /**
   * 获取工作表统计信息
   */
  getSheetStats(sheet) {
    return {
      name: sheet.name,
      rowCount: sheet.rows.length,
      columnCount: sheet.columns.length,
      mergeCount: sheet.merges?.length || 0,
      hasFormulas: sheet.rows.some(row =>
        row.values.some(cell => cell.formula)
      ),
    };
  }

  /**
   * 处理项目任务（用于任务规划系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 执行结果
   */
  async handleProjectTask(params) {
    const { description, projectPath, llmManager, action = 'create_table' } = params;

    console.log('[ExcelEngine] 处理Excel表格生成任务');
    console.log('[ExcelEngine] 描述:', description);
    console.log('[ExcelEngine] 操作:', action);

    try {
      // 使用LLM生成表格结构
      const tableStructure = await this.generateTableStructureFromDescription(description, llmManager);

      // 生成Excel文件
      const fileName = `${tableStructure.name || 'table'}.xlsx`;
      const filePath = path.join(projectPath, fileName);

      const result = await this.writeExcel(filePath, tableStructure);

      return {
        type: 'excel-table',
        success: true,
        ...result,
        sheetCount: tableStructure.sheets?.length || 0,
        rowCount: tableStructure.sheets[0]?.rows?.length || 0
      };
    } catch (error) {
      console.error('[ExcelEngine] 任务执行失败:', error);
      throw error;
    }
  }

  /**
   * 从描述生成Excel表格结构
   * @param {string} description - 表格描述
   * @param {Object} llmManager - LLM管理器
   * @returns {Promise<Object>} 表格结构
   */
  async generateTableStructureFromDescription(description, llmManager) {
    const prompt = `请根据以下描述生成一份Excel表格的结构（JSON格式）：

${description}

返回JSON格式：
{
  "name": "工作簿名称",
  "sheets": [
    {
      "name": "Sheet1",
      "columns": [
        {"index": 0, "header": "列名1", "width": 150},
        {"index": 1, "header": "列名2", "width": 100}
      ],
      "rows": [
        {
          "rowNumber": 1,
          "values": [
            {"col": 1, "value": "列名1", "type": "string"},
            {"col": 2, "value": "列名2", "type": "string"}
          ]
        },
        {
          "rowNumber": 2,
          "values": [
            {"col": 1, "value": "数据1", "type": "string"},
            {"col": 2, "value": 100, "type": "number"}
          ]
        }
      ]
    }
  ]
}

要求：
1. name要简洁明确
2. sheets至少包含一个工作表
3. columns要定义所有列的表头和宽度
4. rows第一行应该是表头行（与columns对应）
5. 后续rows包含实际的数据行，每行的values要与columns数量一致
6. 根据数据性质设置正确的type（string/number/boolean/date）
7. 如果需要生成示例数据，请生成3-5行有意义的数据
8. 确保数据完整、真实、有意义

请只返回JSON，不要添加其他解释。`;

    try {
      let responseText;

      // 尝试使用本地LLM
      if (llmManager && llmManager.isInitialized) {
        console.log('[ExcelEngine] 使用本地LLM生成表格结构');
        const response = await llmManager.query(prompt, {
          temperature: 0.7,
          maxTokens: 3000
        });
        responseText = response.text;
      } else {
        // 降级到后端AI服务
        console.log('[ExcelEngine] 本地LLM不可用，使用后端AI服务');
        responseText = await this.queryBackendAI(prompt);
      }

      // 提取JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const structure = JSON.parse(jsonMatch[0]);
        return this.normalizeTableStructure(structure, description);
      }

      // 解析失败，返回默认结构
      return this.getDefaultTableStructure(description);
    } catch (error) {
      console.error('[ExcelEngine] 生成表格结构失败:', error);
      return this.getDefaultTableStructure(description);
    }
  }

  /**
   * 规范化表格结构
   */
  normalizeTableStructure(structure, description) {
    return {
      name: structure.name || description.substring(0, 30),
      sheets: (structure.sheets || []).map((sheet, sheetIndex) => ({
        name: sheet.name || `Sheet${sheetIndex + 1}`,
        id: sheetIndex + 1,
        columns: (sheet.columns || []).map((col, index) => ({
          index: col.index !== undefined ? col.index : index,
          header: col.header || `Column${index + 1}`,
          width: col.width || 150,
          key: col.key || `col_${index}`
        })),
        rows: (sheet.rows || []).map((row, rowIndex) => ({
          rowNumber: row.rowNumber || rowIndex + 1,
          values: (row.values || []).map((cell, colIndex) => ({
            col: cell.col || colIndex + 1,
            value: cell.value !== undefined ? cell.value : '',
            type: cell.type || 'string',
            style: cell.style,
            formula: cell.formula
          })),
          height: row.height || 20
        })),
        merges: sheet.merges || []
      })),
      metadata: {
        creator: 'ChainlessChain',
        created: new Date(),
        modified: new Date()
      }
    };
  }

  /**
   * 获取默认表格结构
   */
  getDefaultTableStructure(description) {
    return {
      name: description.substring(0, 30),
      sheets: [{
        name: 'Sheet1',
        id: 1,
        columns: [
          { index: 0, header: '项目', width: 200 },
          { index: 1, header: '内容', width: 300 },
          { index: 2, header: '备注', width: 150 }
        ],
        rows: [
          {
            rowNumber: 1,
            values: [
              { col: 1, value: '项目', type: 'string', style: { font: { bold: true } } },
              { col: 2, value: '内容', type: 'string', style: { font: { bold: true } } },
              { col: 3, value: '备注', type: 'string', style: { font: { bold: true } } }
            ]
          },
          {
            rowNumber: 2,
            values: [
              { col: 1, value: '用户需求', type: 'string' },
              { col: 2, value: description, type: 'string' },
              { col: 3, value: '请补充', type: 'string' }
            ]
          },
          {
            rowNumber: 3,
            values: [
              { col: 1, value: '示例数据', type: 'string' },
              { col: 2, value: '请根据实际需求填写数据', type: 'string' },
              { col: 3, value: '', type: 'string' }
            ]
          }
        ],
        merges: []
      }],
      metadata: {
        creator: 'ChainlessChain',
        created: new Date()
      }
    };
  }

  /**
   * 查询后端AI服务（降级方案）
   */
  async queryBackendAI(prompt) {
    const http = require('http');

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a helpful assistant. Return valid JSON only.' },
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

module.exports = new ExcelEngine();
