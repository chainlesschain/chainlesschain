# 快速开始

本指南将帮助您在5分钟内部署并开始使用U盾/SIMKey厂家管理系统。

## 🚀 5分钟快速部署

### 前置要求

确保您的系统已安装：
- **Docker Desktop** (Windows/Mac)
- 或 **Docker + Docker Compose** (Linux)

### 一键启动

#### Windows

```cmd
cd manufacturer-system
start.bat
```

#### Linux/Mac

```bash
cd manufacturer-system
chmod +x start.sh
./start.sh
```

### 等待30秒后访问

启动脚本会自动：
1. 拉取所有Docker镜像
2. 启动MySQL、Redis、后端、前端服务
3. 初始化数据库和默认数据

访问地址：

- 🖥️ **前端管理界面**: http://localhost
- 📚 **API文档**: http://localhost:8080/api/swagger-ui.html
- 👤 **默认账号**: admin
- 🔑 **默认密码**: admin123456

## 📱 系统页面导航

登录后可以访问以下9个核心页面：

### 1. Dashboard (控制台)

**访问路径**: http://localhost/dashboard

**功能概览**:
- 📊 设备总数统计卡片
- 📈 激活趋势折线图
- 🥧 设备类型分布饼图
- 📥 APP下载量柱状图
- ⏱️ 最近操作记录时间轴

**使用场景**: 登录后的首页，快速了解系统整体运营情况

---

### 2. 设备管理

**访问路径**: http://localhost/devices

**可以做什么**:
- ✅ 查看所有设备列表（分页显示）
- ✅ 按设备类型筛选（U盾/SIMKey）
- ✅ 按设备状态筛选（未激活/已激活/已锁定/已注销）
- ✅ 关键词搜索（设备ID、序列号）
- ✅ 激活设备
- ✅ 锁定/解锁设备
- ✅ 注销设备

**操作步骤**:
1. 点击左侧菜单 **"设备管理"**
2. 使用顶部筛选器选择设备类型和状态
3. 在搜索框输入关键词查找特定设备
4. 点击操作列的按钮进行设备管理

**示例：激活设备**
1. 找到状态为"未激活"的设备
2. 点击 **"激活"** 按钮
3. 输入激活码和用户ID
4. 点击确认完成激活

---

### 3. 注册设备

**访问路径**: http://localhost/devices/register

**功能特点**:
- 单个设备注册
- 批量设备注册（CSV导入）
- CSV模板下载
- 手动添加批量设备列表

#### 单个注册操作步骤

1. 选择 **"单个注册"** 标签
2. 选择设备类型（U盾/SIMKey）
3. 填写设备序列号
4. 填写制造商和型号
5. 点击 **"注册设备"**

#### 批量注册操作步骤

**方式一：CSV文件导入**
1. 切换到 **"批量注册"** 标签
2. 点击 **"下载模板"** 获取CSV模板
3. 在Excel中填写设备信息
4. 点击 **"上传CSV"** 选择填好的文件
5. 点击 **"批量注册"** 提交

**方式二：手动添加**
1. 切换到 **"批量注册"** 标签
2. 点击 **"添加设备"** 按钮
3. 逐行填写设备信息
4. 继续添加或点击 **"批量注册"** 提交

**注册结果**：
- 显示成功数量和失败数量
- 列出失败的设备及原因
- 可下载注册结果报告

---

### 4. APP版本管理

**访问路径**: http://localhost/app-versions

**可以做什么**:
- ✅ 查看所有平台APP版本
- ✅ 按平台筛选（Windows/Mac/Linux/Android/iOS）
- ✅ 发布版本（从草稿/测试状态发布）
- ✅ 废弃旧版本
- ✅ 下载安装包
- ✅ 查看下载统计

**版本状态说明**:
- **草稿**: 刚上传，未发布
- **测试中**: 内部测试阶段
- **已发布**: 正式发布，用户可下载
- **已废弃**: 旧版本，不再推荐

**操作步骤**:
1. 点击左侧菜单 **"APP版本"**
2. 使用平台筛选器选择要查看的平台
3. 点击 **"发布"** 将测试版本发布给用户
4. 点击 **"废弃"** 标记旧版本为废弃
5. 点击 **"下载"** 下载安装包

---

### 5. 上传APP版本

**访问路径**: http://localhost/app-versions/upload

**4步上传流程**:

#### 步骤1: 选择平台
- Windows (.exe, .msi)
- macOS (.dmg, .pkg)
- Linux (.deb, .rpm, .AppImage)
- Android (.apk, .aab)
- iOS (.ipa)

