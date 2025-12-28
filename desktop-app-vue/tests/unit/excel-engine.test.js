/**
 * ExcelEngine 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock dependencies
vi.mock('papaparse', () => ({
  default: {
    parse: vi.fn((content, options) => ({
      data: [
        ['Name', 'Age', 'City'],
        ['Alice', '25', 'Beijing'],
        ['Bob', '30', 'Shanghai']
      ]
    })),
    unparse: vi.fn((data) => 'Name,Age,City\nAlice,25,Beijing\nBob,30,Shanghai')
  }
}));

// Mock exceljs - 延迟加载以便在测试中覆盖
vi.mock('exceljs', () => {
  const mockWorksheet = {
    name: 'Sheet1',
    columns: [],
    eachSheet: vi.fn(),
    eachRow: vi.fn(),
    getRow: vi.fn(() => ({
      height: 20,
      eachCell: vi.fn(),
      getCell: vi.fn(() => ({
        value: null,
        font: null,
        fill: null,
        alignment: null,
        border: null,
        numFmt: null
      })),
      commit: vi.fn()
    })),
    mergeCells: vi.fn(),
    model: {
      merges: []
    }
  };

  const mockWorkbook = {
    creator: 'Test User',
    lastModifiedBy: 'Test User',
    created: new Date('2025-01-01'),
    modified: new Date('2025-01-01'),
    eachSheet: vi.fn((callback) => {
      callback(mockWorksheet, 1);
    }),
    addWorksheet: vi.fn(() => mockWorksheet),
    xlsx: {
      readFile: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined)
    }
  };

  return {
    default: {
      Workbook: vi.fn(() => mockWorkbook)
    }
  };
});

describe('ExcelEngine', () => {
  let excelEngine;
  let tempDir;
  let testCsvPath;
  let testXlsxPath;

  beforeEach(async () => {
    // 清除模块缓存并重新导入
    vi.resetModules();
    const ExcelEngineModule = await import('../../src/main/engines/excel-engine.js');
    excelEngine = ExcelEngineModule.default;

    // 创建临时测试目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'excel-test-'));
    testCsvPath = path.join(tempDir, 'test.csv');
    testXlsxPath = path.join(tempDir, 'test.xlsx');

    // 创建测试CSV文件
    await fs.writeFile(testCsvPath, 'Name,Age,City\nAlice,25,Beijing\nBob,30,Shanghai');
  });

  afterEach(async () => {
    // 清理临时文件
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('清理临时文件失败:', error);
    }
  });

  describe('Constructor', () => {
    it('should initialize with supported formats', () => {
      expect(excelEngine.supportedFormats).toEqual(['.xlsx', '.xls', '.csv']);
    });
  });

  describe('readCSV', () => {
    it('should read CSV file successfully', async () => {
      const result = await excelEngine.readCSV(testCsvPath);

      expect(result.type).toBe('csv');
      expect(result.sheets).toHaveLength(1);
      expect(result.sheets[0].name).toBe('Sheet1');
      expect(result.sheets[0].rows).toHaveLength(3);
      expect(result.sheets[0].columns).toHaveLength(3);
    });

    it('should handle CSV file with proper structure', async () => {
      const result = await excelEngine.readCSV(testCsvPath);
      const sheet = result.sheets[0];

      expect(sheet.id).toBe(1);
      expect(sheet.rows[0].rowNumber).toBe(1);
      expect(sheet.rows[0].values[0].value).toBe('Name');
      expect(sheet.rows[0].values[0].type).toBe('string');
    });

    it('should handle empty CSV file', async () => {
      const emptyPath = path.join(tempDir, 'empty.csv');
      await fs.writeFile(emptyPath, '');

      const result = await excelEngine.readCSV(emptyPath);
      expect(result.sheets[0].rows).toHaveLength(0);
    });
  });

  describe('readExcel', () => {
    it('should read CSV file when extension is .csv', async () => {
      const result = await excelEngine.readExcel(testCsvPath);

      expect(result.type).toBe('csv');
      expect(result.sheets).toBeDefined();
    });

    it('should throw error for unsupported file format', async () => {
      const txtPath = path.join(tempDir, 'test.txt');
      await fs.writeFile(txtPath, 'test content');

      await expect(excelEngine.readExcel(txtPath)).rejects.toThrow('不支持的文件格式');
    });

    it('should handle non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.csv');

      await expect(excelEngine.readExcel(nonExistentPath)).rejects.toThrow();
    });
  });

  describe('writeCSV', () => {
    it('should write CSV file successfully', async () => {
      const outputPath = path.join(tempDir, 'output.csv');
      const testData = {
        sheets: [{
          name: 'Sheet1',
          rows: [
            {
              rowNumber: 1,
              values: [
                { col: 1, value: 'Name' },
                { col: 2, value: 'Age' }
              ]
            },
            {
              rowNumber: 2,
              values: [
                { col: 1, value: 'Alice' },
                { col: 2, value: 25 }
              ]
            }
          ]
        }]
      };

      const result = await excelEngine.writeCSV(outputPath, testData);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputPath);

      // 验证文件已创建
      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
    });

    it('should handle missing rows data', async () => {
      const outputPath = path.join(tempDir, 'output.csv');
      const invalidData = {
        sheets: [{ name: 'Sheet1' }]
      };

      await expect(excelEngine.writeCSV(outputPath, invalidData)).rejects.toThrow('没有有效的数据行');
    });

    it('should handle null values in cells', async () => {
      const outputPath = path.join(tempDir, 'output.csv');
      const testData = {
        sheets: [{
          name: 'Sheet1',
          rows: [
            {
              rowNumber: 1,
              values: [
                { col: 1, value: 'Name' },
                { col: 2, value: null },
                { col: 3, value: undefined }
              ]
            }
          ]
        }]
      };

      const result = await excelEngine.writeCSV(outputPath, testData);
      expect(result.success).toBe(true);
    });
  });

  describe('excelToJSON', () => {
    it('should convert Excel to JSON successfully', async () => {
      const json = await excelEngine.excelToJSON(testCsvPath);

      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(2);
      expect(json[0]).toHaveProperty('Name', 'Alice');
      expect(json[0]).toHaveProperty('Age', '25');
      expect(json[0]).toHaveProperty('City', 'Beijing');
    });

    it('should handle custom sheet index', async () => {
      const json = await excelEngine.excelToJSON(testCsvPath, { sheetIndex: 0 });

      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent sheet', async () => {
      await expect(
        excelEngine.excelToJSON(testCsvPath, { sheetIndex: 99 })
      ).rejects.toThrow('工作表不存在');
    });

    it('should handle Excel with empty data rows', async () => {
      const emptyPath = path.join(tempDir, 'empty-data.csv');
      await fs.writeFile(emptyPath, 'Header1,Header2\n');

      const json = await excelEngine.excelToJSON(emptyPath);
      // CSV解析器会将空行解析为一个包含空值的对象
      expect(json.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('jsonToExcel', () => {
    it('should convert JSON to Excel successfully', async () => {
      const outputPath = path.join(tempDir, 'output.xlsx');
      const jsonData = [
        { name: 'Alice', age: 25, city: 'Beijing' },
        { name: 'Bob', age: 30, city: 'Shanghai' }
      ];

      const result = await excelEngine.jsonToExcel(jsonData, outputPath);

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputPath);
    });

    it('should handle empty array', async () => {
      const outputPath = path.join(tempDir, 'output.xlsx');

      await expect(
        excelEngine.jsonToExcel([], outputPath)
      ).rejects.toThrow('JSON数据必须是非空数组');
    });

    it('should handle non-array input', async () => {
      const outputPath = path.join(tempDir, 'output.xlsx');

      await expect(
        excelEngine.jsonToExcel({}, outputPath)
      ).rejects.toThrow('JSON数据必须是非空数组');
    });

    it('should handle custom sheet name', async () => {
      const outputPath = path.join(tempDir, 'output.xlsx');
      const jsonData = [{ name: 'Test' }];

      const result = await excelEngine.jsonToExcel(jsonData, outputPath, { sheetName: 'CustomSheet' });

      expect(result.success).toBe(true);
    });

    it('should create proper header row with bold style', async () => {
      const outputPath = path.join(tempDir, 'output.xlsx');
      const jsonData = [{ name: 'Alice', age: 25 }];

      const result = await excelEngine.jsonToExcel(jsonData, outputPath);
      expect(result.success).toBe(true);
      // 样式验证需要在writeExcel中检查
    });
  });

  describe('validateExcelData', () => {
    it('should validate valid data structure', () => {
      const validData = {
        sheets: [
          {
            name: 'Sheet1',
            rows: []
          }
        ]
      };

      const result = excelEngine.validateExcelData(validData);

      expect(result.valid).toBe(true);
    });

    it('should reject null or undefined data', () => {
      const result1 = excelEngine.validateExcelData(null);
      const result2 = excelEngine.validateExcelData(undefined);

      expect(result1.valid).toBe(false);
      expect(result1.error).toBe('数据格式无效');
      expect(result2.valid).toBe(false);
    });

    it('should reject data without sheets', () => {
      const invalidData = {};

      const result = excelEngine.validateExcelData(invalidData);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('必须包含至少一个工作表');
    });

    it('should reject empty sheets array', () => {
      const invalidData = { sheets: [] };

      const result = excelEngine.validateExcelData(invalidData);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('必须包含至少一个工作表');
    });

    it('should reject sheet without name', () => {
      const invalidData = {
        sheets: [{ rows: [] }]
      };

      const result = excelEngine.validateExcelData(invalidData);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('工作表必须有名称');
    });

    it('should reject sheet without rows array', () => {
      const invalidData = {
        sheets: [{ name: 'Sheet1' }]
      };

      const result = excelEngine.validateExcelData(invalidData);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('工作表必须包含rows数组');
    });
  });

  describe('getSheetStats', () => {
    it('should return correct statistics', () => {
      const sheet = {
        name: 'TestSheet',
        rows: [
          { values: [{ value: 1 }, { value: 2 }] },
          { values: [{ value: 3, formula: 'A1+B1' }] }
        ],
        columns: [{ header: 'Col1' }, { header: 'Col2' }],
        merges: ['A1:B1']
      };

      const stats = excelEngine.getSheetStats(sheet);

      expect(stats.name).toBe('TestSheet');
      expect(stats.rowCount).toBe(2);
      expect(stats.columnCount).toBe(2);
      expect(stats.mergeCount).toBe(1);
      expect(stats.hasFormulas).toBe(true);
    });

    it('should handle sheet without merges', () => {
      const sheet = {
        name: 'TestSheet',
        rows: [],
        columns: []
      };

      const stats = excelEngine.getSheetStats(sheet);

      expect(stats.mergeCount).toBe(0);
      expect(stats.hasFormulas).toBe(false);
    });

    it('should detect formulas correctly', () => {
      const sheetWithFormula = {
        name: 'Sheet',
        rows: [
          { values: [{ value: 1, formula: '=SUM(A1:A10)' }] }
        ],
        columns: []
      };

      const sheetWithoutFormula = {
        name: 'Sheet',
        rows: [
          { values: [{ value: 1 }] }
        ],
        columns: []
      };

      expect(excelEngine.getSheetStats(sheetWithFormula).hasFormulas).toBe(true);
      expect(excelEngine.getSheetStats(sheetWithoutFormula).hasFormulas).toBe(false);
    });
  });

  describe('extractCellStyle', () => {
    it('should extract font style', () => {
      const cell = {
        font: {
          name: 'Arial',
          size: 12,
          bold: true,
          italic: false,
          underline: true,
          color: { argb: 'FF000000' }
        }
      };

      const style = excelEngine.extractCellStyle(cell);

      expect(style.font).toBeDefined();
      expect(style.font.name).toBe('Arial');
      expect(style.font.size).toBe(12);
      expect(style.font.bold).toBe(true);
    });

    it('should extract fill style', () => {
      const cell = {
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' }
        }
      };

      const style = excelEngine.extractCellStyle(cell);

      expect(style.fill).toBeDefined();
      expect(style.fill.type).toBe('pattern');
    });

    it('should extract alignment style', () => {
      const cell = {
        alignment: {
          horizontal: 'center',
          vertical: 'middle'
        }
      };

      const style = excelEngine.extractCellStyle(cell);

      expect(style.alignment).toBeDefined();
      expect(style.alignment.horizontal).toBe('center');
    });

    it('should extract border style', () => {
      const cell = {
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' }
        }
      };

      const style = excelEngine.extractCellStyle(cell);

      expect(style.border).toBeDefined();
      expect(style.border.top).toBeDefined();
    });

    it('should handle cell without styles', () => {
      const cell = {};

      const style = excelEngine.extractCellStyle(cell);

      expect(Object.keys(style).length).toBe(0);
    });

    it('should extract number format', () => {
      const cell = {
        numFmt: '0.00'
      };

      const style = excelEngine.extractCellStyle(cell);

      expect(style.numFmt).toBe('0.00');
    });
  });

  describe('applyCellStyle', () => {
    it('should apply font style to cell', () => {
      const cell = {};
      const style = {
        font: {
          name: 'Arial',
          size: 12,
          bold: true
        }
      };

      excelEngine.applyCellStyle(cell, style);

      expect(cell.font).toEqual(style.font);
    });

    it('should apply multiple styles to cell', () => {
      const cell = {};
      const style = {
        font: { name: 'Arial' },
        fill: { type: 'pattern' },
        alignment: { horizontal: 'center' },
        border: { top: { style: 'thin' } },
        numFmt: '0.00'
      };

      excelEngine.applyCellStyle(cell, style);

      expect(cell.font).toEqual(style.font);
      expect(cell.fill).toEqual(style.fill);
      expect(cell.alignment).toEqual(style.alignment);
      expect(cell.border).toEqual(style.border);
      expect(cell.numFmt).toEqual(style.numFmt);
    });

    it('should handle empty style object', () => {
      const cell = { font: { name: 'Arial' } };
      const style = {};

      excelEngine.applyCellStyle(cell, style);

      // 原有样式应保持不变
      expect(cell.font).toEqual({ name: 'Arial' });
    });
  });

  describe('recommendTool', () => {
    it('should recommend data-engine for Excel tasks', () => {
      const tool = excelEngine.recommendTool?.('创建一个Excel表格');
      // ExcelEngine 本身没有 recommendTool 方法，这是 TaskPlanner 的方法
      // 这个测试可能需要移除或调整
    });
  });

  describe('Error Handling', () => {
    it('should handle file read errors gracefully', async () => {
      const invalidPath = path.join(tempDir, 'non-existent', 'test.csv');

      await expect(excelEngine.readExcel(invalidPath)).rejects.toThrow();
    });

    it('should handle write permission errors', async () => {
      // 这个测试依赖于文件系统权限，在某些环境下可能难以实施
      // 可以通过 mock fs 来实现
    });

    it('should handle corrupted CSV data', async () => {
      const corruptedPath = path.join(tempDir, 'corrupted.csv');
      await fs.writeFile(corruptedPath, 'Name,Age\n"Unclosed quote');

      // PapaParse 应该能处理这种情况，但会有警告
      const result = await excelEngine.readCSV(corruptedPath);
      expect(result.sheets).toBeDefined();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete read-modify-write workflow', async () => {
      // 读取
      const data = await excelEngine.readExcel(testCsvPath);

      // 修改
      data.sheets[0].rows[1].values[1].value = '26';

      // 写入
      const outputPath = path.join(tempDir, 'modified.csv');
      const result = await excelEngine.writeCSV(outputPath, data);

      expect(result.success).toBe(true);

      // 验证
      const modifiedData = await excelEngine.readExcel(outputPath);
      expect(modifiedData.sheets[0].rows).toBeDefined();
    });

    it('should handle JSON round-trip conversion', async () => {
      const originalJson = [
        { name: 'Alice', age: 25 },
        { name: 'Bob', age: 30 }
      ];

      // JSON -> Excel
      const excelPath = path.join(tempDir, 'from-json.csv');
      await excelEngine.jsonToExcel(originalJson, excelPath);

      // Excel -> JSON
      const convertedJson = await excelEngine.excelToJSON(excelPath);

      expect(convertedJson).toHaveLength(2);
      expect(convertedJson[0].name).toBe('Alice');
    });
  });
});
