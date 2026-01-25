# Android应用功能测试指南

## 测试环境准备

### 1. 安装APK

如果还没有最新的APK，需要先编译：

```bash
cd android-app
./gradlew :app:assembleDebug
```

APK位置：`android-app/app/build/outputs/apk/debug/app-debug.apk`

### 2. 安装到设备

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 功能测试清单

### ✅ 已实现功能

#### 1. LLM配置测试（刚修复的Volcengine功能）

**测试路径**: 首页 → 右上角头像 → AI配置

**测试步骤**:

1. 点击右上角头像打开个人中心
2. 点击"AI配置"进入LLM设置
3. 选择"豆包/Doubao"提供商
4. 输入API Key（使用PC端的火山引擎Key）
5. 点击"测试连接"按钮
6. **预期结果**: 应该显示"连接成功✓"（这是我们刚修复的功能）

**涉及文件**:

- `app/src/main/java/com/chainlesschain/android/presentation/screens/LLMSettingsScreen.kt`
- `feature-ai/src/main/java/com/chainlesschain/android/feature/ai/data/llm/CloudLLMAdapters.kt:475-543` (Volcengine修复)

#### 2. AI对话会话创建测试

**测试路径**: 首页 → 探索标签 → 新建对话

**测试步骤**:

1. 在底部导航栏点击"探索"
2. 点击右上角"+"号（新建对话）
3. 输入对话标题（如："测试对话"）
4. 选择模型（如："gpt-3.5-turbo"或配置好的豆包模型）
5. 点击"创建"按钮
6. **预期结果**: 创建成功并进入对话界面

**涉及文件**:

- `feature-ai/src/main/java/com/chainlesschain/android/feature/ai/presentation/NewConversationScreen.kt`
- `feature-ai/src/main/java/com/chainlesschain/android/feature/ai/presentation/ConversationViewModel.kt:70-85`

#### 3. AI对话发送消息测试

**测试路径**: 对话界面

**测试步骤**:

1. 在对话列表中点击任一对话（或刚创建的对话）
2. 在底部输入框输入消息："你好，这是一个测试消息"
3. 点击发送按钮
4. **预期结果**:
   - 消息显示在对话界面
   - AI开始流式回复（如果配置了有效的API Key）
   - 或显示错误提示（如果API Key未配置/无效）

**涉及文件**:

- `feature-ai/src/main/java/com/chainlesschain/android/feature/ai/presentation/ChatScreen.kt`
- `feature-ai/src/main/java/com/chainlesschain/android/feature/ai/presentation/ConversationViewModel.kt`

#### 4. AI测试对话界面

**测试路径**: 首页 → 右上角头像 → AI测试

**测试步骤**:

1. 点击右上角头像打开个人中心
2. 点击"AI测试"
3. 选择已配置的提供商（如Doubao）
4. 输入测试消息
5. 点击发送
6. **预期结果**:
   - 显示流式响应（带光标动画）
   - 显示性能统计（响应时间、Token数等）
   - 支持RAG开关

**涉及文件**:

- `app/src/main/java/com/chainlesschain/android/presentation/screens/LLMTestChatScreen.kt`

### ⚠️ 部分实现功能

#### 5. 项目创建测试（需检查）

**当前状态**:

- ✅ ViewModel实现完整 (`ProjectViewModel.kt:354-388`)
- ✅ UI界面已创建 (`CreateProjectScreen.kt`)
- ⚠️ 导航路由可能未完全集成

**可能的测试路径**:

- 路径1: 首页 → 项目标签 → 右上角"+"按钮
- 路径2: 项目详情页中可能有创建项目入口

**测试步骤**（如果找到入口）:

1. 找到"新建项目"或"+"按钮
2. 输入项目名称（必填）
3. 输入项目描述（可选）
4. 选择项目类型（开发/设计/写作/研究/其他）
5. 添加标签（可选）
6. 点击"创建"按钮
7. **预期结果**: 项目创建成功并显示在项目列表中

**涉及文件**:

- `feature-project/src/main/java/com/chainlesschain/android/feature/project/ui/CreateProjectScreen.kt`
- `feature-project/src/main/java/com/chainlesschain/android/feature/project/viewmodel/ProjectViewModel.kt:354-388`

#### 6. 项目详情查看测试

**测试路径**: 首页 → 项目标签 → 点击任一项目卡片

**测试步骤**:

1. 在项目列表中点击任一项目
2. **预期结果**: 进入项目详情页

**注意**: 当前`ProjectScreen.kt`使用的是模拟数据(mock data)，可能不会显示实际从数据库创建的项目。

**涉及文件**:

- `app/src/main/java/com/chainlesschain/android/presentation/screens/ProjectScreen.kt:38-98` (模拟数据)
- `app/src/main/java/com/chainlesschain/android/presentation/screens/ProjectDetailScreenV2.kt`

## 已知问题

### 1. 编译错误（未影响已有功能）

- ❌ `feature-file-browser` 模块有编译错误（已临时禁用）
- ❌ `feature-project` 依赖 `feature-file-browser`（导入文件功能受影响）
- ✅ LLM配置和对话功能不受影响

### 2. ProjectScreen使用模拟数据

- `app/src/main/java/com/chainlesschain/android/presentation/screens/ProjectScreen.kt`
- 显示的项目是硬编码的示例数据，不是从数据库加载
- 需要修改为使用`ProjectViewModel`从数据库加载真实数据

## 测试优先级

### 高优先级（核心功能）

1. ✅ **LLM配置测试** - 刚修复的Volcengine连接测试
2. ✅ **AI对话创建和发送** - 核心AI功能
3. ✅ **AI测试界面** - 验证LLM配置是否正常工作

### 中优先级（辅助功能）

4. ⚠️ **项目创建** - 需要检查导航路由
5. ⚠️ **项目查看** - 需要确认是否连接真实数据

## 测试报告模板

测试完成后，请记录以下信息：

```
功能: [测试的功能名称]
测试时间: [日期时间]
测试设备: [设备型号和Android版本]
测试结果: [✅成功 / ❌失败 / ⚠️部分成功]

详细说明:
- [步骤1]: [结果]
- [步骤2]: [结果]
...

问题截图: [如有问题，附上截图]
```

## 下一步建议

1. **立即测试**: LLM配置和AI对话功能（已完整实现）
2. **后续修复**:
   - 修复`feature-file-browser`编译错误
   - 将`ProjectScreen`改为使用真实数据
   - 添加项目创建的导航路由
3. **功能增强**:
   - 测试RAG功能
   - 测试文件引用功能（待file-browser修复后）

---

**最后更新**: 2026-01-25
**修复内容**: Volcengine/Doubao API连接测试