#### 步骤2: 上传文件
- 拖拽文件到上传区域
- 或点击选择文件
- 支持最大2GB文件
- 显示上传进度

#### 步骤3: 填写信息
- 版本号（如：1.0.0）
- 版本名称
- 更新日志（支持Markdown）
- 是否强制更新
- 最小支持版本

#### 步骤4: 确认提交
- 预览版本信息
- 确认无误后提交
- 上传成功后跳转到版本列表

**提示**: 上传后的版本默认为"草稿"状态，需要在版本管理页面点击"发布"才能让用户下载。

---

### 6. 备份管理

**访问路径**: http://localhost/backups

**可以做什么**:
- ✅ 查看所有备份记录
- ✅ 按设备ID或用户ID筛选
- ✅ 创建新备份
- ✅ 恢复数据到新设备
- ✅ 删除过期备份

#### 创建备份操作步骤

1. 点击 **"创建备份"** 按钮
2. 输入设备ID
3. 输入用户ID
4. 选择备份类型：
   - **完整备份**: 备份所有数据
   - **增量备份**: 只备份变更数据
5. 选择加密方式（AES-256-GCM）
6. 输入加密后的数据（JSON格式）
7. 设置有效期（默认730天）
8. 点击 **"创建"** 提交

#### 恢复数据操作步骤

1. 在备份列表中找到要恢复的备份
2. 点击 **"恢复"** 按钮
3. 输入目标设备ID（新设备）
4. 输入管理员密码进行验证
5. 点击 **"确认恢复"**
6. 等待恢复完成

**安全提示**:
- 备份数据已加密，无法直接查看内容
- 恢复操作需要管理员密码验证
- 删除备份前会二次确认

---

### 7. 用户管理

**访问路径**: http://localhost/users

**可以做什么**:
- ✅ 查看所有系统用户
- ✅ 按角色筛选（管理员/经销商/用户）
- ✅ 按状态筛选（正常/锁定/停用）
- ✅ 添加新用户
- ✅ 编辑用户信息
- ✅ 锁定/解锁用户
- ✅ 删除用户
- ✅ 查看用户详情

**角色权限说明**:

| 角色 | 权限范围 |
|------|---------|
| **管理员** | 所有权限，包括用户管理 |
| **经销商** | 管理分配的设备，不能管理用户 |
| **普通用户** | 只能查看和管理自己的设备 |

#### 添加用户操作步骤

1. 点击 **"添加用户"** 按钮
2. 填写用户信息：
   - 用户名（唯一）
   - 邮箱
   - 手机号
   - 真实姓名
3. 选择角色
4. 设置初始密码
5. 点击 **"确定"** 创建

#### 编辑用户操作步骤

1. 点击用户行的 **"编辑"** 按钮
2. 修改用户信息
3. 点击 **"确定"** 保存

#### 锁定/解锁用户

- **锁定**: 临时禁止用户登录（可解锁）
- **停用**: 永久停用用户（不可恢复）
- 锁定的用户在列表中显示为灰色

---

### 8. 操作日志

**访问路径**: http://localhost/logs

**可以做什么**:
- ✅ 查看所有操作记录
- ✅ 按设备ID筛选
- ✅ 按操作类型筛选
- ✅ 按状态筛选（成功/失败）
- ✅ 按时间范围筛选
- ✅ 查看日志详情
- ✅ 导出日志（CSV格式）

**操作类型**:
- 设备注册
- 设备激活
- 设备锁定
- 设备解锁
- 设备注销
- 密码恢复
- 数据备份
- 数据恢复
- 用户登录
- 用户登出

#### 查询日志操作步骤

1. 选择筛选条件：
   - 设备ID（可选）
   - 操作类型（可选）
   - 状态（可选）
   - 时间范围（可选）
2. 点击 **"查询"** 按钮
3. 查看筛选结果

#### 查看详情操作步骤

1. 点击日志行的 **"详情"** 按钮
2. 查看完整的操作信息：
   - 操作人
   - 操作时间
   - IP地址
   - User Agent
   - 请求参数（JSON格式）
   - 响应结果（JSON格式）
   - 错误信息（如果失败）

#### 导出日志

1. 设置筛选条件
2. 点击 **"导出"** 按钮
3. 选择导出格式（CSV）
4. 下载日志文件

---

## 🎯 常见使用场景

### 场景1: 批量注册新设备

