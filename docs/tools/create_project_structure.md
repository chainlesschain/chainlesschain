# 项目结构创建

## 基本信息

- **工具ID**: tool_create_project_structure
- **工具名称**: create_project_structure
- **类型**: function
- **分类**: project
- **风险等级**: 2/5
- **状态**: 启用
- **来源**: 内置工具

## 功能描述

创建标准项目目录结构

## 参数Schema

```json
{
  "type": "object",
  "properties": {
    "projectName": {
      "type": "string",
      "description": "项目名称"
    },
    "projectType": {
      "type": "string",
      "description": "项目类型",
      "enum": [
        "web",
        "blog",
        "simple"
      ]
    },
    "outputPath": {
      "type": "string",
      "description": "输出路径"
    }
  },
  "required": [
    "projectName",
    "projectType",
    "outputPath"
  ]
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
    "projectPath": {
      "type": "string"
    },
    "createdFiles": {
      "type": "array"
    }
  }
}
```

## 配置选项

```json
undefined
```

## 权限要求

- `file:write`

## 使用示例

```javascript
const result = await callTool('create_project_structure', {
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

`docs/tools/tool_create_project_structure.md`

---

**创建时间**: 2025-12-29
**维护者**: ChainlessChain Team
