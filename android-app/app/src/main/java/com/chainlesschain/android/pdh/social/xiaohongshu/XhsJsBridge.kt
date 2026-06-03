package com.chainlesschain.android.pdh.social.xiaohongshu

import android.webkit.JavascriptInterface
import timber.log.Timber
import java.util.concurrent.atomic.AtomicReference

/**
 * 2026-05-26 — 复刻 [BilibiliJsBridge] + [DouyinJsBridge] 同套路径给小红书。
 * 详 memory `bilibili_in_webview_prefetch_architecture.md`。
 *
 * 关键差异 (vs Bilibili / Douyin)：
 *   - 小红书 `/user/me` 端点 cookie-only **不需签名** — profile 路径稳定，能拿
 *     真 user_id + nickname
 *   - notes/liked/follow 需 X-S/X-t/X-s-common 头签名 (xhs 风控 SDK)。JS 端尝试
 *     按优先级调 `window._webmsxyw(path, body)` / `window.webmsxyw(...)` /
 *     `window.xhs.sign(...)` / `window._b8.xs(...)` 拿签名 headers，attach 到
 *     fetch headers 再调 edith.xiaohongshu.com 端点
 *   - 登录页 `www.xiaohongshu.com/explore` 多数情况不加载 sign sdk → 这 3 个端
 *     点 v0 跳过；只拿 profile (1 event)
 *   - JavascriptInterface 名 `XhsBridge`，AtomicReference pendingCallback 同模式
 *   - PREFETCH_JS schema 必跟 [XhsLocalCollector] root JSON 完全同 shape:
 *     schemaVersion=1, account.{uid:user_id_string, numericUid, displayName},
 *     events:[{kind:'note'|'liked'|'follow', ...}]
 *
 * 注意：[XhsLocalCollector.acceptLoginCookie] 必须 a1 字段，JS 端从
 * document.cookie 解出来传上去（避免 Kotlin 侧再 extractA1）。
 */
object XhsJsBridge {
    private val pendingCallback = AtomicReference<((String?) -> Unit)?>(null)

    fun setPending(callback: (String?) -> Unit) {
        pendingCallback.set(callback)
    }

    fun clearPending() {
        pendingCallback.set(null)
    }

    @JavascriptInterface
    fun onSyncData(json: String) {
        Timber.i("XhsJsBridge: onSyncData received len=%d", json.length)
        val cb = pendingCallback.getAndSet(null) ?: run {
            Timber.w("XhsJsBridge: onSyncData but no pending callback")
            return
        }
        cb(json)
    }

    @JavascriptInterface
    fun onSyncError(message: String) {
        Timber.w("XhsJsBridge: onSyncError msg=%s", message)
        val cb = pendingCallback.getAndSet(null) ?: return
        cb(null)
    }

