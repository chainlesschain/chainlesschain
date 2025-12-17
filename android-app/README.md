# ChainlessChain Android 原生版

使用Java开发的Android原生应用 - 个人AI知识库系统

## 🎯 项目概述

ChainlessChain Android是一个功能完整的知识库管理应用，支持：

- 📝 **知识库管理** - 创建、编辑、查看Markdown笔记
- 🔒 **SIMKey认证** - 基于SIM卡的安全认证
- 🤖 **AI对话** - 集成Ollama AI助手
- 🔄 **数据同步** - 跨设备数据同步
- 🔐 **加密存储** - SQLCipher数据库加密

## 📊 当前状态

### ✅ 已完成

| 模块 | 状态 | 文件数 |
|------|------|--------|
| 项目配置 | ✅ 完成 | 3 |
| 数据模型 | ✅ 完成 | 2 |
| 数据库层 (Room + SQLCipher) | ✅ 完成 | 5 |
| 服务层 | ✅ 完成 | 3 |
| 工具类 | ✅ 完成 | 3 |
| 核心Activity | ✅ 完成 | 3 |
| Fragment框架 | ✅ 完成 | 1 |

**总计**: 20+ 核心Java类文件

### 🔨 待完成

1. ViewModel类 (MVVM架构)
2. RecyclerView Adapter
3. 其他Fragment (Chat, Settings)
4. 知识库编辑和查看Activity
5. 布局XML文件
6. 资源文件 (strings, colors, themes)

## 🏗️ 项目架构

```
android-app/
├── app/
│   ├── build.gradle                # 应用级配置
│   └── src/main/
│       ├── AndroidManifest.xml     # 清单文件
│       ├── java/com/chainlesschain/
│       │   ├── ChainlessChainApp.java          # 应用类
│       │   ├── model/                          # 数据模型
│       │   │   ├── KnowledgeItem.java         # 知识库实体
│       │   │   └── ChatMessage.java           # 聊天消息实体
│       │   ├── database/                       # 数据库
│       │   │   ├── AppDatabase.java           # 数据库主类
│       │   │   ├── KnowledgeDao.java          # 知识库DAO
│       │   │   ├── ChatDao.java               # 聊天DAO
│       │   │   └── Converters.java            # 类型转换器
│       │   ├── service/                        # 服务层
│       │   │   ├── SIMKeyService.java         # SIMKey服务
│       │   │   ├── LLMService.java            # AI服务
│       │   │   └── SyncService.java           # 同步服务
│       │   ├── ui/                             # 界面
│       │   │   ├── SplashActivity.java        # 启动页
│       │   │   ├── LoginActivity.java         # 登录页
│       │   │   ├── MainActivity.java          # 主页
│       │   │   └── fragment/
│       │   │       └── KnowledgeFragment.java # 知识库列表
│       │   ├── util/                           # 工具类
│       │   │   ├── UIUtils.java
│       │   │   └── DateUtils.java
│       │   └── viewmodel/                      # ViewModel (待实现)
│       └── res/                                # 资源文件 (待创建)
│           ├── layout/                         # 布局
│           ├── values/                         # 值资源
│           ├── drawable/                       # 图片资源
│           └── menu/                           # 菜单
└── build.gradle                    # 项目级配置
```

## 🚀 技术栈

### 核心框架
- **语言**: Java 11
- **最低SDK**: Android 7.0 (API 24)
- **目标SDK**: Android 14 (API 34)

### 主要依赖

```gradle
// AndroidX
androidx.appcompat:appcompat:1.6.1
androidx.core:core-ktx:1.12.0
com.google.android.material:material:1.11.0

// Architecture Components
androidx.lifecycle:lifecycle-*:2.7.0
androidx.navigation:navigation-*:2.7.6

// Database
androidx.room:room-runtime:2.6.1
net.zetetic:android-database-sqlcipher:4.5.4

// Networking
com.squareup.retrofit2:retrofit:2.9.0
com.squareup.okhttp3:okhttp:4.12.0

// Markdown
io.noties.markwon:core:4.6.2

// Others
com.google.code.gson:gson:2.10.1
com.github.bumptech.glide:glide:4.16.0
```

## 📝 核心功能实现

### 1. SIMKey 安全认证

```java
// 使用方式
SIMKeyService simKeyService = SIMKeyService.getInstance(context);

// 检测SIMKey
SIMKeyService.SIMKeyStatus status = simKeyService.detectSIMKey();

// 验证PIN码
boolean verified = simKeyService.verifyPIN("123456");

// 加密数据
String encrypted = simKeyService.encrypt("sensitive data");

// 签名数据
String signature = simKeyService.signData("data to sign");
```

