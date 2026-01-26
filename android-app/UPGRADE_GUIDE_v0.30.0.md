# 📦 ChainlessChain Android 升级指南 v0.26.2 → v0.30.0

**目标版本**: v0.30.0
**源版本**: v0.26.2
**升级类型**: 主要功能更新

---

## 🎯 升级概述

本次升级从 v0.26.2 (92%完成度) 提升到 v0.30.0 (100%完成度)，包含：

- ✅ 4个全新UI屏幕
- ✅ 5个重要功能增强
- ✅ 数据库升级 (v14 → v15)
- ✅ 20个新增E2E测试

**升级难度**: ⭐⭐⭐ (中等)
**预计时间**: 10-15分钟
**数据丢失风险**: 低（推荐备份）

---

## ⚠️ 重要提示

### 不可降级

升级到 v0.30.0 后 **无法降级** 到旧版本，原因：
- 数据库结构已变更 (v14 → v15)
- 新增实体和字段
- 数据迁移不可逆

### 推荐操作顺序

```
1. 备份数据 ← 重要！
2. 下载新版本
3. 卸载旧版本 (可选)
4. 安装新版本
5. 验证数据迁移
6. 测试新功能
```

---

## 📋 升级前检查清单

### 环境检查

- [ ] Android版本 ≥ 8.0 (API 26)
- [ ] 可用存储 ≥ 200MB
- [ ] 可用RAM ≥ 4GB
- [ ] 网络连接正常（用于下载APK）

### 数据检查

- [ ] 好友列表数量: ______ 人
- [ ] 动态数量: ______ 条
- [ ] 评论数量: ______ 条
- [ ] 知识库条目: ______ 条

**记录这些数据，升级后验证是否完整！**

---

## 🔐 步骤 1: 备份数据

### 方式 1: ADB备份（推荐）

```bash
# 连接设备
adb devices

# 完整备份
adb backup -f chainlesschain_v0.26.2_backup.ab \
  -apk \
  -shared \
  -all \
  com.chainlesschain.android

# 等待设备上确认备份
# 备份文件保存为: chainlesschain_v0.26.2_backup.ab
```

**备份内容**:
- ✅ 应用数据 (数据库、配置)
- ✅ APK文件
- ✅ 共享数据
- ✅ 缓存

**备份大小**: 通常 50-200MB

---

### 方式 2: 导出重要数据

**导出知识库**:
```
应用内 → 知识库 → 设置 → 导出全部
→ 保存到: /sdcard/Download/knowledge_export_[日期].json
```

**导出聊天记录**:
```
应用内 → 会话列表 → 设置 → 导出记录
→ 保存到: /sdcard/Download/chat_export_[日期].json
```

**导出动态**:
```
应用内 → 社交 → 动态 → 设置 → 导出动态
→ 保存到: /sdcard/Download/posts_export_[日期].json
```

**拉取到电脑**:
```bash
adb pull /sdcard/Download/knowledge_export_*.json ./backup/
adb pull /sdcard/Download/chat_export_*.json ./backup/
adb pull /sdcard/Download/posts_export_*.json ./backup/
```

---

## 📥 步骤 2: 下载新版本

### 方式 1: GitHub Releases

```bash
# 访问Release页面
https://github.com/yourusername/chainlesschain/releases/tag/v0.30.0

# 下载APK
wget https://github.com/yourusername/chainlesschain/releases/download/v0.30.0/chainlesschain-v0.30.0.apk

# 或使用curl
curl -LO https://github.com/yourusername/chainlesschain/releases/download/v0.30.0/chainlesschain-v0.30.0.apk
```

### 方式 2: 从源码构建

```bash
# 克隆仓库
git clone https://github.com/yourusername/chainlesschain.git
cd chainlesschain/android-app

# 切换到v0.30.0标签
git checkout v0.30.0

# 构建Release APK
./gradlew assembleRelease

# APK位置
ls -lh app/build/outputs/apk/release/app-release.apk
```

### 验证下载

```bash
# 校验SHA256
sha256sum chainlesschain-v0.30.0.apk

# 应该输出
# [生成后填写] chainlesschain-v0.30.0.apk
```

---

## 🗑️ 步骤 3: 卸载旧版本（可选）

### 保留数据卸载

```bash
# 方式1: ADB卸载（保留数据）
adb uninstall -k com.chainlesschain.android

# 方式2: 手动卸载（设置中取消勾选"清除数据"）
```

### 完全卸载（不推荐）

```bash
# 警告: 会删除所有数据！
adb uninstall com.chainlesschain.android
```

**建议**: 直接覆盖安装，无需卸载

---

## 📲 步骤 4: 安装新版本

### 方式 1: ADB安装

```bash
# 覆盖安装（保留数据）
adb install -r chainlesschain-v0.30.0.apk

# 或使用
adb install -r -d chainlesschain-v0.30.0.apk
```

### 方式 2: 手动安装

