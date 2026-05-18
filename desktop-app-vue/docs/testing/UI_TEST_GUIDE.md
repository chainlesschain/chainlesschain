# 桌面应用一键配置功能测试指南

## 测试目标

验证桌面应用中的"一键配置"按钮能够正确配置本地coturn STUN/TURN服务器。

## 前置条件

### 1. 确保coturn服务正在运行

```bash
# 检查容器状态
docker ps | grep coturn

# 应该看到类似输出:
# chainlesschain-coturn   Up X minutes   0.0.0.0:3478->3478/tcp, ...
```

如果没有运行，启动它：

```bash
docker-compose up -d coturn
```

### 2. 验证coturn服务可用

```bash
cd backend/coturn-service
./test.sh
```

应该看到：
```
✓ STUN服务器响应成功
✓ TURN服务器响应成功
✓ 所有测试通过！
```

## 测试步骤

### 步骤1: 启动桌面应用

```bash
cd desktop-app-vue
npm run dev
```

等待应用启动（可能需要1-2分钟）。

### 步骤2: 打开P2P网络设置

1. 应用启动后，点击左侧菜单的 **"设置"** 图标
2. 在设置页面，点击 **"P2P 网络"** 标签页

### 步骤3: 查看初始配置

在"WebRTC 配置"部分，查看当前的STUN/TURN配置：

**STUN服务器列表**:
- 应该看到一些公共STUN服务器（如 stun.l.google.com）

**TURN服务器**:
- 可能为空或有一些旧配置

### 步骤4: 执行一键配置

1. 在"STUN 服务器"部分上方，找到蓝色的提示框
2. 提示框内容：
   ```
   快速配置本地STUN/TURN服务器
   如果您已经使用Docker启动了本地coturn服务器，点击下方按钮可以自动配置
   ```
3. 点击右侧的 **"⚡ 一键配置"** 按钮

### 步骤5: 验证配置结果

点击按钮后，应该看到：

1. **成功提示**:
   ```
   ✓ 本地coturn服务器配置已完成！请确保Docker容器正在运行。
   ```

2. **STUN服务器列表**:
   - 第一个应该是: `stun:localhost:3478` 🆕
   - 后面是原有的公共STUN服务器

3. **TURN服务器**:
   - "启用 TURN" 开关应该自动打开 ✓
   - TURN服务器列表中应该出现一个新卡片:
     ```
     URL: turn:localhost:3478
     用户名: chainlesschain
     凭证: ***
     ```

### 步骤6: 保存设置

1. 滚动到页面底部
2. 点击 **"💾 保存设置"** 按钮
3. 等待保存成功提示

### 步骤7: 验证NAT穿透状态

在同一页面，找到"NAT 穿透状态"部分：

1. 点击 **"🔄 重新检测"** 按钮
2. 等待检测完成（约5-10秒）
3. 查看检测结果：
   - **NAT 类型**: 应该显示检测到的NAT类型（如 symmetric）
   - **公网 IP**: 显示您的公网IP
   - **本地 IP**: 显示本地IP

### 步骤8: 运行传输层诊断

继续向下滚动，找到"传输层诊断"部分：

1. 点击 **"运行完整诊断"** 按钮
2. 等待诊断完成
3. 查看诊断结果表格：
   - **TCP**: 应该显示 ✓ 可用
   - **WebSocket**: 应该显示 ✓ 可用
   - **WebRTC**: 在Node.js环境中可能显示不可用（正常）

## 预期结果

### ✅ 成功标准

1. **配置应用成功**:
   - STUN服务器列表包含 `stun:localhost:3478`
   - TURN已启用
   - TURN服务器包含 `turn:localhost:3478`
   - 认证信息正确（chainlesschain/chainlesschain2024）

2. **NAT检测成功**:
   - 显示NAT类型
   - 显示公网IP和本地IP
   - 无错误提示

3. **传输层诊断通过**:
   - 至少2个传输层可用（TCP、WebSocket）
   - 显示监听地址

### ❌ 失败情况处理

#### 问题1: 点击"一键配置"无反应

**可能原因**:
- JavaScript错误
- 函数未正确绑定

**解决方法**:
1. 打开浏览器开发者工具（F12）
2. 查看Console标签页是否有错误
3. 检查 `SystemSettings.vue` 中的 `handleQuickSetupLocalCoturn` 函数

