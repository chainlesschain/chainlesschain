/**
 * 代码执行沙箱工具集
 *
 * 提供安全的 Python 代码执行能力
 *
 * @module extended-tools-sandbox
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * Sandbox 工具处理器
 */
class SandboxToolsHandler {
  constructor() {
    this.pythonSandbox = null;
  }

  /**
   * 设置 PythonSandbox 引用
   * @param {Object} pythonSandbox - PythonSandbox 实例
   */
  setPythonSandbox(pythonSandbox) {
    this.pythonSandbox = pythonSandbox;
    logger.info('[SandboxTools] PythonSandbox 已设置');
  }

  /**
   * 注册所有沙箱工具
   * @param {FunctionCaller} functionCaller - 函数调用器实例
   */
  register(functionCaller) {
    const self = this;

    // ====== Python 代码执行工具 ======

    functionCaller.registerTool(
      'python_execute',
      async (params, context) => {
        if (!self.pythonSandbox) {
          throw new Error('Python 沙箱未初始化');
        }

        const {
          code,
          timeout = 30000,
          inputData = null,
        } = params;

        if (!code || typeof code !== 'string') {
          throw new Error('请提供有效的 Python 代码');
        }

        // 检查沙箱状态
        const status = await self.pythonSandbox.checkStatus();
        if (!status.initialized) {
          // 尝试初始化
          await self.pythonSandbox.initialize();
        }

        // 执行代码
        const result = await self.pythonSandbox.execute(code, {
          timeout,
          inputData,
        });

        return {
          success: result.status === 'completed',
          output: result.output,
          error: result.error || null,
          exitCode: result.exitCode,
          duration: result.duration,
          executionId: result.executionId,
        };
      },
      {
        name: 'python_execute',
        description: '在安全沙箱中执行 Python 代码。支持数据计算、数据处理、可视化生成等任务。',
        parameters: {
          code: {
            type: 'string',
            description: 'Python 代码字符串',
            required: true,
          },
          timeout: {
            type: 'number',
            description: '执行超时时间（毫秒），默认 30000',
            default: 30000,
          },
          inputData: {
            type: 'object',
            description: '传递给脚本的输入数据（JSON 格式），脚本可通过读取 /workspace/input.json 获取',
            required: false,
          },
        },
      }
    );

    // ====== 数据分析工具 ======

    functionCaller.registerTool(
      'python_analyze_data',
      async (params, context) => {
        if (!self.pythonSandbox) {
          throw new Error('Python 沙箱未初始化');
        }

        const {
          data,
          analysis_type = 'summary',
          columns = null,
        } = params;

        if (!data || !Array.isArray(data)) {
          throw new Error('请提供有效的数据数组');
        }

        // 根据分析类型生成代码
        const analysisCode = generateAnalysisCode(analysis_type, columns);

        const result = await self.pythonSandbox.execute(analysisCode, {
          timeout: 60000,
          inputData: { data },
        });

        return {
          success: result.status === 'completed',
          analysis: result.output,
          error: result.error || null,
        };
      },
      {
        name: 'python_analyze_data',
        description: '使用 Python 分析数据，支持统计摘要、相关性分析、趋势分析等',
        parameters: {
          data: {
            type: 'array',
            description: '数据数组（JSON 格式）',
            required: true,
          },
          analysis_type: {
            type: 'string',
            description: '分析类型：summary(统计摘要)、correlation(相关性)、trend(趋势)',
            enum: ['summary', 'correlation', 'trend'],
            default: 'summary',
          },
          columns: {
            type: 'array',
            description: '要分析的列名（可选）',
            required: false,
          },
        },
      }
    );

    // ====== 数学计算工具 ======

    functionCaller.registerTool(
      'python_math',
      async (params, context) => {
        if (!self.pythonSandbox) {
          throw new Error('Python 沙箱未初始化');
        }

        const {
          expression,
          variables = {},
          symbolic = false,
        } = params;

        if (!expression) {
          throw new Error('请提供数学表达式');
        }

        // 生成数学计算代码
        const mathCode = generateMathCode(expression, variables, symbolic);

        const result = await self.pythonSandbox.execute(mathCode, {
          timeout: 30000,
        });

        return {
          success: result.status === 'completed',
          result: result.output,
          error: result.error || null,
        };
      },
      {
        name: 'python_math',
        description: '执行数学计算，支持数值计算和符号计算',
        parameters: {
          expression: {
            type: 'string',
            description: '数学表达式，如 "2 + 2" 或 "integrate(x**2, x)"',
            required: true,
          },
          variables: {
            type: 'object',
            description: '变量值字典，如 {"x": 5, "y": 10}',
            default: {},
          },
          symbolic: {
            type: 'boolean',
            description: '是否使用符号计算（SymPy）',
            default: false,
          },
        },
      }
    );

    // ====== 沙箱状态工具 ======

    functionCaller.registerTool(
      'sandbox_status',
      async (params, context) => {
        if (!self.pythonSandbox) {
          return {
            available: false,
            error: 'Python 沙箱未配置',
          };
        }

        const status = await self.pythonSandbox.checkStatus();
        const stats = self.pythonSandbox.getStats();

        return {
          available: status.dockerAvailable && status.imageExists,
          ...status,
          stats,
        };
      },
      {
        name: 'sandbox_status',
        description: '检查代码执行沙箱的状态',
        parameters: {},
      }
    );

    logger.info('[SandboxTools] ✓ 4 个沙箱工具已注册');
  }
}