```bash
# 1. 将APK传输到设备
adb push chainlesschain-v0.30.0.apk /sdcard/Download/

# 2. 在设备上打开文件管理器
# 3. 导航到 /sdcard/Download/
# 4. 点击 chainlesschain-v0.30.0.apk
# 5. 允许"未知来源"安装
# 6. 点击"安装"
```

### 安装选项

- ✅ **保留数据**: 勾选
- ✅ **允许降级**: 不勾选（无法降级）
- ✅ **授予权限**: 根据提示授权

---

## 🔄 步骤 5: 数据库自动迁移

### 迁移过程

启动应用后，会自动执行数据库迁移：

```
v14 (旧版本)
  ↓
[迁移脚本执行]
  • 创建PostReportEntity表
  • 创建BlockedUserEntity表
  • 更新索引
  • 验证数据完整性
  ↓
v15 (新版本) ✅
```

### 迁移时间

- **小数据量** (<1000条): 2-3秒
- **中数据量** (1000-10000条): 5-10秒
- **大数据量** (>10000条): 10-30秒

### 迁移日志

查看迁移日志：
```bash
adb logcat | grep "DatabaseMigration"
```

成功输出示例：
```
I/DatabaseMigration: Starting migration from 14 to 15
I/DatabaseMigration: Creating PostReportEntity table
I/DatabaseMigration: Creating BlockedUserEntity table
I/DatabaseMigration: Migration completed successfully
I/DatabaseMigration: Data integrity verified
```

---

## ✅ 步骤 6: 验证升级

### 6.1 版本验证

```
应用内 → 设置 → 关于
→ 查看版本号: v0.30.0
```

### 6.2 数据完整性验证

**好友列表**:
```
社交 → 好友 → 检查数量
升级前: ______ 人
升级后: ______ 人 ← 应该相等
```

**动态数量**:
```
社交 → 动态 → 检查数量
升级前: ______ 条
升级后: ______ 条 ← 应该相等
```

**知识库条目**:
```
知识库 → 列表 → 检查数量
升级前: ______ 条
升级后: ______ 条 ← 应该相等
```

### 6.3 功能验证

使用 [功能验证清单](./FEATURE_VERIFICATION_CHECKLIST.md) 验证核心功能：

- [ ] 添加好友功能正常
- [ ] 发布动态功能正常
- [ ] 图片上传功能正常
- [ ] 链接预览功能正常
- [ ] 分享功能正常
- [ ] 举报功能正常
- [ ] 屏蔽功能正常
- [ ] 备注名编辑功能正常

---

## 🆕 步骤 7: 体验新功能

### 7.1 添加好友

```
社交 → 好友 → 点击右上角 ➕
→ 尝试DID搜索
→ 查看附近的人
→ 查看推荐好友
```

### 7.2 好友详情

```
社交 → 好友 → 点击任意好友
→ 查看完整资料
→ 查看在线状态
→ 尝试快捷操作
→ 查看动态时间线
```

### 7.3 用户资料

```
社交 → 动态 → 点击作者头像
→ 查看用户资料
→ 验证关系状态识别
→ 尝试TabRow切换
```

### 7.4 评论详情

```
社交 → 动态 → 点击评论
→ 查看评论详情
→ 尝试发表回复
→ 尝试点赞评论
```

### 7.5 配图上传

```
社交 → 动态 → 点击发布按钮
→ 点击"图片"按钮
→ 选择1-9张图片
→ 查看预览网格
→ 尝试删除图片
→ 发布动态
```

### 7.6 链接预览

```
社交 → 动态 → 点击发布按钮
→ 输入包含链接的文本
→ 等待预览卡片加载
→ 查看预览效果
→ 尝试移除预览
```

### 7.7 分享动态

```
社交 → 动态 → 点击分享图标
→ 选择分享方式
→ 验证分享内容格式
```

### 7.8 举报/屏蔽

```
社交 → 动态 → 点击右上角 ⋮
→ 选择"举报"
→ 选择举报原因
→ 提交举报

→ 再次点击 ⋮
→ 选择"屏蔽该用户"
→ 确认屏蔽
→ 验证内容自动过滤
```

### 7.9 备注名编辑

```
社交 → 好友 → 长按好友卡片
→ 选择"设置备注"
→ 输入备注名
→ 保存
→ 验证备注名优先显示
→ 验证搜索支持备注名
```

---

## 🐛 故障排查

### 问题 1: 安装失败

**症状**: `Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]`

**原因**: 签名不匹配

**解决方案**:
```bash
# 1. 卸载旧版本
adb uninstall com.chainlesschain.android

# 2. 重新安装新版本
adb install chainlesschain-v0.30.0.apk
```

**注意**: 这会删除所有数据，确保已备份！

---

### 问题 2: 数据库迁移失败

**症状**: 应用崩溃或无限加载

**原因**: 数据库迁移异常

