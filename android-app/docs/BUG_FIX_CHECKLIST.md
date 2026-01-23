# Bug 修复清单

## 版本信息
- **版本**: v1.0
- **创建日期**: 2026-01-23
- **状态**: 跟踪中

---

## 1. 已知 Bug 列表

### 1.1 高优先级 (P0)

#### Bug #1: 应用启动时偶尔崩溃
- **状态**: ⏳ 修复中
- **描述**: 冷启动时，偶尔出现 NullPointerException
- **重现步骤**:
  1. 完全关闭应用
  2. 清除应用缓存
  3. 重新启动应用
  4. 约 5% 概率崩溃
- **错误日志**:
  ```
  java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference
  at com.chainlesschain.android.ChainlessChainApplication.onCreate()
  ```
- **根本原因**: 数据库初始化和 Hilt 注入存在竞态条件
- **修复方案**:
  1. 延迟数据库初始化
  2. 添加非空检查
  3. 使用 lateinit 而非直接引用
- **修复人**: [待分配]
- **预计完成**: 2026-01-25

#### Bug #2: 内存泄漏导致 OOM
- **状态**: ⏳ 修复中
- **描述**: 长时间使用应用后，内存持续增长，最终 OutOfMemoryError
- **重现步骤**:
  1. 启动应用
  2. 浏览动态列表 10+ 分钟
  3. 切换到好友列表
  4. 观察内存使用量持续增长
- **LeakCanary 报告**:
  ```
  LeakCanary detected: PostCard -> ImageLoader -> Coil -> Memory leak
  ```
- **根本原因**:
  - Coil ImageLoader 未正确释放
  - Compose remember 使用不当
  - 未取消订阅的 Flow
- **修复方案**:
  1. 使用 LocalContext.current.imageLoader
  2. 在 remember 中正确使用 keys
  3. 使用 collectAsStateWithLifecycle()
  4. 在 DisposableEffect 中取消订阅
- **修复人**: [待分配]
- **预计完成**: 2026-01-26

---

### 1.2 中优先级 (P1)

#### Bug #3: 动态发布后不立即刷新
- **状态**: ✅ 已修复
- **描述**: 发布动态后，需要手动下拉刷新才能看到新动态
- **根本原因**: Repository 未触发 Flow 更新
- **修复方案**: 在 publishPost 后发送 invalidate 信号
- **修复人**: Android Team
- **修复日期**: 2026-01-23
- **修复 PR**: #123

#### Bug #4: 搜索好友时输入延迟
- **状态**: ⏳ 修复中
- **描述**: 在搜索框输入时，UI 有明显卡顿
- **重现步骤**:
  1. 打开好友列表
  2. 在搜索框快速输入文字
  3. 观察输入延迟和卡顿
- **根本原因**: 每次输入都触发数据库查询，无防抖
- **修复方案**:
  1. 使用 snapshotFlow + debounce(300ms)
  2. 在后台线程执行搜索
  3. 使用 derivedStateOf 缓存结果
- **代码示例**:
  ```kotlin
  LaunchedEffect(Unit) {
      snapshotFlow { searchQuery }
          .debounce(300)
          .distinctUntilChanged()
          .collectLatest { query ->
              viewModel.searchFriends(query)
          }
  }
  ```
- **修复人**: [待分配]
- **预计完成**: 2026-01-27

#### Bug #5: 图片加载失败时无提示
- **状态**: 📋 待修复
- **描述**: 当图片加载失败时，显示空白，无任何提示
- **修复方案**:
  1. 添加错误占位符
  2. 显示重试按钮
  3. 记录错误日志
- **代码示例**:
  ```kotlin
  AsyncImage(
      model = ImageRequest.Builder(LocalContext.current)
          .data(imageUrl)
          .crossfade(true)
          .build(),
      contentDescription = null,
      placeholder = painterResource(R.drawable.placeholder),
      error = painterResource(R.drawable.error_placeholder),
      modifier = Modifier.clickable { /* 重试 */ }
  )
  ```
