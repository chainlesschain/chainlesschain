package com.chainlesschain.android.pdh.social.douyin

import android.webkit.JavascriptInterface
import timber.log.Timber
import java.util.concurrent.atomic.AtomicReference

/**
 * 2026-05-25 — 复刻 [BilibiliJsBridge] 同套路径给抖音。详 memory
 * `bilibili_in_webview_prefetch_architecture.md`。OkHttp 调 douyin.com web API
 * 风险面同 b 站（TLS 指纹 + JS-set anti-bot cookie + 加 `_signature` 客户端签名
 * 风控更严）→ 唯一稳路是 www.douyin.com 登录用 WebView 内 evaluateJavascript 跑
 * fetch + JavascriptInterface bridge 回 Kotlin。
 *
 * 关键差异（vs Bilibili）：
 *   - 抖音 v0.3 端点要求 `_signature` query param 客户端签 — WebView 内 fetch
 *     **不自动签**（页面自己的 axios/XHR 被 monkey-patch 了 sig 注入，但我们的
 *     裸 fetch 绕开）。MVP 先只拿 profile（account/info/v2）— 该端点弱签名/容签名
 *     失败，能拿 sec_user_id + 基本资料数。其它 (history/favourite/like) v1 端通过
 *     调 `window.byted_acrawler?.sign?.()` 在 WebView 内借页面 sig 工具，本 v0 仅
 *     profile 一道 — 至少证明架构通了
 *   - JavascriptInterface 名 `DouyinBridge`（与 `BilibiliBridge` 隔离），AtomicRef
 *     pendingCallback 同模式
 *   - PREFETCH_JS schema 必须跟 [DouyinLocalCollector] `root` JSON 完全同 shape
 *     (schemaVersion=1, account.secUid, events:[{kind:'profile'|'history'|...}])
 */
object DouyinJsBridge {
    private val pendingCallback = AtomicReference<((String?) -> Unit)?>(null)

    fun setPending(callback: (String?) -> Unit) {
        pendingCallback.set(callback)
    }

    fun clearPending() {
        pendingCallback.set(null)
    }

    @JavascriptInterface
    fun onSyncData(json: String) {
        Timber.i("DouyinJsBridge: onSyncData received len=%d", json.length)
        val cb = pendingCallback.getAndSet(null) ?: run {
            Timber.w("DouyinJsBridge: onSyncData but no pending callback")
            return
        }
        cb(json)
    }

    @JavascriptInterface
    fun onSyncError(message: String) {
        Timber.w("DouyinJsBridge: onSyncError msg=%s", message)
        val cb = pendingCallback.getAndSet(null) ?: return
        cb(null)
    }

