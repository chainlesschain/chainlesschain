# Kotlin 代码风格指南

## 概述

本文档定义了 ChainlessChain Android 项目的 Kotlin 代码风格和最佳实践。

**版本：** v1.0
**更新日期：** 2026-01-23

---

## 1. 文件组织

### 1.1 文件命名

- 文件名使用 PascalCase（大驼峰）
- 文件名应反映其主要内容

```kotlin
// ✅ 好
KnowledgeListScreen.kt
UserRepository.kt
StringExtensions.kt

// ❌ 不好
knowledgeList.kt
user_repository.kt
utils.kt
```

### 1.2 文件结构

文件内容应按以下顺序组织：

```kotlin
// 1. 包声明
package com.chainlesschain.android.feature.knowledge

// 2. 导入语句（按字母排序）
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*

// 3. 顶层声明（常量、扩展函数等）
const val MAX_ITEMS = 100

// 4. 类定义
class MyClass { }

// 5. 扩展函数
fun String.capitalize() { }
```

---

## 2. 命名规范

### 2.1 包名

- 全小写，不使用下划线
- 使用点分隔

```kotlin
// ✅ 好
package com.chainlesschain.android.feature.knowledge

// ❌ 不好
package com.ChainlessChain.Android.Feature.Knowledge
package com.chainlesschain.android_feature_knowledge
```

### 2.2 类名

- 使用 PascalCase（大驼峰）
- 名词或名词短语

```kotlin
// ✅ 好
class KnowledgeItem
class UserRepository
class HttpClient

// ❌ 不好
class knowledgeItem
class userrepository
class HTTPClient
```

### 2.3 函数名

- 使用 camelCase（小驼峰）
- 动词或动词短语

```kotlin
// ✅ 好
fun loadData()
fun calculateTotal()
fun isValid()

// ❌ 不好
fun LoadData()
fun CalculateTotal()
fun valid()
```

### 2.4 变量名

**普通变量：**
- 使用 camelCase
- 描述性名称

```kotlin
// ✅ 好
val userName = "John"
var itemCount = 0
private val _uiState = MutableStateFlow(UiState())

// ❌ 不好
val UserName = "John"
var count = 0  // 太短，不清晰
private val uiState = MutableStateFlow(UiState())  // 应该有下划线
```

**常量：**
- 使用 UPPER_SNAKE_CASE
- 定义在 companion object 或顶层

```kotlin
// ✅ 好
const val MAX_COUNT = 100
const val API_BASE_URL = "https://api.example.com"

companion object {
    const val DEFAULT_TIMEOUT = 30
}

// ❌ 不好
const val maxCount = 100
const val apiBaseUrl = "https://api.example.com"
```

---

## 3. 代码格式

### 3.1 缩进

- 使用 4 个空格缩进
- 不使用 Tab

```kotlin
// ✅ 好
class MyClass {
    fun myFunction() {
        if (condition) {
            doSomething()
        }
    }
}

// ❌ 不好
class MyClass {
  fun myFunction() {
    if (condition) {
      doSomething()
    }
  }
}
```

### 3.2 行长度

- 最大行长度：120 字符
- 超过时换行

```kotlin
// ✅ 好
fun longFunctionName(
    parameter1: String,
    parameter2: Int,
    parameter3: Boolean
): String {
    // ...
}

// ❌ 不好
fun longFunctionName(parameter1: String, parameter2: Int, parameter3: Boolean): String {
    // ...
}
```

### 3.3 空格

**操作符周围：**
```kotlin
// ✅ 好
val sum = a + b
val result = value * 2

// ❌ 不好
val sum=a+b
val result=value*2
```

**关键字之后：**
```kotlin
// ✅ 好
if (condition) {
    // ...
}

// ❌ 不好
if(condition){
    // ...
}
```

### 3.4 空行

- 类成员之间使用一个空行分隔
- 逻辑块之间使用空行分隔

```kotlin
class MyClass {
    private val field1 = "value1"

    fun function1() {
        // 实现
    }

    fun function2() {
        // 实现
    }
}
```

---

## 4. 编程实践

### 4.1 可空性

**优先使用非空类型：**
```kotlin
// ✅ 好
val name: String = "John"
val count: Int = 0

// ❌ 不好（除非真的需要可空）
val name: String? = "John"
val count: Int? = 0
```

**安全调用：**
```kotlin
// ✅ 好
val length = name?.length ?: 0
name?.let { println(it) }

// ❌ 不好
val length = name!!.length  // 避免使用 !!
if (name != null) {  // 使用 let 更简洁
    println(name)
}
```

### 4.2 字符串模板

```kotlin
// ✅ 好
val message = "Hello, $name!"
val info = "Count: ${items.size}"

// ❌ 不好
val message = "Hello, " + name + "!"
val info = "Count: " + items.size
```

### 4.3 when 表达式

```kotlin
// ✅ 好
when (value) {
    0 -> "zero"
    1 -> "one"
    else -> "many"
}

// ❌ 不好
if (value == 0) {
    "zero"
} else if (value == 1) {
    "one"
} else {
    "many"
}
```

### 4.4 扩展函数

```kotlin
// ✅ 好
fun String.isEmail(): Boolean {
    return this.contains("@")
}

// 使用
val valid = email.isEmail()

// ❌ 不好
fun isEmail(email: String): Boolean {
    return email.contains("@")
}
```

### 4.5 作用域函数

**let - 非空检查和转换：**
```kotlin
name?.let { nonNullName ->
    println(nonNullName)
}
```

**apply - 对象配置：**
```kotlin
val person = Person().apply {
    name = "John"
    age = 30
}
```

