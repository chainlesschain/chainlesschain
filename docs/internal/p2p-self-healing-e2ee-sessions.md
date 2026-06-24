# 自愈式 E2EE 会话设计 (好友聊天健壮性)

> 状态：设计 (2026-06-24)。背景见 memory `family_p2p_messaging_relay_and_followups`。
> 目标：让好友聊天的 E2EE 会话**自我恢复**，用户永不手动重新配对。

## 1. 问题陈述 (真机实测暴露)

传输层 (信令中继 `RemoteMessageRelay`/`WebRtcSignalingMessageRelay`) 已**健壮**：消息跨网/AP 隔离必达。
**脆弱的是 E2EE 会话层 (Signal X3DH + DoubleRatchet)**——任何一处出岔子就**永久失败、必须手动重配**：

| 故障 | 现象 | 现状 |
|---|---|---|
| **握手没完成** | 配对后无 X3DH session established，`sendMessage` 因 `hasSession=false` 失败 | 无自动补完 (FriendSyncConnector 会重试连接，但握手本身不一定跑) |
| **棘轮发散** | `DoubleRatchet.decrypt` 抛 `MAC verification failed`；收端 `handleIncomingText` 记日志后丢弃 | **无自动恢复**——该 peer 的后续消息全部解不开，永久卡死 |
| **重启后会话坏** | 重启 restore 出已发散的旧 session → 一发就 MAC 失败 | 并行 session `25ae582091`「重连不覆盖已恢复会话」防**未来**覆盖，但**已坏的 session 仍坏** |

**根因：E2EE 会话层没有"检测损坏 → 自动重建"的闭环。** 健壮系统应：握手失败自动重试；解密失败自动重新握手 (透明)；重建后把丢失的消息补发。

## 2. 自愈机制 (三件)

### 2.1 解密失败 → 自动重建会话 (核心)
收端 `P2PMessageRepository.handleIncomingText` 捕获到 **MAC/解密失败**时，不再只记日志，而是：
1. **删除发散的会话** (`PersistentSessionManager.deleteSession(peerId)` —— feature-p2p 已可访问 PSM)。
2. **触发重新握手** (经 seam，见 §3)：`initiate(peerDid)` 会因 session 已删→真正重跑 X3DH (而非 line 67 skip)。
3. **去抖**：同一 peer 的 recover 调用限速 (如 ≥10s 一次)，避免 MAC 失败风暴触发握手风暴。
4. 重建成功后，对端的同名 peer 也会因收到新 X3DH 而建立**全新对齐**会话。

### 2.2 握手补完 (健壮化现有重试)
配对/重连后若一定时间内仍 `getSession==null`，主动 `initiate(peerDid)` (幂等：line 67 已 skip-if-present)。
接入点：`P2PChatViewModel.startConnectionWatcher` 已轮询会话就绪——轮询到**超时仍无会话**时调一次 recover seam。

### 2.3 重建后消息补发 (不丢消息)
重建会话期间到达的消息解不开 (旧 ratchet)。发送端需要**重发**：
- 简单版：收端 recover 成功后，发一个 `RESYNC_REQUEST` 控制消息给发端；发端收到后**重发最近 N 条未 ACK 的消息** (P2PMessage 已有 `requiresAck`/`isAcknowledged` 字段 + Room 落库可查未 ACK)。
- 退化版 (先做)：不自动补发，仅保证**会话恢复后的新消息能通**——把"永久卡死"降级为"丢几条但自动恢复"。已是巨大健壮性提升。

## 3. 架构 (依赖倒置 seam，隔离并行 session 的 core-e2ee 内部改动)

复用已验证的 `RemoteMessageRelay` 同款模式 (feature-p2p 定义接口，app 实现注入)：

```
feature-p2p:  interface SessionRecovery {          // 新 seam
                  suspend fun recover(peerId: String): Boolean   // 删旧会话+重握手，去抖
              }
              P2PMessageRepository:
                - 注入 SessionRecovery? (可选,未注入=零回归)
                - handleIncomingText 捕获 MAC 失败 → recover(peerId) (限速)

app:          class WebRtcSessionRecovery : SessionRecovery {    // 新实现
                  // 1) persistentSessionManager.deleteSession(peerId)
                  // 2) friendSessionHandshake.initiate(peerId)   // 已删→真重跑 X3DH
                  // 去抖 map<peerId, lastAttemptMs>
              }
              MainActivity.onCreate: 把 WebRtcSessionRecovery 注入/attach 给 repository
                                     (同 attachRemoteRelay 模式)
```

**为何用 seam**：① 依赖方向 app→feature-p2p，repository 不能直接调 app 层 `FriendSessionHandshake`；
② 隔离并行 session 正在改的 `FriendSessionHandshake`/`PersistentSessionManager`/`E2EEHandshakeCommandRouter` 内部——
seam 只依赖它们的**公开 API** (`initiate`/`deleteSession`)，内部怎么改不影响。

