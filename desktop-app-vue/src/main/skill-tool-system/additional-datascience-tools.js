/**
 * 数据科学相关工具补充定义
 * 补充数据预处理、机器学习、数据可视化等工具
 */

const dataScienceTools = [
  // ==================== 数据预处理工具 ====================

  /**
   * 数据预处理器
   * 数据清洗、缺失值处理、特征缩放
   */
  {
    id: 'tool_data_preprocessor',
    name: 'data_preprocessor',
    display_name: '数据预处理器',
    description: '数据清洗、缺失值处理、异常值检测、特征缩放和编码',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径（CSV/Excel）'
        },
        operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'remove_duplicates',
              'handle_missing',
              'detect_outliers',
              'normalize',
              'standardize',
              'encode_categorical',
              'one_hot_encode',
              'label_encode'
            ]
          },
          description: '预处理操作列表'
        },
        options: {
          type: 'object',
          properties: {
            missingStrategy: {
              type: 'string',
              enum: ['drop', 'mean', 'median', 'mode', 'forward_fill', 'backward_fill'],
              default: 'median'
            },
            outlierMethod: {
              type: 'string',
              enum: ['iqr', 'zscore', 'isolation_forest'],
              default: 'iqr'
            },
            scalingMethod: {
              type: 'string',
              enum: ['standard', 'minmax', 'robust'],
              default: 'standard'
            }
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        }
      },
      required: ['dataPath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        rowsProcessed: { type: 'number' },
        columnsProcessed: { type: 'number' },
        summary: {
          type: 'object',
          properties: {
            duplicatesRemoved: { type: 'number' },
            missingValuesHandled: { type: 'number' },
            outliersDetected: { type: 'number' }
          }
        }
      }
    },
    examples: [
      {
        description: '清洗并标准化数据',
        params: {
          dataPath: './data/raw/customer_data.csv',
          operations: ['remove_duplicates', 'handle_missing', 'standardize'],
          options: {
            missingStrategy: 'median',
            scalingMethod: 'standard'
          },
          outputPath: './data/processed/customer_data_clean.csv'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * 特征工程工具
   * 特征创建、选择和转换
   */
  {
    id: 'tool_feature_engineer',
    name: 'feature_engineer',
    display_name: '特征工程工具',
    description: '特征创建、选择、转换和降维',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'polynomial_features',
              'interaction_features',
              'binning',
              'pca',
              'feature_selection',
              'timestamp_features'
            ]
          }
        },
        config: {
          type: 'object',
          properties: {
            polynomialDegree: { type: 'number', default: 2 },
            pcaComponents: { type: 'number', default: 0.95 },
            selectionMethod: {
              type: 'string',
              enum: ['chi2', 'mutual_info', 'f_classif', 'rfe'],
              default: 'mutual_info'
            },
            topK: { type: 'number', description: '保留前K个特征' }
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        }
      },
      required: ['dataPath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        originalFeatures: { type: 'number' },
        newFeatures: { type: 'number' },
        featureNames: { type: 'array', items: { type: 'string' } }
      }
    },
    examples: [
      {
        description: '创建多项式特征并进行特征选择',
        params: {
          dataPath: './data/processed/features.csv',
          operations: ['polynomial_features', 'feature_selection'],
          config: {
            polynomialDegree: 2,
            selectionMethod: 'mutual_info',
            topK: 20
          },
          outputPath: './data/processed/features_engineered.csv'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== 机器学习工具 ====================

  /**
   * 机器学习模型训练器
   * 训练各类机器学习模型
   */
  {
    id: 'tool_ml_model_trainer',
    name: 'ml_model_trainer',
    display_name: '机器学习模型训练器',
    description: '训练分类、回归、聚类等机器学习模型',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '训练数据路径'
        },
        targetColumn: {
          type: 'string',
          description: '目标变量列名'
        },
        modelType: {
          type: 'string',
          enum: [
            'random_forest',
            'xgboost',
            'lightgbm',
            'svm',
            'logistic_regression',
            'linear_regression',
            'kmeans',
            'neural_network'
          ],
          description: '模型类型'
        },
        taskType: {
          type: 'string',
          enum: ['classification', 'regression', 'clustering'],
          description: '任务类型'
        },
        hyperparameters: {
          type: 'object',
          description: '超参数配置',
          properties: {
            n_estimators: { type: 'number' },
            max_depth: { type: 'number' },
            learning_rate: { type: 'number' },
            test_size: { type: 'number', default: 0.2 },
            random_state: { type: 'number', default: 42 }
          }
        },
        cv_folds: {
          type: 'number',
          default: 5,
          description: '交叉验证折数'
        },
        autoTune: {
          type: 'boolean',
          default: false,
          description: '是否自动调优超参数'
        },
        modelOutputPath: {
          type: 'string',
          description: '模型保存路径'
        }
      },
      required: ['dataPath', 'targetColumn', 'modelType', 'taskType', 'modelOutputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        modelPath: { type: 'string' },
        metrics: {
          type: 'object',
          description: '模型评估指标'
        },
        trainingTime: { type: 'number' },
        bestParams: { type: 'object' }
      }
    },
    examples: [
      {
        description: '训练随机森林分类器',
        params: {
          dataPath: './data/train.csv',
          targetColumn: 'churn',
          modelType: 'random_forest',
          taskType: 'classification',
          hyperparameters: {
            n_estimators: 100,
            max_depth: 10,
            test_size: 0.2
          },
          cv_folds: 5,
          autoTune: true,
          modelOutputPath: './models/rf_model.pkl'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write', 'compute:intensive'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * 模型评估器
   * 评估机器学习模型性能
   */
  {
    id: 'tool_model_evaluator',
    name: 'model_evaluator',
    display_name: '模型评估器',
    description: '评估模型性能，生成评估报告和可视化',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelPath: {
          type: 'string',
          description: '模型文件路径'
        },
        testDataPath: {
          type: 'string',
          description: '测试数据路径'
        },
        taskType: {
          type: 'string',
          enum: ['classification', 'regression', 'clustering'],
          description: '任务类型'
        },
        generatePlots: {
          type: 'boolean',
          default: true,
          description: '是否生成可视化图表'
        },
        reportOutputPath: {
          type: 'string',
          description: '评估报告输出路径'
        }
      },
      required: ['modelPath', 'testDataPath', 'taskType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        metrics: {
          type: 'object',
          description: '评估指标（accuracy、f1_score、rmse等）'
        },
        confusionMatrix: { type: 'array' },
        featureImportance: { type: 'array' },
        plots: {
          type: 'array',
          items: { type: 'string' },
          description: '生成的图表路径列表'
        },
        reportPath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '评估分类模型',
        params: {
          modelPath: './models/rf_model.pkl',
          testDataPath: './data/test.csv',
          taskType: 'classification',
          generatePlots: true,
          reportOutputPath: './reports/model_evaluation.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  // ==================== 数据可视化工具 ====================

  /**
   * 图表生成器
   * 生成各类数据可视化图表
   */
  {
    id: 'tool_chart_generator',
    name: 'chart_generator',
    display_name: '数据可视化图表生成器',
    description: '生成折线图、柱状图、饼图、散点图、热力图等',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        chartType: {
          type: 'string',
          enum: [
            'line',
            'bar',
            'column',
            'pie',
            'scatter',
            'heatmap',
            'box',
            'violin',
            'histogram',
            'area',
            'bubble',
            'radar'
          ],
          description: '图表类型'
        },
        data: {
          type: 'object',
          description: '图表数据',
          properties: {
            x: { type: 'array', description: 'X轴数据' },
            y: { type: 'array', description: 'Y轴数据' },
            labels: { type: 'array', description: '标签' },
            values: { type: 'array', description: '数值' }
          }
        },
        dataSource: {
          type: 'string',
          description: '数据源文件路径（可选，与data二选一）'
        },
        options: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            xLabel: { type: 'string' },
            yLabel: { type: 'string' },
            width: { type: 'number', default: 800 },
            height: { type: 'number', default: 600 },
            theme: {
              type: 'string',
              enum: ['default', 'dark', 'minimal', 'colorful'],
              default: 'default'
            },
            showLegend: { type: 'boolean', default: true },
            showGrid: { type: 'boolean', default: true }
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径（支持.png、.jpg、.svg、.html）'
        }
      },
      required: ['chartType', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        chartPath: { type: 'string' },
        chartType: { type: 'string' },
        dataPoints: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成销售趋势折线图',
        params: {
          chartType: 'line',
          data: {
            x: ['1月', '2月', '3月', '4月', '5月'],
            y: [100, 120, 135, 125, 150]
          },
          options: {
            title: '2025年月度销售趋势',
            xLabel: '月份',
            yLabel: '销售额（万元）',
            theme: 'default'
          },
          outputPath: './charts/sales_trend.png'
        }
      },
      {
        description: '从CSV生成柱状图',
        params: {
          chartType: 'bar',
          dataSource: './data/product_sales.csv',
          options: {
            title: '产品销量对比',
            theme: 'colorful'
          },
          outputPath: './charts/product_comparison.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * 统计分析工具
   * 描述性统计、相关性分析、假设检验
   */
  {
    id: 'tool_statistical_analyzer',
    name: 'statistical_analyzer',
    display_name: '统计分析工具',
    description: '执行描述性统计、相关性分析、假设检验等',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        analyses: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'descriptive',
              'correlation',
              't_test',
              'chi_square',
              'anova',
              'normality_test',
              'distribution_fit'
            ]
          },
          description: '分析类型列表'
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: '要分析的列名（可选）'
        },
        options: {
          type: 'object',
          properties: {
            confidence_level: { type: 'number', default: 0.95 },
            method: { type: 'string' }
          }
        },
        reportOutputPath: {
          type: 'string',
          description: '分析报告输出路径'
        }
      },
      required: ['dataPath', 'analyses']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'object',
          description: '分析结果'
        },
        reportPath: { type: 'string' }
      }
    },
    examples: [
      {
        description: '执行描述性统计和相关性分析',
        params: {
          dataPath: './data/sales_data.csv',
          analyses: ['descriptive', 'correlation'],
          reportOutputPath: './reports/statistical_analysis.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },

  /**
   * 数据探索性分析（EDA）工具
   * 自动生成探索性数据分析报告
   */
  {
    id: 'tool_eda_generator',
    name: 'eda_generator',
    display_name: 'EDA报告生成器',
    description: '自动生成探索性数据分析报告，包含数据概览、分布、相关性等',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        targetColumn: {
          type: 'string',
          description: '目标变量（可选）'
        },
        reportType: {
          type: 'string',
          enum: ['quick', 'detailed', 'comprehensive'],
          default: 'detailed',
          description: '报告详细程度'
        },
        outputFormat: {
          type: 'string',
          enum: ['html', 'pdf', 'notebook'],
          default: 'html',
          description: '输出格式'
        },
        outputPath: {
          type: 'string',
          description: '输出路径'
        }
      },
      required: ['dataPath', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        reportPath: { type: 'string' },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: '报告章节列表'
        }
      }
    },
    examples: [
      {
        description: '生成详细EDA报告',
        params: {
          dataPath: './data/customer_data.csv',
          targetColumn: 'churn',
          reportType: 'detailed',
          outputFormat: 'html',
          outputPath: './reports/eda_report.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = dataScienceTools;
