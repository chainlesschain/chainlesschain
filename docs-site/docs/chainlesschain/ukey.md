# U盾集成

U盾（USB Key）是ChainlessChain PC端的安全核心，提供硬件级的密钥保护。

## 什么是U盾?

U盾是一种USB接口的硬件安全设备，内置安全芯片：
- 🔐 **私钥永不导出**: 私钥生成并永久存储在安全芯片中
- 🛡️ **PIN码保护**: 多次错误自动锁定
- ✍️ **数字签名**: 所有关键操作需要U盾签名
- 🔒 **数据加密**: 数据库密钥由U盾管理

## 支持的U盾型号

### 推荐型号

| 品牌 | 型号 | 价格 | 兼容性 | 推荐指数 |
|------|------|------|--------|----------|
| 飞天诚信 | ePass3003 | ¥68 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 握奇数据 | WatchData | ¥58 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 中钞信用卡 | G+D | ¥128 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| YubiKey | YubiKey 5 | $45 | ⭐⭐⭐ | ⭐⭐⭐ |

### 兼容标准

ChainlessChain 支持以下标准的U盾：
- ✅ PKCS#11 (推荐)
- ✅ Microsoft Crypto API (CAPI/CNG)
- ✅ OpenSC标准
- ⚠️ 专有SDK (需要额外配置)

## 购买U盾

### 购买渠道

1. **官方推荐**: ChainlessChain官网商城（即将上线）
2. **电商平台**: 京东、天猫旗舰店
3. **线下**: 部分银行营业厅

::: warning 防伪提示
请从正规渠道购买，避免购买到假冒伪劣产品
:::

### 价格参考

- 基础型: ¥50-80
- 标准型: ¥80-150
- 高级型: ¥150-300

::: tip
首次使用推荐购买飞天诚信 ePass3003，性价比高
:::

## 初次设置

### Windows 系统

#### 1. 安装驱动

```powershell
# 方式一: 自动安装（推荐）
ChainlessChain会自动检测并安装驱动

# 方式二: 手动安装
从U盾厂商官网下载驱动程序
运行安装程序
重启计算机
```

#### 2. 插入U盾

```
1. 将U盾插入USB接口
2. 等待系统识别
3. 检查设备管理器中是否显示
```

#### 3. 初始化

```
1. 打开ChainlessChain
2. 系统检测到U盾
3. 提示设置PIN码:
   - 长度: 6-16位
   - 建议: 数字+字母组合
   - 记住: 务必牢记，忘记无法找回
4. 确认PIN码
5. 生成密钥对（需要30秒-2分钟）
6. 完成！
```

### macOS 系统

#### 1. 安装驱动

```bash
# 使用Homebrew安装OpenSC
brew install opensc

# 或下载厂商驱动
从U盾厂商官网下载macOS驱动
安装.pkg文件
```

#### 2. 配置权限

```bash
# 授予ChainlessChain访问U盾的权限
系统偏好设置 → 安全性与隐私 → 隐私 → 辅助功能
勾选 ChainlessChain
```

### Linux 系统

#### 1. 安装依赖

```bash
# Ubuntu/Debian
sudo apt-get install opensc pcscd pcsc-tools

# Fedora/RHEL
sudo dnf install opensc pcsc-lite pcsc-tools

# Arch Linux
sudo pacman -S opensc ccid pcsclite
```

#### 2. 启动服务

```bash
# 启动pcscd服务
sudo systemctl start pcscd
sudo systemctl enable pcscd

# 检测U盾
pcsc_scan
```

## 日常使用

### 登录系统

```
1. 打开ChainlessChain
2. 插入U盾
3. 输入PIN码
4. 验证成功，进入系统
```

### PIN码管理

#### 修改PIN码

```
设置 → 安全 → U盾管理 → 修改PIN码
1. 输入当前PIN码
2. 输入新PIN码（6-16位）
3. 确认新PIN码
4. 完成
```

#### PIN码错误次数

大多数U盾允许连续错误3-10次：

```
剩余次数显示:
✓✓✓✓✓ (5次)
✓✓✓✓ (4次)
✓✓✓ (3次)
✓✓ (2次) ⚠️ 警告：剩余次数不多
✓ (1次) ⚠️ 警告：最后一次机会
✗ (0次) 🔒 已锁定
```

::: danger 重要
PIN码输入错误次数耗尽后，U盾将被永久锁定，无法解锁！
:::

### 解锁锁定的U盾

#### PUK码解锁

部分U盾支持PUK码解锁：

```
1. 获取PUK码（购买时提供或联系厂商）
2. 使用厂商工具解锁
3. 重置PIN码
```

#### 管理员密钥解锁