## 4. 集成点 (谁改什么)

| 模块 | 改动 | 冲突风险 |
|---|---|---|
| **feature-p2p** `SessionRecovery.kt` (新) | 定义 seam 接口 | 无 (新文件) |
| **feature-p2p** `P2PMessageRepository` | handleIncomingText 捕获 MAC → recover；注入可选 seam | 低 (并行 session 也在此文件改文件传输——需协调，分函数隔离) |
| **app** `WebRtcSessionRecovery.kt` (新) | 实现 seam：deleteSession + initiate + 去抖 | 无 (新文件) |
| **app** `MainActivity` | attach seam (同 attachRemoteRelay) | 低 |
| **core-e2ee** `PersistentSessionManager` | 确认有公开 `deleteSession(peerId)` (没有则加) | **中——并行 session 正在改此文件，必须协调** |

## 5. 测试

- **纯单测** (feature-p2p)：`P2PMessageRepository` 注入 fake SessionRecovery，喂一条会 MAC 失败的消息 → 断言 recover 被调一次 + 去抖 (10s 内第二次 MAC 不再调)。
- **纯单测** (app)：`WebRtcSessionRecovery` 注入 fake PSM + fake handshake → 断言先 delete 后 initiate + 去抖 map。
- **真机 E2E** (一次性，别反复)：干净配对 → 发消息通 → 人为制造发散 (一端重启) → 发消息 → 观察**自动 recover 日志 + 几秒后消息能通** (不再需手动重配)。

## 6.0 ✅ 协调结论 (2026-06-24)：发端 force-overwrite 已由握手协议天然解决

读 `E2EEHandshakeCommandRouter.handleInit` 发现并行 session **已为自愈实现了响应方覆盖**：
- `handleInit` **从不跳过已存在会话**，总是 `acceptSession(fromDid, initialMessage)` → 覆盖响应方旧（发散）会话。
- 其注释明确："这是一侧丢失会话后的自愈路径"。
- 配合 `FriendSessionHandshake.initiate`「仅在无会话时才发 e2ee.init」：我的 `WebRtcSessionRecovery`
  **先 deleteSession 再 initiate** → initiate 见无会话 → 发 e2ee.init → 对端 handleInit 覆盖。

**故端到端自愈闭环已成立，无需改握手协议**：
1. 收端 MAC 失败 → recover：deleteSession + initiate（成为 X3DH 发起方）。
2. initiate 发 e2ee.init 给对端。
3. 对端 handleInit → acceptSession **覆盖**其旧发散会话。
4. 双方全新对齐会话。

**残留的小风险 (refinement，非阻塞)**：**glare** —— 若双向互发都 MAC 失败、两端同时 recover+initiate，
可能两轮 e2ee.init 交叉。缓解：① 10s 去抖；② 多数情况只有**收端**检测到失败（发端以为发成功），
单向触发无 glare；③ acceptSession 覆盖 → 最终收敛（可能多一轮）。彻底解可加「仅 offerer(小 DID)
发起 recover、非 offerer 发 RESYNC_REQUEST 请 offerer 重握手」，留作后续。

## 6. 与并行 session 协调 (历史，§6.0 已闭合 force-overwrite)

并行 session 正在 `FriendSessionHandshake`/`PersistentSessionManager`/`E2EEHandshakeCommandRouter`/文件传输 活跃迭代。
**分工建议**：
- **本设计的 seam (feature-p2p `SessionRecovery` + app `WebRtcSessionRecovery` + MainActivity attach)** = 新文件为主，本 session 可独立做。
- **`PersistentSessionManager.deleteSession` 公开 API** = 若缺，请并行 session (它在此文件) 加，或我加一个独立公开方法 (不碰其 handshake 内部)。
- **handleIncomingText 的 MAC 捕获点** = 与并行 session 的文件传输改动同文件 (`P2PMessageRepository`)，按函数隔离、plumbing 提交避免 index race。

## 7. 落地顺序 (增量，每步可单独验)
1. core-e2ee 确认/加 `deleteSession(peerId)` 公开 API (+单测)。
2. feature-p2p `SessionRecovery` seam 接口 (新文件)。
3. feature-p2p `P2PMessageRepository.handleIncomingText` MAC 捕获 → recover (去抖) + 注入可选 seam (+单测)。
4. app `WebRtcSessionRecovery` 实现 (deleteSession+initiate+去抖) (+单测)。
5. app `MainActivity` attach。
6. (可选,后做) §2.3 消息补发 RESYNC。
7. 真机 E2E 一次性验自愈周期。
