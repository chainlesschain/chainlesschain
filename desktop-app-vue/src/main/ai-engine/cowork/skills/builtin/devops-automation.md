---
name: devops-automation
version: 1.0.0
description: DevOps自动化技能 - CI/CD流水线生成、Docker管理、部署脚本
author: ChainlessChain
category: devops
gate:
  platform: [win32, darwin, linux]
tools:
  - file_reader
  - file_writer
  - command_executor
---

# DevOps 自动化技能

## 描述
提供DevOps自动化能力，包括CI/CD流水线生成、Docker容器管理、以及部署脚本创建。支持GitHub Actions、GitLab CI和Jenkins。

## 使用方法
```
/devops-automation [子命令] [选项]
```

## 子命令

- `dockerfile` - 分析项目结构并生成优化的Dockerfile
- `ci-config` - 生成CI/CD流水线配置文件
- `deploy` - 创建部署脚本和环境配置
- `analyze` - 分析现有DevOps配置并提出改进建议

## 执行步骤

1. **分析项目结构**: 检测项目语言、框架、依赖和构建工具
2. **生成Dockerfile**: 创建多阶段构建的Dockerfile，优化镜像大小和安全性
3. **创建CI配置**: 根据项目类型生成CI/CD流水线（lint、test、build、deploy）
4. **部署规划**: 生成部署脚本，包含环境变量管理和健康检查

## 支持平台

| 平台 | 配置文件 |
|------|----------|
| GitHub Actions | `.github/workflows/*.yml` |
| GitLab CI | `.gitlab-ci.yml` |
| Jenkins | `Jenkinsfile` |
| Docker Compose | `docker-compose.yml` |

## 输出格式
- 生成的配置文件内容（可直接使用）
- 配置说明和注意事项
- 环境变量列表和说明
- 部署流程图和步骤说明

## 示例

生成Dockerfile:
```
/devops-automation dockerfile
```

生成GitHub Actions配置:
```
/devops-automation ci-config --platform github
```

创建部署脚本:
```
/devops-automation deploy --target production
```