    /**
     * 小红书 prefetch JS:
     *   1. 解 a1 from document.cookie (anti-bot fingerprint 字段)
     *   2. fetch /api/sns/web/v1/user/me (cookie-only, 无 sig) → user_id + nickname
     *   3. 试 4 个 xhs signer 拿 X-S/X-t/X-s-common headers
     *   4. 若 sig 拿到 → 试 fetch user_posted / collected / followings 各 1 页
     *   5. 没 sig → 只返 profile event (account fully populated)
     *
     * 返 root JSON 同 [XhsLocalCollector.snapshot] shape。
     */
    const val PREFETCH_JS: String = """
(async () => {
  try {
    const SCHEMA = 1;
    const now = Date.now();
    const events = [];
    const debug = [];

    const tryJson = async (url, headers) => {
      const shortUrl = url.length > 80 ? url.slice(0, 80) + '…' : url;
      const opts = {credentials:'include', mode:'cors'};
      if (headers) opts.headers = headers;
      try {
        const r = await fetch(url, opts);
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
        if (headers) for (const k in headers) xhr.setRequestHeader(k, headers[k]);
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

    // a1 cookie field (anti-bot fingerprint) — Kotlin 侧必须有此字段才 saveCredentials
    const a1Match = document.cookie.match(/(?:^|;\s*)a1=([^;]+)/);
    const a1 = a1Match ? a1Match[1] : '';

    // 提前定义 signer (上版 v0 以为 /user/me 不要签，真机 406 — 现在 xhs 把这条
    // 也加签了。signer 在 /explore 页确实加载 → webmsxyw=true，给所有端点统一加签)
    const xhsSign = (path, body) => {
      try {
        if (typeof window._webmsxyw === 'function') return window._webmsxyw(path, body);
        if (typeof window.webmsxyw === 'function') return window.webmsxyw(path, body);
        if (window.xhs && typeof window.xhs.sign === 'function') return window.xhs.sign(path, body);
        if (window._b8 && typeof window._b8.xs === 'function') return window._b8.xs(path, body);
      } catch (e) {
        debug.push({u: 'xhs-sign-err', err: String(e).slice(0, 80)});
      }
      return null;
    };
    const buildSignedHeaders = (path) => {
      const sig = xhsSign(path, '');
      if (!sig) return null;
      return {
        'X-s': sig['X-s'] || sig.xs || '',
        'X-t': String(sig['X-t'] || sig.xt || ''),
        'X-s-common': sig['X-s-common'] || sig['x-s-common'] || sig.xsCommon || '',
      };
    };

    // v6: Kotlin 侧 dispatchCookieReady 从 id_token (httpOnly JWT) decode 抠
    // user_id 注入 window.__XHS_USER_ID__。若有就跳过 /user/me HTTP (服务端
    // 风控严，不论 -104 还是 406)。否则降级跑 /user/me 试。
    let userId = window.__XHS_USER_ID__ || null;
    let nickname = '';
    const meResp = userId ? null : await (async () => {
      const mePath = '/api/sns/web/v1/user/me';
      const meHeaders = buildSignedHeaders(mePath);
      return await tryJson('https://edith.xiaohongshu.com' + mePath, meHeaders);
    })();
    debug.push({_smokeTest: 'injected', injectedUserId: userId, idTokenInjected: !!userId});

    // v7 兜底 smoke — 试两条 alternative endpoint 看是不是 /user/me 端点单独被拒
    const altSmokePaths = [
      '/api/sns/web/v1/feed?source=homefeed_recommend',
      '/api/sns/web/v1/login/info',
    ];
    for (const p of altSmokePaths) {
      const h = buildSignedHeaders(p);
      await tryJson('https://edith.xiaohongshu.com' + p, h);
    }
    // userId 已在 v6 上面 declare (来自 injected window.__XHS_USER_ID__)
    if (!userId && meResp && meResp.success && meResp.data) {
      userId = meResp.data.user_id || meResp.data.userid || null;
      nickname = meResp.data.nickname || meResp.data.name || '';
    }
    // v3 真机：code=-104 "没有权限访问" — cookie 缺 web_session 等关键字段。
    // dump cookie 字段名列表（不带值，免敏感）暴露真实捕获情况
    const cookieFieldNames = document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(Boolean);
    debug.push({_smokeTest: 'me', userId: userId, nickname: nickname, a1Present: !!a1,
                cookieLen: document.cookie.length, locHref: location.href,
                cookieFields: cookieFieldNames.join(','),
                signerCandidates: {
                  webmsxyw: typeof window._webmsxyw === 'function',
                  webmsxyw2: typeof window.webmsxyw === 'function',
                  xhsSign: !!(window.xhs && typeof window.xhs.sign === 'function'),
                  b8xs: !!(window._b8 && typeof window._b8.xs === 'function'),
                }});

    // v8: 至少推个 profile event 让用户看见「已采到账号信息」(+1 事件)。
    // notes/liked/follow CORS 全挡，只能从 /user/me 拿到资料
    if (userId) {
      events.push({
        kind: 'profile',
        id: 'profile-' + userId,
        capturedAt: now,
        userId: userId,
        nickname: nickname,
        redId: (meResp && meResp.data && meResp.data.red_id) || '',
        avatar: (meResp && meResp.data && meResp.data.images) || '',
      });
    }
    if (userId) {
      // notes (用户自己发的笔记)
      const notesPath = '/api/sns/web/v2/user_posted?num=30&cursor=&user_id=' + encodeURIComponent(userId) +
                        '&image_formats=jpg,webp,avif&xsec_token=&xsec_source=pc_user';
      const notesHeaders = buildSignedHeaders(notesPath);
      if (notesHeaders) {
        const notesResp = await tryJson('https://edith.xiaohongshu.com' + notesPath, notesHeaders);
        const notes = (notesResp && notesResp.data && notesResp.data.notes) || [];
        notes.forEach(n => {
          events.push({
            kind: 'note',
            id: 'note-' + (n.note_id || n.noteId || ''),
            capturedAt: (n.time || n.create_time || 0) * 1000 || now,
            title: n.display_title || n.title || '(no title)',
            noteId: n.note_id || n.noteId || '',
            desc: n.desc || '',
            type: n.type || 'normal',
            likedCount: parseInt(n.liked_count || n.likedCount || 0) || 0,
            collectedCount: parseInt(n.collected_count || n.collectedCount || 0) || 0,
            commentCount: parseInt(n.comment_count || n.commentCount || 0) || 0,
          });
        });
      } else {
        debug.push({u: 'notes-no-sig', e: 'skipped', err: 'no xhs signer available'});
      }

      // liked (我赞过的笔记)
      const likedPath = '/api/sns/web/v1/note/liked?num=30&cursor=';
      const likedHeaders = buildSignedHeaders(likedPath);
      if (likedHeaders) {
        const likedResp = await tryJson('https://edith.xiaohongshu.com' + likedPath, likedHeaders);
        const liked = (likedResp && likedResp.data && likedResp.data.notes) || [];
        liked.forEach(l => {
          events.push({
            kind: 'liked',
            id: 'liked-' + (l.note_id || l.noteId || ''),
            capturedAt: (l.time || 0) * 1000 || now,
            title: l.display_title || l.title || '(no title)',
            noteId: l.note_id || l.noteId || '',
            authorNickname: l.user && (l.user.nickname || l.user.name),
          });
        });
      }

      // follows (我关注的用户)
      const followsPath = '/api/sns/web/v1/user/' + encodeURIComponent(userId) + '/followings?page=1&page_size=20';
      const followsHeaders = buildSignedHeaders(followsPath);
      if (followsHeaders) {
        const followsResp = await tryJson('https://edith.xiaohongshu.com' + followsPath, followsHeaders);
        const follows = (followsResp && followsResp.data && (followsResp.data.users || followsResp.data.followings)) || [];
        follows.forEach(f => {
          events.push({
            kind: 'follow',
            id: 'follow-' + (f.user_id || f.id || ''),
            capturedAt: now,
            userId: f.user_id || f.id || '',
            nickname: f.nickname || f.name || '',
            image: f.image || f.avatar || null,
          });
        });
      }
    }

    const root = {
      schemaVersion: SCHEMA,
      snapshottedAt: now,
      account: {
        uid: userId || '',
        numericUid: '0',
        displayName: nickname || '',
        a1: a1,
      },
      events: events,
      _debug: debug,
    };
    XhsBridge.onSyncData(JSON.stringify(root));
  } catch (e) {
    XhsBridge.onSyncError(String(e && e.stack || e));
  }
})();
"""
}
