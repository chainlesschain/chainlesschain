# 设备激活

设备激活是用户首次使用U盾或SIMKey时的必要步骤，将设备与用户账户绑定。

## 激活方式

### 1. 在线激活（推荐）

用户通过ChainlessChain应用在线激活设备。

#### 用户操作流程

```
1. 插入U盾 / 插入SIM卡
2. 打开ChainlessChain应用
3. 选择"激活设备"
4. 输入激活码（设备包装上）
5. 设置PIN码
6. 完成激活
```

#### 系统处理流程

```
1. 验证激活码有效性
2. 检查设备序列号
3. 验证设备未被激活
4. 生成设备密钥对
5. 将设备绑定到用户账户
6. 更新设备状态为"已激活"
7. 记录激活日志
8. 返回激活成功
```

### 2. 离线激活

无网络环境下的激活方式。

#### 生成离线激活包

```
厂家管理系统:
设备管理 → 选择设备 → 离线激活 → 生成激活包

输入信息:
- 用户ID: user123
- 有效期: 30天

下载: activation_pack_UP2024010100001.bin
```

#### 用户离线激活

```
1. 获取激活包文件
2. 打开ChainlessChain应用
3. 选择"离线激活"
4. 导入激活包文件
5. 设置PIN码
6. 完成激活
```

### 3. 批量预激活

企业批量采购时，可以预激活设备。

```
厂家管理系统:
设备管理 → 批量激活

上传用户列表:
用户ID    | 设备序列号
----------|------------------
user001   | UP2024010100001
user002   | UP2024010100002
...

确认批量激活 → 生成激活记录
```

## 激活码管理

### 激活码格式

```
格式: XXXX-XXXX-XXXX-XXXX (16位)
示例: A3F9-2B4C-7D1E-9K8M

组成:
- 设备标识: 4位
- 批次信息: 4位
- 校验码: 4位
- 随机码: 4位
```

### 生成激活码

```typescript
function generateActivationCode(serialNumber: string): string {
  // 1. 从序列号提取信息
  const deviceHash = hash(serialNumber).substr(0, 4);
  const batchInfo = serialNumber.substr(2, 6).substr(0, 4);

  // 2. 生成随机码
  const randomCode = generateRandomString(4);

  // 3. 计算校验码
  const checksum = calculateChecksum(deviceHash + batchInfo + randomCode);

  // 4. 组合激活码
  return `${deviceHash}-${batchInfo}-${checksum}-${randomCode}`;
}
```

### 激活码验证

```typescript
function validateActivationCode(code: string, serialNumber: string): boolean {
  // 1. 格式检查
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    return false;
  }

  // 2. 提取各部分
  const parts = code.split("-");
  const [deviceHash, batchInfo, checksum, randomCode] = parts;

  // 3. 验证校验码
  const expectedChecksum = calculateChecksum(
    deviceHash + batchInfo + randomCode,
  );
  if (checksum !== expectedChecksum) {
    return false;
  }

  // 4. 验证设备匹配
  const expectedDeviceHash = hash(serialNumber).substr(0, 4);
  if (deviceHash !== expectedDeviceHash) {
    return false;
  }

  return true;
}
```

### 激活码状态

| 状态   | 说明           | 可用性    |
| ------ | -------------- | --------- |
| 未使用 | 刚生成，未激活 | ✅ 可用   |
| 已使用 | 已完成激活     | ❌ 不可用 |
| 已过期 | 超过有效期     | ❌ 不可用 |
| 已作废 | 手动作废       | ❌ 不可用 |

## 激活验证

### 设备验证

```
验证项目:
1. 序列号存在性检查
2. 设备状态检查（必须是"已注册"或"已发货"）
3. 激活码有效性检查
4. 设备型号兼容性检查
5. 固件版本检查
```

### 用户验证

```
验证项目:
1. 用户账户存在性
2. 用户状态（必须是"正常"）
3. 设备数量限制（每用户最多绑定设备数）
4. 地理位置限制（可选）
5. 企业授权检查（企业版）
```

