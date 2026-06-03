# Python工具集 - 安装和使用指南

这个目录包含用于文档处理的Python工具脚本,通过Node.js桥接器调用。

## 📦 依赖安装

### 方法1: 一键安装(推荐)

```bash
pip install python-docx openpyxl python-pptx reportlab pandas matplotlib pillow
```

### 方法2: 使用requirements.txt

```bash
cd desktop-app-vue/src/main/python-tools
pip install -r requirements.txt
```

## 📋 依赖包说明

| 包名 | 用途 | 版本要求 |
|------|------|----------|
| python-docx | Word文档处理 | ≥0.8.11 |
| openpyxl | Excel读写 | ≥3.0.0 |
| python-pptx | PPT生成 | ≥0.6.21 |
| reportlab | PDF生成 | ≥3.6.0 |
| pandas | 数据分析 | ≥1.3.0 |
| matplotlib | 图表生成 | ≥3.4.0 |
| pillow | 图像处理 | ≥8.0.0 |

## 🔧 可用工具

### 1. check_environment.py
**用途**: 检查Python环境和依赖

**调用示例**:
```bash
python check_environment.py '{}'
```

**返回**:
```json
{
  "success": true,
  "python_version": "3.12.0",
  "dependencies": {
    "docx": { "installed": true, "version": "0.8.11" },
    "openpyxl": { "installed": true, "version": "3.1.2" }
  }
}
```

### 2. word_generator.py
**用途**: 生成Word文档

**调用示例**:
```bash
python word_generator.py '{
  "operation": "create",
  "title": "工作报告",
  "content": "这是报告内容",
  "output_path": "C:/temp/report.docx",
  "template": "business",
  "metadata": {
    "author": "张三",
    "subject": "月度工作总结"
  }
}'
```

**模板类型**:
- `basic` - 基础模板
- `business` - 商务模板(带日期,蓝色标题)
- `academic` - 学术模板(带摘要,参考文献)
- `report` - 报告模板(封面,目录,分章节)

### 3. excel_processor.py
**用途**: 处理Excel文件

**调用示例**:
```bash
python excel_processor.py '{
  "operation": "create",
  "title": "销售报表",
  "sheets": [{
    "name": "Q1销售",
    "data": [
      ["月份", "销售额", "成本"],
      ["1月", 100000, 60000],
      ["2月", 120000, 70000]
    ]
  }],
  "output_path": "C:/temp/sales.xlsx",
  "template": "sales"
}'
```

**模板类型**:
- `basic` - 基础表格
- `sales` - 销售报表(带图表)
- `financial` - 财务报表
- `data_analysis` - 数据分析(带统计)

### 4. ppt_generator.py
**用途**: 生成PPT演示文稿

**调用示例**:
```bash
python ppt_generator.py '{
  "operation": "create",
  "title": "产品演示",
  "subtitle": "2025年度新品",
  "slides": [
    {
      "type": "title_content",
      "title": "产品特性",
      "content": ["特性1", "特性2", "特性3"]
    }
  ],
  "output_path": "C:/temp/demo.pptx",
  "template": "business"
}'
```

**模板类型**:
- `business` - 商务模板(蓝色主题)
- `education` - 教育模板(绿色主题)
- `creative` - 创意模板(紫色主题)

## 🚀 从Node.js调用

在Node.js中通过Python桥接器调用:

```javascript
const { getPythonBridge } = require('./project/python-bridge');

const bridge = getPythonBridge();

// 生成Word文档
const result = await bridge.callTool('word_generator', {
  operation: 'create',
  title: '工作报告',
  content: '这是报告内容',
  output_path: 'C:/temp/report.docx',
  template: 'business'
});

console.log('文档已生成:', result.output_path);
```

## ⚠️ 常见问题

### Q1: 提示"未安装python-docx"
**A**: 运行 `pip install python-docx`

### Q2: Python命令不可用
**A**:
1. 确保已安装Python 3.8+
2. 将Python添加到系统PATH
3. Windows用户可以使用 `py` 命令代替 `python`

### Q3: 中文乱码
**A**: 确保:
1. Python脚本使用UTF-8编码
2. JSON参数使用 `ensure_ascii=False`
3. 系统支持UTF-8

### Q4: 权限错误
**A**:
1. 确保输出目录存在且有写权限
2. Windows可能需要管理员权限

## 📝 开发新工具

创建新Python工具的模板:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import json

def main():
    try:
        # 解析参数
        args = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}

        # 执行操作
        result = {
            'success': True,
            'data': 'your result'
        }

        # 输出JSON
        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()
```

## 📞 技术支持

如有问题,请查看主项目文档或提交issue。

---

**版本**: 1.0.0
**更新日期**: 2025-12-28
**维护者**: ChainlessChain Team
