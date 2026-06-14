# Personal Data Hub — Python Sidecar (forensics-bridge)

> **状态**：v0.1 设计稿（2026-05-20）。配套 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) v0.3。
>
> **目标**：把 [`sjqz`](file://C:/code/sjqz)（Python mobile-forensics toolkit，1.7w 行）作为 Node hub 的**采集前端**，避免重写 17 parser + Android/iOS extraction + WeChat 解密。fork 后改造为 IPC sidecar，由 hub 主进程通过 stdio JSON-lines 调用。
>
> **关联**：Phase 4.5（sidecar 基础设施 + 系统数据 adapter）首次落地；Phase 5-12 多 adapter 复用。

---

## 1. 为什么是 sidecar

| 选项 | 评估 |
|---|---|
| **纯 JS 重写 sjqz 17 parser** | 每 adapter +2-3d；WeChat SQLCipher 解密自研高风险；Android/iOS 提取栈（ADB / AFC / 加密备份解密）JS 生态不成熟。**否决** |
| **Python 嵌入 Node (boa / pythonia)** | runtime 耦合；崩溃域不隔离；不易升级 Python 版本。**否决** |
| **HTTP service** | 开端口 = 攻击面；要做 auth；与"零外网"原则冲突。**否决** |
| **stdio JSON-lines sidecar**（采纳） | 不开端口；崩溃域隔离；可独立打包 / 升级；与 `backend/ai-service` 模式一致 |

---

## 2. 架构

```
┌────────────────────────────────────────────┐
│ Node hub (主进程)                            │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │ SidecarSupervisor                     │ │
│  │  - spawn / health-check / restart     │ │
│  │  - rate-limit / timeout / cancel      │ │
│  │  - audit log every IPC call           │ │
│  └────────────┬─────────────────────────┘ │
│               │ ChildProcess.stdio         │
└───────────────┼────────────────────────────┘
                │ JSON-lines on stdin/stdout
                │ logs on stderr (pino-style)
                ↓
┌────────────────────────────────────────────┐
│ forensics-bridge (Python sidecar)           │
│                                            │
│  ┌──────────────┐                          │
│  │ IPC dispatcher│ ← method routing       │
│  └────┬─────────┘                          │
│       ↓                                    │
│  ┌──────────────────────────────────────┐ │
│  │ sjqz core (fork, 改造为 lib)          │ │
│  │  ├─ android/extractor.py             │ │
│  │  ├─ ios/extractor.py                 │ │
│  │  ├─ parsers/wechat.py                │ │
│  │  ├─ parsers/wechat_decrypt.py        │ │
│  │  ├─ parsers/ecommerce.py             │ │
│  │  ├─ parsers/lifestyle.py             │ │
│  │  ├─ parsers/system.py                │ │
│  │  └─ ... (17 parser 全部)              │ │
│  └──────────────────────────────────────┘ │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │ NormalizedBatch builder              │ │
│  │  sjqz dataclass → UnifiedSchema       │ │
│  │  - Person / Event / Place / Item     │ │
│  │  - source.adapter / capturedBy 标注  │ │
│  └──────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

**关键边界**：
- sidecar **只输出 NormalizedBatch JSON**，不直接写 LocalVault（hub schema 校验后才落库）
- sidecar **不联外网**（不发遥测、不下模型；唯一例外 = adapter 必需的源 app API，明确声明）
- sidecar **不持有 vault 主密钥**（解密 WeChat 等场景由 hub 把密钥临时下发，sidecar 用完即清）

---

## 3. IPC 协议

### 3.1 Envelope 格式

**Request (hub → sidecar, 一行一 JSON)**：
```json
{
  "id": "req-001",
  "method": "wechat.parse",
  "params": {
    "db_path": "C:/temp/EnMicroMsg.db",
    "key": "abc1234",
    "since_watermark": "2024-01-01T00:00:00Z"
  },
  "timeout_ms": 60000
}
```

**Response (sidecar → hub, 一行一 JSON)**：

```json
// 进度 (可选, 长任务多次发)
{"id":"req-001","type":"progress","data":{"processed":120,"total":5000,"phase":"messages"}}

// 数据 chunk (流式, 可多次)
{"id":"req-001","type":"chunk","data":{
  "events":[{...}],
  "persons":[{...}],
  "places":[{...}],
  "items":[{...}]
}}

// 最终结果
{"id":"req-001","type":"result","data":{
  "status":"ok",
  "totalEvents":5000,
  "totalPersons":234,
  "watermark":"2026-05-19T23:59:59Z"
}}

// 错误（终止）
{"id":"req-001","type":"error","error":{
  "code":"WECHAT_KEY_INVALID",
  "msg":"PRAGMA key failed: file is not a database",
  "retryable":false
}}
```

**日志 (stderr，独立通道)**：每行 pino-style JSON，hub 转发到 audit log。

### 3.2 Method 注册表

| Method | 入参 | 出参 | 说明 |
|---|---|---|---|
| `sidecar.ping` | `{}` | `{"version":"x.y.z","pythonVersion":"3.12.x"}` | 健康检查 |
| `sidecar.capabilities` | `{}` | `{"methods":["..."],"parsers":["wechat","alipay",...]}` | 能力声明 |
| `android.list_devices` | `{}` | `{"devices":[{"serial":"...","model":"..."}]}` | 列 ADB 设备 |
| `android.extract` | `{"serial":"...","method":"adb_backup\|root\|apk_downgrade","packages":["com.tencent.mm"],"output_dir":"..."}` | stream chunks + `{"path":"..."}` | 拉手机数据到本地 |
| `ios.list_devices` | `{}` | `{"devices":[{"udid":"...","name":"..."}]}` | 列 iOS 设备 |
| `ios.extract` | `{"udid":"...","backup_password":"?","output_dir":"..."}` | stream chunks + `{"path":"..."}` | iTunes-style 备份 + 解密 |
| `wechat.calculate_key` | `{"imei":"...","uin":"..."}` | `{"key":"abc1234"}` | sjqz 的 MD5(IMEI+UIN)[:7] |
| `wechat.verify_key` | `{"db_path":"...","key":"..."}` | `{"valid":true}` | SQLCipher PRAGMA key 试解 |
| `wechat.auto_decrypt` | `{"data_dir":"...","output_dir":"..."}` | stream + `{"key":"...","decrypted_db":"..."}` | sjqz auto_decrypt 全流程 |
| `wechat.parse` | `{"db_path":"...","since_watermark":"?"}` | stream NormalizedBatch chunks | 解析聊天/联系人/群/媒体 |
| `qq.parse` | 同上 | 同上 | QQ |
| `whatsapp.parse` | 同上 | 同上 | WhatsApp |
| `telegram.parse` | 同上 | 同上 | Telegram |
| `weibo.parse` | 同上 | 同上 | 微博 |
| `bilibili.parse` | 同上 | 同上 | B 站 |
| `douyin.parse` | 同上 | 同上 | 抖音 |
| `taobao.parse` | 同上 | 同上 | 淘宝 |
| `alipay.parse` | 同上 | 同上 | 支付宝（SQLite 直读路径，CSV import 走 JS） |
| `pinduoduo.parse` | 同上 | 同上 | 拼多多 |
| `jd.parse` | 同上 | 同上 | 京东 |
| `meituan.parse` | 同上 | 同上 | 美团 |
| `xiaohongshu.parse` | 同上 | 同上 | 小红书 |
| `amap.parse` | 同上 | 同上 | 高德地图 |
| `baidumap.parse` | 同上 | 同上 | 百度地图 |
| `didi.parse` | 同上 | 同上 | 滴滴出行 |
| `ctrip.parse` | 同上 | 同上 | 携程 |
| `system.parse_contacts` | `{"data_dir":"..."}` | stream NormalizedBatch chunks (Person) | 通讯录 → Person |
| `system.parse_calllog` | 同上 | stream Event(subtype=call) | 通话记录 |
| `system.parse_sms` | 同上 | stream Event(subtype=message) | 短信/彩信 |
| `system.parse_wifi` | 同上 | stream Place(category=wifi) | WiFi 记录 |
| `request.cancel` | `{"id":"req-001"}` | `{"cancelled":true}` | 取消进行中请求 |

### 3.3 错误码

| Code | 含义 | retryable |
|---|---|---|
| `SIDECAR_BOOTING` | sidecar 启动中 | true（指数退避） |
| `METHOD_NOT_FOUND` | method 名错 | false |
| `INVALID_PARAMS` | 参数 schema 不对 | false |
| `ADB_NOT_INSTALLED` | adb 命令找不到 | false（提示用户装 platform-tools） |
| `DEVICE_NOT_FOUND` | 指定 serial/udid 离线 | true |
| `EXTRACT_PERMISSION_DENIED` | 没 root / Android 备份关 | false |
| `WECHAT_KEY_INVALID` | SQLCipher PRAGMA key 失败 | false |
| `WECHAT_KEY_NOT_FOUND` | shared_prefs 拿不到 UIN | false |
| `DB_FILE_CORRUPT` | SQLite 文件损坏 | false |
| `PARSER_INTERNAL` | parser 内部异常（含 traceback） | false（issue 上报） |
| `TIMEOUT` | 超出 timeout_ms | true |
| `CANCELLED` | 被 hub 主动 cancel | false |

---

## 4. 17 Parser × Phase 映射

> **维度**：sjqz parser 文件 / 对应 Phase / sidecar method / 与 v0.2 inventory 表（Personal_Data_Hub_Architecture.md §12.1）匹配的包名

| Phase | sidecar method | sjqz file | 包名 | ROI | 备注 |
|---|---|---|---|---|---|
| 4.5 | `system.parse_contacts` | `parsers/system.py` | `com.android.providers.contacts` | ⭐⭐⭐⭐⭐ | EntityResolver 种子，电话号主键 |
| 4.5 | `system.parse_calllog` | 同上 | 同上 | ⭐⭐⭐ | Event(subtype=call) |
| 4.5 | `system.parse_sms` | 同上 | `com.android.providers.telephony` | ⭐⭐⭐ | Event(subtype=message)；隐私敏感 |
| 4.5 | `system.parse_wifi` | 同上 | `/data/misc/wifi/` | ⭐⭐ | Place(category=wifi) |
| 6 | `alipay.parse` | `parsers/ecommerce.py` | `com.eg.android.AlipayGphone` | ⭐⭐⭐⭐⭐ | CSV 走 JS 主路径，sidecar 作 SQLite 直读兜底 |
| 7 | `taobao.parse` | `parsers/ecommerce.py` | `com.taobao.taobao` | ⭐⭐⭐⭐⭐ | 字段映射现成 |
| 7 | `jd.parse` | `parsers/lifestyle.py` | `com.jingdong.app.mall` | ⭐⭐⭐⭐ | 同上 |
| 7 | `pinduoduo.parse` | `parsers/ecommerce.py` | `com.xunmeng.pinduoduo` | ⭐⭐⭐ | 同上 |
| 7 | `meituan.parse` | `parsers/lifestyle.py` | `com.sankuai.meituan` | ⭐⭐⭐⭐⭐ | 同上 |
| 9 | `amap.parse` | `parsers/amap.py` | `com.autonavi.minimap` | ⭐⭐⭐⭐⭐ | Place 主源 |
| 9 | `baidumap.parse` | `parsers/baidumap.py` | `com.baidu.BaiduMap` | ⭐⭐⭐⭐ | Place 副源（EntityResolver 合并） |
| 9 | `ctrip.parse` | `parsers/travel.py` | `ctrip.android.view` | ⭐⭐⭐⭐ | 机票/酒店/火车 |
| 9 | `didi.parse` | `parsers/travel.py` | `com.didi.es.psngr` | ⭐⭐ | 出差打车 |
| 12 | `wechat.auto_decrypt` + `wechat.parse` | `parsers/wechat.py` + `parsers/wechat_decrypt.py` | `com.tencent.mm` | ⭐⭐⭐⭐⭐ | T3 风险降级核心 |
| 13+ | `qq.parse` | `parsers/qq.py` | `com.tencent.mobileqq` | ⭐⭐ | 与微信重叠 |
| 13+ | `weibo.parse` | `parsers/social.py` | `com.sina.weibo` | ⭐⭐ | long-tail |
| 13+ | `bilibili.parse` | `parsers/social.py` | (用户未装) | — | long-tail |
| 13+ | `douyin.parse` | `parsers/douyin.py` | `com.ss.android.ugc.aweme` | ⭐⭐⭐ | long-tail |
| 13+ | `xiaohongshu.parse` | `parsers/lifestyle.py` | `com.xingin.xhs` | ⭐⭐⭐⭐ | long-tail |
| (v2+) | `whatsapp.parse` | `parsers/whatsapp.py` | `com.whatsapp` | — | 中国大陆用户少；境外用户场景 |
| (v2+) | `telegram.parse` | `parsers/telegram.py` | `org.telegram.messenger` | — | 同上 |

**覆盖率**：sjqz 17 parser 中 **16 个直接复用**，仅 `whatsapp` / `telegram` defer 到 v2+（用户实际场景驱动）。

---

## 5. sjqz Fork 改造点

> **fork 仓库**：`packages/personal-data-hub-bridge/`（Python 子目录在 monorepo 内）；上游不 PR 回 sjqz（License MIT 兼容，保留 Copyright 行）

### 5.1 改造清单

| sjqz 原能力 | 现状 | forensics-bridge 改造 |
|---|---|---|
| `cli.py` argparse + print 表格 | 人机交互 | **重写为 `ipc_server.py`** — stdin/stdout JSON-lines loop |
| parsers/*.py 返回 dataclass list | 直接给 CLI | **加 `to_normalized_batch()` 方法** — dataclass → UnifiedSchema JSON |
| `extractor.py` 用 print 报进度 | stdout 直接打字 | **走 `emit_progress(id, processed, total)`** 发 IPC progress 事件 |
| 错误抛 Exception | CLI traceback | **wrap 成 IPC error envelope**，含 code + msg + 是否 retryable |
| 默认编码 cp936（Windows） | 中文乱码常见 | **强制 UTF-8** — stdin/stdout `sys.reconfigure(encoding='utf-8')` |
| `pysqlcipher3` 可选依赖 | import 失败软降级 | **require**；打包时强制带 SQLCipher binding |
| 报告生成 `reports/` | HTML / Excel | **删除**（hub 自己渲染 UI，不依赖 sidecar HTML） |
| `exporters/` | JSON / CSV 导出 | **删除**（hub 走自己的导出管道） |
| `web/` Flask UI | 内置 web UI | **删除**（hub UI 唯一入口） |

### 5.2 NormalizedBatch builder

每个 parser 加一个 `to_normalized_batch(self, raw_records) -> dict`：

```python
def to_normalized_batch(self, messages: List[WeChatMessage]) -> dict:
    """sjqz WeChatMessage → UnifiedSchema NormalizedBatch"""
    events = []
    persons_by_id = {}
    for msg in messages:
        # 抽 Person
        if msg.talker not in persons_by_id:
            persons_by_id[msg.talker] = {
                "id": f"person:wechat:{msg.talker}",
                "type": "person",
                "subtype": "contact" if not msg.is_group else "unknown",
                "names": [msg.talker_nick] if msg.talker_nick else [msg.talker],
                "identifiers": {"wechatId": msg.talker},
                "source": {
                    "adapter": "wechat",
                    "adapterVersion": "0.1.0",
                    "capturedBy": "sqlite",
                    "capturedAt": int(msg.create_time.timestamp() * 1000),
                },
                "ingestedAt": int(time.time() * 1000),
                "confidence": 1.0,
            }
        # 抽 Event
        events.append({
            "id": f"event:wechat:{msg.msg_id}",
            "type": "event",
            "subtype": "message",
            "occurredAt": int(msg.create_time.timestamp() * 1000),
            "actor": f"person:wechat:{msg.talker}" if msg.is_send == 0 else "person:self",
            "participants": [f"person:wechat:{msg.talker}"],
            "content": {"text": msg.parsed_content},
            "source": {
                "adapter": "wechat",
                "adapterVersion": "0.1.0",
                "originalId": msg.msg_id,
                "capturedBy": "sqlite",
                "capturedAt": int(msg.create_time.timestamp() * 1000),
            },
            "ingestedAt": int(time.time() * 1000),
            "confidence": 1.0,
            "extra": {"is_group": msg.is_group, "msg_type": msg.type},
        })
    return {
        "events": events,
        "persons": list(persons_by_id.values()),
        "places": [],
        "items": [],
    }
```

### 5.3 IPC Server 骨架

```python
# packages/personal-data-hub-bridge/forensics_bridge/ipc_server.py
import json
import sys
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

import sys
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')

from .dispatcher import METHODS, dispatch

EXECUTOR = ThreadPoolExecutor(max_workers=4)
PENDING = {}  # id → Future

def emit(envelope):
    sys.stdout.write(json.dumps(envelope, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def emit_progress(req_id, processed, total, phase=""):
    emit({"id": req_id, "type": "progress",
          "data": {"processed": processed, "total": total, "phase": phase}})

def emit_chunk(req_id, batch):
    emit({"id": req_id, "type": "chunk", "data": batch})

def emit_result(req_id, data):
    emit({"id": req_id, "type": "result", "data": data})
    PENDING.pop(req_id, None)

def emit_error(req_id, code, msg, retryable=False):
    emit({"id": req_id, "type": "error",
          "error": {"code": code, "msg": msg, "retryable": retryable}})
    PENDING.pop(req_id, None)

def handle_request(req):
    req_id = req.get("id") or str(uuid.uuid4())
    method = req.get("method")
    params = req.get("params", {})
    try:
        if method == "request.cancel":
            f = PENDING.get(params.get("id"))
            if f:
                f.cancel()
            emit_result(req_id, {"cancelled": bool(f)})
            return
        if method not in METHODS:
            emit_error(req_id, "METHOD_NOT_FOUND", f"unknown method: {method}")
            return
        fut = EXECUTOR.submit(
            dispatch, method, params,
            lambda p, t, ph="": emit_progress(req_id, p, t, ph),
            lambda b: emit_chunk(req_id, b),
        )
        PENDING[req_id] = fut
        try:
            result = fut.result(timeout=req.get("timeout_ms", 60000) / 1000.0)
            emit_result(req_id, result)
        except TimeoutError:
            emit_error(req_id, "TIMEOUT", "exceeded timeout_ms", retryable=True)
    except Exception as exc:  # pragma: no cover
        emit_error(req_id, "PARSER_INTERNAL",
                   f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"id": None, "type": "error",
                  "error": {"code": "INVALID_JSON", "msg": str(e)}})
            continue
        handle_request(req)

if __name__ == "__main__":
    main()
```

---

## 6. Hub 侧 Supervisor

### 6.1 SidecarSupervisor

```typescript
// packages/personal-data-hub/lib/sidecar/supervisor.js
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

export class SidecarSupervisor extends EventEmitter {
  constructor({ binaryPath, healthCheckIntervalMs = 30000 }) {
    super();
    this.binaryPath = binaryPath;
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.proc = null;
    this.pending = new Map(); // id → { resolve, reject, onProgress, onChunk }
  }

  async start() {
    this.proc = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => this._handleEnvelope(JSON.parse(line)));
    this.proc.stderr.on("data", (b) => this.emit("log", b.toString("utf8")));
    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      // 重启策略：crashLoop 检测 + 指数退避，外层调用决策
    });
    await this.invoke("sidecar.ping", {}, { timeoutMs: 5000 });
    this._scheduleHealthCheck();
  }

  invoke(method, params, { timeoutMs = 60000, onProgress, onChunk } = {}) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TIMEOUT ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        onProgress,
        onChunk,
      });
      this.proc.stdin.write(JSON.stringify({ id, method, params, timeout_ms: timeoutMs }) + "\n");
    });
  }

  _handleEnvelope(env) {
    const p = this.pending.get(env.id);
    if (!p) return;
    if (env.type === "progress") p.onProgress?.(env.data);
    else if (env.type === "chunk") p.onChunk?.(env.data);
    else if (env.type === "result") { this.pending.delete(env.id); p.resolve(env.data); }
    else if (env.type === "error") { this.pending.delete(env.id); p.reject(env.error); }
  }

  _scheduleHealthCheck() { /* 每 30s ping，超时重启 */ }
  async stop() { /* SIGTERM → wait 5s → SIGKILL */ }
}
```

### 6.2 PythonSidecarAdapter 基类

```javascript
// packages/personal-data-hub/lib/adapters/_python-sidecar-base.js
export class PythonSidecarAdapter {
  constructor({ name, sidecarMethod, supervisor }) {
    this.name = name;
    this.sidecarMethod = sidecarMethod;
    this.supervisor = supervisor;
  }
  async *sync(opts) {
    let lastBatch;
    await this.supervisor.invoke(this.sidecarMethod, {
      ...opts,
      since_watermark: opts.sinceWatermark,
    }, {
      timeoutMs: 600_000,
      onChunk: (batch) => { lastBatch = batch; /* yield 在 async iterator 外层 */ },
    });
    // 简化：完整 stream pattern 见 supervisor.invokeStream
  }
}
```

---

## 7. 打包策略

### 7.1 三平台 build

| 平台 | 工具 | 输出 |
|---|---|---|
| Windows | PyInstaller `--onefile --windowed` | `forensics-bridge.exe` (~30-50MB) |
| macOS | PyInstaller `--onefile` + codesign + notarize | `forensics-bridge` (~30-50MB) |
| Linux | PyInstaller `--onefile` | `forensics-bridge` (~30-50MB) |
| Android | **N/A** — 走原生 adapter | (Android 端不调 sidecar) |
| iOS | **N/A** — 走原生 adapter | (iOS 端不调 sidecar) |

**前置依赖**：
- Python 3.11+ (3.10 EOL 2026-10，避免)
- `pysqlcipher3`：Windows 需预编译 wheel（参考 `nicholaschum/pysqlcipher3`）；Mac/Linux 走 `libsqlcipher-dev` apt/brew
- `pymobiledevice3`：iOS 提取必备，pure-python，跨平台无问题
- `adb`：不打进 sidecar，提示用户装 Android platform-tools

### 7.2 Release 流水

```yaml
# .github/workflows/release.yml 加 build-forensics-bridge job
build-forensics-bridge:
  strategy:
    matrix:
      os: [windows-latest, macos-latest, ubuntu-latest]
  steps:
    - uses: actions/setup-python@v5
      with: { python-version: "3.11" }
    - run: pip install -r packages/personal-data-hub-bridge/requirements.txt pyinstaller
    - run: cd packages/personal-data-hub-bridge && pyinstaller forensics-bridge.spec
    - uses: actions/upload-artifact@v4
      with:
        name: forensics-bridge-${{ matrix.os }}
        path: packages/personal-data-hub-bridge/dist/forensics-bridge*