### 安全验证

```
验证项目:
1. 设备证书验证
2. 硬件唯一性验证
3. 防克隆检测
4. 时间戳验证
5. 签名验证
```

## 激活限制

### 时间限制

```json
{
  "activationPolicy": {
    "expiryDays": 365,
    "gracePeriod": 30,
    "autoExpire": true
  }
}
```

- **有效期**: 激活码365天内有效
- **宽限期**: 过期后30天宽限期
- **自动过期**: 超过宽限期自动作废

### 次数限制

```json
{
  "activationPolicy": {
    "maxAttempts": 5,
    "lockoutDuration": 3600,
    "resetOnSuccess": true
  }
}
```

- **最大尝试次数**: 5次
- **锁定时长**: 1小时
- **成功后重置**: 激活成功后计数器重置

### 设备限制

```json
{
  "devicePolicy": {
    "maxDevicesPerUser": 5,
    "allowMultipleActivations": false,
    "requireUniqueDevice": true
  }
}
```

- **每用户最大设备数**: 5个
- **允许多次激活**: 否
- **要求设备唯一**: 是

## 激活状态监控

### 实时状态

```
仪表盘 → 激活监控

实时统计:
┌─────────────────────────────┐
│ 今日激活: 123               │
│ 成功率: 98.5%               │
│ 失败数: 2                   │
│ 平均耗时: 3.2秒             │
└─────────────────────────────┘

激活趋势:
[折线图: 显示24小时内的激活量]

失败原因分布:
- 激活码无效: 45%
- 设备未注册: 30%
- 网络超时: 15%
- 其他: 10%
```

### 告警设置

```
系统设置 → 告警配置 → 激活告警

告警条件:
□ 激活失败率 > 5%
☑ 单日激活数 < 10
☑ 异常激活模式检测
□ 激活耗时 > 10秒

通知方式:
☑ 邮件
☑ 短信
□ 钉钉
□ 企业微信
```

## 激活日志

### 日志记录

每次激活尝试都会记录：

```json
{
  "activationLog": {
    "id": "log-20240101-001",
    "timestamp": "2024-01-01T10:30:00Z",
    "deviceSerialNumber": "UP2024010100001",
    "userId": "user123",
    "activationCode": "A3F9-****-****-9K8M",
    "ipAddress": "192.168.1.100",
    "userAgent": "ChainlessChain/1.0.0 (Windows)",
    "result": "success",
    "duration": 3200,
    "errorCode": null,
    "errorMessage": null
  }
}
```

### 日志查询

```
设备管理 → 激活日志

筛选条件:
- 时间范围: 最近7天
- 结果: 全部 / 成功 / 失败
- 设备序列号: UP2024010100001
- 用户ID: user123

导出日志: Excel / CSV / JSON
```

### 日志分析

```sql
-- 激活成功率统计
SELECT
    DATE(timestamp) as date,
    COUNT(*) as total,
    SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success_count,
    ROUND(SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate
FROM activation_logs
WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC
```

## 激活失败处理

### 常见失败原因

| 错误码 | 错误信息     | 原因                   | 解决方法               |
| ------ | ------------ | ---------------------- | ---------------------- |
| 1001   | 激活码无效   | 激活码格式错误或已使用 | 检查激活码，或重新获取 |
| 1002   | 设备未注册   | 设备序列号不存在       | 联系厂商注册设备       |
| 1003   | 设备已激活   | 该设备已被激活         | 如需重新激活，先解绑   |
| 1004   | 激活码过期   | 超过有效期             | 联系厂商重新生成       |
| 1005   | 用户不存在   | 用户账户不存在         | 先注册用户账户         |
| 1006   | 达到设备上限 | 用户设备数已达上限     | 解绑旧设备或升级配额   |
| 1007   | 网络错误     | 网络连接失败           | 检查网络连接           |
| 1008   | 服务器错误   | 服务器内部错误         | 稍后重试或联系技术支持 |

