# Compose 动画使用指南

## 概述

本文档提供 ChainlessChain Android 应用的动画使用指南和最佳实践。

**版本：** v0.27.0
**更新日期：** 2026-01-23

---

## 一、动画工具类

### 1. AnimationUtils

提供统一的动画时长、缓动曲线和常用动画效果。

#### 标准时长

```kotlin
object Duration {
    const val FAST = 150        // 快速动画（微交互）
    const val NORMAL = 300      // 标准动画（默认）
    const val SLOW = 500        // 慢速动画（强调）
    const val VERY_SLOW = 800   // 非常慢（页面过渡）
}
```

#### 标准缓动曲线

```kotlin
object Easing {
    val STANDARD = FastOutSlowInEasing          // 标准
    val EMPHASIZED = CubicBezierEasing(...)     // 强调
    val DECELERATE = LinearOutSlowInEasing      // 减速
    val ACCELERATE = FastOutLinearInEasing      // 加速
    val BOUNCE = CubicBezierEasing(...)         // 弹跳
}
```

---

## 二、交互动画

### 1. 按压动画

**效果：** 按下时缩小，松开时恢复

```kotlin
Button(
    onClick = { /* ... */ },
    modifier = Modifier.pressAnimation()
) {
    Text("点击我")
}
```

**自定义缩放比例：**
```kotlin
Modifier.pressAnimation(
    pressedScale = 0.90f,  // 按下时缩放到 90%
    duration = 150
)
```

---

### 2. 震动动画

**效果：** 左右震动（用于错误提示）

```kotlin
@Composable
fun LoginForm() {
    var shake by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.shakeAnimation(shake) {
            shake = false  // 动画结束后重置
        }
    ) {
        TextField(
            value = password,
            onValueChange = { password = it }
        )

        Button(onClick = {
            if (password.isEmpty()) {
                shake = true  // 触发震动
            }
        }) {
            Text("登录")
        }
    }
}
```

**使用场景：**
- ✅ 表单验证失败
- ✅ 输入错误
- ✅ 操作被拒绝

---

### 3. 弹跳动画

**效果：** 放大后弹跳（用于成功反馈）

```kotlin
@Composable
fun SuccessButton() {
    var bounce by remember { mutableStateOf(false) }

    Button(
        onClick = {
            bounce = true
            onSuccess()
        },
        modifier = Modifier.bounceAnimation(bounce) {
            bounce = false
        }
    ) {
        Text("提交")
    }
}
```

**使用场景：**
- ✅ 操作成功
- ✅ 完成任务
- ✅ 收到奖励

---

### 4. 脉冲动画

**效果：** 持续缩放（引导注意力）

```kotlin
@Composable
fun NotificationBadge(count: Int) {
    Box(
        modifier = Modifier
            .size(24.dp)
            .pulseAnimation(enabled = count > 0)
            .background(Color.Red, CircleShape)
    ) {
        Text(
            text = count.toString(),
            modifier = Modifier.align(Alignment.Center)
        )
    }
}
```

**使用场景：**
- ✅ 未读通知
- ✅ 新功能提示
- ✅ 引导用户操作

---

### 5. 旋转动画

**效果：** 持续旋转（加载指示）

```kotlin
@Composable
fun RefreshButton(isLoading: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(
            imageVector = Icons.Default.Refresh,
            contentDescription = "刷新",
            modifier = Modifier.rotateAnimation(enabled = isLoading)
        )
    }
}
```

**使用场景：**
- ✅ 加载中
- ✅ 刷新数据
- ✅ 同步状态

---

## 三、页面过渡动画

### 1. 标准页面过渡（前进）

```kotlin
NavHost(
    navController = navController,
    startDestination = "home"
) {
    composable(
        route = "home",
        enterTransition = { standardForwardTransition().first },
        exitTransition = { standardForwardTransition().second }
    ) {
        HomeScreen()
    }

    composable(
        route = "detail/{id}",
        enterTransition = { standardForwardTransition().first },
        exitTransition = { standardForwardTransition().second },
        popEnterTransition = { standardBackwardTransition().first },
        popExitTransition = { standardBackwardTransition().second }
    ) {
        DetailScreen()
    }
}
```

