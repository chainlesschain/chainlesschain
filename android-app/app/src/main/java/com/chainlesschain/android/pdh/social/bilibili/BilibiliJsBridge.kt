package com.chainlesschain.android.pdh.social.bilibili

import android.webkit.JavascriptInterface
import timber.log.Timber
import java.util.concurrent.atomic.AtomicReference

/**
 * 2026-05-25 真机：OkHttp 调 b 站桌面 web API 始终被风控（即使 cookie / UA / WBI
 * 签名 / dm_img 指纹全齐，TLS ClientHello 指纹和 JS-set anti-bot cookie 仍暴露
 * 非真实浏览器）→ /x/v3/fav/resource/list 硬 -400，history/dynamics/follows 静默
 * 空 list。唯一稳路是 **在登录用的 WebView 内 evaluateJavascript 跑 fetch()** ：
 *
 *   - WebView 是真 Chrome，TLS 指纹 = 真 Chrome
 *   - `credentials:'include'` 自动带全 cookie（含 JS 生成的 _uuid / buvid_fp /
 *     b_lsid / b_nut 这些 OkHttp 拿不到的）
 *   - 同源调用 api.bilibili.com，CORS 不拦
 *
 * 流程：
 *   1. [SocialCookieWebViewScreen] 抓 cookie 成功后，先调 [setPending] 注册回调
 *   2. evaluateJavascript 跑聚合 JS（4 API 并发 + per-folder fav）
 *   3. JS 把结果 stringify 后调 `BilibiliBridge.onSyncData(json)`
 *   4. 本类 invokeOnce 把 json 传给 pending 回调，登录界面 dismiss
 *   5. [HubLocalViewModel.onBilibiliLoginCookie] 接到 prefetched data 直接写 vault
 *      （跳过 OkHttp 的 [BilibiliApiClient.snapshot]）
 *
 * 全局单例理由：JavascriptInterface 必须 thread-safe 且要从 WebView JS thread
 * 调回 Kotlin；用 singleton + AtomicReference<callback> 一次性消费最稳。
 */
object BilibiliJsBridge {
    private val pendingCallback = AtomicReference<((String?) -> Unit)?>(null)

    /**
     * Register a one-shot callback to be invoked when the WebView's JS calls
     * back into [onSyncData] (success) or when [onSyncError] (failure). The
     * callback is null-arg = JS reported an error; non-null arg = raw JSON
     * string for the caller to parse. Calling [setPending] twice without
     * an [onSyncData] in between will overwrite — caller's responsibility
     * to not race itself.
     */
    fun setPending(callback: (String?) -> Unit) {
        pendingCallback.set(callback)
    }

    /** Cancel any pending callback — used when WebView dispose races. */
    fun clearPending() {
        pendingCallback.set(null)
    }

    @JavascriptInterface
    fun onSyncData(json: String) {
        Timber.i("BilibiliJsBridge: onSyncData received len=%d", json.length)
        val cb = pendingCallback.getAndSet(null) ?: run {
            Timber.w("BilibiliJsBridge: onSyncData but no pending callback")
            return
        }
        cb(json)
    }

    @JavascriptInterface
    fun onSyncError(message: String) {
        Timber.w("BilibiliJsBridge: onSyncError msg=%s", message)
        val cb = pendingCallback.getAndSet(null) ?: return
        cb(null)
    }