### 重试机制

```typescript
async function activateDeviceWithRetry(
  serialNumber: string,
  activationCode: string,
  maxRetries: number = 3,
): Promise<ActivationResult> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await activateDevice(serialNumber, activationCode);
      if (result.success) {
        return result;
      }

      // 可重试的错误
      if (result.errorCode === 1007) {
        // 网络错误
        await sleep(Math.pow(2, i) * 1000); // 指数退避
        continue;
      }

      // 不可重试的错误
      return result;
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}
```

## 激活后配置

### 初始化设置

激活成功后，系统会引导用户完成初始配置：

```
1. 设置PIN码
   - 长度: 6-16位
   - 复杂度: 数字+字母
   - 确认PIN码

2. 生成密钥对
   - 算法: RSA-4096 / Ed25519
   - 进度显示
   - 大约需要 1-2分钟

3. 备份助记词
   - 生成24个助记词
   - 用户抄写备份
   - 验证备份

4. 完成设置
   - 设备绑定成功
   - 进入主界面
```

### 设备信息同步

```
激活成功后同步到厂家系统:
- 激活时间
- 用户ID（加密）
- 设备状态: 已激活
- 地理位置（可选）
- 应用版本
```

## API接口

### 在线激活

```http
POST /api/v1/devices/activate
Content-Type: application/json

{
  "serialNumber": "UP2024010100001",
  "activationCode": "A3F9-2B4C-7D1E-9K8M",
  "userId": "user123",
  "pin": "********"
}
```

响应：

```json
{
  "code": 0,
  "message": "激活成功",
  "data": {
    "deviceId": "d7f3e8a1-4b2c-4d9e-8f1a-2b3c4d5e6f7a",
    "activatedAt": "2024-01-01T10:30:00Z",
    "expiresAt": "2025-01-01T10:30:00Z",
    "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
  }
}
```

### 验证激活状态

```http
GET /api/v1/devices/{serialNumber}/activation-status
Authorization: Bearer {token}
```

响应：

```json
{
  "code": 0,
  "data": {
    "serialNumber": "UP2024010100001",
    "status": "已激活",
    "activatedAt": "2024-01-01T10:30:00Z",
    "userId": "user123",
    "expiresAt": "2025-01-01T10:30:00Z",
    "lastUsedAt": "2024-01-15T08:20:00Z"
  }
}
```

## 常见问题

### 激活码在哪里？

激活码位置：

1. 设备包装盒上的标签
2. 设备说明书
3. 厂商提供的激活凭证
4. 企业批量采购由管理员分配

### 可以在多个设备上激活吗？

不可以。一个U盾/SIMKey只能激活一次，绑定到一个用户账户。如需更换设备，需要先解绑。

### 激活失败怎么办？

1. 检查激活码是否正确
2. 确认设备序列号匹配
3. 检查网络连接
4. 尝试重启应用
5. 联系技术支持

### 如何重新激活？

```
1. 解绑设备
   设备管理 → 选择设备 → 解绑

2. 重新生成激活码
   设备管理 → 选择设备 → 生成新激活码

3. 用户重新激活
   使用新激活码激活
```

## 最佳实践

1. ✅ **及时激活**: 收到设备后尽快激活
2. ✅ **妥善保管激活码**: 激活码不要分享给他人
3. ✅ **备份助记词**: 激活后立即备份助记词
4. ✅ **设置强PIN码**: 使用复杂的PIN码
5. ✅ **监控激活**: 定期检查异常激活

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「激活方式」。设备激活模块通过激活码把设备绑定到用户，支持在线 / 离线 / 批量预激活三种方式，含激活码管理、激活验证与激活限制。

### 2. 核心特性

- 三种激活方式：在线（推荐）/ 离线激活包 / 批量预激活
- 激活码生成 / 验证 / 状态管理
- 激活限制：时间 / 次数 / 设备绑定
- 多重激活验证（设备 / 用户 / 安全）