**背景**: 生产厂家生产了100个新U盾，需要批量注册到系统

**步骤**:
1. 导航到 **"注册设备"** 页面
2. 切换到 **"批量注册"** 标签
3. 点击 **"下载模板"** 下载CSV模板
4. 在Excel中填写100个设备的信息：
   ```csv
   设备类型,序列号,制造商,型号
   UKEY,UK20240001,ChainlessChain,CCU-1000
   UKEY,UK20240002,ChainlessChain,CCU-1000
   ...
   ```
5. 保存并上传CSV文件
6. 点击 **"批量注册"**
7. 查看注册结果统计：
   - 成功：98个
   - 失败：2个（序列号重复）
8. 下载结果报告，修正失败的记录

---

### 场景2: 发布新APP版本

**背景**: 开发团队完成了Android v2.0.0版本，需要发布给用户

**步骤**:
1. 导航到 **"上传APP版本"** 页面
2. **步骤1**: 选择 **"Android"** 平台
3. **步骤2**: 拖拽上传 `chainlesschain-v2.0.0.apk`
4. **步骤3**: 填写版本信息
   - 版本号：2.0.0
   - 版本名称：重大功能更新
   - 更新日志：
     ```markdown
     ## 新功能
     - 新增人脸识别登录
     - 支持指纹支付

     ## 优化
     - 优化启动速度
     - 修复已知问题
     ```
   - 强制更新：是（勾选）
   - 最小支持版本：1.5.0
5. **步骤4**: 确认信息，点击 **"提交"**
6. 上传成功后，跳转到 **"APP版本管理"** 页面
7. 找到刚上传的v2.0.0版本（状态：草稿）
8. 点击 **"发布"** 按钮
9. 确认发布，版本状态变为"已发布"
10. 用户端即可检测到新版本并下载更新

---

### 场景3: 用户设备激活

**背景**: 用户购买了一个U盾，获得激活码，需要激活设备

**步骤**:
1. 用户从设备包装盒中获得激活码：`ABCD-EFGH-IJKL-MNOP`
2. 导航到 **"设备管理"** 页面
3. 在设备列表中筛选状态为 **"未激活"** 的设备
4. 通过序列号找到对应设备：`UK20240001`
5. 点击 **"激活"** 按钮
6. 在弹出的对话框中输入：
   - 激活码：`ABCD-EFGH-IJKL-MNOP`
   - 用户ID：`user123`（用户在APP中注册的ID）
7. 点击 **"确认激活"**
8. 激活成功，设备状态变为 **"已激活"**
9. 用户可以在APP中使用该U盾

---

### 场景4: 数据备份与恢复

**背景**: 用户的U盾丢失，需要将数据恢复到新U盾

#### 创建备份

1. 用户在丢失前使用了数据备份功能
2. APP将加密数据上传到厂家系统
3. 管理员导航到 **"备份管理"** 页面
4. 点击 **"创建备份"**
5. 输入信息：
   - 设备ID：`UK20240001`（旧设备）
   - 用户ID：`user123`
   - 备份类型：完整备份
   - 加密数据：（从APP获取的加密JSON）
   - 有效期：730天
6. 点击 **"创建"**，备份成功

#### 恢复数据

1. 用户购买了新U盾：`UK20240100`
2. 管理员在 **"设备管理"** 中激活新设备
3. 导航到 **"备份管理"** 页面
4. 找到旧设备 `UK20240001` 的备份
5. 点击 **"恢复"** 按钮
6. 输入目标设备ID：`UK20240100`
7. 输入管理员密码：`admin123456`
8. 点击 **"确认恢复"**
9. 系统将备份数据恢复到新设备
10. 用户在新设备上可以访问所有数据

---

## 🔧 故障排查

### 问题1: 无法访问前端页面

**症状**: 浏览器显示"无法访问此网站"

**解决方法**:

```bash
# 检查Docker容器状态
docker-compose ps

# 应该看到4个容器都是Up状态：
# - mysql
# - redis
# - backend
# - frontend

# 如果frontend容器异常，查看日志
docker-compose logs frontend

# 重启前端容器
docker-compose restart frontend
```

---

### 问题2: API请求失败

**症状**: 页面显示"网络错误"或"请求失败"

**解决方法**:

```bash
# 检查后端服务
docker-compose logs backend

# 检查数据库连接
docker-compose logs mysql

# 查看是否有错误信息
docker-compose logs backend | grep ERROR

# 重启后端服务
docker-compose restart backend
```

---

### 问题3: 登录失败

