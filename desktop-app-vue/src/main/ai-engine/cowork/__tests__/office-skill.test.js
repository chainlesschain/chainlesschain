/**
 * OfficeSkill 单元测试
 */

const { OfficeSkill } = require('../skills/office-skill');
const { SkillRegistry } = require('../skills/skill-registry');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('OfficeSkill', () => {
  let officeSkill;
  let skillRegistry;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'office-skill-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    officeSkill = new OfficeSkill();
    skillRegistry = new SkillRegistry();
    skillRegistry.register(officeSkill);
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  // ==========================================
  // canHandle 测试
  // ==========================================

  describe('canHandle', () => {
    test('应该识别 Excel 任务', () => {
      const task = {
        name: '生成销售报表',
        type: 'office',
        operation: 'createExcel',
        data: { columns: ['产品', '销量'], rows: [] },
      };

      const score = officeSkill.canHandle(task);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    test('应该识别 Word 任务', () => {
      const task = {
        name: '创建报告文档',
        type: 'office',
        operation: 'createWord',
        content: { title: '年度报告' },
      };

      const score = officeSkill.canHandle(task);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    test('应该识别 PowerPoint 任务', () => {
      const task = {
        name: '生成演示文稿',
        type: 'office',
        operation: 'createPowerPoint',
        slides: [{ title: '产品介绍' }],
      };

      const score = officeSkill.canHandle(task);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    test('应该识别数据分析任务', () => {
      const task = {
        name: '分析销售数据',
        type: 'office',
        operation: 'performDataAnalysis',
        data: [],
      };

      const score = officeSkill.canHandle(task);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    test('应该拒绝不相关任务', () => {
      const task = {
        name: '编译代码',
        type: 'build',
        operation: 'compile',
      };

      const score = officeSkill.canHandle(task);
      expect(score).toBeLessThan(30);
    });
  });

  // ==========================================
  // createExcel 测试
  // ==========================================

  describe('createExcel', () => {
    test('应该创建简单的 Excel 文件', async () => {
      const outputPath = path.join(testDir, 'simple.xlsx');
      const input = {
        outputPath,
        sheetName: '销售数据',
        columns: [
          { header: '产品', key: 'product', width: 20 },
          { header: '销量', key: 'sales', width: 15 },
          { header: '金额', key: 'amount', width: 15 },
        ],
        rows: [
          { product: '产品 A', sales: 100, amount: 5000 },
          { product: '产品 B', sales: 150, amount: 7500 },
          { product: '产品 C', sales: 80, amount: 4000 },
        ],
      };

      const result = await officeSkill.createExcel(input, {});

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputPath);
      expect(result.rowCount).toBe(3);

      // 验证文件存在
      const stats = await fs.stat(outputPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    test('应该支持多个工作表', async () => {
      const outputPath = path.join(testDir, 'multi-sheet.xlsx');
      const input = {
        outputPath,
        sheets: [
          {
            name: '第一季度',
            columns: [{ header: '月份', key: 'month' }],
            rows: [{ month: '1月' }, { month: '2月' }, { month: '3月' }],
          },
          {
            name: '第二季度',
            columns: [{ header: '月份', key: 'month' }],
            rows: [{ month: '4月' }, { month: '5月' }, { month: '6月' }],
          },
        ],
      };

      const result = await officeSkill.createExcel(input, {});

      expect(result.success).toBe(true);
      expect(result.sheetsCreated).toBe(2);
    });

    test('应该应用样式', async () => {
      const outputPath = path.join(testDir, 'styled.xlsx');
      const input = {
        outputPath,
        sheetName: '样式测试',
        columns: [{ header: '列 A', key: 'colA' }],
        rows: [{ colA: '数据 1' }],
        applyStyles: true,
      };

      const result = await officeSkill.createExcel(input, {});

      expect(result.success).toBe(true);
      expect(result.stylesApplied).toBe(true);
    });

    test('应该拒绝无效输入', async () => {
      const input = {
        // 缺少 outputPath
        columns: [],
        rows: [],
      };

      await expect(officeSkill.createExcel(input, {})).rejects.toThrow();
    });
  });

  // ==========================================
  // createWord 测试
  // ==========================================

  describe('createWord', () => {
    test('应该创建简单的 Word 文档', async () => {
      const outputPath = path.join(testDir, 'simple.docx');
      const input = {
        outputPath,
        title: '测试文档',
        sections: [
          {
            heading: '第一章',
            paragraphs: [
              '这是第一段内容。',
              '这是第二段内容。',
            ],
          },
          {
            heading: '第二章',
            paragraphs: [
              '这是另一章的内容。',
            ],
          },
        ],
      };

      const result = await officeSkill.createWord(input, {});

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputPath);
      expect(result.sectionsCreated).toBe(2);

      // 验证文件存在
      const stats = await fs.stat(outputPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    test('应该支持多种文本样式', async () => {
      const outputPath = path.join(testDir, 'styled.docx');
      const input = {
        outputPath,
        title: '样式测试',
        sections: [
          {
            heading: '样式示例',
            paragraphs: [
              { text: '普通文本', style: 'normal' },
              { text: '粗体文本', style: 'bold' },
              { text: '斜体文本', style: 'italic' },
            ],
          },
        ],
      };

      const result = await officeSkill.createWord(input, {});

      expect(result.success).toBe(true);
      expect(result.stylesApplied).toBeGreaterThanOrEqual(1);
    });

    test('应该拒绝无效输入', async () => {
      const input = {
        // 缺少 outputPath
        title: '无效文档',
      };

      await expect(officeSkill.createWord(input, {})).rejects.toThrow();
    });
  });

  // ==========================================
  // createPowerPoint 测试
  // ==========================================

  describe('createPowerPoint', () => {
    test('应该创建简单的 PPT 文件', async () => {
      const outputPath = path.join(testDir, 'simple.pptx');
      const input = {
        outputPath,
        title: '产品演示',
        slides: [
          {
            title: '封面',
            content: '欢迎使用我们的产品',
          },
          {
            title: '产品特性',
            bullets: [
              '特性 1：高性能',
              '特性 2：易用性',
              '特性 3：安全可靠',
            ],
          },
          {
            title: '总结',
            content: '感谢观看',
          },
        ],
      };

      const result = await officeSkill.createPowerPoint(input, {});

      expect(result.success).toBe(true);
      expect(result.filePath).toBe(outputPath);
      expect(result.slidesCreated).toBe(3);

      // 验证文件存在
      const stats = await fs.stat(outputPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(0);
    });

    test('应该支持图表幻灯片', async () => {
      const outputPath = path.join(testDir, 'with-chart.pptx');
      const input = {
        outputPath,
        title: '数据报告',
        slides: [
          {
            title: '销售趋势',
            chartType: 'bar',
            chartData: {
              labels: ['Q1', 'Q2', 'Q3', 'Q4'],
              datasets: [
                {
                  name: '销售额',
                  values: [100, 150, 120, 180],
                },
              ],
            },
          },
        ],
      };

      const result = await officeSkill.createPowerPoint(input, {});

      expect(result.success).toBe(true);
      expect(result.chartsCreated).toBeGreaterThanOrEqual(1);
    });

    test('应该拒绝无效输入', async () => {
      const input = {
        // 缺少 outputPath
        title: '无效 PPT',
      };

      await expect(officeSkill.createPowerPoint(input, {})).rejects.toThrow();
    });
  });

  // ==========================================
  // performDataAnalysis 测试
  // ==========================================

  describe('performDataAnalysis', () => {
    test('应该执行数据汇总', async () => {
      const input = {
        operation: 'summary',
        data: [
          { product: '产品 A', sales: 100, amount: 5000 },
          { product: '产品 B', sales: 150, amount: 7500 },
          { product: '产品 C', sales: 80, amount: 4000 },
        ],
        columns: ['sales', 'amount'],
      };

      const result = await officeSkill.performDataAnalysis(input, {});

      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary.sales).toBeDefined();
      expect(result.summary.sales.total).toBe(330);
      expect(result.summary.sales.average).toBeCloseTo(110, 1);
      expect(result.summary.sales.min).toBe(80);
      expect(result.summary.sales.max).toBe(150);
    });

    test('应该执行统计分析', async () => {
      const input = {
        operation: 'statistics',
        data: [
          { value: 10 },
          { value: 20 },
          { value: 30 },
          { value: 40 },
          { value: 50 },
        ],
        column: 'value',
      };

      const result = await officeSkill.performDataAnalysis(input, {});

      expect(result.success).toBe(true);
      expect(result.statistics).toBeDefined();
      expect(result.statistics.mean).toBe(30);
      expect(result.statistics.median).toBe(30);
      expect(result.statistics.variance).toBeGreaterThan(0);
      expect(result.statistics.stdDev).toBeGreaterThan(0);
    });

    test('应该执行分组汇总', async () => {
      const input = {
        operation: 'groupBy',
        data: [
          { category: 'A', sales: 100 },
          { category: 'A', sales: 150 },
          { category: 'B', sales: 200 },
          { category: 'B', sales: 250 },
        ],
        groupByColumn: 'category',
        aggregateColumn: 'sales',
        aggregateFunction: 'sum',
      };

      const result = await officeSkill.performDataAnalysis(input, {});

      expect(result.success).toBe(true);
      expect(result.groups).toBeDefined();
      expect(result.groups.A).toBe(250);
      expect(result.groups.B).toBe(450);
    });

    test('应该支持多种聚合函数', async () => {
      const data = [
        { category: 'A', value: 10 },
        { category: 'A', value: 20 },
        { category: 'B', value: 30 },
      ];

      // 测试 sum
      const sumResult = await officeSkill.performDataAnalysis({
        operation: 'groupBy',
        data,
        groupByColumn: 'category',
        aggregateColumn: 'value',
        aggregateFunction: 'sum',
      }, {});
      expect(sumResult.groups.A).toBe(30);

      // 测试 average
      const avgResult = await officeSkill.performDataAnalysis({
        operation: 'groupBy',
        data,
        groupByColumn: 'category',
        aggregateColumn: 'value',
        aggregateFunction: 'average',
      }, {});
      expect(avgResult.groups.A).toBe(15);

      // 测试 count
      const countResult = await officeSkill.performDataAnalysis({
        operation: 'groupBy',
        data,
        groupByColumn: 'category',
        aggregateColumn: 'value',
        aggregateFunction: 'count',
      }, {});
      expect(countResult.groups.A).toBe(2);
      expect(countResult.groups.B).toBe(1);
    });

    test('应该拒绝无效操作', async () => {
      const input = {
        operation: 'invalid_operation',
        data: [],
      };

      await expect(officeSkill.performDataAnalysis(input, {})).rejects.toThrow();
    });
  });

  // ==========================================
  // SkillRegistry 集成测试
  // ==========================================

  describe('SkillRegistry 集成', () => {
    test('应该从注册表中找到 OfficeSkill', () => {
      const skills = skillRegistry.findSkillsForTask({
        type: 'office',
        operation: 'createExcel',
      });

      expect(skills.length).toBeGreaterThanOrEqual(1);
      expect(skills[0].skill).toBe(officeSkill);
      expect(skills[0].score).toBeGreaterThanOrEqual(80);
    });

    test('应该自动选择最佳技能', () => {
      const bestSkill = skillRegistry.selectBestSkill({
        type: 'office',
        operation: 'createWord',
      });

      expect(bestSkill).toBe(officeSkill);
    });

    test('应该自动执行任务', async () => {
      const outputPath = path.join(testDir, 'auto-excel.xlsx');
      const task = {
        type: 'office',
        operation: 'createExcel',
        input: {
          outputPath,
          sheetName: '自动生成',
          columns: [{ header: '测试', key: 'test' }],
          rows: [{ test: '数据' }],
        },
      };

      const result = await skillRegistry.autoExecute(task, {});

      expect(result.success).toBe(true);
      expect(result.result.filePath).toBe(outputPath);

      // 验证文件存在
      const stats = await fs.stat(outputPath);
      expect(stats.isFile()).toBe(true);
    });
  });

  // ==========================================
  // 性能和错误处理测试
  // ==========================================

  describe('性能和错误处理', () => {
    test('应该处理大量数据', async () => {
      const outputPath = path.join(testDir, 'large-data.xlsx');
      const rows = [];
      for (let i = 0; i < 1000; i++) {
        rows.push({ id: i, value: Math.random() * 100 });
      }

      const input = {
        outputPath,
        sheetName: '大数据',
        columns: [
          { header: 'ID', key: 'id' },
          { header: '值', key: 'value' },
        ],
        rows,
      };

      const startTime = Date.now();
      const result = await officeSkill.createExcel(input, {});
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.rowCount).toBe(1000);
      expect(duration).toBeLessThan(5000); // 应该在 5 秒内完成
    });

    test('应该优雅处理文件写入错误', async () => {
      const invalidPath = '/invalid/path/file.xlsx';
      const input = {
        outputPath: invalidPath,
        sheetName: '测试',
        columns: [{ header: '列', key: 'col' }],
        rows: [{ col: '数据' }],
      };

      await expect(officeSkill.createExcel(input, {})).rejects.toThrow();
    });

    test('应该记录执行指标', async () => {
      const outputPath = path.join(testDir, 'metrics.xlsx');
      const task = {
        type: 'office',
        operation: 'createExcel',
        input: {
          outputPath,
          sheetName: '指标测试',
          columns: [{ header: '测试', key: 'test' }],
          rows: [{ test: '数据' }],
        },
      };

      const result = await officeSkill.executeWithMetrics(task, {});

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.duration).toBeGreaterThan(0);
      expect(result.metrics.timestamp).toBeTruthy();
    });
  });

  // ==========================================
  // 输入验证测试
  // ==========================================

  describe('输入验证', () => {
    test('应该验证 Excel 输入', () => {
      const schema = {
        outputPath: { type: 'string', required: true },
        columns: { type: 'array', required: true },
        rows: { type: 'array', required: true },
      };

      const validInput = {
        outputPath: '/path/to/file.xlsx',
        columns: [{ header: 'A', key: 'a' }],
        rows: [{ a: 1 }],
      };

      const invalidInput = {
        // 缺少 outputPath
        columns: [],
        rows: [],
      };

      expect(() => officeSkill.validateInput(validInput, schema)).not.toThrow();
      expect(() => officeSkill.validateInput(invalidInput, schema)).toThrow();
    });

    test('应该验证数据类型', () => {
      const schema = {
        name: { type: 'string', required: true },
        age: { type: 'number', required: true },
        active: { type: 'boolean', required: false },
      };

      const validInput = {
        name: 'Alice',
        age: 30,
        active: true,
      };

      const invalidInput = {
        name: 'Bob',
        age: 'thirty', // 类型错误
      };

      expect(() => officeSkill.validateInput(validInput, schema)).not.toThrow();
      expect(() => officeSkill.validateInput(invalidInput, schema)).toThrow();
    });
  });
});
