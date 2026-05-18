# 社交网络模块 E2E 测试

本目录包含社交网络模块的端到端测试文件。

## 测试文件列表

| 文件名 | 页面路由 | 测试描述 | 测试用例数 |
|--------|---------|----------|-----------|
| `credentials.e2e.test.ts` | `/credentials` | 可验证凭证页面 | 4 |
| `contacts.e2e.test.ts` | `/contacts` | 联系人页面 | 4 |
| `friends.e2e.test.ts` | `/friends` | 好友管理页面 | 4 |
| `posts.e2e.test.ts` | `/posts` | 动态广场页面 | 4 |
| `offline-queue.e2e.test.ts` | `/offline-queue` | 离线消息队列页面 | 4 |
| `chat.e2e.test.ts` | `/chat` | 聊天窗口页面 | 4 |
| `call-history.e2e.test.ts` | `/call-history` | 通话记录页面 | 4 |

## 测试用例结构

每个测试文件包含以下标准测试用例：

1. **页面访问测试** - 验证能够正确访问目标页面并检查URL
2. **UI元素测试** - 验证主要UI元素是否正确显示
3. **列表/空状态测试** - 验证数据列表或空状态提示是否正确显示
4. **页面加载测试** - 验证页面是否正常加载和渲染

## 测试技术栈

- **测试框架**: Playwright
- **应用类型**: Electron Desktop App
- **辅助工具**: `../helpers/common.ts`
  - `launchElectronApp()` - 启动Electron应用
  - `closeElectronApp()` - 关闭Electron应用

## 运行测试

```bash
# 运行所有社交模块测试
npm run test:e2e -- tests/e2e/social/

# 运行单个测试文件
npm run test:e2e -- tests/e2e/social/contacts.e2e.test.ts

# 以调试模式运行
npm run test:e2e -- tests/e2e/social/contacts.e2e.test.ts --debug
```

## 测试特点

- ✅ 使用统一的测试辅助函数
- ✅ 每个测试前启动应用，测试后关闭
- ✅ 支持 E2E 模式参数 (`?e2e=true`)
- ✅ 包含合理的等待时间以确保页面加载
- ✅ 灵活的元素检测（支持多种可能的UI实现）

## 注意事项

1. 测试使用 `?e2e=true` 查询参数来标识E2E测试模式
2. 每个测试都包含适当的超时设置（10秒用于页面加载）
3. 测试设计为容错性强，支持多种可能的UI实现方式
4. 空状态和列表状态都被考虑在内

## 维护说明

- 当添加新的社交功能页面时，请按照现有模式创建新的测试文件
- 保持每个测试文件至少包含4个基础测试用例
- 确保测试用例描述清晰，使用中文命名
- 更新本README文件以反映新增的测试内容

## 创建时间

2026-01-25

## 相关文档

- [E2E测试总体指南](../README.md)
- [测试辅助工具文档](../helpers/README.md)
- [知识管理模块测试](../knowledge/README.md)
- [项目管理模块测试](../project/README.md)
