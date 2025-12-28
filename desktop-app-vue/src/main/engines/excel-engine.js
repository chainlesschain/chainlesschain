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
                if (global.gc) global.gc();
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
}

module.exports = new ExcelEngine();