    /**
     * v0 抖音 prefetch JS — MVP 只拿 profile。其它 3 端 (history/favourite/like)
     * 试 `window.byted_acrawler?.sign?.(url)` 拼签名 — 拿不到就 _debug 留痕跳过。
     *
     * 返 JSON 跟 [DouyinLocalCollector.snapshot] root 同 shape：schemaVersion=1,
     * account.{secUid, storedSecUid: null, nickname, ...}, events:[{kind, id, ...}]。
     *
     * 用 `credentials:'include'` 自动带全 cookie (含 OkHttp 拿不到的 _uuid /
     * msToken / passport_csrf_token 等 JS-set anti-bot cookie)。
     */
    const val PREFETCH_JS: String = """
(async () => {
  try {
    const SCHEMA = 1;
    const now = Date.now();
    const events = [];
    const debug = [];

    const tryJson = async (url) => {
      const shortUrl = url.length > 80 ? url.slice(0, 80) + '…' : url;
      try {
        const r = await fetch(url, {credentials:'include', mode:'cors'});
        const txt = await r.text();
        debug.push({u: shortUrl, e: 'fetch', s: r.status, l: txt.length, head: txt.slice(0, 500)});
        if (r.ok) {
          try { return JSON.parse(txt); } catch (e) {}
        }
      } catch (e) {
        debug.push({u: shortUrl, e: 'fetch', err: String(e).slice(0, 80)});
      }
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.withCredentials = true;
        xhr.send();
        const txt = xhr.responseText || '';
        debug.push({u: shortUrl, e: 'xhr', s: xhr.status, l: txt.length, head: txt.slice(0, 500)});
        if (xhr.status >= 200 && xhr.status < 300) {
          try { return JSON.parse(txt); } catch (e) {}
        }
      } catch (e) {
        debug.push({u: shortUrl, e: 'xhr', err: String(e).slice(0, 80)});
      }
      return null;
    };

    // 借页面 byted_acrawler 给 url 加 _signature (运气好命中)
    const signUrl = (url) => {
      try {
        const sig = (window.byted_acrawler && window.byted_acrawler.sign && window.byted_acrawler.sign(url))
                 || (window._0x32d839 && typeof window._0x32d839 === 'function' && window._0x32d839(url))
                 || null;
        if (sig) {
          return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_signature=' + encodeURIComponent(sig);
        }
      } catch (e) {
        debug.push({u: 'signUrl-err', err: String(e).slice(0, 80)});
      }
      return url;
    };

    // v2 sec_uid 抓取策略 — 抖音 passport/account/info/v2 端点需 _signature
    // 客户端签名 (window.byted_acrawler.sign)；登录页 `/?showLogin=1` 不加载
    // 该 sdk（hasAcrawler=false）→ 返 HTML 首页不是 JSON。
    //
    // 替代方案：fetch `/user/self` → 抖音 302 跳 `/user/<sec_uid>`。XHR 同源
    // 后 `xhr.responseURL` 拿最终 URL，正则抠出 sec_uid。**不需要签名**。
    let secUid = null, nickname = '', shortId = null;
    // v4: fetch 跟 302 (r.url 拿最终 URL) + 兜底从 HTML 全文搜 sec_uid pattern
    try {
      const r = await fetch('https://www.douyin.com/user/self', {
        credentials: 'include', redirect: 'follow'
      });
      const finalUrl = r.url || '';
      const txt = await r.text();
      const urlMatch = finalUrl.match(/\/user\/([A-Za-z0-9_-]{10,})/);
      if (urlMatch) secUid = urlMatch[1];
      // 全文搜 `MS4wLjABAAAA<rest>` (抖音 sec_uid 标准前缀) 或带键名的 JSON 模式
      if (!secUid) {
        const m1 = txt.match(/(MS4wLjAB[A-Za-z0-9_-]{20,})/);
        const m2 = txt.match(/"sec_user_id"\s*:\s*"([^"\\]+)"/);
        const m3 = txt.match(/"sec_uid"\s*:\s*"([^"\\]+)"/);
        const m4 = txt.match(/"secUid"\s*:\s*"([^"\\]+)"/);
        secUid = (m1 && m1[1]) || (m2 && m2[1]) || (m3 && m3[1]) || (m4 && m4[1]) || null;
      }
      const nickMatch = txt.match(/"nickname"\s*:\s*"([^"\\]{1,60})"/);
      if (nickMatch) nickname = nickMatch[1];
      // diagnostic: 找 body 里所有含 "sec" 的小段（最多 5 段 × 60 字）暴露真实 shape
      const secSnippets = [];
      const re = /.{0,30}sec[a-zA-Z_]{0,12}.{0,30}/g;
      let mm;
      let cnt = 0;
      while ((mm = re.exec(txt)) !== null && cnt < 5) {
        secSnippets.push(mm[0].replace(/\s+/g, ' '));
        cnt++;
      }
      debug.push({u: '/user/self', e: 'fetch-redirect', s: r.status, l: txt.length,
                  finalUrl: finalUrl.length > 120 ? finalUrl.slice(0, 120) + '…' : finalUrl,
                  matched: !!secUid,
                  head: 'sec_snippets: ' + secSnippets.join(' | ').slice(0, 450)});
    } catch (e) {
      debug.push({u: '/user/self', e: 'fetch-redirect', err: String(e).slice(0, 80)});
    }

    if (secUid) {
      events.push({
        kind: 'profile',
        id: 'profile-' + secUid,
        capturedAt: now,
        secUid: secUid,
        shortId: null,
        nickname: nickname,
        signature: null,
        followingCount: 0,
        followerCount: 0,
        awemeCount: 0,
        favoritingCount: 0,
        totalFavorited: 0,
      });
    }
    debug.push({_smokeTest: 'profile', secUid: secUid, nickname: nickname,
                cookieLen: document.cookie.length, locHref: location.href,
                hasAcrawler: !!(window.byted_acrawler && window.byted_acrawler.sign)});

    // history (要求签名 — 没拿到 acrawler.sign 该 -2154 / -1)
    if (secUid) {
      const histResp = await tryJson(signUrl(
        'https://www.douyin.com/aweme/v1/web/history/read/?count=30&aid=6383'
      ));
      ((histResp && histResp.aweme_list) || []).forEach(a => {
        events.push({
          kind: 'history',
          id: 'watch-' + a.aweme_id,
          capturedAt: (a.create_time || 0) * 1000 || now,
          awemeId: String(a.aweme_id || ''),
          description: a.desc || '',
          authorSecUid: a.author && a.author.sec_uid,
          authorNickname: a.author && a.author.nickname,
          duration: a.duration || 0,
        });
      });
      const favResp = await tryJson(signUrl(
        'https://www.douyin.com/aweme/v1/web/aweme/favorite/?sec_user_id=' + encodeURIComponent(secUid) +
        '&count=30&aid=6383'
      ));
      ((favResp && favResp.aweme_list) || []).forEach(a => {
        events.push({
          kind: 'favourite',
          id: 'fav-' + a.aweme_id,
          capturedAt: (a.create_time || 0) * 1000 || now,
          awemeId: String(a.aweme_id || ''),
          description: a.desc || '',
          authorNickname: a.author && a.author.nickname,
        });
      });
      const likeResp = await tryJson(signUrl(
        'https://www.douyin.com/aweme/v1/web/aweme/post/like/?sec_user_id=' + encodeURIComponent(secUid) +
        '&count=30&aid=6383'
      ));
      ((likeResp && likeResp.aweme_list) || []).forEach(a => {
        events.push({
          kind: 'like',
          id: 'like-' + a.aweme_id,
          capturedAt: (a.create_time || 0) * 1000 || now,
          awemeId: String(a.aweme_id || ''),
          description: a.desc || '',
          authorNickname: a.author && a.author.nickname,
        });
      });
    }

    const root = {
      schemaVersion: SCHEMA,
      snapshottedAt: now,
      account: { secUid: secUid || '', storedSecUid: null, nickname: nickname || '' },
      events: events,
      _debug: debug,
    };
    DouyinBridge.onSyncData(JSON.stringify(root));
  } catch (e) {
    DouyinBridge.onSyncError(String(e && e.stack || e));
  }
})();
"""
}