- **修复人**: [待分配]

#### Bug #6: 点赞动画不流畅
- **状态**: 📋 待修复
- **描述**: 点击点赞按钮时，动画卡顿
- **修复方案**:
  1. 使用 animateFloatAsState 优化动画
  2. 减少重组范围
  3. 使用硬件加速
- **代码示例**:
  ```kotlin
  val scale by animateFloatAsState(
      targetValue = if (isLiked) 1.2f else 1f,
      animationSpec = spring(
          dampingRatio = Spring.DampingRatioMediumBouncy,
          stiffness = Spring.StiffnessLow
      )
  )
  ```

---

### 1.3 低优先级 (P2)

#### Bug #7: 深色模式切换时闪烁
- **状态**: 📋 待修复
- **描述**: 切换深色/浅色模式时，UI 有短暂闪烁
- **修复方案**: 使用 CrossfadeTransition

#### Bug #8: 通知角标数量不准确
- **状态**: 📋 待修复
- **描述**: 通知角标显示的未读数量偶尔不正确
- **修复方案**:
  1. 使用 Room 的 @Query 返回 Flow<Int>
  2. 确保数据库更新触发 Flow 刷新

#### Bug #9: 键盘弹出时底部导航栏被遮挡
- **状态**: 📋 待修复
- **描述**: 在输入框输入时，键盘遮挡底部导航
- **修复方案**: 使用 `imePadding()` 和 `windowInsetsPadding()`

---

## 2. Bug 修复流程

### 2.1 Bug 报告模板

```markdown
## Bug 描述
[简短描述问题]

## 重现步骤
1. [步骤 1]
2. [步骤 2]
3. [步骤 3]

## 预期行为
[描述预期的正确行为]

## 实际行为
[描述实际发生的错误行为]

## 环境信息
- Android 版本: [例如: Android 13]
- 设备型号: [例如: Pixel 6]
- 应用版本: [例如: v0.27.0]

## 错误日志
```
[粘贴相关错误日志]
```

## 截图/录屏
[如有必要，附加截图或录屏]

## 可能的原因
[如果知道，描述可能的原因]
```

### 2.2 修复步骤

1. **复现问题**
   - 按照重现步骤确认 Bug
   - 在多个设备上测试
   - 记录详细日志

2. **定位根本原因**
   - 使用 Logcat 查看日志
   - 使用 Android Profiler 分析性能
   - 使用断点调试
   - 检查相关代码

3. **设计修复方案**
   - 评估多种解决方案
   - 选择最优方案
   - 考虑性能和兼容性影响

4. **实现修复**
   - 编写修复代码
   - 遵循代码规范
   - 添加注释说明修复逻辑

5. **测试修复**
   - 验证 Bug 已修复
   - 确保无新增问题
   - 运行相关单元测试
   - 进行回归测试

6. **代码审查**
   - 提交 Pull Request
   - 通过团队审查
   - 解决审查意见

7. **部署和监控**
   - 合并到主分支
   - 发布新版本
   - 监控崩溃报告

---

## 3. 测试检查清单

### 3.1 修复前检查

- [ ] 能稳定重现 Bug
- [ ] 了解根本原因
- [ ] 设计了修复方案
- [ ] 修复方案已评审

### 3.2 修复后检查

- [ ] Bug 已完全修复
- [ ] 无新增问题
- [ ] 通过所有相关测试
- [ ] 代码符合规范
- [ ] 添加了必要的测试用例
- [ ] 更新了文档

---

## 4. 回归测试清单

### 4.1 核心功能测试

- [ ] 应用启动正常
- [ ] 登录/注册功能正常
- [ ] 好友管理功能正常
- [ ] 动态发布和浏览正常
- [ ] 点赞评论功能正常
- [ ] 通知功能正常

### 4.2 性能测试

