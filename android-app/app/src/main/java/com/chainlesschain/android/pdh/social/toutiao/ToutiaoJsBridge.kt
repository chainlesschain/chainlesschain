package com.chainlesschain.android.pdh.social.toutiao

import android.webkit.JavascriptInterface
import timber.log.Timber
import java.util.concurrent.atomic.AtomicReference

/**
 * 2026-05-26 — 复刻 [BilibiliJsBridge] + [DouyinJsBridge] + [XhsJsBridge] 同套路径
 * 给头条。详 memory `bilibili_in_webview_prefetch_architecture.md`。
 *
 * 关键差异 (vs 其它 3 平台)：
 *   - 头条 `/passport/account/info/v2/?aid=24` 端点 cookie-only **不需签名** —
 *     profile 路径稳定（与 Xhs `/user/me` 同模式）。返 `{status_code: 0,
 *     data: {user_id, screen_name, mobile, avatar_url, ...}}`
 *   - feed/collection/search 需 `_signature` 客户端签名 (byted_acrawler SDK,
 *     与抖音同字节系签名), JS 端尝试 `window.byted_acrawler.sign(url)` 拼 sig
 *   - 登录页 `www.toutiao.com/` 本身一加载就**误触发** url-path isLoginSuccess
 *     (与 Xhs 同 bug, isLoginSuccess 必须返 false 强制走 cookie poll)
 *   - JavascriptInterface 名 `ToutiaoBridge`, AtomicReference pendingCallback 同模式
 *   - PREFETCH_JS schema 跟 [ToutiaoLocalCollector] root JSON 同 shape:
 *     account.{uid, displayName}, events:[{kind:'profile'|'read'|'collection'|'search'}]
 */
object ToutiaoJsBridge {
    private val pendingCallback = AtomicReference<((String?) -> Unit)?>(null)

    fun setPending(callback: (String?) -> Unit) {
        pendingCallback.set(callback)
    }

    fun clearPending() {
        pendingCallback.set(null)
    }

    @JavascriptInterface
    fun onSyncData(json: String) {
        Timber.i("ToutiaoJsBridge: onSyncData received len=%d", json.length)
        val cb = pendingCallback.getAndSet(null) ?: run {
            Timber.w("ToutiaoJsBridge: onSyncData but no pending callback")
            return
        }
        cb(json)
    }

    @JavascriptInterface
    fun onSyncError(message: String) {
        Timber.w("ToutiaoJsBridge: onSyncError msg=%s", message)
        val cb = pendingCallback.getAndSet(null) ?: return
        cb(null)
    }

    /**
     * 头条 prefetch JS:
     *   1. 抠 passport_uid (cookie-only, primary UID 字段)
     *   2. fetch /passport/account/info/v2/?aid=24 → user_id + screen_name 等 profile
     *   3. push profile event
     *   4. v0 跳过 feed/collection/search (需要 _signature, 多半 CORS 拒)
     *
     * 返 root JSON 跟 [ToutiaoLocalCollector.snapshot] 同 shape。
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

    // v2 真机：passport_uid 是 httpOnly cookie, JS document.cookie 读不到。
    // 走 Kotlin 侧 dispatchCookieReady 抠 + 注入 window.__TOUTIAO_UID__。
    // 同时 /passport/account/info/v2 返 error_code=16 "该应用无权限" — 头条
    // 风控严不返用户资料。MVP 仅靠注入 uid 推 profile event
    const injectedUid = window.__TOUTIAO_UID__ || null;
    // 兜底降级也试 document.cookie (登录早期或 httpOnly 关掉时还能拿到)
    const docCookieMatch = document.cookie.match(/(?:^|;\s*)passport_uid=(\d+)/);
    const passportUidFromCookie = docCookieMatch ? docCookieMatch[1] : '';

    // 仍试 /passport/account/info/v2 拿 nickname/avatar (即使 error_code=16
    // 也 dump 出来诊断) — 不阻断 profile event
    const meResp = await tryJson('https://www.toutiao.com/passport/account/info/v2/?aid=24');
    let uid = injectedUid || passportUidFromCookie || '';
    let nickname = '';
    if (meResp && meResp.status_code === 0 && meResp.data) {
      uid = String(meResp.data.user_id || uid);
      nickname = meResp.data.screen_name || meResp.data.name || '';
    }
    debug.push({_smokeTest: 'passport', uid: uid, nickname: nickname,
                passportUidFromCookie: passportUidFromCookie,
                injectedFromKotlin: injectedUid,
                cookieLen: document.cookie.length, locHref: location.href,
                hasAcrawler: !!(window.byted_acrawler && window.byted_acrawler.sign)});

    // 至少推 profile event (即使 /passport/account/info 返风控错误)
    if (uid) {
      events.push({
        kind: 'profile',
        id: 'profile-' + uid,
        capturedAt: now,
        uid: uid,
        nickname: nickname,
        avatarUrl: (meResp && meResp.data && meResp.data.avatar_url) || '',
        mobile: (meResp && meResp.data && meResp.data.mobile) || null,
        description: (meResp && meResp.data && meResp.data.description) || '',
        followingCount: parseInt((meResp && meResp.data && (meResp.data.following_count || 0)) || 0) || 0,
        followerCount: parseInt((meResp && meResp.data && (meResp.data.followers_count || meResp.data.follower_count || 0)) || 0) || 0,
        mediaId: (meResp && meResp.data && meResp.data.media_id) || null,
      });
    }

    // 试 byted_acrawler signer 给 feed/collection/search 加 _signature
    const signUrl = (url) => {
      try {
        const sig = window.byted_acrawler && window.byted_acrawler.sign && window.byted_acrawler.sign(url);
        if (sig) return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_signature=' + encodeURIComponent(sig);
      } catch (e) {
        debug.push({u: 'sign-err', err: String(e).slice(0, 80)});
      }
      return url;
    };

    if (uid) {
      // feed (read history)
      const feedResp = await tryJson(signUrl(
        'https://www.toutiao.com/api/news/feed/v90/?category=__all__&count=30&aid=24'
      ));
      ((feedResp && (feedResp.data || feedResp.aweme_list)) || []).forEach(item => {
        if (!item || !item.item_id) return;
        events.push({
          kind: 'read',
          id: 'read-' + item.item_id,
          capturedAt: (item.publish_time || item.behot_time || 0) * 1000 || now,
          itemId: String(item.item_id),
          title: item.title || '(no title)',
          category: item.chinese_tag || item.tag || null,
          author: (item.source) || (item.user_info && item.user_info.name) || null,
          readDuration: 0,
          source: item.source || null,
        });
      });
      // collection (saved articles)
      const collectResp = await tryJson(signUrl(
        'https://www.toutiao.com/article/v2/tab_comments/?count=30&aid=24'
      ));
      ((collectResp && collectResp.data) || []).forEach(item => {
        if (!item || !item.item_id) return;
        events.push({
          kind: 'collection',
          id: 'collect-' + item.item_id,
          capturedAt: (item.create_time || 0) * 1000 || now,
          itemId: String(item.item_id),
          title: item.title || '(no title)',
          category: item.tag || null,
          author: item.source || null,
        });
      });
    }

    const root = {
      schemaVersion: SCHEMA,
      snapshottedAt: now,
      account: {
        uid: uid || passportUid || '',
        displayName: nickname || '',
      },
      events: events,
      _debug: debug,
    };
    ToutiaoBridge.onSyncData(JSON.stringify(root));
  } catch (e) {
    ToutiaoBridge.onSyncError(String(e && e.stack || e));
  }
})();
"""
}
