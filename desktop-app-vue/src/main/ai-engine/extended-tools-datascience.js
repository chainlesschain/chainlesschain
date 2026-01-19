/**
 * 数据科学工具的handler实现
 * 提供数据预处理、机器学习、可视化等功能
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class DataScienceToolsHandler {
  constructor() {
    this.name = 'DataScienceToolsHandler';
  }

  /**
   * 执行Python脚本的辅助方法
   */
  async executePythonScript(scriptContent, args = []) {
    return new Promise((resolve, reject) => {
      // 创建临时脚本文件
      const tmpScript = path.join(require('os').tmpdir(), `script_${Date.now()}.py`);

      // 写入脚本
      fs.writeFile(tmpScript, scriptContent, 'utf-8')
        .then(() => {
          // 执行Python脚本
          const python = spawn('python', [tmpScript, ...args]);

          let stdout = '';
          let stderr = '';

          python.stdout.on('data', (data) => {
            stdout += data.toString();
          });

          python.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          python.on('close', (code) => {
            // 删除临时文件
            fs.unlink(tmpScript).catch(console.error);

            if (code === 0) {
              resolve({ stdout, stderr });
            } else {
              reject(new Error(`Python脚本执行失败 (code ${code}): ${stderr}`));
            }
          });
        })
        .catch(reject);
    });
  }

  /**
   * 数据预处理器
   */
  async tool_data_preprocessor(params) {
    const { dataPath, operations, options = {}, outputPath } = params;

    try {
      const pythonScript = `
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler, LabelEncoder
import json
import sys

# 读取数据
df = pd.read_csv('${dataPath}')
original_rows = len(df)
original_cols = len(df.columns)

stats = {
    'duplicatesRemoved': 0,
    'missingValuesHandled': 0,
    'outliersDetected': 0
}

operations = ${JSON.stringify(operations)}
options = ${JSON.stringify(options)}

# 执行预处理操作
for op in operations:
    if op == 'remove_duplicates':
        before = len(df)
        df = df.drop_duplicates()
        stats['duplicatesRemoved'] = before - len(df)

    elif op == 'handle_missing':
        missing_count = df.isnull().sum().sum()
        strategy = options.get('missingStrategy', 'median')

        if strategy == 'drop':
            df = df.dropna()
        elif strategy == 'mean':
            df = df.fillna(df.mean(numeric_only=True))
        elif strategy == 'median':
            df = df.fillna(df.median(numeric_only=True))
        elif strategy == 'mode':
            df = df.fillna(df.mode().iloc[0])
        elif strategy == 'forward_fill':
            df = df.fillna(method='ffill')
        elif strategy == 'backward_fill':
            df = df.fillna(method='bfill')

        stats['missingValuesHandled'] = missing_count

    elif op == 'detect_outliers':
        method = options.get('outlierMethod', 'iqr')
        numeric_cols = df.select_dtypes(include=[np.number]).columns

        outliers = 0
        if method == 'iqr':
            for col in numeric_cols:
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                outliers += ((df[col] < (Q1 - 1.5 * IQR)) | (df[col] > (Q3 + 1.5 * IQR))).sum()

        stats['outliersDetected'] = outliers

    elif op == 'normalize' or op == 'standardize':
        numeric_cols = df.select_dtypes(include=[np.number]).columns
        method = options.get('scalingMethod', 'standard')

        if method == 'standard':
            scaler = StandardScaler()
        elif method == 'minmax':
            scaler = MinMaxScaler()
        elif method == 'robust':
            scaler = RobustScaler()

        df[numeric_cols] = scaler.fit_transform(df[numeric_cols])

    elif op == 'encode_categorical' or op == 'label_encode':
        categorical_cols = df.select_dtypes(include=['object']).columns
        le = LabelEncoder()

        for col in categorical_cols:
            df[col] = le.fit_transform(df[col].astype(str))

# 保存处理后的数据
output_path = '${outputPath || dataPath.replace('.csv', '_processed.csv')}'
df.to_csv(output_path, index=False)

# 输出结果
result = {
    'success': True,
    'outputPath': output_path,
    'rowsProcessed': len(df),
    'columnsProcessed': len(df.columns),
    'summary': stats
}

print(json.dumps(result))
`;

      const { stdout } = await this.executePythonScript(pythonScript);
      const result = JSON.parse(stdout.trim());

      return result;
    } catch (error) {
      logger.error('[Data Preprocessor] 处理失败:', error);

      // 如果Python不可用，返回说明
      if (error.message.includes('spawn python ENOENT')) {
        return {
          success: false,
          error: 'Python环境未安装或未配置',
          message: '请安装Python 3.x并确保pandas、scikit-learn库可用'
        };
      }

      throw new Error(`数据预处理失败: ${error.message}`);
    }
  }

  /**
   * 图表生成器
   */
  async tool_chart_generator(params) {
    const { chartType, data, dataSource, options = {}, outputPath } = params;

    try {
      // 如果提供了数据源文件，先读取数据
      let chartData = data;
      if (dataSource && !data) {
        const fileContent = await fs.readFile(dataSource, 'utf-8');
        // 简单的CSV解析
        const lines = fileContent.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',');
        chartData = {
          labels: headers,
          values: lines.slice(1).map(line => line.split(','))
        };
      }

      const pythonScript = `
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import numpy as np
import json

# 设置中文字体
plt.rcParams['font.sans-serif'] = ['SimHei', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False

chart_type = '${chartType}'
chart_data = ${JSON.stringify(chartData)}
options = ${JSON.stringify(options)}

# 创建图表
plt.figure(figsize=(${options.width || 800}/100, ${options.height || 600}/100))

if chart_type == 'line':
    plt.plot(chart_data['x'], chart_data['y'], marker='o')
    plt.xlabel(options.get('xLabel', 'X轴'))
    plt.ylabel(options.get('yLabel', 'Y轴'))

elif chart_type == 'bar':
    plt.bar(chart_data['x'], chart_data['y'])
    plt.xlabel(options.get('xLabel', 'X轴'))
    plt.ylabel(options.get('yLabel', 'Y轴'))

elif chart_type == 'pie':
    plt.pie(chart_data['values'], labels=chart_data['labels'], autopct='%1.1f%%')

elif chart_type == 'scatter':
    plt.scatter(chart_data['x'], chart_data['y'])
    plt.xlabel(options.get('xLabel', 'X轴'))
    plt.ylabel(options.get('yLabel', 'Y轴'))

elif chart_type == 'histogram':
    plt.hist(chart_data['values'], bins=20, edgecolor='black')
    plt.xlabel(options.get('xLabel', '数值'))
    plt.ylabel(options.get('yLabel', '频数'))

# 设置标题
if options.get('title'):
    plt.title(options['title'], fontsize=16)

# 显示网格
if options.get('showGrid', True):
    plt.grid(True, alpha=0.3)

# 显示图例
if options.get('showLegend', True) and chart_type != 'pie':
    plt.legend()

# 保存图表
plt.tight_layout()
plt.savefig('${outputPath}', dpi=150, bbox_inches='tight')
plt.close()

print(json.dumps({
    'success': True,
    'chartPath': '${outputPath}',
    'chartType': chart_type,
    'dataPoints': len(chart_data.get('x', chart_data.get('values', [])))
}))
`;

      const { stdout } = await this.executePythonScript(pythonScript);
      const result = JSON.parse(stdout.trim());

      return result;
    } catch (error) {
      logger.error('[Chart Generator] 生成失败:', error);

      if (error.message.includes('spawn python ENOENT')) {
        return {
          success: false,
          error: 'Python环境未安装',
          message: '请安装Python 3.x并确保matplotlib、seaborn库可用'
        };
      }

      throw new Error(`图表生成失败: ${error.message}`);
    }
  }

  /**
   * 机器学习模型训练器（简化版本）
   */
  async tool_ml_model_trainer(params) {
    const { dataPath, targetColumn, modelType, taskType, hyperparameters = {}, modelOutputPath } = params;

    try {
      // 生成Python训练脚本
      const scriptPath = path.join(path.dirname(modelOutputPath), 'train_model.py');

      const pythonScript = `
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
import joblib
import json
import time

# 读取数据
df = pd.read_csv('${dataPath}')
X = df.drop('${targetColumn}', axis=1)
y = df['${targetColumn}']

# 数值化处理
X = X.select_dtypes(include=[np.number])

# 划分训练集和测试集
test_size = ${hyperparameters.test_size || 0.2}
random_state = ${hyperparameters.random_state || 42}
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=random_state)

# 选择模型
task_type = '${taskType}'
model_type = '${modelType}'

start_time = time.time()

if task_type == 'classification':
    if model_type == 'random_forest':
        from sklearn.ensemble import RandomForestClassifier
        model = RandomForestClassifier(
            n_estimators=${hyperparameters.n_estimators || 100},
            max_depth=${hyperparameters.max_depth || 10},
            random_state=random_state
        )
    elif model_type == 'logistic_regression':
        from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(random_state=random_state, max_iter=1000)
else:  # regression
    if model_type == 'random_forest':
        from sklearn.ensemble import RandomForestRegressor
        model = RandomForestRegressor(
            n_estimators=${hyperparameters.n_estimators || 100},
            max_depth=${hyperparameters.max_depth || 10},
            random_state=random_state
        )
    elif model_type == 'linear_regression':
        from sklearn.linear_model import LinearRegression
        model = LinearRegression()

# 训练模型
model.fit(X_train, y_train)

# 交叉验证
cv_scores = cross_val_score(model, X_train, y_train, cv=${hyperparameters.cv_folds || 5})

# 评估指标
if task_type == 'classification':
    from sklearn.metrics import accuracy_score, f1_score
    y_pred = model.predict(X_test)
    metrics = {
        'accuracy': accuracy_score(y_test, y_pred),
        'f1_score': f1_score(y_test, y_pred, average='weighted'),
        'cv_mean': cv_scores.mean(),
        'cv_std': cv_scores.std()
    }
else:
    from sklearn.metrics import mean_squared_error, r2_score
    y_pred = model.predict(X_test)
    metrics = {
        'mse': mean_squared_error(y_test, y_pred),
        'rmse': np.sqrt(mean_squared_error(y_test, y_pred)),
        'r2': r2_score(y_test, y_pred),
        'cv_mean': cv_scores.mean(),
        'cv_std': cv_scores.std()
    }

training_time = time.time() - start_time

# 保存模型
joblib.dump(model, '${modelOutputPath}')

# 输出结果
result = {
    'success': True,
    'modelPath': '${modelOutputPath}',
    'metrics': metrics,
    'trainingTime': training_time
}

print(json.dumps(result))
`;

      await fs.writeFile(scriptPath, pythonScript, 'utf-8');

      const { stdout } = await this.executePythonScript(pythonScript);
      const result = JSON.parse(stdout.trim());

      return result;
    } catch (error) {
      logger.error('[ML Model Trainer] 训练失败:', error);

      if (error.message.includes('spawn python ENOENT')) {
        return {
          success: false,
          error: 'Python环境未安装',
          message: '请安装Python 3.x并确保scikit-learn库可用'
        };
      }

      throw new Error(`模型训练失败: ${error.message}`);
    }
  }

  /**
   * 统计分析工具（简化版本）
   */
  async tool_statistical_analyzer(params) {
    const { dataPath, analyses, columns, reportOutputPath } = params;

    try {
      const pythonScript = `
import pandas as pd
import numpy as np
from scipy import stats
import json

# 读取数据
df = pd.read_csv('${dataPath}')

${columns ? `df = df[${JSON.stringify(columns)}]` : ''}

results = {}
analyses = ${JSON.stringify(analyses)}

# 执行分析
for analysis in analyses:
    if analysis == 'descriptive':
        results['descriptive'] = df.describe().to_dict()

    elif analysis == 'correlation':
        numeric_df = df.select_dtypes(include=[np.number])
        results['correlation'] = numeric_df.corr().to_dict()

# 保存报告
if '${reportOutputPath}':
    report_html = f"""
    <html>
    <head><title>统计分析报告</title></head>
    <body>
        <h1>统计分析报告</h1>
        <h2>描述性统计</h2>
        {df.describe().to_html()}
        <h2>相关性矩阵</h2>
        {df.select_dtypes(include=[np.number]).corr().to_html()}
    </body>
    </html>
    """
    with open('${reportOutputPath}', 'w', encoding='utf-8') as f:
        f.write(report_html)

print(json.dumps({
    'success': True,
    'results': results,
    'reportPath': '${reportOutputPath}'
}))
`;

      const { stdout } = await this.executePythonScript(pythonScript);
      const result = JSON.parse(stdout.trim());

      return result;
    } catch (error) {
      logger.error('[Statistical Analyzer] 分析失败:', error);
      throw new Error(`统计分析失败: ${error.message}`);
    }
  }

  /**
   * 注册所有工具到FunctionCaller
   */
  register(functionCaller) {
    functionCaller.registerTool('tool_data_preprocessor', this.tool_data_preprocessor.bind(this));
    functionCaller.registerTool('tool_chart_generator', this.tool_chart_generator.bind(this));
    functionCaller.registerTool('tool_ml_model_trainer', this.tool_ml_model_trainer.bind(this));
    functionCaller.registerTool('tool_statistical_analyzer', this.tool_statistical_analyzer.bind(this));

    logger.info('[DataScienceToolsHandler] 数据科学工具已注册（4个）');
  }
}

module.exports = DataScienceToolsHandler;