- [ ] 启动时间 < 2s
- [ ] UI 流畅度 ≥ 55 FPS
- [ ] 内存使用 < 150MB
- [ ] 无内存泄漏
- [ ] 电池消耗正常

### 4.3 兼容性测试

- [ ] Android 8.0 (API 26) 可用
- [ ] Android 13 (API 33) 可用
- [ ] Android 14 (API 34) 可用
- [ ] 不同屏幕尺寸正常显示
- [ ] 横屏模式正常

---

## 5. 常见问题和解决方案

### 5.1 崩溃问题

**问题类型**:
- NullPointerException
- IllegalStateException
- OutOfMemoryError
- NetworkOnMainThreadException

**通用解决方案**:
1. 添加空值检查
2. 使用安全调用 `?.`
3. 在正确的线程执行操作
4. 使用 try-catch 捕获异常
5. 优化内存使用

### 5.2 内存泄漏

**常见原因**:
- 未取消的协程
- 未释放的监听器
- 静态引用持有 Context
- 匿名内部类持有外部引用

**解决方案**:
```kotlin
// ❌ 错误 - 内存泄漏
class MyViewModel : ViewModel() {
    init {
        GlobalScope.launch {
            // 这会导致泄漏
        }
    }
}

// ✅ 正确
class MyViewModel : ViewModel() {
    init {
        viewModelScope.launch {
            // 使用 viewModelScope，会自动取消
        }
    }
}

// ❌ 错误 - Compose 泄漏
@Composable
fun MyScreen() {
    LaunchedEffect(Unit) {
        someFlow.collect {
            // 如果 Flow 无限，会导致泄漏
        }
    }
}

// ✅ 正确
@Composable
fun MyScreen() {
    val data by someFlow.collectAsStateWithLifecycle()
    // 自动管理生命周期
}
```

### 5.3 性能问题

**常见原因**:
- 主线程执行耗时操作
- 频繁的重组
- 未优化的列表渲染
- 过大的图片

**解决方案**:
```kotlin
// 减少重组
@Composable
fun MyComposable(data: Data) {
    val processedData = remember(data) {
        // 仅在 data 改变时重新计算
        processData(data)
    }
}

// 优化列表
LazyColumn {
    items(items, key = { it.id }) { item ->
        // 使用 key 优化性能
        ItemCard(item)
    }
}

// 后台线程处理
viewModelScope.launch(Dispatchers.IO) {
    val result = repository.heavyOperation()
    withContext(Dispatchers.Main) {
        updateUi(result)
    }
}
```

---

## 6. 监控和报告

### 6.1 崩溃监控

**工具**:
- LeakCanary (内存泄漏)
- Android Vitals (崩溃率)
- Firebase Crashlytics (崩溃报告)

**关键指标**:
- 崩溃率 < 0.5%
- ANR 率 < 0.1%
- 内存泄漏数 = 0

### 6.2 性能监控

**工具**:
- Android Profiler
- Baseline Profile
- Macrobenchmark

**关键指标**:
- 冷启动 < 2s
- 热启动 < 1s
- 帧率 ≥ 55 FPS
- 内存使用 < 150MB

---

## 7. 下一步行动

### 7.1 立即执行 (本周)

- [ ] 修复 Bug #1 (启动崩溃)
- [ ] 修复 Bug #2 (内存泄漏)
- [ ] 修复 Bug #4 (搜索延迟)
- [ ] 添加自动化测试覆盖

### 7.2 短期计划 (2 周内)

- [ ] 修复所有 P1 优先级 Bug
- [ ] 提升测试覆盖率到 80%
- [ ] 建立 CI/CD 自动测试
- [ ] 集成 Firebase Crashlytics

### 7.3 长期计划 (1 个月内)

- [ ] 修复所有已知 Bug
- [ ] 建立性能监控系统
- [ ] 定期性能优化
- [ ] 持续改进代码质量

---

**文档维护者：** Android 团队
**最后更新：** 2026-01-23
