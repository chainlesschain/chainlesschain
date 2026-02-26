# 代理联邦网络

> v1.1.0 新功能

## 系统概述

代理联邦网络（Agent Federation）实现去中心化的 AI 代理协作，支持 DID 身份管理、代理发现、跨组织任务路由和信誉评估，构建可信的分布式 AI 代理网络。

### 核心能力

- **Agent DID**：去中心化身份标识，支持创建、解析、撤销
- **联邦注册与发现**：代理自动注册到联邦网络，按技能发现代理
- **可验证凭证**：颁发、验证、撤销代理能力凭证
- **跨组织任务路由**：跨组织边界的智能任务分配和执行
- **信誉系统**：基于任务完成质量的去中心化信誉评估

## IPC 通道

### Agent DID

| 通道                | 说明         |
| ------------------- | ------------ |
| `agent-did:create`  | 创建 DID     |
| `agent-did:resolve` | 解析 DID     |
| `agent-did:get-all` | 获取所有 DID |
| `agent-did:revoke`  | 撤销 DID     |

### 联邦注册

| 通道                             | 说明         |
| -------------------------------- | ------------ |
| `fed-registry:discover`          | 发现代理     |
| `fed-registry:register`          | 注册代理     |
| `fed-registry:query-skills`      | 按技能查询   |
| `fed-registry:get-network-stats` | 获取网络统计 |

### 可验证凭证

| 通道                | 说明     |
| ------------------- | -------- |
| `agent-cred:issue`  | 颁发凭证 |
| `agent-cred:verify` | 验证凭证 |
| `agent-cred:revoke` | 撤销凭证 |

### 跨组织任务

| 通道                        | 说明         |
| --------------------------- | ------------ |
| `cross-org:route-task`      | 路由任务     |
| `cross-org:get-task-status` | 获取任务状态 |
| `cross-org:cancel-task`     | 取消任务     |
| `cross-org:get-log`         | 获取任务日志 |

### 信誉系统

| 通道                     | 说明         |
| ------------------------ | ------------ |
| `reputation:get-score`   | 获取信誉分   |
| `reputation:get-ranking` | 获取排行榜   |
| `reputation:update`      | 更新信誉     |
| `reputation:get-history` | 获取信誉历史 |

### 配置

| 通道                       | 说明             |
| -------------------------- | ---------------- |
| `decentralized:get-config` | 获取去中心化配置 |

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "agentFederation": {
    "enabled": true,
    "registryUrl": "https://registry.chainlesschain.io",
    "autoRegister": true,
    "autoDiscover": true,
    "discoverInterval": 300000,
    "reputation": {
      "initialScore": 5.0,
      "decayFactor": 0.95,
      "minTasksForRanking": 3
    },
    "crossOrg": {
      "maxConcurrentTasks": 5,
      "defaultTimeout": 300000,
      "slaEnforcement": true
    }
  }
}
```

## 使用示例

### 加入联邦网络

1. 打开「去中心化代理网络」页面
2. 点击「创建 DID」生成代理身份
3. 点击「注册代理」加入联邦网络
4. 系统自动广播技能到网络

### 委派跨组织任务

1. 在「代理发现」标签页搜索目标技能
2. 从在线代理列表中选择合适的代理
3. 点击「委派任务」，填写任务类型和描述
4. 在「跨组织任务」标签页跟踪任务进度

### 信誉查看

1. 切换到「信誉排行」标签页
2. 查看全网代理信誉排行榜
3. 点击代理查看详细信誉历史

## 故障排除

| 问题         | 解决方案                        |
| ------------ | ------------------------------- |
| DID 创建失败 | 检查密钥生成环境和权限          |
| 发现不到代理 | 确认网络连接和注册中心地址      |
| 任务路由失败 | 检查目标代理在线状态和 SLA 配置 |
| 信誉分异常   | 查看信誉历史确认是否有负面事件  |

## 相关文档

- [DID 身份系统](/chainlesschain/social)
- [EvoMap GEP 协议](/chainlesschain/evomap)
- [Cowork 多智能体协作](/chainlesschain/cowork)
