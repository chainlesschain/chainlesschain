"use strict";

import { describe, expect, it } from "vitest";

const {
  EmailAdapter,
  AlipayBillAdapter,
  WechatAdapter,
  WpsDocAdapter,
  TencentDocsAdapter,
  BaiduNetdiskAdapter,
  CamScannerDocAdapter,
  MercedesMeAdapter,
  IXiamenAdapter,
  MeiyouAdapter,
  DianpingAdapter,
  ElemeAdapter,
  JdAdapter,
  MeituanAdapter,
  PinduoduoAdapter,
  TaobaoAdapter,
  VipshopAdapter,
  XianyuAdapter,
  ZhihuAdapter,
  Train12306Adapter,
  CtripAdapter,
  DidiAdapter,
  DidiConsumerAdapter,
  TongchengAdapter,
  createAccountScopeFromSnapshot,
} = require("../lib");

describe("account-backed adapter default scopes", () => {
  it("isolates email accounts while preserving case-insensitive identity", () => {
    const first = new EmailAdapter({
      account: {
        provider: "qq",
        email: "User@Example.com",
        authCode: "secret",
      },
    });
    const sameAccount = new EmailAdapter({
      account: {
        provider: "qq",
        email: "user@example.COM",
        authCode: "rotated-secret",
      },
    });
    const otherAccount = new EmailAdapter({
      account: {
        provider: "qq",
        email: "other@example.com",
        authCode: "secret",
      },
    });

    expect(first.defaultScope).toBe(sameAccount.defaultScope);
    expect(first.defaultScope).not.toBe(otherAccount.defaultScope);
    expect(first.defaultScope).not.toContain("user@example.com");
    expect(
      new EmailAdapter({ snapshotMode: true }).defaultScope,
    ).toBeUndefined();
  });

  it("isolates Alipay and WeChat accounts", () => {
    const alipayA = new AlipayBillAdapter({
      account: { email: "a@example.com" },
    });
    const alipayB = new AlipayBillAdapter({
      account: { email: "b@example.com" },
    });
    const wechatA = new WechatAdapter({ account: { uin: "10001" } });
    const wechatB = new WechatAdapter({ account: { uin: "10002" } });

    expect(alipayA.defaultScope).not.toBe(alipayB.defaultScope);
    expect(wechatA.defaultScope).not.toBe(wechatB.defaultScope);
    expect(alipayA.defaultScope).not.toBe(wechatA.defaultScope);
  });

  it("maps embedded snapshot identities to the same scope as live adapters", () => {
    const emailSnapshot = new EmailAdapter({ snapshotMode: true });
    const liveEmail = new EmailAdapter({
      account: {
        provider: "qq",
        email: "user@example.com",
        authCode: "secret",
      },
    });
    const liveTaobao = new TaobaoAdapter({
      account: { userId: "taobao-user" },
    });

    expect(
      createAccountScopeFromSnapshot(
        emailSnapshot.name,
        { user: "User@Example.com" },
        {
          identityFields: emailSnapshot.snapshotScopeIdentityFields,
          topLevelFields: emailSnapshot.snapshotScopeTopLevelFields,
          includeField: emailSnapshot.snapshotScopeIdentityIncludesField,
        },
      ),
    ).toBe(liveEmail.defaultScope);
    expect(
      createAccountScopeFromSnapshot(liveTaobao.name, {
        account: { userId: "taobao-user" },
      }),
    ).toBe(liveTaobao.defaultScope);
  });

  it.each([
    ["WPS docs", WpsDocAdapter, "userId"],
    ["Tencent docs", TencentDocsAdapter, "userId"],
    ["Baidu Netdisk", BaiduNetdiskAdapter, "userId"],
    ["CamScanner", CamScannerDocAdapter, "userId"],
    ["Mercedes me", MercedesMeAdapter, "userId"],
    ["iXiamen", IXiamenAdapter, "userId"],
    ["Meiyou", MeiyouAdapter, "userId"],
    ["Dianping", DianpingAdapter, "userId"],
    ["Eleme", ElemeAdapter, "userId"],
    ["JD", JdAdapter, "pin"],
    ["Meituan", MeituanAdapter, "userId"],
    ["Pinduoduo", PinduoduoAdapter, "uid"],
    ["Taobao", TaobaoAdapter, "userId"],
    ["Vipshop", VipshopAdapter, "userId"],
    ["Xianyu", XianyuAdapter, "userId"],
    ["Zhihu", ZhihuAdapter, "urlToken"],
    ["12306", Train12306Adapter, "username"],
    ["Ctrip", CtripAdapter, "email"],
    ["Didi enterprise", DidiAdapter, "email"],
    ["Didi consumer", DidiConsumerAdapter, "phone"],
    ["Tongcheng", TongchengAdapter, "email"],
  ])("%s isolates its live account cursor", (_label, Adapter, field) => {
    const first = new Adapter({ account: { [field]: "account-a" } });
    const second = new Adapter({ account: { [field]: "account-b" } });
    const snapshotOnly = new Adapter();

    expect(first.defaultScope).toMatch(
      new RegExp(`^account:${first.name}:[a-f0-9]{32}$`),
    );
    expect(first.defaultScope).not.toBe(second.defaultScope);
    expect(first.defaultScope).not.toContain("account-a");
    expect(snapshotOnly.defaultScope).toBeUndefined();
  });
});
