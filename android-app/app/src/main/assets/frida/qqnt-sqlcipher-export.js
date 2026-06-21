'use strict';
/*
 * module 101 QQNT 采集方案 Phase 1 — frida 在线解密 agent (Method C).
 *
 * 借 QQ 进程里**已经用正确 key 打开的连接**，在该连接上执行
 *   ATTACH DATABASE '<out>' AS ccpt KEY '';   -- 空 key = 明文目标
 *   SELECT sqlcipher_export('ccpt');           -- 整库导出为明文
 *   DETACH DATABASE ccpt;
 * 绕开 QQNT 自研 cipher 参数（离线复现不可行）。只导 nt_msg.db / group_info.db /
 * profile_info.db，每库一次。INEXEC 防递归。
 *
 * 触发：必须让 QQ 前台进到「消息」列表/某会话，IM 插件查询过 nt_msg.db，hook 才命中。
 *
 * 双发：send() + console.log(JSON) —— Kotlin 侧 (QQNTFridaExporter) 解析
 * `{"kind":"export",...}` 行拿明文路径，不依赖 frida-inject 的 send 行为。
 */
var DB_MATCH = /(nt_msg|group_info|profile_info)\.db$/;
var OUTDIR = '/data/local/tmp/dec/';
var DONE = {}, INEXEC = false, f_exec = null, f_dbfn = null;

function emit(obj) {
  try { send(obj); } catch (e) {}
  try { console.log(JSON.stringify(obj)); } catch (e) {}
}
// QQNT's nt_msg.db goes through WCDB (libwcdb.so), which bundles its OWN
// SQLCipher — the sqlite3_* symbols we need are exported THERE, not in the
// system libsqlite.so. Resolve/hook from WCDB first, fall back to global.
var MODS = null;
function wcdbNames() {
  var names = [];
  try {
    Process.enumerateModules().forEach(function (m) {
      if (/wcdb|sqlcipher/i.test(m.name)) names.push(m.name);
    });
  } catch (e) {}
  return names;
}
function modCandidates() {
  if (MODS) return MODS;
  var names = wcdbNames();
  if (names.length === 0) return [null]; // wcdb not loaded yet — DON'T cache
  names.push(null);
  MODS = names; // cache only once wcdb is present
  return MODS;
}
function findSym(name) {
  var c = modCandidates();
  for (var i = 0; i < c.length; i++) {
    var p = Module.findExportByName(c[i], name);
    if (p) return p;
  }
  return null;
}
function resolve() {
  if (f_exec) return true;
  f_exec = findSym('sqlite3_exec');
  f_dbfn = findSym('sqlite3_db_filename');
  return !!f_exec;
}
function filenameOf(db) {
  if (!f_dbfn) return null;
  var fn = new NativeFunction(f_dbfn, 'pointer', ['pointer', 'pointer']);
  var p = fn(db, Memory.allocUtf8String('main'));
  return p.isNull() ? null : p.readUtf8String();
}
function execOn(db, sql) {
  var exec = new NativeFunction(f_exec, 'int', ['pointer', 'pointer', 'pointer', 'pointer', 'pointer']);
  var errOut = Memory.alloc(Process.pointerSize); errOut.writePointer(NULL);
  INEXEC = true;
  var rc = exec(db, Memory.allocUtf8String(sql), NULL, NULL, errOut);
  INEXEC = false;
  var ep = errOut.readPointer();
  return { rc: rc, msg: ep.isNull() ? '' : ep.readUtf8String() };
}
var SEEN_FN = {};
function noteFn(db) {
  if (INEXEC || !resolve()) return;
  var fn = filenameOf(db);
  if (fn && !SEEN_FN[fn]) { SEEN_FN[fn] = true; emit({ kind: 'dbfile', fn: fn }); }
}
function tryExport(db) {
  if (INEXEC || !resolve()) return;
  var fn = filenameOf(db);
  if (!fn || !DB_MATCH.test(fn) || DONE[fn]) return;
  DONE[fn] = true;
  var out = OUTDIR + fn.split('/').pop() + '.plain.db';
  var r = execOn(db, "ATTACH DATABASE '" + out + "' AS ccpt KEY ''; SELECT sqlcipher_export('ccpt'); DETACH DATABASE ccpt;");
  emit({ kind: 'export', src: fn, out: out, rc: r.rc, msg: r.msg });
  if (r.rc !== 0) DONE[fn] = false; // 失败允许其它 hook 重试
}
function install() {
  // Wait for WCDB (libwcdb.so) to load — QQNT's nt_msg cipher lives there, and
  // if we hook before it loads we'd bind the system libsqlite instead. Polling
  // also lets us attach early and still catch the FIRST nt_msg open (key set).
  if (wcdbNames().length === 0) { setTimeout(install, 250); return; }
  if (!resolve()) { setTimeout(install, 250); return; }
  emit({ kind: 'ready', match: String(DB_MATCH), mods: modCandidates() });
  ['sqlite3_key', 'sqlite3_key_v2'].forEach(function (n) {
    var p = findSym(n);
    if (p) { Interceptor.attach(p, { onEnter: function (a) { this.db = a[0]; }, onLeave: function () { try { tryExport(this.db); } catch (e) {} } }); emit({ kind: 'hook', sym: n }); }
  });
  ['sqlite3_prepare_v2', 'sqlite3_prepare', 'sqlite3_prepare_v3'].forEach(function (n) {
    var p = findSym(n);
    if (p) { Interceptor.attach(p, { onEnter: function (a) { try { noteFn(a[0]); tryExport(a[0]); } catch (e) {} } }); emit({ kind: 'hook', sym: n }); }
  });
}
install();
