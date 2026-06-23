'use strict';
/**
 * qzone-collect — QQ空间 (Qzone) collector core: 说说 / 留言板 / 相册 → vault events.
 *
 * Qzone has NO local browsable DB (the QQNT databases only cache per-contact
 * "latest feed" preview snippets), so this is the API path: Qzone CGI endpoints
 * authed with the account's qzone-domain `p_skey` + `uin` + a `g_tk` token
 * derived from p_skey (the bkn hash). Pure Node — the only side effect is the
 * caller-supplied `fetchImpl` (defaults to global fetch), so the parsers are
 * unit-testable and the same core runs on PC (`cc hub collect-qzone --cookie`)
 * and in-APK (the Android app captures the cookie via a WebView and feeds it in).
 *
 * Cookie note: the base `.qq.com` skey is rejected by Qzone ("请先登录空间") —
 * the qzone-domain `p_skey` is required (a browser login to user.qzone.qq.com,
 * or the in-app WebView, yields it). Extracted from
 * scripts/android/pdh-qzone-collect.mjs (behaviour identical).
 */
const SELF_ID = 'person-qq-self';
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
const SRC = (originalId, at) => ({ adapter: 'qzone', adapterVersion: '0.1.0', originalId, capturedAt: at || Date.now(), capturedBy: 'api' });

/** Qzone bkn/g_tk hash over p_skey (or skey). */
function gtk(s) { let h = 5381; for (let i = 0; i < String(s).length; i++) h += (h << 5) + String(s).charCodeAt(i); return h & 0x7fffffff; }