**注意**: 当前为模拟实现，需要替换为实际SDK调用。所有TODO标记的地方需要集成真实的SIMKey SDK。

### 2. 加密数据库

```java
// 数据库自动加密
AppDatabase db = AppDatabase.getInstance(context, password);

// CRUD操作
KnowledgeDao dao = db.knowledgeDao();
dao.insert(item);
dao.getAllItems().observe(lifecycleOwner, items -> {
    // 处理数据
});
```

### 3. AI 对话服务

```java
// 配置服务
LLMService llmService = LLMService.getInstance();
llmService.setServerUrl("http://your-server:11434");
llmService.setModel("qwen2:7b");

// 发送查询
String response = llmService.query(
    "你好，AI助手",
    null,  // 可选上下文
    chatHistory  // 聊天历史
);
```

### 4. 数据同步

```java
// 配置同步
SyncService syncService = SyncService.getInstance(context);
syncService.setSyncEnabled(true);
syncService.setServerUrl("http://your-sync-server");
syncService.setAutoSync(true);

// 执行同步
SyncService.SyncResult result = syncService.sync(knowledgeItems);
```

## 🔧 开发指南

### 环境要求

- Android Studio Hedgehog (2023.1.1) 或更高
- JDK 11 或更高
- Android SDK Platform 34
- Android Build Tools 34.0.0

### 构建步骤

1. **克隆项目**
   ```bash
   cd android-app
   ```

2. **打开项目**
   - 使用Android Studio打开`android-app`目录
   - 等待Gradle同步完成

3. **运行应用**
   - 连接Android设备或启动模拟器
   - 点击Run按钮或使用快捷键 Shift+F10

### 完成剩余开发

#### 1. 创建ViewModel类

创建 `viewmodel/KnowledgeViewModel.java`:

```java
public class KnowledgeViewModel extends AndroidViewModel {
    private KnowledgeDao knowledgeDao;
    private LiveData<List<KnowledgeItem>> items;

    public KnowledgeViewModel(Application app) {
        super(app);
        AppDatabase db = AppDatabase.getInstance(
            app,
            ChainlessChainApp.getInstance().getDbPassword()
        );
        knowledgeDao = db.knowledgeDao();
        items = knowledgeDao.getAllItems();
    }

    public LiveData<List<KnowledgeItem>> getItems() {
        return items;
    }

    // 其他方法...
}
```

#### 2. 创建RecyclerView Adapter

创建 `ui/adapter/KnowledgeAdapter.java`:

```java
public class KnowledgeAdapter extends RecyclerView.Adapter<KnowledgeAdapter.ViewHolder> {
    private List<KnowledgeItem> items = new ArrayList<>();
    private OnItemClickListener listener;

    @Override
    public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_knowledge, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(ViewHolder holder, int position) {
        KnowledgeItem item = items.get(position);
        holder.bind(item);
    }

    // 其他方法...
}
```

#### 3. 创建布局文件

在 `res/layout/` 目录创建以下XML文件：

- `activity_splash.xml` - 启动页布局
- `activity_login.xml` - 登录页布局
- `activity_main.xml` - 主页布局
- `fragment_knowledge.xml` - 知识库Fragment布局
- `fragment_chat.xml` - 聊天Fragment布局
- `fragment_settings.xml` - 设置Fragment布局
- `item_knowledge.xml` - 知识库列表项布局
- `item_chat_message.xml` - 聊天消息列表项布局

#### 4. 创建菜单资源

创建 `res/menu/bottom_navigation.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<menu xmlns:android="http://schemas.android.com/apk/res/android">
    <item
        android:id="@+id/nav_knowledge"
        android:icon="@drawable/ic_knowledge"
        android:title="@string/knowledge" />
    <item
        android:id="@+id/nav_chat"
        android:icon="@drawable/ic_chat"
        android:title="@string/chat" />
    <item
        android:id="@+id/nav_settings"
        android:icon="@drawable/ic_settings"
        android:title="@string/settings" />
</menu>
```

#### 5. 创建字符串资源

创建 `res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">ChainlessChain</string>
    <string name="knowledge">知识库</string>
    <string name="chat">AI助手</string>
    <string name="settings">设置</string>
    <!-- 其他字符串... -->
</resources>
```

## 🔒 SIMKey SDK集成

### 步骤1: 添加SDK库

将SIMKey SDK的AAR文件放到 `app/libs/` 目录，然后在 `app/build.gradle` 中添加：

```gradle
dependencies {
    implementation files('libs/simkey-sdk.aar')
}
```

### 步骤2: 添加权限

已在 `AndroidManifest.xml` 中添加必要权限：

```xml
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
```

### 步骤3: 替换模拟实现

在 `SIMKeyService.java` 中，将所有TODO标记的代码替换为实际SDK调用：