### 3. 系统架构

```
用户端 ──激活码──► 前端（设备激活页）
                      │  REST /api/v1/devices/{id}/activate
                      ▼
              后端（Spring Boot + JWT）→ 校验激活码 + 限制
                      ▼
              MySQL（activation_codes / devices）→ 绑定用户 + 置「已激活」
```

### 4. 系统定位

厂家管理系统的**设备-用户绑定关口**，是设备从「未激活」进入「已激活」生命周期的唯一入口。

### 5. 核心功能

| 功能       | 说明                                     |
| ---------- | ---------------------------------------- |
| 在线激活   | 用户输码 → 后端校验 → 绑定               |
| 离线激活   | 生成离线激活包，无网环境激活             |
| 批量预激活 | 出厂前批量预绑定                         |
| 激活码管理 | 生成 / 验证 / 状态（未用 / 已用 / 失效） |
| 激活限制   | 时间窗 / 次数 / 设备数                   |

### 6. 技术架构

后端 Spring Boot 3.2.1 + MyBatis Plus；激活码存 `activation_codes`，设备状态存 `devices`；设备管理 API（含 activate）10 接口；激活码格式 + 校验规则见正文「激活码管理」。

### 7. 系统特点

- 激活码一次性 / 限次防滥用
- 时间 + 次数 + 设备三重限制
- 离线激活包支持无网环境

### 8. 应用场景

经销商激活分发给终端用户；出厂批量预激活；售后解绑后重新激活（见正文「如何重新激活」）。

### 9. 竞品对比

| 维度              | 本模块         | 手工绑定 |
| ----------------- | -------------- | -------- |
| 激活码限次 / 限时 | ✅             | ❌       |
| 离线激活          | ✅             | ⚠️       |
| 批量预激活        | ✅             | ❌       |
| 激活审计          | ✅ device_logs | ❌       |

### 10. 配置参考

激活码有效期 / 次数 / 设备限制在生成时配置（见正文「激活限制」）；离线激活包生成参数见正文「生成离线激活包」。部署见 [安装部署](/manufacturer/installation)。

### 11. 性能指标

在线激活为轻量校验 + 绑定（秒级）；批量预激活按批处理；激活码校验可经 Redis 缓存加速。

### 12. 测试覆盖

激活码生成 / 校验 / 限次 / 过期、在线 / 离线 / 批量激活路径、设备状态流转由后端集成测试覆盖。

### 13. 安全考虑

- 激活码不可分享（见正文「最佳实践」）
- 激活需 JWT；批量 / 离线包生成需 ADMIN / DEALER 权限
- 设备 / 用户 / 安全三重验证（见正文「激活验证」）
- 所有激活操作写 `device_logs` 审计

### 14. 故障排除

见正文「常见问题」与「如何重新激活」。补充：

| 症状           | 可能原因             | 处理             |
| -------------- | -------------------- | ---------------- |
| 激活码无效     | 已用 / 过期 / 超次数 | 生成新激活码     |
| 激活失败       | 网络 / 设备已绑定    | 检查网络；先解绑 |
| 离线激活包失效 | 超时间限制           | 重新生成离线包   |

### 15. 关键文件

| 资源                         | 说明                   |
| ---------------------------- | ---------------------- |
| `activation_codes` 表        | 激活码 / 状态 / 限制   |
| `devices` 表                 | 设备状态 / 绑定用户    |
| `/api/v1/devices/*/activate` | 激活 REST API          |
| 前端「设备激活」页           | 在线 / 离线 / 批量界面 |

### 16. 使用示例

见正文「在线激活 → 用户操作流程」。重新激活见正文「如何重新激活」（解绑 → 生成新码 → 重新激活）。

### 17. 相关文档

- [设备注册](/manufacturer/device-register)
- [设备管理](/manufacturer/device-manage)
- [厂家管理系统概述](/manufacturer/overview)
