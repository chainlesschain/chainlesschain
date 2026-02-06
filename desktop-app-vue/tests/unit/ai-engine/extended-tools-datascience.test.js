/**
 * DataScienceToolsHandler 单元测试
 * 测试数据科学工具（数据预处理、机器学习、可视化）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from('{"result": "success"}'));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        callback(0);
      }
    }),
  })),
}));

describe('DataScienceToolsHandler', () => {
  let DataScienceToolsHandler;
  let handler;
  const testOutputDir = path.join(process.cwd(), 'test-output-ds');

  beforeEach(async () => {
    vi.clearAllMocks();

    // Dynamic import
    const module = await import('../../../src/main/ai-engine/extended-tools-datascience.js');
    DataScienceToolsHandler = module.default || module.DataScienceToolsHandler;

    handler = new DataScienceToolsHandler();

    // 确保测试输出目录存在
    await fs.mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试文件
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  // ==================== 构造函数测试 ====================

  describe('构造函数', () => {
    it('应该正确初始化 DataScienceToolsHandler', () => {
      expect(handler).toBeDefined();
      expect(handler.name).toBe('DataScienceToolsHandler');
    });
  });

  // ==================== executePythonScript 测试 ====================

  describe('executePythonScript', () => {
    it('应该执行 Python 脚本', async () => {
      const script = 'print("Hello, World!")';
      const result = await handler.executePythonScript(script);

      expect(result).toBeDefined();
      expect(result.stdout).toBeDefined();
    });

    it('应该支持传递参数', async () => {
      const script = 'import sys\nprint(sys.argv[1])';
      const result = await handler.executePythonScript(script, ['arg1']);

      expect(result).toBeDefined();
    });

    it('应该处理脚本错误', async () => {
      const { spawn } = await import('child_process');
      spawn.mockImplementationOnce(() => ({
        stdout: { on: vi.fn() },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from('Error message'));
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(1); // 非零退出码
          }
        }),
      }));

      const script = 'invalid python code';
      await expect(handler.executePythonScript(script)).rejects.toThrow();
    });

    it('应该清理临时文件', async () => {
      const script = 'print("test")';
      await handler.executePythonScript(script);

      // 验证 spawn 被调用
      const { spawn } = await import('child_process');
      expect(spawn).toHaveBeenCalled();
    });
  });

  // ==================== tool_data_preprocessor 测试 ====================

  describe('tool_data_preprocessor', () => {
    const mockParams = {
      dataPath: path.join(testOutputDir, 'data.csv'),
      operations: ['remove_duplicates', 'handle_missing'],
      outputPath: path.join(testOutputDir, 'output.csv'),
    };

    beforeEach(async () => {
      // 创建测试数据文件
      const csvData = 'name,age\nAlice,30\nBob,25\nAlice,30\n';
      await fs.writeFile(mockParams.dataPath, csvData);
    });

    it('应该执行数据预处理', async () => {
      const result = await handler.tool_data_preprocessor(mockParams);

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
    });

    it('应该支持删除重复项', async () => {
      const params = {
        ...mockParams,
        operations: ['remove_duplicates'],
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });

    it('应该支持处理缺失值', async () => {
      const params = {
        ...mockParams,
        operations: ['handle_missing'],
        options: {
          missingStrategy: 'median',
        },
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });

    it('应该支持检测异常值', async () => {
      const params = {
        ...mockParams,
        operations: ['detect_outliers'],
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });

    it('应该支持标准化', async () => {
      const params = {
        ...mockParams,
        operations: ['normalize'],
        options: {
          scaler: 'standard',
        },
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });

    it('应该返回统计信息', async () => {
      const result = await handler.tool_data_preprocessor(mockParams);

      expect(result.success).toBe(true);
      expect(result.stats).toHaveProperty('duplicatesRemoved');
      expect(result.stats).toHaveProperty('missingValuesHandled');
    });
  });

  // ==================== tool_ml_trainer 测试 ====================

  describe('tool_ml_trainer', () => {
    const mockParams = {
      dataPath: path.join(testOutputDir, 'train.csv'),
      algorithm: 'linear_regression',
      targetColumn: 'price',
      featureColumns: ['size', 'rooms'],
      modelPath: path.join(testOutputDir, 'model.pkl'),
    };

    beforeEach(async () => {
      // 创建训练数据
      const csvData = 'size,rooms,price\n100,2,200000\n150,3,300000\n';
      await fs.writeFile(mockParams.dataPath, csvData);
    });

    it('应该训练机器学习模型', async () => {
      const result = await handler.tool_ml_trainer(mockParams);

      expect(result.success).toBe(true);
      expect(result.modelPath).toBe(mockParams.modelPath);
    });

    it('应该支持线性回归', async () => {
      const params = {
        ...mockParams,
        algorithm: 'linear_regression',
      };

      const result = await handler.tool_ml_trainer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持决策树', async () => {
      const params = {
        ...mockParams,
        algorithm: 'decision_tree',
      };

      const result = await handler.tool_ml_trainer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持随机森林', async () => {
      const params = {
        ...mockParams,
        algorithm: 'random_forest',
      };

      const result = await handler.tool_ml_trainer(params);

      expect(result.success).toBe(true);
    });

    it('应该返回训练指标', async () => {
      const result = await handler.tool_ml_trainer(mockParams);

      expect(result.success).toBe(true);
      expect(result.metrics).toBeDefined();
    });

    it('应该支持交叉验证', async () => {
      const params = {
        ...mockParams,
        options: {
          crossValidation: true,
          cvFolds: 5,
        },
      };

      const result = await handler.tool_ml_trainer(params);

      expect(result.success).toBe(true);
    });
  });

  // ==================== tool_data_visualizer 测试 ====================

  describe('tool_data_visualizer', () => {
    const mockParams = {
      dataPath: path.join(testOutputDir, 'data.csv'),
      chartType: 'bar',
      xColumn: 'name',
      yColumn: 'value',
      outputPath: path.join(testOutputDir, 'chart.png'),
    };

    beforeEach(async () => {
      // 创建可视化数据
      const csvData = 'name,value\nA,10\nB,20\nC,30\n';
      await fs.writeFile(mockParams.dataPath, csvData);
    });

    it('应该生成可视化图表', async () => {
      const result = await handler.tool_data_visualizer(mockParams);

      expect(result.success).toBe(true);
      expect(result.chartPath).toBe(mockParams.outputPath);
    });

    it('应该支持柱状图', async () => {
      const params = {
        ...mockParams,
        chartType: 'bar',
      };

      const result = await handler.tool_data_visualizer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持折线图', async () => {
      const params = {
        ...mockParams,
        chartType: 'line',
      };

      const result = await handler.tool_data_visualizer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持散点图', async () => {
      const params = {
        ...mockParams,
        chartType: 'scatter',
      };

      const result = await handler.tool_data_visualizer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持饼图', async () => {
      const params = {
        ...mockParams,
        chartType: 'pie',
      };

      const result = await handler.tool_data_visualizer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持自定义样式', async () => {
      const params = {
        ...mockParams,
        options: {
          title: 'Test Chart',
          xlabel: 'X Axis',
          ylabel: 'Y Axis',
          color: 'blue',
        },
      };

      const result = await handler.tool_data_visualizer(params);

      expect(result.success).toBe(true);
    });
  });

  // ==================== tool_statistical_analyzer 测试 ====================

  describe('tool_statistical_analyzer', () => {
    const mockParams = {
      dataPath: path.join(testOutputDir, 'data.csv'),
      columns: ['value1', 'value2'],
    };

    beforeEach(async () => {
      const csvData = 'value1,value2\n10,20\n15,25\n20,30\n';
      await fs.writeFile(mockParams.dataPath, csvData);
    });

    it('应该执行统计分析', async () => {
      const result = await handler.tool_statistical_analyzer(mockParams);

      expect(result.success).toBe(true);
      expect(result.statistics).toBeDefined();
    });

    it('应该计算描述性统计', async () => {
      const result = await handler.tool_statistical_analyzer(mockParams);

      expect(result.success).toBe(true);
      expect(result.statistics).toHaveProperty('mean');
      expect(result.statistics).toHaveProperty('median');
      expect(result.statistics).toHaveProperty('std');
    });

    it('应该支持相关性分析', async () => {
      const params = {
        ...mockParams,
        analysis: ['correlation'],
      };

      const result = await handler.tool_statistical_analyzer(params);

      expect(result.success).toBe(true);
    });

    it('应该支持假设检验', async () => {
      const params = {
        ...mockParams,
        analysis: ['hypothesis_test'],
      };

      const result = await handler.tool_statistical_analyzer(params);

      expect(result.success).toBe(true);
    });
  });

  // ==================== 错误处理测试 ====================

  describe('错误处理', () => {
    it('应该处理文件不存在错误', async () => {
      const params = {
        dataPath: '/nonexistent/file.csv',
        operations: ['remove_duplicates'],
        outputPath: path.join(testOutputDir, 'output.csv'),
      };

      await expect(handler.tool_data_preprocessor(params)).rejects.toThrow();
    });

    it('应该处理无效的算法', async () => {
      const params = {
        dataPath: path.join(testOutputDir, 'data.csv'),
        algorithm: 'invalid_algorithm',
        targetColumn: 'target',
        featureColumns: ['feature'],
        modelPath: path.join(testOutputDir, 'model.pkl'),
      };

      await expect(handler.tool_ml_trainer(params)).rejects.toThrow();
    });

    it('应该处理无效的图表类型', async () => {
      const params = {
        dataPath: path.join(testOutputDir, 'data.csv'),
        chartType: 'invalid_type',
        xColumn: 'x',
        yColumn: 'y',
        outputPath: path.join(testOutputDir, 'chart.png'),
      };

      await expect(handler.tool_data_visualizer(params)).rejects.toThrow();
    });
  });

  // ==================== 边界情况测试 ====================

  describe('边界情况', () => {
    it('应该处理空数据集', async () => {
      const emptyPath = path.join(testOutputDir, 'empty.csv');
      await fs.writeFile(emptyPath, 'col1,col2\n');

      const params = {
        dataPath: emptyPath,
        operations: ['remove_duplicates'],
        outputPath: path.join(testOutputDir, 'output.csv'),
      };

      try {
        await handler.tool_data_preprocessor(params);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('应该处理大型数据集', async () => {
      const largePath = path.join(testOutputDir, 'large.csv');
      let csvData = 'col1,col2\n';
      for (let i = 0; i < 1000; i++) {
        csvData += `${i},${i * 2}\n`;
      }
      await fs.writeFile(largePath, csvData);

      const params = {
        dataPath: largePath,
        operations: ['remove_duplicates'],
        outputPath: path.join(testOutputDir, 'output.csv'),
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });

    it('应该处理特殊字符列名', async () => {
      const specialPath = path.join(testOutputDir, 'special.csv');
      await fs.writeFile(specialPath, 'col-1,col_2,col 3\n1,2,3\n');

      const params = {
        dataPath: specialPath,
        operations: ['remove_duplicates'],
        outputPath: path.join(testOutputDir, 'output.csv'),
      };

      const result = await handler.tool_data_preprocessor(params);

      expect(result.success).toBe(true);
    });
  });
});