/**
 * 生成数据分析代码
 */
function generateAnalysisCode(analysisType, columns) {
  const baseCode = `
import json
import pandas as pd
import numpy as np

# 读取输入数据
with open('/workspace/input.json', 'r') as f:
    input_data = json.load(f)

df = pd.DataFrame(input_data['data'])
`;

  const analysisCode = {
    summary: `
${baseCode}
# 统计摘要
print("=== 数据统计摘要 ===")
print(df.describe().to_string())
print("\\n数据类型:")
print(df.dtypes.to_string())
print("\\n缺失值:")
print(df.isnull().sum().to_string())
`,

    correlation: `
${baseCode}
# 相关性分析
numeric_df = df.select_dtypes(include=[np.number])
if not numeric_df.empty:
    print("=== 相关性矩阵 ===")
    print(numeric_df.corr().to_string())
else:
    print("无数值列可供相关性分析")
`,

    trend: `
${baseCode}
# 趋势分析
print("=== 数据趋势 ===")
for col in df.select_dtypes(include=[np.number]).columns:
    values = df[col].dropna()
    if len(values) > 1:
        trend = "上升" if values.iloc[-1] > values.iloc[0] else "下降"
        change = ((values.iloc[-1] - values.iloc[0]) / values.iloc[0] * 100) if values.iloc[0] != 0 else 0
        print(f"{col}: {trend} ({change:.2f}%)")
`,
  };

  return analysisCode[analysisType] || analysisCode.summary;
}

/**
 * 生成数学计算代码
 */
function generateMathCode(expression, variables, symbolic) {
  if (symbolic) {
    return `
from sympy import *
init_printing()

# 定义符号变量
${Object.keys(variables).map(v => `${v} = Symbol('${v}')`).join('\n')}

# 计算表达式
result = ${expression}
print(result)
`;
  } else {
    return `
import numpy as np
from math import *

# 定义变量
${Object.entries(variables).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}

# 计算表达式
result = ${expression}
print(result)
`;
  }
}

// 单例实例
let sandboxToolsInstance = null;

/**
 * 获取 SandboxToolsHandler 单例
 * @returns {SandboxToolsHandler}
 */
function getSandboxTools() {
  if (!sandboxToolsInstance) {
    sandboxToolsInstance = new SandboxToolsHandler();
  }
  return sandboxToolsInstance;
}

module.exports = {
  SandboxToolsHandler,
  getSandboxTools,
};
