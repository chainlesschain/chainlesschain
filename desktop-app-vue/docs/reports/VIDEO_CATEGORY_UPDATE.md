# 视频分类更新说明

## 问题描述

如果您在模板管理和项目页面看不到"视频"分类，这是因为您的数据库是在添加视频分类之前创建的。

## 解决方案

### 方案1：删除旧数据库（推荐，适用于测试环境）

如果您的数据库中没有重要数据，可以删除旧数据库让系统重新创建：

**Windows**:
```cmd
# 停止应用
# 然后删除数据库文件
del ..\data\chainlesschain.db

# 重新启动应用
npm run dev
```

**Linux/Mac**:
```bash
# 停止应用
# 然后删除数据库文件
rm ../data/chainlesschain.db

# 重新启动应用
npm run dev
```

### 方案2：运行更新脚本（保留现有数据）

如果您想保留现有数据，可以运行更新脚本：

```bash
cd desktop-app-vue
node update-video-category.js
```

脚本会自动：
- ✅ 检查是否已有视频分类
- ✅ 添加"视频"一级分类（🎬）
- ✅ 添加6个视频子分类：
  - 📱 短视频
  - 📺 长视频
  - 📡 直播
  - 📹 Vlog
  - 🎨 动画
  - 🎮 测评

## 验证

更新后，启动应用：

```bash
npm run dev
```

### 检查分类显示

1. **项目页面**
   - 点击"新建项目"
   - 应该能看到"🎬 视频"分类
   - 点击视频分类可以看到6个子分类

2. **模板管理页面**
   - 进入模板管理
   - 分类筛选中应该有"视频"选项
   - 选择视频分类应该显示29个视频模板

### 检查模板加载

打开浏览器开发工具（F12），在控制台查看：
```
[TemplateStore] 成功加载模板: XX
```

应该能看到29个视频模板已加载。

## 视频模板列表

更新后，系统将包含以下29个视频模板：

### 短视频制作（4个）
1. 短视频脚本-抖音/快手
2. Instagram Reels脚本
3. 微信视频号脚本
4. TikTok海外脚本

### 长视频内容（3个）
5. YouTube长视频
6. B站长视频策划
7. 纪录片策划案

### 直播（2个）
8. 直播脚本策划
9. 直播复盘报告

### Vlog（3个）
10. Vlog拍摄计划
11. 旅行Vlog规划
12. 美食Vlog脚本

### 教程视频（2个）
13. 视频教程大纲
14. 软件教程脚本

### 后期制作（3个）
15. 视频剪辑提纲
16. 视频调色方案
17. 视频特效清单

### 商业视频（1个）
18. 商业广告片脚本

### 访谈节目（2个）
19. 人物专访策划
20. 播客视频化

### 动画视频（2个）
21. MG动画脚本
22. 解说动画策划

### 音乐视频（2个）
23. MV分镜脚本
24. 歌词视频模板

### 测评视频（3个）
25. 产品测评脚本
26. 游戏评测脚本
27. 开箱视频脚本

### 拍摄策划（2个）
28. 分镜头脚本表
29. 拍摄执行方案

## 常见问题

### Q1: 更新后还是看不到视频分类？

**解决方案**:
1. 确认主进程已重新构建：`npm run build:main`
2. 完全关闭应用（不是最小化）
3. 重新启动：`npm run dev`
4. 清除浏览器缓存：Ctrl+Shift+Delete（开发工具中）

### Q2: 模板显示但是数量不对？

**检查步骤**:
1. 确认所有29个JSON文件存在：
   ```bash
   ls src/main/templates/video/*.json | wc -l
   # 应该输出 29
   ```

2. 运行测试脚本：
   ```bash
   node test-video-project.js
   ```

### Q3: 创建项目时报错？

**可能原因**:
- 模板文件格式错误
- 数据库权限问题

**解决方案**:
1. 检查控制台错误信息
2. 验证模板JSON格式：
   ```bash
   node test-video-project.js
   ```

## 技术细节

### 更新内容

**文件**: `src/main/category-manager.js`

**修改内容**:
```javascript
// 新增一级分类
{ id: uuidv4(), name: '视频', parent_id: null, icon: '🎬', color: '#ff4d4f', sort_order: 10 }

// 新增二级分类
{ name: '短视频', parent_name: '视频', icon: '📱', color: '#ff4d4f', sort_order: 1 },
{ name: '长视频', parent_name: '视频', icon: '📺', color: '#ff4d4f', sort_order: 2 },
{ name: '直播', parent_name: '视频', icon: '📡', color: '#ff4d4f', sort_order: 3 },
{ name: 'Vlog', parent_name: '视频', icon: '📹', color: '#ff4d4f', sort_order: 4 },
{ name: '动画', parent_name: '视频', icon: '🎨', color: '#ff4d4f', sort_order: 5 },
{ name: '测评', parent_name: '视频', icon: '🎮', color: '#ff4d4f', sort_order: 6 }
```

## 获取帮助

如果问题仍然存在：

1. 查看完整日志：开发工具控制台（F12）
2. 查看主进程日志：终端窗口输出
3. 参考文档：`README_VIDEO_PROJECT.md`
4. 运行诊断：`node test-video-project.js`

---

**更新日期**: 2025-12-30
**适用版本**: v0.17.0+