**症状**: 输入账号密码后提示"用户名或密码错误"

**解决方法**:

1. 确认使用默认账号：
   - 用户名：`admin`
   - 密码：`admin123456`

2. 清除浏览器缓存：
   - 打开开发者工具（F12）
   - Application → Storage → Clear site data
   - 刷新页面

3. 尝试无痕模式：
   - 使用浏览器无痕窗口访问
   - 避免缓存干扰

4. 重置数据库：
```bash
# 停止所有服务
docker-compose down

# 删除数据库卷
docker volume rm manufacturer-system_mysql-data

# 重新启动
docker-compose up -d
```

---

### 问题4: 文件上传失败

**症状**: 上传APP安装包时显示"上传失败"

**解决方法**:

1. 检查文件大小（不超过2GB）

2. 检查文件格式：
   - Windows: .exe, .msi
   - Mac: .dmg, .pkg
   - Linux: .deb, .rpm, .AppImage
   - Android: .apk, .aab
   - iOS: .ipa

3. 查看后端日志：
```bash
docker-compose logs backend | grep upload
```

4. 检查上传目录权限（Linux/Mac）：
```bash
# 确保上传目录存在
mkdir -p data/uploads

# 设置权限
chmod 777 data/uploads
```

5. 重启后端服务：
```bash
docker-compose restart backend
```

---

## 📊 系统监控

### 查看系统状态

```bash
# 查看所有容器状态
docker-compose ps

# 查看资源使用情况
docker stats

# 实时查看所有日志
docker-compose logs -f

# 只查看后端日志
docker-compose logs -f backend
```

### 性能监控

访问 **Dashboard** 页面查看实时统计：

- **设备总数**: 当前注册的设备总数
- **激活率**: 已激活设备 / 总设备
- **用户数量**: 系统用户总数
- **下载量**: APP总下载次数

### 数据库监控

```bash
# 进入MySQL容器
docker-compose exec mysql bash

# 登录MySQL
mysql -u root -p

# 查看数据库大小
SELECT
  table_schema AS 'Database',
  ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)'
FROM information_schema.tables
WHERE table_schema = 'manufacturer_system'
GROUP BY table_schema;

# 查看表记录数
SELECT
  table_name AS 'Table',
  table_rows AS 'Rows'
FROM information_schema.tables
WHERE table_schema = 'manufacturer_system';
```

---

## 🔄 数据备份

### 备份数据库

```bash
# 导出整个数据库
docker-compose exec mysql mysqldump -u root -p manufacturer_system > backup_$(date +%Y%m%d).sql

# 只导出数据（不包含结构）
docker-compose exec mysql mysqldump -u root -p --no-create-info manufacturer_system > data_backup.sql

# 只导出结构（不包含数据）
docker-compose exec mysql mysqldump -u root -p --no-data manufacturer_system > schema_backup.sql
```

### 恢复数据库

```bash
# 恢复数据库
docker-compose exec -T mysql mysql -u root -p manufacturer_system < backup_20241202.sql
```

### 备份上传文件

```bash
# 备份上传的APP文件
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz data/uploads/

# 恢复上传文件
tar -xzf uploads_backup_20241202.tar.gz
```

---

## 📞 获取帮助

### 文档资源

- 📖 [系统概述](/manufacturer/overview) - 了解系统功能
- 🏗️ [安装部署](/manufacturer/installation) - 详细部署指南
- 📝 [API文档](/api/manufacturer/devices) - 接口文档
- ❓ [常见问题](/faq) - 常见问题解答

### 技术支持

- **官网**: https://www.chainlesschain.com
- **邮箱**: zhanglongfa@chainlesschain.com
- **电话**: 400-1068-687
- **GitHub**: https://github.com/chainlesschain/manufacturer-system

### 社区支持