function parseCookieStr(s) { const o = {}; for (const part of String(s).split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return o; }
function cookieHeader(ck) { return Object.entries(ck).map(([k, v]) => `${k}=${v}`).join('; '); }
function stripHtml(s) {
  return String(s || '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
function beijingMs(s) { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || '')); if (!m) return 0; return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`) || 0; }
function unwrap(text) { return String(text).trim().replace(/^[\w$]+\(/, '').replace(/\);?\s*$/, ''); }

// ── 说说 (emotion_cgi_msglist_v6) → EVENT(post) ─────────────────────────────
function parseQzoneFeed(text) {
  let json; try { json = JSON.parse(unwrap(text)); } catch { return { code: -1, events: [] }; }
  if (json.code !== undefined && json.code !== 0) return { code: json.code, message: json.message, events: [] };
  const list = json.msglist || (json.result && json.result.msglist) || [];
  const events = [];
  for (const it of list) {
    const tid = it.tid || it.t1_tid || it.cellid;
    const occurredAt = (Number(it.created_time) || 0) * 1000;
    if (!tid || !occurredAt) continue;
    const txt = (it.content || it.summary || '').replace(/\s+/g, ' ').trim();
    const pics = Array.isArray(it.pic) ? it.pic.length : 0;
    if (!txt && !pics) continue;
    events.push({
      type: 'event', subtype: 'post', id: `qzone:${tid}`,
      occurredAt, actor: SELF_ID, participants: [SELF_ID],
      content: { title: (txt || '[图片] 我的说说').slice(0, 80), text: txt || undefined },
      source: SRC(`qzone-${tid}`, occurredAt),
      extra: { kind: 'qzone-shuoshuo', tid, mediaCount: pics, cmtnum: it.cmtnum || 0, secret: !!it.secret },
      ingestedAt: Date.now(),
    });
  }
  return { code: 0, events, total: json.total != null ? json.total : (json.result && json.result.total) };
}

// ── 留言板 (get_msgb) → EVENT(message) by the commenter ────────────────────
function parseGuestbook(text) {
  let json; try { json = JSON.parse(unwrap(text)); } catch { return { code: -1, events: [], persons: [] }; }
  if (json.code !== 0) return { code: json.code, message: json.message, events: [], persons: [] };
  const list = (json.data && json.data.commentList) || [];
  const events = [], persons = new Map();
  for (const c of list) {
    const id = c.id; const occurredAt = beijingMs(c.pubtime);
    const txt = stripHtml(c.htmlContent || c.content || '');
    if (!id || !occurredAt || !txt) continue;
    const fromUin = String(c.uin || '');
    const fromNick = c.nickname || fromUin;
    const actor = fromUin ? `person-qq-${fromUin}` : SELF_ID;
    if (fromUin && !persons.has(actor)) persons.set(actor, { type: 'person', subtype: 'contact', id: actor, names: fromNick !== fromUin ? [fromNick, fromUin] : [fromUin], identifiers: { qqUin: fromUin }, source: SRC(actor), ingestedAt: Date.now() });
    events.push({
      type: 'event', subtype: 'message', id: `qzone-msgb:${id}`,
      occurredAt, actor, participants: [actor, SELF_ID],
      content: { title: txt.slice(0, 80), text: txt },
      source: SRC(`qzone-msgb-${id}`, occurredAt),
      extra: { kind: 'qzone-guestbook', fromUin, fromNick },
      ingestedAt: Date.now(),
    });
  }
  return { code: 0, events, persons: [...persons.values()], total: json.data && json.data.total };
}

// ── 相册 (fcg_list_album_v3) → EVENT(media) per album ──────────────────────
function parseAlbums(text) {
  let json; try { json = JSON.parse(unwrap(text)); } catch { return { code: -1, events: [] }; }
  if (json.code !== 0) return { code: json.code, message: json.message, events: [] };
  const list = (json.data && json.data.albumList) || [];
  const events = [];
  for (const a of list) {
    if (!a.id) continue;
    const occurredAt = (Number(a.createtime) || 0) * 1000;
    const name = a.name || '(相册)';
    events.push({
      type: 'event', subtype: 'media', id: `qzone-album:${a.id}`,
      occurredAt: occurredAt || Date.now(), actor: SELF_ID, participants: [SELF_ID],
      content: { title: `相册：${name}（${a.total || 0} 张）`, text: a.desc || undefined },
      source: SRC(`qzone-album-${a.id}`, occurredAt),
      extra: { kind: 'qzone-album', albumId: a.id, photoCount: a.total || 0, desc: a.desc || '', commentCount: a.comment || 0 },
      ingestedAt: Date.now(),
    });
  }
  return { code: 0, events, total: (json.data && json.data.albumsInUser) != null ? json.data.albumsInUser : list.length };
}

function qproxy(domainPath, params) {
  const qs = Object.entries({ format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', source: 'qzone', plat: 'qzone', ...params }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `https://user.qzone.qq.com/proxy/domain/${domainPath}?${qs}`;
}

/**
 * Collect Qzone data into a vault batch. `fetchImpl(url, opts)` is injectable
 * (defaults to global fetch) so this is testable offline and runs in-APK.
 * @returns {Promise<{ok, uin, events, persons, counts, reason?}>}
 */
async function collectQzone({ uin, cookie, what = ['shuoshuo'], max = 500, fetchImpl } = {}) {
  const ck = typeof cookie === 'string' ? parseCookieStr(cookie) : (cookie || {});
  // QQ uin cookies are `o0<uin>` — strip the o/0 prefix (uins never have leading zeros).
  const cleanUin = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  uin = cleanUin(uin) || cleanUin(ck.uin) || cleanUin(ck.p_uin);
  const pskey = ck.p_skey || ck.skey;
  if (!uin || !pskey) return { ok: false, reason: 'missing uin or p_skey', events: [], persons: [], counts: {} };
  const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!_fetch) throw new Error('qzone collect: no fetch implementation available');
  const wantSet = new Set(Array.isArray(what) ? what : String(what).split(',').map((s) => s.trim()));
  const g = gtk(pskey);
  const headers = { Cookie: cookieHeader(ck), Referer: `https://user.qzone.qq.com/${uin}`, 'User-Agent': UA };
  const get = async (url) => { const r = await _fetch(url, { headers }); return typeof r.text === 'function' ? r.text() : r; };

  const events = [], persons = new Map();
  const counts = {};

  if (wantSet.has('shuoshuo')) {
    let n = 0;
    for (let pos = 0; pos < max; pos += 20) {
      const r = parseQzoneFeed(await get(qproxy('taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6', { uin, hostUin: uin, num: 20, pos, g_tk: g, need_private_comment: 1 })));
      if (r.code !== 0 || !r.events.length) break;
      events.push(...r.events); n += r.events.length;
      if (r.total != null && n >= r.total) break;
    }
    counts.shuoshuo = n;
  }
  if (wantSet.has('msgb')) {
    let n = 0, total = null;
    for (let start = 0; start < max; start += 20) {
      const r = parseGuestbook(await get(qproxy('m.qzone.qq.com/cgi-bin/new/get_msgb', { uin, hostUin: uin, num: 20, start, g_tk: g })));
      if (r.code !== 0) break;
      total = r.total;
      if (!r.events.length) break;
      events.push(...r.events); for (const p of r.persons) persons.set(p.id, p); n += r.events.length;
      if (total != null && n >= total) break;
    }
    counts.msgb = n;
  }
  if (wantSet.has('album')) {
    const r = parseAlbums(await get(qproxy('photo.qzone.qq.com/fcgi-bin/fcg_list_album_v3', { g_tk: g, hostUin: uin, uin, mode: 2, pageStart: 0, pageNum: 200 })));
    if (r.code === 0) { events.push(...r.events); counts.album = r.events.length; }
    else counts.album = 0;
  }

  return { ok: true, uin, events, persons: [...persons.values()], counts };
}

module.exports = { gtk, parseCookieStr, stripHtml, parseQzoneFeed, parseGuestbook, parseAlbums, collectQzone, SELF_ID };
