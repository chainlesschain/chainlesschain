# ChainlessChain移动端 Android打包指南

## 项目状态

项目已修复以下问题：
- ✅ 修复了交易模块中的数据库导入路径错误（5个文件）
- ✅ 修复了logo.png资源路径问题（2个文件）
- ✅ 添加了`getDatabase()`和`getDIDManager()`兼容性函数
- ✅ 将logo.png复制到`src/static/`目录

**当前问题**: 由于项目中使用了动态导入(import())进行代码分割，与uni-app的IIFE输出格式不兼容，导致CLI构建失败。

## 打包方案

### 方案一：使用HBuilderX可视化打包（推荐）

#### 步骤：

1. **下载并安装HBuilderX**
   - 官网：https://www.dcloud.io/hbuilderx.html
   - 下载"App开发版"
   - 安装后打开HBuilderX

2. **导入项目**
   - 点击菜单：文件 -> 导入 -> 从本地目录导入
   - 选择路径：`D:\code\chainlesschain\mobile-app-uniapp`
   - 点击"确定"

3. **配置manifest.json**
   - 在项目中打开`src/manifest.json`
   - 点击"源码视图"或"可视化配置"
   - 检查以下配置：
     - App名称：ChainlessChain
     - AppID：__UNI__4F3B0DC
     - 版本号：0.1.0
     - 版本名称：0.1.0

4. **配置Android打包证书（首次需要）**
   - 点击"manifest.json"可视化配置界面
   - 切换到"App常用其他配置"
   - 在"Android设置"中配置证书
   - 如果没有证书，可以使用HBuilderX自带的云打包（DCloud会自动生成测试证书）

5. **开始打包**

   **方法A: 云打包（简单）**
   - 右键项目根目录
   - 选择：发行 -> 原生App-云打包
   - 选择"Android"
   - 勾选"使用DCloud老版证书"（测试用）或"使用自有证书"
   - 点击"打包"
   - 等待云端打包完成（5-15分钟）
   - 下载生成的APK文件

   **方法B: 本地打包（需要Android SDK）**
   - 右键项目根目录
   - 选择：发行 -> 原生App-本地打包 -> 生成本地打包App资源
   - 生成后会在`unpackage/resources/`目录下生成资源文件
   - 使用Android Studio导入`platforms/android`项目
   - 构建APK

6. **安装测试**
   - 将生成的APK文件传输到Android设备
   - 安装并测试应用

---

### 方案二：使用DCloud开发者中心云打包

#### 步骤：

1. **注册DCloud开发者账号**
   - 访问：https://dev.dcloud.net.cn/
   - 注册并登录

2. **上传项目**
   - 在开发者中心创建应用
   - 上传项目代码到DCloud
   - 或使用HBuilderX关联账号后直接云打包

3. **配置并打包**
   - 在开发者中心配置App信息
   - 选择Android平台
   - 点击云打包
   - 下载生成的APK

---

### 方案三：修复CLI构建问题（高级）

如果必须使用CLI方式，需要解决动态导入问题：

#### 选项A：移除动态导入

编辑以下文件，将动态导入改为静态导入：

**文件1**: `src/services/database.js`
```javascript
// 在文件顶部添加静态导入
import knowledgeRAG from '@/services/knowledge-rag'

// 然后在代码中替换：
// 将：
import('@/services/knowledge-rag').then(module => {
  const knowledgeRAG = module.default
  // ...
})

// 改为直接使用：
knowledgeRAG.method()
```

**文件2**: `src/services/ai-conversation.js`
```javascript
// 在文件顶部添加
import aiBackend from './ai-backend'

// 替换所有 import('./ai-backend') 调用
```

**注意**: 这可能会导致循环依赖问题，需要重构代码结构。

#### 选项B：使用es格式（实验性）

修改构建配置以使用ES模块格式而非IIFE（可能不适用于uni-app）。

---

## 推荐方案

**强烈推荐使用方案一的"云打包"方式**：
- ✅ 无需配置复杂的Android SDK
- ✅ DCloud自动处理依赖和兼容性
- ✅ 生成的APK可直接安装测试
- ✅ 支持正式签名和测试签名
- ⏱️ 仅需5-15分钟即可完成

## 注意事项

1. **首次打包**: 推荐使用测试证书，正式发布前再配置自有证书
2. **应用权限**: manifest.json中已配置INTERNET权限，根据需要添加其他权限
3. **图标配置**: 项目已配置图标路径，但需要确保`unpackage/res/icons/`目录下有对应尺寸的图标
4. **应用体积**: 由于包含了众多依赖，首次打包APK可能较大（预计20-40MB）

## 常见问题

### Q: 云打包失败怎么办？
A: 检查manifest.json配置是否正确，确保AppID唯一，查看HBuilderX控制台的错误信息。

### Q: 安装APK时提示"未知来源"？
A: 这是正常的，在Android设置中允许安装未知来源应用即可。

### Q: 应用闪退怎么办？
A: 连接Android设备，使用`adb logcat`查看日志，或在HBuilderX中使用"真机运行"调试。

### Q: 需要配置哪些SDK？
A: 使用云打包无需本地SDK。使用本地打包需要Android SDK、Gradle等。

---

## 联系方式

如有问题，请查看：
- uni-app官方文档: https://uniapp.dcloud.net.cn/
- HBuilderX使用文档: https://hx.dcloud.net.cn/
