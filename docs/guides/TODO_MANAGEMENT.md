# TODO 管理规范

**文档版本**: 1.0.0
**最后更新**: 2026-02-15
**适用范围**: ChainlessChain 全项目（桌面端、iOS、Android）

---

## 目录

- [1. 概述](#1-概述)
- [2. TODO vs NOTE 使用规范](#2-todo-vs-note-使用规范)
- [3. 占位符注释规范](#3-占位符注释规范)
- [4. 技术限制标记规范](#4-技术限制标记规范)
- [5. TODO 格式规范](#5-todo-格式规范)
- [6. TODO 清理流程](#6-todo-清理流程)
- [7. 最佳实践](#7-最佳实践)
- [8. 示例](#8-示例)

---

## 1. 概述

### 1.1 目的

本规范旨在：

- 统一项目中 TODO 注释的使用标准
- 区分真正的待实现功能和技术限制说明
- 提高代码可维护性和团队协作效率
- 避免过时的 TODO 注释积累

### 1.2 适用范围

本规范适用于：

- ✅ 桌面端应用（desktop-app-vue/）
- ✅ iOS 应用（ios-app/）
- ✅ Android 应用（android-app/）
- ✅ 后端服务（backend/）

### 1.3 基本原则

1. **明确性**: 注释应清楚说明是待实现功能还是技术限制
2. **可操作性**: TODO 应包含足够的上下文信息
3. **及时性**: 完成后应立即移除或更新 TODO
4. **分类性**: 使用正确的标记（TODO/NOTE/FIXME）

---

## 2. TODO vs NOTE 使用规范

### 2.1 使用 TODO 的场景

✅ **使用 TODO** 当：

- 功能尚未实现，计划在未来版本中添加
- 有明确的实现计划和优先级
- 代码占位符，等待集成真实逻辑
- 临时实现，需要重构或优化

### 2.2 使用 NOTE 的场景

✅ **使用 NOTE** 当：

- 说明技术限制或约束
- 解释为什么某些测试被跳过
- 标记简化实现（不是错误，而是设计选择）
- 记录已知的平台或依赖限制
- 说明占位符数据的用途

### 2.3 使用 FIXME 的场景

⚠️ **使用 FIXME** 当：

- 代码存在已知 bug 或问题
- 临时解决方案，需要更好的实现
- 性能问题需要优化
- 安全问题需要修复

### 2.4 对比示例

```javascript
// ❌ 不好的写法
// TODO: Skipped - VectorStore constructor requires Electron app.getPath()

// ✅ 好的写法 - 使用 NOTE，因为这是技术限制
// NOTE: Skipped - VectorStore constructor requires Electron app.getPath()
//       which is not available in unit test environment
```

```swift
// ❌ 不好的写法
// TODO: Get from IdentityManager

// ✅ 好的写法 - 使用 NOTE，因为这是演示占位符
// NOTE: 使用占位符 userId 用于 UI 演示。生产环境中应从 IdentityManager 获取
// 集成方式: IdentityManager.shared.currentUser.did
```

---

## 3. 占位符注释规范

### 3.1 定义

占位符是用于演示或测试目的的临时数据或逻辑，功能已实现但使用模拟数据。

### 3.2 注释格式

```swift
// NOTE: 使用[占位符类型]用于[目的]。[生产环境建议]
// 集成方式: [具体实现代码示例]
```

### 3.3 示例

#### iOS 示例

```swift
// ✅ 好的占位符注释
private var currentUserDid: String {
    // NOTE: 使用占位符 DID 用于 UI 演示。生产环境中应从 IdentityManager 获取
    // 集成方式: IdentityManager.shared.currentUserDid
    return "did:test:current-user"
}

// ✅ 好的数据源占位符
func loadData() {
    // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 AgentOrchestrator 获取实时任务数据
    // 集成方式: let tasks = await AgentOrchestrator.shared.getAllTasks()

    // 模拟数据...
}
```

#### JavaScript/TypeScript 示例

```javascript
// ✅ 好的占位符注释
function getCurrentUser() {
  // NOTE: 使用模拟用户数据用于开发测试。生产环境中应从认证服务获取
  // 集成方式: await authService.getCurrentUser()
  return { id: "test-user-001", name: "Test User" };
}
```

---

## 4. 技术限制标记规范

### 4.1 定义

技术限制是由于平台、依赖或测试环境的约束而无法实现的功能。

### 4.2 注释格式

```javascript
// NOTE: [功能描述] - [限制原因]
// [可选：替代方案或解决方法]
```

### 4.3 示例

#### 测试跳过

```javascript
// ✅ 好的技术限制注释
describe.skip("_splitTextWithSeparator", () => {
  // NOTE: Skipped to avoid OOM (Out Of Memory) when testing with large datasets
  // These tests would require generating large amounts of test data which can cause memory exhaustion

  it("应该在没有分隔符时返回整个文本", () => {
    // ...
  });
});
```

#### 平台限制

```swift
// ✅ 好的平台限制注释
private func updateCursorPosition() {
    // NOTE: SwiftUI TextEditor 不直接提供光标位置 API。当前使用内容长度作为近似值
    // 生产环境中可能需要使用 UITextView 的 delegate 方法获取精确位置
    let position = CursorPosition(
        line: 0,
        column: content.count,
        offset: content.count
    )
}
```

---

## 5. TODO 格式规范

### 5.1 基本格式

```
// TODO: [简短描述]
// [详细说明]
// Priority: [HIGH|MEDIUM|LOW]
// Related: [相关 Issue/PR 链接]
```

### 5.2 优先级指南

- **HIGH**: 阻塞核心功能，需要尽快实现
- **MEDIUM**: 重要增强功能，计划在下一版本实现
- **LOW**: 可选优化，可以延后处理

### 5.3 示例

```swift
// ✅ 好的 TODO 格式
// TODO: 实现完整的 SQLite 导入功能
// 需要添加事务处理和冲突解决逻辑
// Priority: MEDIUM
// Related: #123
private func importSQLiteData() {
    // 当前简化实现
    throw ToolError.unsupported("SQLite 导入功能需要事务处理")
}
```

```javascript
// ✅ 好的 TODO 格式 (JavaScript)
// TODO: 添加响应缓存机制
// 减少重复请求，提升性能
// Priority: HIGH
// Estimated: 2-3 hours
async function fetchData(url) {
  // 当前直接请求
  return await fetch(url);
}
```

---

## 6. TODO 清理流程

### 6.1 定期检查

建议频率：

- **每个 Sprint 结束时**: 检查和更新 TODO
- **发布前**: 清理所有 HIGH 优先级的 TODO
- **每季度**: 全面审查所有 TODO，移除过时标记

### 6.2 检查清单

- [ ] TODO 是否仍然相关？
- [ ] 是否应该转为 NOTE（如果是技术限制）？
- [ ] 是否已经实现但忘记移除？
- [ ] 优先级是否需要调整？
- [ ] 是否需要创建正式的 Issue？

### 6.3 清理方法

使用项目提供的脚本：

```bash
# 搜索所有 TODO
grep -r "TODO:" --include="*.{js,ts,vue,swift,kt,java}" .

# 按类型分类（可选）
grep -r "TODO.*Priority.*HIGH" --include="*.{js,ts,vue,swift,kt,java}" .
```

### 6.4 转换指南

**从 TODO 转为 NOTE 的场景**:

```swift
// Before ❌
// TODO: Get from IdentityManager
@State private var userId = "user_001"

// After ✅
// NOTE: 使用占位符 userId 用于 UI 演示。生产环境中应从 IdentityManager 获取
// 集成方式: IdentityManager.shared.currentUser.did
@State private var userId = "user_001"
```

---

## 7. 最佳实践

### 7.1 避免过时的 TODO

❌ **不要**:

```javascript
// TODO: Fix this later
const result = hackyImplementation();
```

✅ **应该**:

```javascript
// TODO: 重构为使用策略模式
// 当前实现耦合度高，难以测试
// Priority: MEDIUM
// Estimated: 4 hours
const result = currentImplementation();
```

### 7.2 关联 Issue

对于复杂的 TODO，创建 Issue 并关联：

```swift
// TODO: 实现离线消息队列持久化
// 需要设计数据库 schema 和同步机制
// Priority: HIGH
// Issue: #456
```

### 7.3 记录替代方案

```javascript
// NOTE: 使用 localStorage 作为临时方案。未来应使用 IndexedDB
// localStorage 有 5MB 限制，IndexedDB 可以存储更多数据
const cache = localStorage;
```

### 7.4 UI 文本占位符

对于 UI 中的占位文本，使用友好的措辞：

```swift
// ❌ 不好
Text("功能列表待实现")

// ✅ 好
Text("功能列表正在开发中...")
    .foregroundColor(.secondary)
    .italic()
```

---

## 8. 示例

### 8.1 完整示例（iOS）

```swift
import SwiftUI

struct UserProfileView: View {
    // NOTE: 使用占位符用户 ID 用于 UI 演示。生产环境中应从 AuthManager 获取
    // 集成方式: AuthManager.shared.currentUserId
    @State private var userId = "demo-user-001"

    // TODO: 实现用户头像上传功能
    // 需要集成图片裁剪和压缩
    // Priority: MEDIUM
    // Issue: #789
    @State private var avatarUrl: String?

    var body: some View {
        VStack {
            // UI 实现...
        }
        .onAppear {
            loadUserData()
        }
    }

    private func loadUserData() {
        // NOTE: 使用模拟数据用于 UI 演示。生产环境中应从 API 获取
        // 集成方式: await UserService.shared.getUserProfile(userId: userId)

        // 模拟数据加载...
    }

    private func uploadAvatar() {
        // TODO: 实现头像上传
        // 1. 图片选择
        // 2. 裁剪和压缩
        // 3. 上传到服务器
        // 4. 更新用户配置
        // Priority: MEDIUM
        print("头像上传功能开发中...")
    }
}
```

### 8.2 完整示例（JavaScript）

```javascript
/**
 * 用户数据服务
 */
class UserService {
  constructor() {
    // NOTE: 使用内存缓存作为临时方案。生产环境应使用 Redis
    // 内存缓存在应用重启后会丢失，Redis 提供持久化
    this.cache = new Map();
  }

  /**
   * 获取用户配置
   * TODO: 添加用户配置缓存失效机制
   * 当前缓存永不过期，可能导致数据过时
   * Priority: HIGH
   * Estimated: 2 hours
   */
  async getUserProfile(userId) {
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }

    const profile = await this.fetchFromAPI(userId);
    this.cache.set(userId, profile);
    return profile;
  }

  /**
   * 从 API 获取数据
   */
  async fetchFromAPI(userId) {
    // NOTE: 简化实现。完整版本应包含重试逻辑和错误处理
    // 可在未来版本中添加指数退避重试
    return await fetch(`/api/users/${userId}`).then((r) => r.json());
  }
}
```

### 8.3 测试文件示例

```javascript
describe("UserService", () => {
  describe.skip("缓存失效", () => {
    // NOTE: Skipped - 需要等待缓存失效功能实现后测试
    // Related TODO: UserService.getUserProfile() 中的缓存失效机制

    it("应该在缓存过期后重新获取数据", async () => {
      // 测试逻辑...
    });
  });

  it("应该返回用户配置", async () => {
    // NOTE: 使用模拟 API 响应进行测试
    // 在集成测试中应使用真实 API
    const mockUser = { id: "001", name: "Test User" };
    // 测试逻辑...
  });
});
```

---

## 9. 常见问题

### Q1: 什么时候应该创建 Issue 而不是使用 TODO？

**A**: 当满足以下条件之一时：

- 需要跨多个文件或模块的更改
- 预计实现时间超过 4 小时
- 需要团队讨论或设计评审
- 涉及架构层面的更改

### Q2: 如何处理第三方库限制？

**A**: 使用 NOTE 标记，并说明限制和可能的解决方案：

```javascript
// NOTE: Axios 不支持请求取消后的清理回调
// 解决方案：使用 AbortController 并在 .catch() 中检查错误类型
```

### Q3: UI 演示数据需要标记吗？

**A**: 是的，应该使用 NOTE 标记并说明这是演示数据：

```swift
// NOTE: 使用模拟数据用于 UI 演示和原型测试
// 生产环境中应替换为实际数据源
let mockData = [...]
```

---

## 10. 工具支持

### 10.1 VS Code 扩展

推荐使用 [TODO Highlight](https://marketplace.visualstudio.com/items?itemName=wayou.vscode-todo-highlight) 扩展。

配置示例（settings.json）：

```json
{
  "todohighlight.keywords": [
    {
      "text": "TODO:",
      "color": "#ff6b6b",
      "backgroundColor": "transparent"
    },
    {
      "text": "NOTE:",
      "color": "#4ecdc4",
      "backgroundColor": "transparent"
    },
    {
      "text": "FIXME:",
      "color": "#ffe66d",
      "backgroundColor": "transparent"
    }
  ]
}
```

### 10.2 Xcode 标记

在 Xcode 中，使用 `// MARK: - TODO` 会在导航栏中显示：

```swift
// MARK: - TODO: 实现离线同步
func syncOfflineData() {
    // ...
}
```

---

## 11. 检查清单

在提交代码前，请检查：

- [ ] 所有新增的 TODO 都有明确的描述和优先级
- [ ] 技术限制使用 NOTE 而不是 TODO
- [ ] UI 占位符包含集成方式说明
- [ ] 跳过的测试有明确的原因说明
- [ ] 过时的 TODO 已被移除或更新
- [ ] 复杂的 TODO 已创建对应的 Issue

---

## 12. 更新日志

| 版本  | 日期       | 变更说明                             |
| ----- | ---------- | ------------------------------------ |
| 1.0.0 | 2026-02-15 | 初始版本，基于 v0.33.0 TODO 清理经验 |

---

**维护者**: ChainlessChain Team
**最后审核**: 2026-02-15