```
1. 使用管理员密钥（如果设置过）
2. 连接U盾
3. 运行解锁工具
4. 重置PIN码
```

#### 无法解锁

如果没有PUK码或管理员密钥：
- ❌ U盾无法解锁
- ✅ 使用助记词恢复到新U盾
- ✅ 使用备份U盾

## 密钥管理

### 密钥层次结构

```
主密钥 (Master Key)
├── 设备签名密钥 (Device Sign Key)
│   └── 用于签名DID、交易、消息
├── 设备加密密钥 (Device Encrypt Key)
│   └── 用于接收加密消息、文件
├── 数据库加密密钥 (DB Encryption Key)
│   └── 用于加密SQLCipher数据库
└── 备份加密密钥 (Backup Encryption Key)
    └── 用于加密Git仓库、云备份
```

### 查看公钥

```
设置 → 安全 → U盾管理 → 查看公钥

显示信息:
- DID: did:chainlesschain:QmXXXXXX
- 签名公钥: 0x1234...5678
- 加密公钥: 0xabcd...ef01
- 指纹: SHA256:1a2b3c4d...
```

### 导出证书

```
设置 → 安全 → U盾管理 → 导出证书

可导出内容:
✓ 公钥证书 (.cer)
✓ DID文档 (.json)
✗ 私钥（永不导出）
```

## 备份与恢复

### 为什么要备份?

U盾可能：
- 🔥 丢失
- 💥 损坏
- 🔒 被锁定
- 💔 意外格式化

备份可以确保你不会丢失数据和身份。

### 备份方式

#### 方式一: 助记词备份（推荐）

```
设置 → 安全 → U盾管理 → 生成助记词

1. 系统生成24个助记词
2. 按顺序抄写到纸上
3. 验证：按提示输入几个单词
4. 妥善保存

示例助记词:
abandon ability able about above absent
absorb abstract absurd abuse access accident
account accuse achieve acid acoustic acquire
across act action actor actress actual
```

::: danger 安全警告
- ❌ 不要拍照
- ❌ 不要存在电脑或手机
- ❌ 不要发送给任何人
- ✅ 手写在纸上
- ✅ 保存在安全的地方（保险柜）
- ✅ 考虑制作多份副本
:::

#### 方式二: 备份U盾

```
设置 → 安全 → U盾管理 → 创建备份U盾

1. 插入主U盾
2. 输入PIN码
3. 插入备份U盾
4. 设置备份U盾的PIN码
5. 系统将密钥复制到备份U盾
6. 验证备份成功
7. 将备份U盾存放在不同地点
```

#### 方式三: Shamir秘密共享（高级）

```
设置 → 安全 → 高级 → 社交恢复

1. 选择分片数量 N (如5)
2. 选择恢复阈值 M (如3)
3. 生成N份密钥分片
4. 分发给N个可信朋友/家人
5. 未来需要M份分片即可恢复

特点:
✓ 任意M份可恢复
✗ 少于M份无法恢复
✓ 单个分片泄露不影响安全
```

### 从备份恢复

#### 从助记词恢复

```
1. 购买新U盾
2. 打开ChainlessChain
3. 选择"从助记词恢复"
4. 按顺序输入24个助记词
5. 设置新PIN码
6. 系统重新生成密钥并写入U盾
7. 恢复完成
```

#### 从备份U盾恢复

```
1. 插入备份U盾
2. 输入备份U盾的PIN码
3. 系统自动识别
4. 可选：创建新的主U盾
```

## 高级功能

### 多U盾支持

```
设置 → 安全 → U盾管理 → 添加U盾

场景:
- 家里一个，公司一个
- 主U盾 + 备份U盾
- 不同设备使用不同U盾

每个U盾:
✓ 独立的PIN码
✓ 相同的密钥（从主密钥派生）
✓ 可独立管理
```

### U盾健康检查

```
设置 → 安全 → U盾管理 → 健康检查

检查项目:
✓ U盾连接状态
✓ 固件版本
✓ 剩余存储空间
✓ 证书有效期
✓ PIN码剩余次数

建议:
- 每月检查一次
- 发现异常及时处理
```

### U盾固件升级

```
设置 → 安全 → U盾管理 → 检查更新

如果有新固件:
1. 下载固件包
2. 备份当前U盾（重要！）
3. 运行升级工具
4. 升级完成后验证功能
```

::: warning
固件升级有风险，务必先备份
:::

## API使用

### Node.js示例

```typescript
import { UKey } from '@chainlesschain/ukey'

// 初始化U盾
const ukey = new UKey({
  type: 'feitian',
  pin: '123456'
})

// 生成密钥对
await ukey.generateKeyPair()

// 签名
const data = Buffer.from('Hello World')
const signature = await ukey.sign(data)

// 验证签名
const isValid = await ukey.verify(data, signature)

// 加密
const publicKey = await ukey.getPublicKey()
const encrypted = await ukey.encrypt(data, publicKey)

// 解密
const decrypted = await ukey.decrypt(encrypted)
```

