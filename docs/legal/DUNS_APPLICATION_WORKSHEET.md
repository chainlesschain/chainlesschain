# D-U-N-S Application Worksheet — ChainlessChain

> Pre-filled worksheet for Apple's free D-U-N-S lookup / application flow.
> Open https://developer.apple.com/enroll/duns-lookup/ in a separate tab,
> then copy values from this sheet field-by-field.

**Prepared**: 2026-05-16
**Applicant**: 张龙发 (Zhang Longfa), Legal Representative

---

## ⚠️ Before You Click "Apply"

### Critical decision: which Apple ID owns the account?

The Apple ID you sign in with at the D-U-N-S lookup step becomes the **permanent owner ("Account Holder")** of the future Apple Developer Program enrollment.

- ✅ **Recommended**: Create a new dedicated Apple ID like `dev@chainlesschain.com` or `apple@chainlesschain.com` — this email must be a **mailbox you control on your own domain**, NOT a free webmail
- ❌ **Avoid**: Using your personal Apple ID (icloud.com, qq.com, etc.) — migrating it to a different Apple ID later is a multi-week support ticket
- ❌ **Avoid**: Using `zhanglongfa@chainlesschain.com` if that mailbox is shared or used personally — once bound, all certificate downloads, push key generation, and bank disbursements go through this single account

**Action**:
- [ ] Register `apple@chainlesschain.com` (or similar) on the company mail server first
- [ ] Create a new Apple ID with that email at https://appleid.apple.com/
- [ ] Enable 2FA with a company-owned phone number (the Apple Developer Program enrollment phone call will use this)
- [ ] Then return here

---

## Section 1: Legal Entity Identification

| Field | Value |
|-------|-------|
| Legal Entity Name (English) | `Xiamen Chainlesschain Technology Co., Ltd.` |
| Legal Entity Name (Local Script — 中文) | `厦门无链之链科技有限公司` |
| DBA / Trade Name (optional) | `ChainlessChain` |
| Country / Region | `China` |
| Year established | `2020` |
| Entity Type | `Corporation / 有限责任公司` |
| Tax ID / Registration Number | _(fill from 营业执照 统一社会信用代码, 18-digit)_ |

> The 营业执照 English name must match exactly. If the license has only a Chinese name, use the **same English name as 备案 / 商标 / 银行账户**. Apple cross-checks across systems.

---

## Section 2: Registered Business Address

| Field | Value |
|-------|-------|
| Street Address (Line 1, English) | `Unit 431H, 4th Floor, Building C, Xiamen International Shipping Center` |
| Street Address (Line 2, English) | `No. 93 Xiangyu Road, Xiamen Free Trade Zone` |
| Street Address (Local — 中文) | `福建省厦门市自由贸易试验区象屿路93号厦门国际航运中心C栋4层431单元H` |
| City | `Xiamen / 厦门市` |
| State / Province | `Fujian / 福建省` |
| Postal Code | `361000` |
| Country | `China` |

> Address must match what's printed on the 营业执照. If you've moved since registration without updating the license, **update the license first** — D-U-N-S audit will catch this.

---

## Section 3: Contact Information

| Field | Value |
|-------|-------|
| Headquarters Phone | `+86 400-1068-687` |
| Website URL | `https://www.chainlesschain.com` |
| Main Business Email | `contact@chainlesschain.com` _(or substitute reachable mailbox)_ |

---

## Section 4: Applicant / Verification Contact

This is the person Apple will call back to verify the company. Apple **will call in English** (sometimes Mandarin available on request). Must be reachable during US business hours **and** China hours.