- 💬 [GitHub Discussions](https://github.com/chainlesschain/manufacturer-system/discussions)
- 🐛 [报告问题](https://github.com/chainlesschain/manufacturer-system/issues)
- 📧 [订阅邮件列表](https://www.chainlesschain.com/newsletter)

---

## 🎓 学习路径

### 新手推荐

1. ✅ **本文档** - 快速上手（5分钟）
2. 📖 [系统概述](/manufacturer/overview) - 了解功能（10分钟）
3. 🔧 [设备管理](/manufacturer/device-manage) - 学习核心功能（15分钟）
4. 📱 [APP管理](/manufacturer/app-publish) - 学习版本发布（10分钟）

### 进阶学习

5. 🏗️ [系统架构](/guide/architecture) - 理解技术架构
6. 🔌 [API文档](/api/introduction) - 学习API集成
7. 🔐 [安全最佳实践](/manufacturer/installation#安全配置) - 生产环境部署

### 代码学习

```
推荐学习顺序:
1. 前端页面 (frontend/src/views/) - 理解业务流程
2. 路由配置 (frontend/src/router/) - 理解页面结构
3. API封装 (frontend/src/api/) - 理解接口调用
4. 后端Controller (backend/.../controller/) - 理解API实现
5. 业务Service (backend/.../service/) - 理解业务逻辑
6. 数据库设计 (backend/.../resources/db/) - 理解数据结构
```

---

**祝您使用愉快! 🎉**

有任何问题欢迎随时联系我们！

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「5 分钟快速部署」「系统页面导航」。快速开始指南带你 5 分钟一键部署并走通 Dashboard / 设备管理 / 注册 / APP 版本 / 上传 / 备份六大页面。

### 2. 核心特性

- 一键部署（`start.bat` / `start.sh`），30 秒后可访问
- 六大功能页导航导览
- 单个 + 批量设备注册操作步骤
- APP 上传 4 步 + 备份 / 恢复操作步骤

### 3. 系统架构

```
start.bat / start.sh ──► Docker Compose（MySQL + Redis + 后端 + 前端）
   ▼
前端 http://localhost  ·  API http://localhost:8080  ·  admin / admin123456
```

### 4. 系统定位

厂家管理系统的**新手上手入口**，是 [概述](/manufacturer/overview) 与 [安装部署](/manufacturer/installation) 之间的实操速通。

### 5. 核心功能

| 页面 | 速通内容 |
|---|---|
| Dashboard | 核心指标 / 统计图表 |
| 设备管理 | 列表 / 筛选 / 操作 |
| 注册设备 | 单个 / 批量 |
| APP 版本管理 | 版本列表 / 状态 |
| 上传 APP | 4 步向导 |
| 备份管理 | 创建 / 恢复 |

### 6. 技术架构

部署同 [安装部署](/manufacturer/installation)：Docker Compose 四容器（Spring Boot 3.2.1 + MySQL 8.0 + Redis 7.0 + Vue3/Nginx）。

### 7. 系统特点

- 5 分钟从零到可用
- 默认管理员开箱即用
- 页面导航循序渐进

### 8. 应用场景

首次部署验证、演示环境、新成员上手培训。

### 9. 竞品对比

| 维度 | 本系统 | 自建上手 |
|---|---|---|
| 上手时间 | ✅ 5 分钟 | ⚠️ 数天 |
| 引导文档 | ✅ 分页导览 | ⚠️ |
| 默认数据 | ✅ 开箱即用 | ❌ |

### 10. 配置参考

默认端口 / 账号见正文「等待 30 秒后访问」；自定义配置见 [安装部署](/manufacturer/installation) 的 `docker-compose.yml`。

### 11. 性能指标

一键启动到可访问约 5 分钟（含镜像拉取）；首次访问前等待 ~30 秒服务就绪。

### 12. 测试覆盖

上手路径（部署 → 登录 → 注册 → 上传 → 备份）可作部署后冒烟用例；各功能详细测试见对应模块文档。

### 13. 安全考虑

首次登录后**立即修改默认密码 `admin123456`**；生产部署改 `JWT_SECRET` 与数据库密码（见 [安装部署](/manufacturer/installation) 附录「13. 安全考虑」）。

### 14. 故障排除

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 访问空白 | 服务未就绪 | 再等 30 秒 / 看容器日志 |
| 登录失败 | 用了非默认账号 | `admin / admin123456` |
| 端口冲突 | 端口被占 | 见 [安装部署](/manufacturer/installation) 改端口 |

### 15. 关键文件

| 文件 | 说明 |
|---|---|
| `start.bat` / `start.sh` | 一键启动 |
| `frontend/src/views/` | 前端页面（业务流程） |
| `backend/.../controller/` | 后端 API 实现 |

### 16. 使用示例

```bash
cd manufacturer-system && ./start.sh   # Linux/Mac（Windows 用 start.bat）
# 浏览器打开 http://localhost，用 admin / admin123456 登录
```

### 17. 相关文档

- [厂家管理系统概述](/manufacturer/overview)
- [安装部署](/manufacturer/installation)
- [设备管理](/manufacturer/device-manage)
- [APP 发布](/manufacturer/app-publish)