### Python示例

```python
from chainlesschain import UKey

# 初始化
ukey = UKey(type='feitian', pin='123456')

# 签名
data = b'Hello World'
signature = ukey.sign(data)

# 加密数据库
db_key = ukey.derive_key(purpose='database')
encrypted_db = encrypt_database(db_key)
```

## 故障排查

### U盾无法识别

**检查步骤**:

```bash
# Windows
1. 设备管理器中查看是否有黄色感叹号
2. 重新安装驱动
3. 尝试其他USB接口
4. 重启计算机

# macOS
1. 系统信息 → USB → 查看是否识别
2. 重新安装OpenSC
3. 检查权限设置

# Linux
4. lsusb  # 查看USB设备
5. sudo systemctl status pcscd  # 检查服务状态
6. pcsc_scan  # 扫描智能卡
```

### PIN码验证失败

**可能原因**:
- ❌ PIN码输入错误
- ❌ 大小写错误（如果包含字母）
- ❌ 输入法干扰
- ❌ U盾已锁定

**解决方法**:
```
1. 确认NumLock键是否开启
2. 切换到英文输入法
3. 仔细输入PIN码
4. 检查剩余尝试次数
```

### 签名操作失败

**检查清单**:
- [ ] U盾已插入
- [ ] PIN码已验证
- [ ] U盾未过期
- [ ] 证书有效
- [ ] 系统时间正确

### 性能慢

**优化建议**:
```
1. 使用USB 3.0接口
2. 避免使用USB集线器
3. 更新U盾固件
4. 清理U盾缓存:
   设置 → U盾管理 → 清理缓存
```

## 安全建议

### 保护U盾

1. ✅ **妥善保管**: 不要随意放置
2. ✅ **定期备份**: 防止丢失
3. ✅ **强PIN码**: 不使用123456等弱密码
4. ✅ **及时锁定**: 离开电脑时拔出U盾
5. ✅ **定期检查**: 每月健康检查

### 防止丢失

1. ✅ **固定位置**: 使用后放回固定位置
2. ✅ **绑定钥匙**: 和钥匙放在一起
3. ✅ **贴标签**: 但不要标注用途
4. ✅ **买保险**: 贵重U盾考虑购买保险

### 紧急情况

**U盾丢失**:
```
1. 立即使用备份U盾登录
2. 发布DID更新，撤销丢失U盾的密钥
3. 通知好友更新公钥
4. 将丢失U盾加入黑名单
5. 考虑报警（如果涉及重要资产）
```

## 常见问题

### U盾寿命有多长?

```
通常寿命: 3-10年

影响因素:
- 使用频率
- 环境温度湿度
- 品牌品质

建议:
- 每3年更换一次
- 始终保持备份可用
```

### 可以同时使用多个U盾吗?

```
可以，ChainlessChain支持:
✓ 主U盾 + 备份U盾
✓ 家用U盾 + 办公U盾
✓ 多人共享（企业版）

每个U盾独立管理，但共享相同的主密钥
```

### U盾丢了会泄露数据吗?

```
不会：
✓ 私钥无法导出
✓ 有PIN码保护
✓ 多次错误自动锁定

但是建议:
✓ 及时撤销丢失U盾的密钥
✓ 更改相关密码
✓ 监控账户异常
```

### 忘记PIN码怎么办?

```
如果有备份:
✓ 使用助记词恢复到新U盾
✓ 使用备份U盾
✓ 使用PUK码重置（如果支持）

如果没有备份:
❌ 无法恢复U盾
❌ 无法访问加密数据
❌ 失去控制权

所以备份非常重要！
```

## 企业版功能

### 批量部署

```bash
# 批量初始化U盾
chainlesschain-admin ukey init-batch \
  --count 100 \
  --pin-policy strong \
  --output ./ukeys.csv
```

### 集中管理

```
功能:
✓ 统一密钥策略
✓ 远程锁定/解锁
✓ 使用日志审计
✓ 合规性报告
```

### 多人共享

```
场景: 公司账户需要多人访问

设置:
1. 生成主密钥
2. 为每个员工分配一个U盾
3. 设置访问权限
4. 任意一个U盾都可以访问
5. 员工离职时撤销其U盾
```

## 未来路线图

- [ ] 支持更多U盾型号
- [ ] 生物识别集成（指纹U盾）
- [ ] 无线U盾支持（蓝牙、NFC）
- [ ] 云端备份（加密）
- [ ] 智能合约签名
- [ ] 硬件钱包集成