```java
// 原代码（模拟）
public SIMKeyStatus detectSIMKey() {
    // TODO: 替换为实际的SIMKey SDK调用
    // Example: SIMKeySDK.detect()

    // 模拟实现...
}

// 修改为（实际SDK）
public SIMKeyStatus detectSIMKey() {
    SIMKeySDK.Result result = SIMKeySDK.detect();

    SIMKeyStatus status = new SIMKeyStatus();
    status.connected = result.isConnected();
    status.serialNumber = result.getSerialNumber();
    // ...

    return status;
}
```

## 📱 应用截图（示例）

```
┌─────────────────────┐
│  ChainlessChain     │  启动页
│                     │
│        🔗           │
│                     │
└─────────────────────┘

┌─────────────────────┐
│  登录                │  登录页
│                     │
│  🔒 SIMKey已连接   │
│                     │
│  PIN码: [______]   │
│                     │
│     [登录]          │
└─────────────────────┘

┌─────────────────────┐
│  知识库  💬  ⚙️    │  主页
│                     │
│  [搜索......]      │
│                     │
│  📝 我的笔记       │
│  📄 项目文档       │
│  🔗 重要链接       │
│                     │
│         [+]         │
└─────────────────────┘
```

## 🧪 测试

### 单元测试

```bash
./gradlew test
```

### UI测试

```bash
./gradlew connectedAndroidTest
```

### 测试登录

开发模式下，可以使用任意4-6位数字作为PIN码登录。

## 📦 打包发布

### Debug版本

```bash
./gradlew assembleDebug
```

输出: `app/build/outputs/apk/debug/app-debug.apk`

### Release版本

1. 创建签名密钥：
   ```bash
   keytool -genkey -v -keystore chainlesschain.keystore \
     -alias chainlesschain -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 配置 `gradle.properties`:
   ```properties
   KEYSTORE_FILE=chainlesschain.keystore
   KEYSTORE_PASSWORD=your_password
   KEY_ALIAS=chainlesschain
   KEY_PASSWORD=your_password
   ```

3. 构建Release版本：
   ```bash
   ./gradlew assembleRelease
   ```

输出: `app/build/outputs/apk/release/app-release.apk`

## 🐛 常见问题

### 1. SQLCipher初始化失败

**问题**: 数据库无法打开或崩溃

**解决**: 确保已正确加载SQLCipher库：
```java
System.loadLibrary("sqlcipher");
```

### 2. 网络请求失败

**问题**: 无法连接到AI服务器

**解决**:
- 检查 `AndroidManifest.xml` 中的 `usesCleartextTraffic`
- 使用 `10.0.2.2` 访问开发机器的 localhost
- 检查防火墙设置

### 3. Room数据库迁移

**问题**: 数据库版本升级后数据丢失

**解决**: 使用 `.fallbackToDestructiveMigration()` (开发阶段) 或实现Migration策略（生产环境）

## 🔜 下一步计划

### 短期
- [ ] 完成所有Fragment实现
- [ ] 完成所有布局XML文件
- [ ] 实现Markdown编辑和渲染
- [ ] 添加图片选择功能
- [ ] 完善错误处理

### 中期
- [ ] 集成真实SIMKey SDK
- [ ] 实现后台同步服务
- [ ] 添加通知功能
- [ ] 实现导入/导出功能
- [ ] 添加主题切换

### 长期
- [ ] 离线AI模型
- [ ] 语音输入功能
- [ ] OCR图片识别
- [ ] 协作编辑
- [ ] Widget小部件

## 📚 参考资源

- [Android开发文档](https://developer.android.com/)
- [Room数据库指南](https://developer.android.com/training/data-storage/room)
- [Material Design](https://material.io/develop/android)
- [SQLCipher for Android](https://github.com/sqlcipher/android-database-sqlcipher)
- [Retrofit](https://square.github.io/retrofit/)
- [Markwon](https://github.com/noties/Markwon)

## 💡 贡献指南

欢迎提交Issue和Pull Request！

### 代码规范

- 遵循Android代码风格指南
- 使用有意义的变量和方法名
- 添加必要的注释
- 保持代码简洁和可读性

### 提交规范

```
feat: 添加新功能
fix: 修复bug
docs: 更新文档
style: 代码格式调整
refactor: 重构代码
test: 添加测试
chore: 构建/工具链调整
```

## 📄 许可证

MIT License

## 👥 联系方式

- 项目主页: https://www.chainlesschain.com
- 问题反馈: https://github.com/yourname/chainlesschain/issues

---

**当前版本**: v0.1.0 (核心架构完成)

**开发状态**: 🔨 活跃开发中

**最后更新**: 2025-12-01