#### 问题2: 配置后STUN/TURN测试失败

**可能原因**:
- coturn容器未运行
- 端口被占用
- 防火墙阻止

**解决方法**:
```bash
# 检查容器状态
docker ps | grep coturn

# 检查端口
lsof -i :3478

# 重启容器
docker-compose restart coturn

# 查看日志
docker logs chainlesschain-coturn
```

#### 问题3: NAT检测失败

**可能原因**:
- 网络连接问题
- STUN服务器不可达

**解决方法**:
1. 检查网络连接
2. 尝试使用公共STUN服务器测试
3. 查看浏览器Console的错误信息

## 高级测试

### 测试1: 重复点击一键配置

1. 点击"一键配置"按钮
2. 再次点击"一键配置"按钮
3. **预期**: 应该提示"已存在，跳过"，不会重复添加

### 测试2: 手动删除后重新配置

1. 删除 `stun:localhost:3478`
2. 删除 `turn:localhost:3478`
3. 点击"一键配置"
4. **预期**: 重新添加配置

### 测试3: 修改密码后测试

1. 运行密码更新脚本:
   ```bash
   cd backend/coturn-service
   ./update-password.sh
   ```
2. 记录新密码
3. 在桌面应用中手动更新TURN服务器密码
4. 保存设置
5. 运行NAT检测验证

## 测试记录

### 测试环境

- **操作系统**: _____________
- **Node.js版本**: _____________
- **Electron版本**: _____________
- **测试日期**: _____________

### 测试结果

| 测试项 | 结果 | 备注 |
|--------|------|------|
| coturn容器运行 | ☐ 通过 ☐ 失败 | |
| 一键配置按钮可见 | ☐ 通过 ☐ 失败 | |
| 点击后配置应用 | ☐ 通过 ☐ 失败 | |
| STUN服务器添加 | ☐ 通过 ☐ 失败 | |
| TURN服务器添加 | ☐ 通过 ☐ 失败 | |
| 设置保存成功 | ☐ 通过 ☐ 失败 | |
| NAT检测成功 | ☐ 通过 ☐ 失败 | |
| 传输层诊断通过 | ☐ 通过 ☐ 失败 | |
| 重复配置处理 | ☐ 通过 ☐ 失败 | |

### 问题记录

如果遇到问题，请记录：

1. **问题描述**: _____________________________________________
2. **错误信息**: _____________________________________________
3. **复现步骤**: _____________________________________________
4. **解决方案**: _____________________________________________

## 截图指南

建议截取以下界面的截图：

1. **初始状态**: P2P网络设置页面（配置前）
2. **一键配置按钮**: 蓝色提示框和按钮
3. **配置后状态**: STUN/TURN服务器列表（配置后）
4. **成功提示**: 配置成功的消息提示
5. **NAT检测结果**: NAT类型和IP信息
6. **传输层诊断**: 诊断结果表格

## 自动化测试脚本

如果需要自动化测试，可以使用以下脚本：

```bash
# 测试一键配置逻辑
node desktop-app-vue/test-scripts/test-quick-setup.js

# 测试STUN/TURN连接
node backend/coturn-service/test-stun-turn.js

# 测试P2P功能
node test-p2p-functionality.js

# 测试NAT穿透
cd desktop-app-vue
node test-scripts/test-p2p-nat-traversal.js
```

## 总结

完成以上测试后，您应该能够：

1. ✅ 使用一键配置快速设置本地coturn
2. ✅ 验证STUN/TURN服务器正常工作
3. ✅ 了解NAT穿透状态
4. ✅ 确认传输层可用性

如果所有测试通过，说明一键配置功能工作正常，可以投入使用！

## 相关文档

- **快速启动**: `backend/coturn-service/QUICKSTART.md`
- **测试报告**: `backend/coturn-service/TEST_REPORT.md`
- **云部署**: `backend/coturn-service/CLOUD_DEPLOYMENT.md`
- **实施总结**: `backend/coturn-service/IMPLEMENTATION_SUMMARY.md`

## 反馈

如有问题或建议，请：
- 查看文档中的故障排查章节
- 检查Docker日志
- 运行自动化测试脚本
- 联系技术支持