**also - 副作用操作：**
```kotlin
val numbers = mutableListOf(1, 2, 3)
    .also { println("Before: $it") }
    .apply { add(4) }
    .also { println("After: $it") }
```

**run - 执行代码块：**
```kotlin
val result = run {
    val x = 10
    val y = 20
    x + y
}
```

**with - 上下文操作：**
```kotlin
with(person) {
    println(name)
    println(age)
}
```

---

## 5. Compose 特定规范

### 5.1 Composable 命名

- 使用 PascalCase
- 名词或名词短语

```kotlin
// ✅ 好
@Composable
fun MyScreen() { }

@Composable
fun UserCard(user: User) { }

// ❌ 不好
@Composable
fun myScreen() { }

@Composable
fun showUser(user: User) { }
```

### 5.2 Modifier 参数

- 总是第一个参数
- 使用默认值 `Modifier`

```kotlin
// ✅ 好
@Composable
fun MyComponent(
    modifier: Modifier = Modifier,
    title: String
) { }

// ❌ 不好
@Composable
fun MyComponent(
    title: String,
    modifier: Modifier
) { }
```

### 5.3 记住状态

```kotlin
// ✅ 好
@Composable
fun Counter() {
    var count by remember { mutableStateOf(0) }

    Button(onClick = { count++ }) {
        Text("Count: $count")
    }
}

// ❌ 不好
@Composable
fun Counter() {
    var count = 0  // 不会触发重组

    Button(onClick = { count++ }) {
        Text("Count: $count")
    }
}
```

---

## 6. 文档注释

### 6.1 KDoc 格式

```kotlin
/**
 * 用户仓库，负责用户数据的获取和管理
 *
 * 实现了 Single Source of Truth 模式，优先使用本地缓存
 *
 * @property database 本地数据库
 * @property api 远程 API
 */
class UserRepository(
    private val database: UserDao,
    private val api: UserApi
) {

    /**
     * 根据 ID 获取用户
     *
     * 优先从本地数据库获取，然后后台同步远程数据
     *
     * @param id 用户 ID
     * @return Flow<Result<User>> 用户数据流
     */
    fun getUser(id: String): Flow<Result<User>> {
        // 实现
    }
}
```

### 6.2 文档注释规则

**需要文档注释：**
- ✅ 公共 API
- ✅ 复杂逻辑
- ✅ 公共类和接口

**不需要文档注释：**
- ❌ 私有函数（除非复杂）
- ❌ 简单的 getter/setter
- ❌ 一目了然的代码

---

## 7. 代码检查

### 7.1 运行 Detekt

```bash
# 检查代码
./gradlew detekt

# 自动修复（部分规则）
./gradlew detektFormat
```

### 7.2 常见问题

**问题 1：行过长**
```kotlin
// ❌ 不好
fun veryLongFunctionNameWithManyParameters(parameter1: String, parameter2: Int, parameter3: Boolean, parameter4: Double): String {

// ✅ 好
fun veryLongFunctionNameWithManyParameters(
    parameter1: String,
    parameter2: Int,
    parameter3: Boolean,
    parameter4: Double
): String {
```

**问题 2：过多的函数参数**
```kotlin
// ❌ 不好（超过 6 个参数）
fun createUser(name: String, age: Int, email: String, phone: String, address: String, city: String, country: String)

// ✅ 好（使用数据类）
data class UserInfo(
    val name: String,
    val age: Int,
    val email: String,
    val phone: String,
    val address: String,
    val city: String,
    val country: String
)

fun createUser(userInfo: UserInfo)
```

**问题 3：复杂方法**
```kotlin
// ❌ 不好（复杂度过高）
fun processData(data: List<String>): List<Int> {
    val result = mutableListOf<Int>()
    for (item in data) {
        if (item.isNotEmpty()) {
            if (item.startsWith("A")) {
                result.add(item.length * 2)
            } else if (item.startsWith("B")) {
                result.add(item.length * 3)
            } else {
                result.add(item.length)
            }
        }
    }
    return result
}

// ✅ 好（拆分为小函数）
fun processData(data: List<String>): List<Int> {
    return data
        .filter { it.isNotEmpty() }
        .map { calculateValue(it) }
}

private fun calculateValue(item: String): Int {
    return when {
        item.startsWith("A") -> item.length * 2
        item.startsWith("B") -> item.length * 3
        else -> item.length
    }
}
```

---

## 8. 提交前检查清单

在提交代码前，请确保：

- [ ] 代码通过 Detekt 检查
- [ ] 所有测试通过
- [ ] 公共 API 有文档注释
- [ ] 没有使用 `!!`（除非确实需要）
- [ ] 没有 TODO 注释（或已记录在任务列表）
- [ ] 遵循命名规范
- [ ] 代码格式正确

---

## 9. 工具配置

### 9.1 Android Studio 设置

1. **Settings > Editor > Code Style > Kotlin**
   - Set from: Kotlin style guide
   - Line length: 120

2. **Settings > Editor > Inspections > Kotlin**
   - 启用所有推荐检查

3. **Settings > Plugins**
   - 安装 Detekt 插件

### 9.2 快捷键

- `Ctrl + Alt + L` - 格式化代码
- `Ctrl + Alt + O` - 优化导入
- `Ctrl + Shift + F` - 查找（全项目）

---

## 10. 参考资料

- [Kotlin Coding Conventions](https://kotlinlang.org/docs/coding-conventions.html)
- [Android Kotlin Style Guide](https://developer.android.com/kotlin/style-guide)
- [Detekt Documentation](https://detekt.dev/)

---

**维护者：** Android 团队
**最后更新：** 2026-01-23
