# extended-tools-datascience

**Source**: `src/main/ai-engine/extended-tools-datascience.js`

**Generated**: 2026-02-15T10:10:53.456Z

---

## const

```javascript
const
```

* 数据科学工具的handler实现
 * 提供数据预处理、机器学习、可视化等功能

---

## async executePythonScript(scriptContent, args = [])

```javascript
async executePythonScript(scriptContent, args = [])
```

* 执行Python脚本的辅助方法

---

## async tool_data_preprocessor(params)

```javascript
async tool_data_preprocessor(params)
```

* 数据预处理器

---

## async tool_chart_generator(params)

```javascript
async tool_chart_generator(params)
```

* 图表生成器

---

## async tool_ml_model_trainer(params)

```javascript
async tool_ml_model_trainer(params)
```

* 机器学习模型训练器（简化版本）

---

## async tool_statistical_analyzer(params)

```javascript
async tool_statistical_analyzer(params)
```

* 统计分析工具（简化版本）

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* 注册所有工具到FunctionCaller

---

