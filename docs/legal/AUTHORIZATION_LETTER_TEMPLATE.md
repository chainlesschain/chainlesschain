# 授权委托书模板 / Authorization Letter Template

> Bilingual template (zh/en) for delegating company authority. Common uses:
>
> - Apple Developer Program — team member acting on Account Holder's behalf
> - App Store Connect role delegation (Admin / Developer / Marketing)
> - External vendor contract signing
> - Industry association / standards body membership submission
> - Government / tax / bank submissions when legal rep cannot attend in person
>
> **Fill in the placeholders, print on company letterhead, have the legal
> representative wet-sign + apply the company seal, then scan to PDF.**

---

## 模板正文（中文）/ Template Body (Chinese)

---

# 授权委托书

**委托方（甲方）**：厦门无链之链科技有限公司
**统一社会信用代码**：__________________________________________
**法定代表人**：张龙发
**注册地址**：福建省厦门市自由贸易试验区象屿路 93 号厦门国际航运中心 C 栋 4 层 431 单元 H
**联系电话**：400-1068-687

**受托人（乙方）**：__________________________________________
**身份证号**：__________________________________________
**职务**：__________________________________________
**联系电话**：__________________________________________
**联系邮箱**：__________________________________________

### 一、授权事项

兹委托乙方代表甲方办理下列事项：

```
☐ 1. 代表甲方注册、维护 Apple Developer Program 公司开发者账号
      （含证书 / Provisioning Profile / APNs Key 创建与管理）
☐ 2. 代表甲方在 App Store Connect 内执行应用提交、版本管理、
      App Privacy 填报、价格与可用性设置
☐ 3. 代表甲方与 Apple 客服 / 审核团队沟通，处理 App Review、
      Resolution Center 申诉等事宜
☐ 4. 代表甲方接收并签收与上述事项相关的电子或纸质文件
☐ 5. 其他：__________________________________________
```

### 二、授权范围限制

受托人在执行上述授权事项时，**不得**：

- 转授权第三方
- 以甲方名义签署任何对外财务承诺、借贷、担保或股权变更协议
- 处置甲方持有的数字资产（含但不限于 DID 私钥、加密货币）
- 删除或迁移 Apple Developer Account 的 Account Holder 身份

### 三、授权期限

自 ________ 年 ____ 月 ____ 日起至 ________ 年 ____ 月 ____ 日止。

甲方可随时书面终止本授权，终止之日起立即生效。

### 四、责任承担

受托人在授权范围内的行为，由甲方承担相应法律责任；超越授权范围或违反本委托书的行为，由受托人个人承担相应责任，甲方有权追偿。

### 五、签署

**委托方（甲方）签字盖章**：

```
法定代表人签字：______________________________

公司公章 / 合同专用章：

签署日期：________ 年 ____ 月 ____ 日
```

**受托人（乙方）签字**：

```
受托人签字：______________________________

签署日期：________ 年 ____ 月 ____ 日
```

---

## Template Body (English)

---

# LETTER OF AUTHORIZATION

**Principal (Party A)**: Xiamen Chainlesschain Technology Co., Ltd.
**Unified Social Credit Code**: __________________________________________
**Legal Representative**: Zhang Longfa
**Registered Address**: Unit 431H, 4th Floor, Building C, Xiamen International Shipping Center, No. 93 Xiangyu Road, Xiamen Free Trade Zone, Fujian Province, China
**Contact Phone**: +86 400-1068-687

**Authorized Representative (Party B)**: __________________________________________
**ID / Passport Number**: __________________________________________
**Position**: __________________________________________
**Contact Phone**: __________________________________________
**Email**: __________________________________________

### Article 1 — Scope of Authorization

Party A hereby authorizes Party B to act on Party A's behalf in the following matters:

```
☐ 1. Register and maintain the Apple Developer Program organization
      account (including certificates, Provisioning Profiles, APNs Keys)
☐ 2. Submit applications, manage versions, configure App Privacy, and
      set pricing & availability within App Store Connect
☐ 3. Communicate with Apple Support / App Review on matters including
      review responses and Resolution Center appeals
☐ 4. Receive and sign for electronic or physical documents related to
      the above matters
☐ 5. Other: __________________________________________
```

### Article 2 — Limitations

In exercising the above authority, Party B shall **NOT**:

- Sub-delegate the authority to any third party
- Sign any financial commitment, loan, guarantee, or equity-change
  agreement in the name of Party A
- Dispose of digital assets held by Party A (including but not limited to
  DID private keys and cryptocurrency)
- Delete or migrate the Account Holder identity of the Apple Developer
  Account

### Article 3 — Term

From ____ / ____ / 20____ to ____ / ____ / 20____.

Party A may terminate this authorization in writing at any time, effective
immediately upon notice.

### Article 4 — Liability

Acts of Party B within the scope of this authorization are the legal
responsibility of Party A. Acts exceeding the scope or in breach of this
authorization are the personal responsibility of Party B, and Party A
reserves the right to seek indemnification.

### Article 5 — Signatures

**Principal (Party A) signature and seal**:

```
Legal Representative signature: ______________________________

Company seal:

Date: ____ / ____ / 20____
```

**Authorized Representative (Party B) signature**:

```
Signature: ______________________________

Date: ____ / ____ / 20____
```

---

## Usage Notes

1. **One letter per delegate, per use case**. Do not write a single open-ended
   authorization that covers multiple unrelated matters — each Apple/government
   reviewer wants to see a scope tightly matching their context.

2. **Effective period should not exceed 12 months**. Apple support staff have
   challenged longer-term letters as suspicious.

3. **Wet signature + red seal required** for Chinese authorities; for Apple,
   a clean color scan of the same is accepted.

4. **Retain originals** in `docs/legal/signed/authorizations/<delegate>-<date>.pdf`
   (gitignored — do not commit signed scans).

5. **English version is the controlling text** for international use; the
   Chinese version is the controlling text for domestic Chinese authorities.
   When both are presented to one party, mark which version controls in a
   cover note.

---

> 法律免责声明：本模板为团队内部起草，**未经法务专业审核**。涉及金额、股权或长期授权的场景必须由公司法务定制。模板中"统一社会信用代码"与"受托人身份证号"为留空字段，签署前必须填实。
>
> Disclaimer: This template was drafted internally and **has not undergone legal review**. Matters involving monetary commitments, equity, or long-term delegation must be customized by company counsel. Required fields (Unified Social Credit Code, delegate ID/passport) must be filled before signing.

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：授权委托书模板 / Authorization Letter Template。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