**效果：**
- 前进：新页面从右侧滑入，旧页面向左轻微滑出并淡出
- 返回：新页面从左侧滑入，旧页面向右滑出

---

### 2. 模态弹窗动画

```kotlin
@Composable
fun MyScreen() {
    var showDialog by remember { mutableStateOf(false) }

    AnimatedVisibility(
        visible = showDialog,
        enter = modalTransition().first,
        exit = modalTransition().second
    ) {
        Dialog(onDismissRequest = { showDialog = false }) {
            // 对话框内容
        }
    }
}
```

**效果：**
- 进入：从底部滑入并淡入
- 退出：向底部滑出并淡出

---

### 3. Tab 切换动画

```kotlin
@Composable
fun TabContent(selectedTab: Int) {
    AnimatedContent(
        targetState = selectedTab,
        transitionSpec = {
            SharedElementTransition.PageTransition.fadeInOut.first with
            SharedElementTransition.PageTransition.fadeInOut.second
        },
        label = "tab"
    ) { tab ->
        when (tab) {
            0 -> HomeTab()
            1 -> ProjectTab()
            2 -> ExploreTab()
        }
    }
}
```

**效果：** 淡入淡出切换

---

## 四、列表动画

### 1. 列表项进入/退出动画

```kotlin
@Composable
fun ItemList(items: List<Item>) {
    LazyColumn {
        items(
            items = items,
            key = { it.id }
        ) { item ->
            ItemCard(
                item = item,
                modifier = Modifier.animateItemPlacement(
                    animationSpec = spring(
                        dampingRatio = Spring.DampingRatioMediumBouncy,
                        stiffness = Spring.StiffnessMedium
                    )
                )
            )
        }
    }
}
```

**效果：** 列表项添加/删除时平滑移动

---

### 2. 滑动删除动画

```kotlin
@Composable
fun SwipeToDeleteItem(
    item: Item,
    onDelete: () -> Unit
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = {
            if (it == SwipeToDismissBoxValue.EndToStart) {
                onDelete()
                true
            } else {
                false
            }
        }
    )

    SwipeToDismissBox(
        state = dismissState,
        backgroundContent = {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Red),
                contentAlignment = Alignment.CenterEnd
            ) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "删除",
                    modifier = Modifier.padding(16.dp)
                )
            }
        }
    ) {
        ItemCard(item)
    }
}
```

**效果：** 向左滑动删除，显示红色背景和删除图标

---

### 3. 下拉刷新动画

```kotlin
@Composable
fun PullToRefreshList(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    items: List<Item>
) {
    val pullRefreshState = rememberPullRefreshState(
        refreshing = isRefreshing,
        onRefresh = onRefresh
    )

    Box(modifier = Modifier.pullRefresh(pullRefreshState)) {
        LazyColumn {
            items(items) { item ->
                ItemCard(item)
            }
        }

        PullRefreshIndicator(
            refreshing = isRefreshing,
            state = pullRefreshState,
            modifier = Modifier.align(Alignment.TopCenter)
        )
    }
}
```

---

## 五、内容变化动画

### 1. 文本变化动画

```kotlin
@Composable
fun AnimatedCounter(count: Int) {
    AnimatedContent(
        targetState = count,
        transitionSpec = {
            if (targetState > initialState) {
                // 数字增加：向上滑入
                slideInVertically { -it } with slideOutVertically { it }
            } else {
                // 数字减少：向下滑入
                slideInVertically { it } with slideOutVertically { -it }
            }
        },
        label = "counter"
    ) { targetCount ->
        Text(text = targetCount.toString())
    }
}
```

---

### 2. 图标变化动画

```kotlin
@Composable
fun ToggleIcon(isChecked: Boolean, onToggle: () -> Unit) {
    IconButton(onClick = onToggle) {
        AnimatedContent(
            targetState = isChecked,
            transitionSpec = { scaleIn() with scaleOut() },
            label = "icon"
        ) { checked ->
            Icon(
                imageVector = if (checked) {
                    Icons.Default.Favorite
                } else {
                    Icons.Default.FavoriteBorder
                },
                contentDescription = null,
                tint = if (checked) Color.Red else Color.Gray
            )
        }
    }
}
```

