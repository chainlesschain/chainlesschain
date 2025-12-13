# SIMKey集成

SIMKey利用SIM卡内置的安全芯片，为移动端提供硬件级安全保护。

## 什么是SIMKey?

SIMKey是集成在SIM卡中的安全应用程序（Applet），利用SIM卡的安全芯片存储密钥和执行加密操作。

### SIMKey的优势

- 📱 **始终在线**: 手机随身携带，SIM卡始终在手机中
- 🔐 **硬件安全**: 利用SIM卡的安全芯片，私钥无法导出
- 📞 **运营商背书**: 实名制SIM卡提供额外身份保证
- 🚫 **防复制**: SIM卡丢失后可挂失，防止冒用
- 💰 **无需额外硬件**: 人人都有SIM卡，无需购买U盾

### 与U盾的对比

| 特性 | U盾 | SIMKey |
|------|-----|--------|
| 安全等级 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 便携性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 成本 | ¥50-300 | 免费或低成本 |
| 兼容性 | PC端优秀 | 移动端优秀 |
| 丢失风险 | 容易丢失 | 随手机，不易丢失 |

## 支持的SIM卡

### 技术要求

需要支持以下技术之一：
- ✅ **USIM卡**: 带安全芯片的SIM卡
- ✅ **Java Card**: 支持Java Applet的SIM卡
- ✅ **SIMalliance标准**: 支持OMAPI的SIM卡

### 运营商支持

| 运营商 | Android支持 | iOS支持 | 备注 |
|--------|-------------|---------|------|
| 中国移动 | ✅ | ⚠️部分 | 需要USIM卡 |
| 中国联通 | ✅ | ⚠️部分 | 需要USIM卡 |
| 中国电信 | ✅ | ❌ | 仅Android |

::: tip
iOS系统对SIM卡访问有严格限制，建议iOS用户使用蓝牙U盾
:::

### 检查SIM卡兼容性

#### Android

```java
// 检查OMAPI支持
import android.se.omapi.SEService

SEService seService = new SEService(context, executor, new SEService.OnConnectedListener() {
    @Override
    public void onConnected() {
        Reader[] readers = seService.getReaders();
        for (Reader reader : readers) {
            if (reader.getName().contains("SIM")) {
                // 支持OMAPI
                Log.d("SIMKey", "SIM card supports OMAPI");
            }
        }
    }
})
```

#### 或使用ChainlessChain内置检测

```
设置 → 安全 → SIMKey → 检测兼容性

结果:
✓ 检测到SIM卡
✓ 支持OMAPI
✓ 已安装安全Applet
或
❌ SIM卡不支持OMAPI
建议: 联系运营商更换USIM卡
```

## 初次设置

### Android

#### 1. 检测SIM卡

```
1. 打开ChainlessChain移动应用
2. 进入"设置 → 安全"
3. 选择"启用SIMKey"
4. 应用自动检测SIM卡
```

#### 2. 安装Applet（如需要）

```
某些SIM卡需要安装ChainlessChain Applet:

1. 系统提示需要安装Applet
2. 点击"安装"
3. 下载Applet安装包
4. 应用通过OMAPI安装到SIM卡
5. 等待安装完成（约30秒）
6. 重启应用
```

#### 3. 初始化

```
1. 设置SIMKey PIN码:
   - 独立于SIM卡PIN
   - 6-8位数字
   - 记住：忘记无法找回
2. 确认PIN码
3. 生成密钥对（约1-2分钟）
4. 完成
```

### 安全建议

```
SIMKey PIN码 ≠ SIM卡PIN码

建议:
✓ 使用不同的PIN码
✓ SIMKey PIN更复杂（6-8位）
✓ 定期更换
```

## 日常使用

### 登录

```
1. 打开ChainlessChain
2. 系统检测到SIMKey
3. 提示输入PIN码
   （可选择指纹/面容ID代替）
4. 验证成功，进入系统
```

### 生物识别集成

#### 指纹解锁

```
设置 → 安全 → SIMKey → 生物识别

1. 开启"允许指纹解锁"
2. 验证当前PIN码
3. 扫描指纹
4. 完成

下次登录:
- 直接使用指纹
- 自动解锁SIMKey
- 无需输入PIN码
```

