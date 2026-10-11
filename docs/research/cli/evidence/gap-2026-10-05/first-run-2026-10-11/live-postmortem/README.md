# 火山首次旅程实际失败与交付优化（2026-10-11）

[Actions 38121388190](https://github.com/chainlesschain/chainlesschain/actions/runs/38121388190) 在准确诊断源码 `76ad42e2782430f5d5b4fd6c5e541ed1c2638119` 完成，结论 **failure**。Ubuntu24.04.5 x64、Node22.12.0，正常公开安装 CLI0.166.97，复用同一 private installation/profile；固定项目快照 b2aa、原 verify-04 prompt，没有追加题目提示。UTC07:31:44.460–07:39:18.782。

| 阶段 | 实际结果 |
| --- | --- |
| install / configure / authenticate | 三阶段均执行并通过 |
| tool | 执行，20轮耗尽；exit3 / error_max_turns；失败 |
| artifact | 执行，候选为空；冻结检查失败；四项费用语义均 not-established |

工具轨迹有39个tool_use、44个tool_result。多出的5条是read_file的CC_TOOL_RECOVERY_PAUSED回执，public.97没有execution_started:false；不补造已执行调用，也不放宽严格trace验收。**没有write/edit调用**，候选0字节，SHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855。baseline22/22通过只能证明已有测试通过，候选suite没有执行，不能说明费用反例被检出或存活。产物检查仅在原网络隔离Docker执行；空候选没有可执行的测试suite，宿主仅静态读取/归档。

20个模型usage回执：input207647、output18764、cache_read124672；CLI工具估算 **$0.036069908**。旧public.97认证不报告usage，认证估算、整旅程估算和实际invoice保持null。没有证明provider硬额度或正式预算合规；$0.25是估算停止线。此次实跑不装入未发布费用修复。

实际结果推动以下通用优化：

- 有限预算的每个dispatch都收到准确、临时的剩余请求提示，要求为实现、focused validation和必要修复留轮数。提示不累积到历史，Infinity/zero无上限模式不注入；研究/监测仍按原任务回答。
- read-loop恢复提示明确：要求新增测试时，实际测试修改和验证仍须交付，阅读测试或已有baseline通过不算完成；继续读取前说明缺失事实。
- 默认canonical planner保留首个host policy及当前用户任务。Astra指出预算提示和goal/hook尾后缀可能使任务失去保护，已修复插入位置，并仅跳过尾system-policy寻找最后conversation/tool bundle；不跨新assistant/tool结果保护旧user，不改变消息顺序或信任等级，不可信system仍不可信。
- 诊断将error_max_turns单列为iteration-budget-exhausted，保留失败usage/估算；缺候选断言时明确标记语义无法建立，仍拒绝把空候选判成survivor/killed。原run的agent-error和旧断言文本原件不覆盖，离线重解析另存。
- json/stream-json通过真实agentLoop验证成功读→两个暂停读→实际写→完成，暂停IDs和execution_started:false保留，前次成功读不被污染。标记修复是既有未发布代码，本轮新增集成回归，没有重复实现。

最终9套回归，Windows所有者环境 Node22.22.2与WSL Linux固定Node22.12.0各 **521/521**，零skip；其中remote集成35项含默认planner首policy有/无×hook suffix有/无四组合、四种tight context拒绝且chatFn零调用、无上限及信任/历史边界。五套account-free Node合同各 **39/39**，零skip；相同用例不跨平台累加。ESLint0errors/24既有warnings、Prettier、diff及四项生成文件检查通过。

所有早期失败同时保留：初始错误码夹具25pass/2fail；Linux旧PATH缺node造成162/163和306/310；Windows旧提示末尾路径309/310；修复后宽套Windows沙箱497pass/22fail在Memory原生祖先解析前拒绝、Linux519/519。只读同身份探针确认CodexSandboxOffline对C:\Users\longfa的realpath.native报EPERM，其余祖先通过；所有者最终521/521，未放宽目录guard或safe.directory。最终新版宽套含两项补充边界，各521/521。这些环境失败不能成为正式Windows宿主验收。

新优化只做离线/本地回归，**尚未再跑付费模型**，不能宣称20轮交付失败已在模型实跑中解决；下一次实跑需要同时观察真实写入、候选执行、semantic结果及完整usage/账单。Astra只读复核发现均已落实，AI不替代独立人工预审。

[manifest](./manifest.json)共 **201份gzip双摘要原件**，含完整164个制品文件、原job/API/ZIP、失败与最终reporter及8个normalized优化源码blob。ZIP1098526字节SHA/API digest为411a4240bcd391fcd8e94a2c1ecc3e9c03b680d0fe216064483717cc9c193482；job115747字节SHA为b0a6c625eacfc25fd045bc05091c17fb4280d5461e8233de3c7ba9ca30836542。源码集合指纹 **sha256:7c4949a5ca56ccff6ba197a8ae2b45b21c10f4f11d81fbda5b362b4520bd5287**，优化提交须逐Git blob核对；原contracts18与bootstrap21不覆盖。

08:09UTC的准确76ad Actions回读：Strict5/5、公开安装1/1、费用semantic1/1成功；CLI CI11success/3running/51queued、Docker2success/4queued，均未完整结束，详见API原件。它们不转移为新优化提交的完整CI通过。

正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99** 保持，冻结计划指纹未改。独立人工预审/外部锁、可靠账单/硬额度、目标GUI/辅助技术、8h/24h/SLO、Windows/macOS durable/owner-only及完整native review仍开放；旧窗口北京时间10月12日08:00截止，延期须另建版本。本轮未合并或发行。