| Field | Value |
|-------|-------|
| First Name | `Longfa` |
| Last Name | `Zhang` |
| Title (English) | `Legal Representative` _(or `Chief Executive Officer` — must match what you'll tell the audit caller)_ |
| Title (Chinese) | `法定代表人` |
| Email | `apple@chainlesschain.com` _(create this mailbox first — see top)_ |
| Direct Phone | _(personal mobile or office direct line, must be reachable)_ |

---

## Section 5: Business Details (Apple's optional fields)

| Field | Value |
|-------|-------|
| Number of Employees | _(fill exact headcount, even "1-5" is fine)_ |
| Annual Revenue | _(can leave blank or "Confidential")_ |
| Primary Industry | `Software Publishers (NAICS 511210)` or `Computer Software Development` |
| Description of Business | `Decentralized personal AI management software for iOS, Android, and desktop. P2P end-to-end encrypted knowledge base, social network, and digital identity (DID).` |

---

## Section 6: Document Upload (sometimes requested)

D-U-N-S audit **may** request supporting documents. Have these PDFs ready before submitting:

- [ ] 营业执照副本 PDF (clear scan, recent)
- [ ] 法定代表人身份证正反面 PDF
- [ ] ICP 备案截图 (闽 ICP 备 2025105973 号-1)
- [ ] Optional: company bank statement or utility bill at registered address

> Don't pre-upload unless asked. If asked, respond within 48 hours — slow responses extend the timeline by 1-2 weeks.

---

## Section 7: What Happens After Submit

```
T+0      Submit Apple's D-U-N-S lookup form
T+1-3d   Email confirmation from Apple "D-U-N-S Number Request Received"
T+3-15d  Dun & Bradstreet may call to verify (English; have someone bilingual ready)
T+5-15d  Email "Your D-U-N-S Number is XXXXXXXXX" arrives
T+15d+   D-U-N-S number propagates to Apple's enrollment system
         (usually 24h after D&B issues; can take up to 1 week)
T+~3wk   Now proceed to Apple Developer Program enrollment ($99)
T+~4wk   Apple's enrollment verification call (English, 5-15 min)
T+~5wk   Account active → certificate generation, App Store Connect access
```

**Typical Chinese-company timeline**: 4-6 weeks D-U-N-S submission → active developer account.

---

## Section 8: Common Rejection Reasons (defensive)

1. **Address mismatch** — D-U-N-S form says 象屿路93号, 营业执照 says different. Fix the license, don't lie on the form.
2. **English name drift** — D-U-N-S "Xiamen Chainlesschain", 备案 "Xiamen Chainless Chain", trademark "ChainlessChain". Standardize **before** submitting.
3. **Unreachable phone** — 400 number forwards to closed line during audit window.
4. **Personal email** — `zhanglongfa@gmail.com` as company contact. Use `@chainlesschain.com`.
5. **Auditor can't reach a person who speaks English** — at least one human at the verification phone must handle a 5-minute English call about company basics (name, address, business description).

---

## Section 9: Track Status

D-U-N-S lookup status URL (once submitted, Apple emails the link):
- Apple Developer enrollment dashboard: https://developer.apple.com/account/

Status fields to track in this doc once submitted:

```
Submitted (UTC):        ____________________
Apple confirmation #:   ____________________
D&B audit call (UTC):   ____________________
D-U-N-S issued:         ____________________
Enrollment phase start: ____________________
Enrollment complete:    ____________________
```

---

## Appendix A: English Name Standardization

Previous internal drafts used inconsistent English names. **Standardized name**
(per business license — confirmed by Account Holder 2026-05-16):

> `Xiamen Chainlesschain Technology Co., Ltd.`

Use this exact spelling in:
- D-U-N-S application (this worksheet)
- Apple Developer Program enrollment
- App Store Connect "Legal Entity Name"
- All future legal documents, contracts, partnership agreements

Already corrected in this commit:
- `docs/legal/PRIVACY_POLICY.md` — 2 EN occurrences
- `docs/legal/TERMS_OF_SERVICE.md` — 2 EN occurrences

Other surfaces to audit later (out of scope for this commit):
- `docs-website-v2/` — currently inconsistent (header uses "Chainlesschain",
  some footers use Chinese only). Sweep before website re-deploy.