#### 面容ID（部分设备）

```
支持设备:
- 华为 Mate/P系列
- 小米部分旗舰机
- OPPO Find系列
- vivo X系列
```

### PIN码管理

#### 修改PIN码

```
设置 → 安全 → SIMKey → 修改PIN码

1. 输入当前PIN码
2. 输入新PIN码（6-8位）
3. 确认新PIN码
4. 完成
```

#### PIN码错误限制

```
允许错误次数: 5次
剩余次数显示:
✓✓✓✓✓ (5次)
✓✓✓ (3次)
✓ (1次) ⚠️ 最后一次机会
✗ (0次) 🔒 已锁定
```

#### 解锁锁定的SIMKey

```
方式一: PUK码解锁
1. 联系运营商获取PUK码
2. 设置 → SIMKey → 解锁
3. 输入PUK码
4. 重置PIN码

方式二: 使用助记词恢复
1. 准备新SIM卡
2. 使用助记词恢复密钥
3. 写入新SIM卡
```

## 备份与恢复

### 备份方式

#### 助记词备份（推荐）

```
设置 → 安全 → SIMKey → 生成助记词

1. 生成12个助记词（移动端简化版）
2. 手写记录
3. 验证
4. 妥善保存

示例:
apple book cat dog egg fish
girl hat ice joy key lion
```

#### 云端加密备份

```
设置 → 安全 → SIMKey → 云端备份

1. 选择云服务（iCloud/Google Drive）
2. 设置备份密码（强密码）
3. 加密密钥
4. 上传到云端
5. 完成

安全性:
✓ 密钥使用备份密码加密
✓ 云服务商无法解密
✓ 丢失手机可快速恢复
```

#### 跨设备备份

```
PC ← → 手机

设置:
1. 在PC上生成恢复二维码
2. 手机扫描二维码
3. 输入PIN码
4. 密钥通过加密通道同步
5. 写入SIM卡
```

### 恢复密钥

#### 从助记词恢复

```
1. 安装新SIM卡或更换手机
2. 打开ChainlessChain
3. 选择"从助记词恢复"
4. 输入12个助记词
5. 设置新PIN码
6. 密钥写入SIM卡
7. 完成
```

#### 从云端恢复

```
1. 新设备登录云账号
2. 打开ChainlessChain
3. 选择"从云端恢复"
4. 输入备份密码
5. 下载并解密密钥
6. 写入SIM卡
7. 完成
```

## 高级功能

### 双因素认证

```
SIMKey + 生物识别 = 双因素认证

配置:
设置 → 安全 → 双因素认证

选项:
○ 仅SIMKey PIN
● SIMKey PIN + 指纹（推荐）
○ SIMKey PIN + 面容ID
```

### 自动锁定

```
设置 → 安全 → 自动锁定

锁定时机:
□ 应用退到后台
□ 屏幕关闭
□ 闲置5分钟
□ 闲置15分钟
■ 闲置30分钟
```

### 远程锁定

```
场景: 手机丢失

操作:
1. 在PC端登录ChainlessChain
2. 设置 → 设备管理
3. 选择丢失的手机
4. 点击"远程锁定SIMKey"
5. 该手机的SIMKey立即锁定
6. 需要助记词才能解锁
```

## API使用

### Kotlin示例

```kotlin
import com.chainlesschain.simkey.SIMKey

// 初始化
val simkey = SIMKey(context)

// 检查可用性
if (simkey.isAvailable()) {
    // 验证PIN
    simkey.verifyPIN("123456")

    // 签名
    val data = "Hello World".toByteArray()
    val signature = simkey.sign(data)

    // 加密
    val encrypted = simkey.encrypt(data)

    // 解密
    val decrypted = simkey.decrypt(encrypted)
}
```

### React Native示例

```typescript
import { SIMKey } from '@chainlesschain/simkey'

const simkey = new SIMKey()

// 检查兼容性
const isSupported = await simkey.isSupported()

if (isSupported) {
    // 初始化
    await simkey.initialize('123456')

    // 获取公钥
    const publicKey = await simkey.getPublicKey()

    // 签名
    const signature = await simkey.sign(data)
}
```

## 故障排查