```

打包产物作为 release asset 上传；desktop installer (NSIS / DMG) afterPack hook 复制到 `app.asar.unpacked/sidecar/`。

### 7.3 与 ai-service 隔离

| 维度 | `backend/ai-service` (FastAPI) | `forensics-bridge` (sidecar) |
|---|---|---|
| 启动方式 | Docker / 用户后台跑 | hub 主进程 spawn |
| 端口 | 暴露 HTTP :8000 | 不开端口（stdio only） |
| 生命周期 | 与 Ollama 同长寿 | 按需 spawn，闲置 5 分钟自杀 |
| 资源 | 持续占内存（模型 cache） | 用完即释 |
| 部署 | 可选服务（用户主动起） | 与桌面 app 绑定，无需用户配置 |
| Python 版本 | 3.10（既定） | 3.11+（独立锁定） |

**独立 venv / 独立 PyInstaller binary** — 两边不共享依赖，避免 `pysqlcipher3` 等只 sidecar 用的库污染 ai-service。

---

## 8. 安全模型

### 8.1 sidecar 权限边界

- **文件系统**：仅可读 hub 通过 params 显式指定的路径；不允许 sidecar 自己扫盘
- **网络**：默认禁出网（hub 可加 firewall sandbox / Linux namespaces / macOS sandbox-exec）；adapter 必需的源 app API 必须在 `dataDisclosure` 显式声明
- **密钥**：sidecar 不持久化任何密钥；hub 临时下发 → sidecar 用 → 返回后内存 zero-fill
- **进程**：sidecar 不应启 child process（execve）；adapter 需要的 `adb` 等命令由 hub 一侧管控

### 8.2 审计

每个 IPC 调用 hub 一侧记录：
```
audit_log {
  ts, method, params_redacted, status, duration_ms, events_emitted, error_code?
}
```

`params_redacted` 把 WeChat key / SQLCipher 密码等敏感字段 mask（仅留首尾 2 字符 + 长度）。

### 8.3 Sandboxing 增强（v2+）

- Linux：seccomp + namespaces
- macOS：`sandbox-exec` profile
- Windows：Job Object + integrity level low
- 全部默认开（v0 先不做，先靠"sidecar 独立进程 + 不持密钥 + 不出网"三道防线）

---

## 9. 测试策略

### 9.1 sidecar 单测（Python pytest）

- 每个 parser 接 fixture SQLite（脱敏后的真实样本）→ 断言 NormalizedBatch 字段
- IPC envelope 序列化 / 反序列化 round-trip
- 错误码分支全覆盖（key 错 / db 不存在 / 字段 corrupt）

### 9.2 桥接集成测（Node vitest + spawn）

- 启 sidecar → invoke `sidecar.ping` 应 < 1s
- invoke `wechat.parse` mock db → 验 chunk 多次到达 + result 终态
- timeout / cancel / crash 三场景 SidecarSupervisor 恢复正常

### 9.3 真机 E2E

- Phase 4.5 验收：Redmi 24115RA8EC ADB → sidecar `android.extract` `com.android.providers.contacts` → `system.parse_contacts` → 200+ 条 Person 入 LocalVault
- Phase 12 验收：同机 `com.tencent.mm` → `wechat.auto_decrypt` 拿 key → `wechat.parse` → 5 年消息全部入库 ≤ 30 分钟

---

## 10. Open Questions

### OQ-S1：sidecar 是否应支持热重启

**A**：crash 后立即重启（高可用）
**B**：crash 后等下次 invoke 才重启（懒）
**C**：crash 3 次内退避重启，超过用户介入

**推荐 C**。理由：sidecar crash 罕见但若反复 crash 通常是数据损坏 / 依赖 broken，自动重启会形成日志风暴；3 次给瞬时故障容忍空间，超过强制人介入。

### OQ-S2：sidecar 与 `backend/ai-service` 是否合并

**A**：独立（采纳，见 §7.3）
**B**：合并到 ai-service，加 `/sidecar/*` 路由

**推荐 A**。理由：(1) 生命周期不同（ai-service 长寿、sidecar 按需）；(2) ai-service 可选（用户可不启），sidecar 与 hub 绑定；(3) 依赖隔离避免污染。

### OQ-S3：IPC 编码

**A**：JSON-lines（采纳）
**B**：MessagePack（更紧凑）
**C**：JSON-RPC 2.0

**推荐 A**。理由：(1) 调试友好（直接 cat 看）；(2) Python/Node 双 native 支持；(3) 流式 chunk 天然适配。

### OQ-S4：sjqz 上游同步策略

**A**：定期 rebase（跟随上游）
**B**：fork 后断开（独立维护）
**C**：选择性 cherry-pick（关键修复才合）

**推荐 C**。理由：(1) sjqz 设计目标（取证导出）与中台目标（中台采集）已分叉，全 rebase 会冲突；(2) 关键 parser bug fix / 新 app 适配可单独 cherry-pick；(3) 上游 README / CLI / web 子树全删，rebase 必有大量冲突。

---

## 11. 后续演进

- v0.2：Sandboxing（seccomp / sandbox-exec / Win Job Object）
- v0.3：sidecar pool（多实例并发跑不同 adapter）
- v0.4：sidecar 内嵌轻量 LLM（OCR 兜底，与 hub Ollama 分离避免抢资源）
- v0.5：上游回贡（sjqz fork 关键修复 PR 回去）

---

## 12. 参考

- 上游 [sjqz](file://C:/code/sjqz) — fork 基线
- [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md) v0.3 — 主架构文档
- [`Adapter_System_Data.md`](./Adapter_System_Data.md) — Phase 4.5 首个 sidecar 落地 adapter
- 既有 `backend/ai-service/` — Python 服务部署先例
- `pymobiledevice3`、`pysqlcipher3` — sidecar 关键依赖

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 为什么是 sidecar」。Personal Data Hub Python Sidecar（forensics-bridge）把 sjqz 的 17 个 parser + iOS/Android extraction 以独立 Python 进程供 Hub 调用，配套 Architecture v0.3。

### 2. 核心特性

17 parser × Phase 映射；IPC 协议；sjqz fork 改造；Hub 侧 Supervisor；打包策略。

### 3. 系统架构

见正文「2. 架构」（Hub Node ↔ IPC ↔ Python sidecar ↔ sjqz parser）。

### 4. 系统定位

PDH 的**Python 取证桥（forensics-bridge）sidecar**。

### 5. 核心功能

见正文 3–7：IPC 协议 / 17 parser 映射 / fork 改造点 / Supervisor / 打包。

### 6. 技术架构

Python sidecar；`pymobiledevice3`（iOS）+ `pysqlcipher3`（SQLCipher）；复用 `backend/ai-service/` 部署先例。

### 7. 系统特点

进程隔离（Python 取证库不污染 Node）；首个落地 adapter = `Adapter_System_Data.md`（Phase 4.5）。

### 8. 应用场景

需要 Python-only 取证能力（iOS 备份解析 / WeChat 解密等）的 adapter。

### 9. 竞品对比

sidecar（进程隔离）vs 纯 Node 实现（见正文 1 为什么是 sidecar）。

### 10. 配置参考

sidecar method 列表见正文 §3.2；关键依赖 `pymobiledevice3` / `pysqlcipher3`。

### 11. 性能指标

IPC 往返 + Python 解析时延；随数据量线性。

### 12. 测试覆盖

各 parser 复用 sjqz 既有测试；Hub 侧 Supervisor 集成测试。

### 13. 安全考虑

取证库处理高敏感本机数据；sidecar 仅本机；输出经 LocalVault 加密。

### 14. 故障排除

Python 依赖缺失 / sidecar 启动失败 → 见正文 6 Supervisor + 7 打包策略。

### 15. 关键文件

forensics-bridge sidecar；sjqz `parsers/*`；`backend/ai-service/`（部署先例）。

### 16. 使用示例

见正文 §3 IPC 协议与 §3.2 sidecar method 调用。

### 17. 相关文档

见正文「12. 参考」：`Personal_Data_Hub_Architecture.md`、`Adapter_System_Data.md`、上游 sjqz。