**解决方案**:
```bash
# 1. 查看崩溃日志
adb logcat | grep -i "crash\|exception\|error"

# 2. 如果是迁移错误，恢复备份
adb restore chainlesschain_v0.26.2_backup.ab

# 3. 重新尝试升级
```

---

### 问题 3: 好友/动态丢失

**症状**: 升级后好友列表或动态列表为空

**原因**: 数据未正确迁移

**解决方案**:
```bash
# 1. 恢复备份
adb restore chainlesschain_v0.26.2_backup.ab

# 2. 导入之前导出的数据
应用内 → 设置 → 数据导入
→ 选择备份文件
→ 确认导入
```

---

### 问题 4: 新功能不可用

**症状**: 看不到新增的UI屏幕或功能

**原因**: 缓存未清理或导航未更新

**解决方案**:
```bash
# 1. 清理应用缓存
adb shell pm clear com.chainlesschain.android

# 2. 重新登录

# 3. 如果问题仍存在，重新安装
adb uninstall com.chainlesschain.android
adb install chainlesschain-v0.30.0.apk
```

---

### 问题 5: 图片上传失败

**症状**: 图片选择后无法上传

**原因**: 后端API未配置或网络问题

**解决方案**:
```
1. 检查网络连接
2. 检查图片大小 (< 5MB)
3. 检查图片格式 (JPG, PNG, WebP)
4. 联系管理员配置后端API
```

---

### 问题 6: 链接预览加载失败

**症状**: 输入URL后预览卡片不显示

**原因**: 网络问题或网站不支持Open Graph

**解决方案**:
```
1. 检查网络连接
2. 等待5秒（超时时间）
3. 尝试其他网站（如 https://kotlinlang.org）
4. 如果持续失败，跳过链接预览直接发布
```

---

## 🔄 回滚指南

### 注意

升级到 v0.30.0 后 **无法直接降级**，但可以通过以下方式回滚：

### 方式 1: 恢复备份

```bash
# 1. 卸载v0.30.0
adb uninstall com.chainlesschain.android

# 2. 恢复v0.26.2备份
adb restore chainlesschain_v0.26.2_backup.ab

# 3. 验证数据
```

**限制**: 升级后的新数据（新好友、新动态等）会丢失

---

### 方式 2: 数据导出+重装

```bash
# 1. 在v0.30.0中导出数据
应用内 → 设置 → 数据导出

# 2. 卸载v0.30.0
adb uninstall com.chainlesschain.android

# 3. 安装v0.26.2
adb install chainlesschain-v0.26.2.apk

# 4. 导入数据（部分兼容）
应用内 → 设置 → 数据导入
```

**限制**: v0.30.0的新数据类型（举报、屏蔽等）无法导入v0.26.2

---

## 📞 获取帮助

### 升级问题支持

如遇到升级问题，请提供以下信息：

1. **设备信息**:
   - 型号: ___________
   - Android版本: ___________
   - RAM: ___________

2. **版本信息**:
   - 源版本: v0.26.2
   - 目标版本: v0.30.0

3. **问题描述**:
   - 具体症状
   - 复现步骤
   - 错误信息

4. **日志**:
   ```bash
   adb logcat > logcat.txt
   # 附上 logcat.txt
   ```

### 联系方式

- **GitHub Issues**: https://github.com/yourusername/chainlesschain/issues
- **Email**: support@chainlesschain.com
- **Discord**: https://discord.gg/chainlesschain

---

## 📚 相关文档

- [发布说明](./RELEASE_NOTES_v0.30.0.md) - 新功能详解
- [快速开始](./QUICK_START_v0.30.0.md) - 上手指南
- [功能验证清单](./FEATURE_VERIFICATION_CHECKLIST.md) - 验证功能
- [故障排查](./E2E_TESTING_GUIDE.md#故障排查) - 常见问题

---

## ✅ 升级检查清单

### 升级前

- [ ] 记录数据数量（好友、动态、知识库）
- [ ] 执行ADB备份
- [ ] 导出重要数据（可选）
- [ ] 下载新版本APK
- [ ] 验证APK校验和

### 升级中

- [ ] 安装新版本（覆盖或卸载后安装）
- [ ] 等待首次启动完成
- [ ] 观察数据库迁移进度

### 升级后

- [ ] 验证版本号 (v0.30.0)
- [ ] 检查数据完整性（好友、动态、知识库）
- [ ] 测试核心功能（添加好友、发布动态等）
- [ ] 体验新功能（配图、链接预览等）
- [ ] 清理备份文件（确认一切正常后）

---

## 🎉 升级完成！

恭喜你成功升级到 ChainlessChain Android v0.30.0！

现在你可以享受：
- ✅ 更完整的UI体验
- ✅ 更强大的功能
- ✅ 更安全的社区环境
- ✅ 更个性化的好友管理

**开始探索新功能吧！** 🚀

---

**ChainlessChain 团队**
2026-01-26