### SIM卡无法识别

**检查步骤**:

```
1. 确认SIM卡已插入
2. 重启手机
3. 检查SIM卡状态:
   设置 → SIM卡管理
4. 尝试重新插入SIM卡
5. 联系运营商确认SIM卡类型
```

### OMAPI访问失败

**可能原因**:
- ❌ SIM卡不支持OMAPI
- ❌ 应用未获得权限
- ❌ 系统版本过低（需Android 9+）

**解决方法**:
```
1. 检查Android版本（设置 → 关于手机）
2. 授予应用权限:
   设置 → 应用 → ChainlessChain → 权限
3. 联系运营商更换USIM卡
```

### PIN码验证失败

**常见问题**:
```
1. 输入法干扰
   解决: 使用系统数字键盘

2. PIN码记错
   解决: 仔细回忆或使用PUK码重置

3. SIMKey已锁定
   解决: 使用PUK码或助记词恢复
```

### 性能慢

**优化建议**:
```
1. 清理缓存:
   设置 → SIMKey → 清理缓存

2. 重启Applet:
   设置 → SIMKey → 重启Applet

3. 减少密钥操作频率:
   - 启用会话缓存
   - 延长自动锁定时间
```

## 安全建议

### 保护SIMKey

1. ✅ **强PIN码**: 不使用生日、电话等弱密码
2. ✅ **启用生物识别**: 更方便更安全
3. ✅ **定期备份**: 防止SIM卡损坏
4. ✅ **远程锁定**: 手机丢失立即锁定
5. ✅ **监控异常**: 定期查看登录日志

### 防止丢失

1. ✅ **云备份**: 开启云端加密备份
2. ✅ **助记词**: 妥善保管助记词
3. ✅ **多设备**: 至少有PC端或另一部手机
4. ✅ **定期验证**: 定期测试恢复流程

### SIM卡更换

```
场景: 换手机或换运营商

步骤:
1. 在旧手机导出助记词
2. （可选）云端备份
3. 插入新SIM卡到新手机
4. 安装ChainlessChain
5. 使用助记词恢复
6. 完成
```

## 常见问题

### 换手机需要重新设置吗?

```
不需要：
✓ 使用助记词恢复
✓ 使用云端备份恢复
✓ 使用跨设备同步

但建议:
✓ 换手机前先备份
✓ 验证恢复成功后再擦除旧手机
```

### SIM卡损坏怎么办?

```
如果有备份:
✓ 使用助记词恢复到新SIM卡
✓ 使用云端备份恢复
✓ 使用PC端的U盾登录后重新初始化

如果没有备份:
❌ 无法恢复SIMKey
❌ 无法访问加密数据
```

### 可以在多个SIM卡使用吗?

```
可以：
✓ 主SIM卡（日常使用）
✓ 备用SIM卡（备份）
✓ 不同手机的SIM卡

方法:
1. 使用相同的助记词
2. 在多个SIM卡上恢复密钥
3. 共享相同的DID和密钥
```

### iOS支持情况?

```
目前:
❌ iOS系统限制SIM卡API访问
❌ 无法直接使用SIMKey

替代方案:
✓ 使用蓝牙U盾（YubiKey等）
✓ 使用Face ID + Secure Enclave
✓ 等待iOS系统开放API
```

## 性能对比

### 操作速度

| 操作 | U盾 | SIMKey | 软件模拟 |
|------|-----|--------|----------|
| 初始化 | 30-120秒 | 60-180秒 | <1秒 |
| 签名 | 50-200ms | 200-500ms | 1-10ms |
| 加密 | 50-200ms | 200-500ms | 1-10ms |
| 解密 | 50-200ms | 200-500ms | 1-10ms |

### 电池消耗

```
典型使用（每天100次操作）:
- SIMKey: 额外耗电 < 1%
- 蓝牙U盾: 额外耗电 2-3%
- 软件模拟: 几乎无影响

SIMKey耗电极低，可忽略不计
```

## 未来功能

- [ ] iOS eSIM支持
- [ ] 5G SIM卡优化
- [ ] NFC离线签名
- [ ] 多SIM卡自动切换
- [ ] SIM卡健康监控
- [ ] 量子抗性算法升级