---

### 3. 尺寸变化动画

```kotlin
@Composable
fun ExpandableCard(isExpanded: Boolean) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(
                animationSpec = spring(
                    dampingRatio = Spring.DampingRatioMediumBouncy,
                    stiffness = Spring.StiffnessLow
                )
            )
    ) {
        Column {
            Text("标题")

            if (isExpanded) {
                Text("详细内容...")
            }
        }
    }
}
```

---

## 六、节能模式下的动画

### 根据电池状态调整动画

```kotlin
@Composable
fun AdaptiveAnimation() {
    val powerSavingConfig by rememberPowerSavingConfig()

    AnimatedContent(
        targetState = selectedTab,
        transitionSpec = {
            if (powerSavingConfig.reduceAnimations) {
                // 低电量：简单淡入淡出
                fadeIn() with fadeOut()
            } else {
                // 正常：完整滑动动画
                slideInHorizontally { it } with
                slideOutHorizontally { -it }
            }
        }
    ) { tab ->
        TabContent(tab)
    }
}
```

---

## 七、性能优化建议

### 1. 避免过度动画

**❌ 不好：** 同时运行多个复杂动画
```kotlin
Column {
    repeat(100) { index ->
        Box(
            modifier = Modifier
                .pulseAnimation()  // ❌ 100 个脉冲动画
                .rotateAnimation() // ❌ 100 个旋转动画
        )
    }
}
```

**✅ 好：** 只在必要时使用动画
```kotlin
LazyColumn {
    items(items) { item ->
        Box(
            modifier = Modifier.animateItemPlacement()  // ✅ 只在位置变化时动画
        )
    }
}
```

---

### 2. 使用 remember 缓存动画状态

**❌ 不好：** 每次重组都创建新的动画状态
```kotlin
@Composable
fun MyAnimation() {
    val scale by animateFloatAsState(1.2f)  // ❌ 每次重组都重新创建
}
```

**✅ 好：** 使用 remember 缓存
```kotlin
@Composable
fun MyAnimation(isAnimating: Boolean) {
    val scale by remember {
        animateFloatAsState(if (isAnimating) 1.2f else 1f)
    }
}
```

---

### 3. 使用 key 参数优化列表动画

```kotlin
LazyColumn {
    items(
        items = items,
        key = { it.id }  // ✅ 使用稳定的 key
    ) { item ->
        ItemCard(
            item = item,
            modifier = Modifier.animateItemPlacement()
        )
    }
}
```

---

## 八、动画调试

### 1. 启用动画检查器

Android Studio > Tools > Layout Inspector > Show All (包括动画)

### 2. 慢动作查看动画

Settings > Developer Options > Animation Scale > 5x

### 3. 动画性能监控

```kotlin
@Composable
fun MyScreen() {
    if (BuildConfig.DEBUG) {
        ComposePerformanceUtils.RecompositionCounter("MyScreen")
    }

    // 内容
}
```

---

## 九、完整示例

### 知识库列表页动画

```kotlin
@Composable
fun KnowledgeListScreen() {
    var items by remember { mutableStateOf(emptyList<Item>()) }
    var isRefreshing by remember { mutableStateOf(false) }

    val pullRefreshState = rememberPullRefreshState(
        refreshing = isRefreshing,
        onRefresh = { isRefreshing = true }
    )

    Box(modifier = Modifier.pullRefresh(pullRefreshState)) {
        LazyColumn {
            items(
                items = items,
                key = { it.id }
            ) { item ->
                ItemCard(
                    item = item,
                    modifier = Modifier
                        .animateItemPlacement()  // 列表项位置变化动画
                        .pressAnimation()        // 按压反馈
                )
            }
        }

        PullRefreshIndicator(
            refreshing = isRefreshing,
            state = pullRefreshState,
            modifier = Modifier.align(Alignment.TopCenter)
        )
    }
}
```

---

## 十、参考资料

- [Compose Animation](https://developer.android.com/jetpack/compose/animation)
- [Material Motion](https://m3.material.io/styles/motion/overview)
- [Animation Guide](https://developer.android.com/develop/ui/compose/animation/introduction)

---

**维护者：** Android 团队
**最后更新：** 2026-01-23