    /**
     * 聚合 JS — 在 WebView 里并发 fetch b 站 4 个 API（含 per-folder 收藏 dive），
     * 把结果整成跟 [BilibiliLocalCollector.snapshot] 写盘的 `root` JSONObject 完全
     * 同 shape 的 JSON 字符串，通过 [onSyncData] 回 Kotlin。
     *
     * 用 `credentials:'include'` 让 WebView 自动带全 cookie（含 OkHttp 拿不到的
     * JS-set 字段 _uuid / buvid_fp / b_lsid / b_nut）。同源 api.bilibili.com /
     * api.vc.bilibili.com CORS 由 b 站自己 ACAO 头放行。
     *
     * SCHEMA_VERSION 必须跟 Kotlin 侧 [BilibiliLocalCollector.SNAPSHOT_SCHEMA_VERSION]
     * 一致 — JS adapter (social-bilibili/adapter.js) 检 schemaVersion 选 parser。
     */
    const val PREFETCH_JS: String = """
(async () => {
  try {
    const uidMatch = document.cookie.match(/DedeUserID=(\d+)/);
    if (!uidMatch) {
      BilibiliBridge.onSyncError('DedeUserID not in document.cookie');
      return;
    }
    const uid = uidMatch[1];
    const SCHEMA = 1;
    const now = Date.now();
    const events = [];
    // 2026-05-25 v2: 上版本所有 fetch 静默返 null，events=0 — 多半是 CORS 拒 +
    // .catch(()=>null) 把错吞了。诊断版每个 fetch 抓 HTTP status + 错误 + body 头
    // 长度，最后塞到 result.debug 让 Kotlin 端能看到 b 站到底返了什么
    const debug = [];
    // v3: tryFetch 双引擎 — fetch 失败自动 fallback 到 XHR。某些 WebView 配置
    // 下 fetch + credentials:'include' 跨子域有奇怪 CORS 行为，XHR 同条件下更稳。
    const tryJson = async (url) => {
      const shortUrl = url.length > 80 ? url.slice(0, 80) + '…' : url;
      // 先 fetch
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
      // fetch 失败 / 非 ok → XHR fallback
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false); // sync — 简化等待
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

    // v3 smoke test — 优先调 /x/web-interface/nav (well-known 端点，登录后必返
    // 含 isLogin 的 user info)。如果这都返不来，下面 4 个数据 fetch 必然全空，
    // 直接看 debug 数组的 status / err / head 锁定 CORS / HTTP 401 / WebView 行为
    const navResp = await tryJson('https://api.bilibili.com/x/web-interface/nav');
    const navIsLogin = !!(navResp && navResp.data && navResp.data.isLogin);
    debug.push({_smokeTest: 'nav', isLogin: navIsLogin, code: navResp ? navResp.code : null,
                cookieLen: document.cookie.length, locHref: location.href});

    // history — v4: ps=200 → -400, b 站上限 ps=30。改 cursor+view_at+business
    // 显式起点。v5 加 max+view_at 分页扩到 200
    const histResp = await tryJson('https://api.bilibili.com/x/web-interface/history/cursor?max=0&view_at=0&business=archive&ps=30');
    (histResp && histResp.data && histResp.data.list || []).forEach(item => {
      events.push({
        kind: 'history',
        id: (item.history && item.history.bvid) || ('avid-' + ((item.history && item.history.oid) || item.oid || 0)),
        capturedAt: (item.view_at || 0) * 1000,
        title: item.title || '(no title)',
        bvid: item.history && item.history.bvid,
        avid: (item.history && item.history.oid) || item.oid,
        duration: item.duration,
        uploader: item.owner && item.owner.name,
        uploaderMid: item.owner && item.owner.mid,
        part: item.part,
      });
    });

    // favourites — 2 step: list folders, then per-folder items
    const foldersResp = await tryJson('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=' + uid);
    const folders = (foldersResp && foldersResp.data && foldersResp.data.list) || [];
    for (const folder of folders) {
      if (!folder.id) continue;
      // v4: ps=50 → -400, b 站上限 ps=20。同 folder 多页等 v5 加 pagination loop
      const itemsResp = await tryJson(
        'https://api.bilibili.com/x/v3/fav/resource/list?media_id=' + folder.id +
        '&pn=1&ps=20&platform=web&keyword=&order=mtime&type=0&tid=0'
      );
      (itemsResp && itemsResp.data && itemsResp.data.medias || []).forEach(media => {
        events.push({
          kind: 'favourite',
          id: 'fav-' + (media.bvid || media.title),
          capturedAt: (media.fav_time || 0) * 1000,
          title: media.title,
          bvid: media.bvid,
          folderName: folder.title,
          uploader: media.upper && media.upper.name,
        });
      });
    }

    // follows (followings, paginated — first page ps=50)
    const followsResp = await tryJson(
      'https://api.bilibili.com/x/relation/followings?vmid=' + uid + '&pn=1&ps=50&order=desc'
    );
    (followsResp && followsResp.data && followsResp.data.list || []).forEach(fl => {
      events.push({
        kind: 'follow',
        id: 'follow-' + fl.mid,
        capturedAt: (fl.mtime || 0) * 1000,
        mid: fl.mid,
        uname: fl.uname,
        face: fl.face,
        sign: fl.sign,
      });
    });

    // dynamics (推文 timeline, space_history endpoint on vc subdomain)
    const dynResp = await tryJson(
      'https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=' + uid + '&offset_dynamic_id=0'
    );
    (dynResp && dynResp.data && dynResp.data.cards || []).forEach(card => {
      let parsed = {};
      try { parsed = JSON.parse(card.card); } catch (e) {}
      const desc = card.desc || {};
      events.push({
        kind: 'dynamic',
        id: 'dyn-' + (desc.rid || desc.dynamic_id_str || Date.now()),
        capturedAt: (desc.timestamp || 0) * 1000,
        summary: (parsed.item && (parsed.item.description || parsed.item.content)) || parsed.description || parsed.dynamic || '',
        dynamicType: String(desc.type || ''),
        rid: desc.rid,
        authorMid: desc.uid,
        authorName: desc.user_profile && desc.user_profile.info && desc.user_profile.info.uname,
      });
    });

    const root = {
      schemaVersion: SCHEMA,
      snapshottedAt: now,
      account: { uid: String(uid), displayName: '' },
      events: events,
      _debug: debug,
    };
    BilibiliBridge.onSyncData(JSON.stringify(root));
  } catch (e) {
    BilibiliBridge.onSyncError(String(e && e.stack || e));
  }
})();
"""
}
