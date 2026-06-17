'use strict';
/*
 * PDH Method C — frida 在线解密 (sqlcipher_export).
 *
 * 原理：不去离线复现 WCDB/SQLCipher 的自研 cipher 参数（实测 72 组合全失败），
 * 而是借 App 进程里**已经用正确 key 打开的连接**，在该连接上执行
 *   ATTACH DATABASE '<out>' AS ccpt KEY '';   -- 空 key = 明文目标库
 *   SELECT sqlcipher_export('ccpt');           -- SQLCipher 内建：整库导出为明文
 *   DETACH DATABASE ccpt;
 * → 得到一份**完整明文副本**，绕开 cipher 参数匹配。
 *
 * 触发：hook sqlite3_key/_v2（开库时）+ sqlite3_prepare*（已开库的下次查询时）。
 * 只对文件名匹配 DB_MATCH 的库导出，每库一次。INEXEC 防递归。
 *
 * 用法（被 pdh-frida-decrypt.sh 调用；也可单独）：
 *   su -c 'timeout 60 /data/local/tmp/fj -p <pid> -s /data/local/tmp/ccexport.js'
 * 然后**让 App 进到会查询目标库的界面**（如 IM 的「私信/消息」），hook 才会命中。
 *
 * 可调：环境无法传参给注入脚本，改 DB_MATCH / OUTDIR 常量即可。
 */
var DB_MATCH = /_im\.db$/;            // 要解的库（IM 主库）。微信改 /EnMicroMsg\.db$/ 等。
var OUTDIR = '/data/local/tmp/dec/';  // 明文副本输出目录（pull 后必清，含个人数据）。
var DONE = {}, INEXEC = false, f_exec = null, f_dbfn = null;

function resolve() {
  if (f_exec) return true;
  f_exec = Module.findExportByName(null, 'sqlite3_exec');
  f_dbfn = Module.findExportByName(null, 'sqlite3_db_filename');
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
function tryExport(db) {
  if (INEXEC || !resolve()) return;
  var fn = filenameOf(db);
  if (!fn || !DB_MATCH.test(fn) || DONE[fn]) return;
  DONE[fn] = true;
  var out = OUTDIR + fn.split('/').pop() + '.plain.db';
  var r = execOn(db, "ATTACH DATABASE '" + out + "' AS ccpt KEY ''; SELECT sqlcipher_export('ccpt'); DETACH DATABASE ccpt;");
  send('[export] ' + fn + ' rc=' + r.rc + ' msg=[' + r.msg + '] -> ' + out);
  if (r.rc !== 0) DONE[fn] = false; // 失败允许其它 hook 重试
}
function install() {
  if (!resolve()) { setTimeout(install, 400); return; }
  send('[ready] sqlite3_exec resolved; waiting for ' + DB_MATCH + ' to be opened/queried');
  ['sqlite3_key', 'sqlite3_key_v2'].forEach(function (n) {
    var p = Module.findExportByName(null, n);
    if (p) { Interceptor.attach(p, { onEnter: function (a) { this.db = a[0]; }, onLeave: function () { try { tryExport(this.db); } catch (e) { send('e1 ' + e); } } }); send('[hook] ' + n); }
  });
  ['sqlite3_prepare_v2', 'sqlite3_prepare', 'sqlite3_prepare_v3'].forEach(function (n) {
    var p = Module.findExportByName(null, n);
    if (p) { Interceptor.attach(p, { onEnter: function (a) { try { tryExport(a[0]); } catch (e) { } } }); send('[hook] ' + n); }
  });
}
install();
