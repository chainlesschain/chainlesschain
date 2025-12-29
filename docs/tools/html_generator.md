# HTML生成器

## 基本信息

- **工具ID**: tool_html_generator
- **工具名称**: html_generator
- **类型**: function
- **分类**: web
- **风险等级**: 1/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

生成标准HTML页面结构

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "页面标题",
      "default": "我的网页"
    },
    "content": {
      "type": "string",
      "description": "页面内容"
    },
    "primaryColor": {
      "type": "string",
      "description": "主题颜色",
      "default": "#667eea"
    }
  }
}
```

## 返回值Schema

```json
{
  "type": "object",
  "properties": {
    "success": {
      "type": "boolean"
    },
    "html": {
      "type": "string"
    },
    "fileName": {
      "type": "string"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

无特殊权限要求

## 使用示例

```javascript
const result = await callTool('html_generator', {
  // 参数根据 parameters_schema 定义
});

if (result.success) {
  console.log('执行成功:', result);
} else {
  console.error('执行失败:', result.error);
}
```

## 性能指标

- **平均执行时间**: 0 ms
- **调用次数**: 0
- **成功次数**: 0

## 文档路径

`docs/tools/tool_html_generator.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
