# PDF导出功能测试文档

> 这是一个用于测试PDF导出功能的Markdown文档，包含各种常见元素。

## 1. 标题测试

### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

---

## 2. 文本格式测试

这是**粗体文本**，这是*斜体文本*，这是~~删除线文本~~。

这是一个包含`代码片段`的段落。

---

## 3. 列表测试

### 无序列表
- 项目1
- 项目2
  - 子项目2.1
  - 子项目2.2
- 项目3

### 有序列表
1. 第一项
2. 第二项
   1. 子项目2.1
   2. 子项目2.2
3. 第三项

---

## 4. 代码块测试

### JavaScript代码
```javascript
function hello(name) {
  console.log(`Hello, ${name}!`);
  return true;
}

// 调用函数
hello("World");
```

### Python代码
```python
def calculate_sum(a, b):
    """计算两个数的和"""
    result = a + b
    return result

# 测试
print(calculate_sum(10, 20))
```

### HTML代码
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>测试页面</title>
</head>
<body>
  <h1>你好，世界！</h1>
</body>
</html>
```

---

## 5. 表格测试

| 功能 | 状态 | 完成度 | 备注 |
|------|------|--------|------|
| 项目统计 | ✅ 完成 | 100% | 测试通过 |
| PDF导出 | ✅ 完成 | 100% | 正在测试 |
| Git AI | ✅ 完成 | 100% | UI已集成 |
| 模板引擎 | ✅ 完成 | 100% | 6/6测试通过 |
| 模板预览 | ✅ 完成 | 100% | 待测试 |

---

## 6. 引用块测试

> 这是一个引用块。
>
> 引用块可以包含多行内容。
>
> **注意**: 引用块中也可以使用格式化文本。

---

## 7. 链接测试

- [GitHub](https://github.com)
- [Anthropic](https://www.anthropic.com)
- [ChainlessChain文档](#1-标题测试)

---

## 8. 中文字符测试

### 中文标点符号
这是一个测试句子，包含中文标点符号：句号。逗号，感叹号！问号？

### 特殊中文字符
测试特殊字符：「」『』《》〈〉【】〖〗

### 常用汉字
春眠不觉晓，处处闻啼鸟。
夜来风雨声，花落知多少。

### 中英文混合
ChainlessChain是一个去中心化的个人AI管理系统，使用Electron + Vue3开发。

---

## 9. 任务列表测试

- [x] 完成P0-1项目统计
- [x] 完成P0-2 PDF导出
- [x] 完成P0-3 Git AI提交
- [x] 完成P0-4模板引擎
- [x] 完成P0-5模板预览
- [ ] 完整端到端测试
- [ ] 性能优化

---

## 10. 分隔线测试

第一部分

---

第二部分

***

第三部分

___

第四部分

---

## 11. 数学公式测试（如果支持）

行内公式：E = mc²

块级公式：
```
∫₀^∞ e^(-x²) dx = √π/2
```

---

## 12. 长段落测试

这是一个较长的段落，用于测试PDF中的文本换行和排版效果。Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

这是另一个长段落，包含中文字符。这个段落用来测试中文文本的换行、断字和排版效果。在PDF导出过程中，需要确保中文字符能够正确显示，标点符号不会出现在行首，并且整体排版美观整洁。人工智能技术的发展日新月异，深度学习模型在各个领域都展现出了强大的能力，包括自然语言处理、计算机视觉、语音识别等等。

---

## 13. 嵌套结构测试

1. 第一级列表
   - 嵌套无序列表
   - 第二项
     ```javascript
     // 嵌套代码块
     const test = "hello";
     ```
   - 第三项
     > 嵌套引用块
2. 继续有序列表
   | 列 | 值 |
   |----|----|
   | A  | 1  |
   | B  | 2  |

---

## 14. 特殊字符转义测试

- 小于号: <
- 大于号: >
- 和号: &
- 引号: "双引号"
- 撇号: '单引号'

---

## 测试总结

本文档包含了14个主要测试章节，涵盖了Markdown的常见元素：
- ✅ 标题（H1-H6）
- ✅ 文本格式（粗体、斜体、删除线）
- ✅ 列表（有序、无序、嵌套）
- ✅ 代码块（多种语言、语法高亮）
- ✅ 表格（多列、对齐）
- ✅ 引用块
- ✅ 链接
- ✅ 中文字符和标点
- ✅ 任务列表
- ✅ 分隔线
- ✅ 长段落
- ✅ 嵌套结构

**测试时间**: 2025-12-26
**文档版本**: v1.0
**测试状态**: 准备就绪

---

**页脚信息**: ChainlessChain P0功能测试 | 第 1 页
