# Changelog

**Range**: v5.0.3.137..HEAD

---

## ✨ Features

- feat(evolution): finalize test deployment workflow (`c2f8b79`) - 2026-09-15
- feat(jetbrains/web-panel): evolution test-deployment UI for deploymentMode=test (`95196ae`) - 2026-09-15
- feat(extension): evolution test-deployment controls in config webview (`b5ae555`) - 2026-09-15
- feat(evolution): deployment profile v5 adds deploymentMode managed/test + testPrivateKeyPath (`2b2034a`) - 2026-09-15
- feat(context): propagate real request context window end-to-end (`bdee423`) - 2026-09-14
- feat(memory): wire governed semantic candidate sources (`c58cbf5`) - 2026-09-14
- feat(agent): close local Codex gap implementations (`b5afec5`) - 2026-09-14
- feat(cli): background session list pagination (Gap G10, 2026-09-13) (`5ebe18f`) - 2026-09-13
- feat(evolution): cut over ledger payload journal (`0bea0ec`) - 2026-09-13
- feat(evolution): enforce runtime revalidation admission (`287a4d8`) - 2026-09-13
- feat(evolution): assemble production eval runtime (`b576484`) - 2026-09-13
- feat:deferred-recovery-validation (`d8c704e`) - 2026-09-13
- feat(llm): add native OpenAI Responses transport (`16b99bd`) - 2026-09-13
- feat(agent): add bound deferred questions (`8eda841`) - 2026-09-13
- feat(sandbox): report enforceable runtime capabilities (`7fa21b9`) - 2026-09-13
- feat(plugin): add bound control-candidate evals (`c7b53c6`) - 2026-09-13
- feat(llm): add versioned model capability profiles (`2ed27fa`) - 2026-09-13
- feat(memory): add governed Chinese lexical recall (`1ecf2ff`) - 2026-09-12
- feat(evolution): connect authenticated Run evidence to Wiki maintenance (`3d16e8e`) - 2026-09-12
- feat(cli): enforce deployment readiness evidence (`084586a`) - 2026-09-12
- feat(evolution): fail close model egress gaps (`a81497b`) - 2026-09-12

## 🐛 Bug Fixes

- fix(release):stabilize-cli-oidc-gates (`d55de48`) - 2026-09-15
- fix(evolution): canonicalize test deployment paths (`faf6756`) - 2026-09-15
- fix(ci): setup real Python on windows-latest before CI gate integrity suite (`827c7e7`) - 2026-09-15
- fix(cli): preserve test deployment mode on reconfigure + tests (`c0e0c19`) - 2026-09-15
- fix(release): wait for exact SHA CLI gates (`beba376`) - 2026-09-15
- fix(release): align CLI lockfile and compaction fixtures (`206aa6d`) - 2026-09-15
- fix(release): gate compaction boundaries at configured window (`837da41`) - 2026-09-15
- fix(ci): pin trajectory fixture context window (`56c2d3b`) - 2026-09-14
- fix(protocol): sync context memory schema projections (`0af3801`) - 2026-09-14
- fix(cli): prevent keeper heartbeat lock starvation (`7fe50f1`) - 2026-09-13
- fix(cli): harden wiki release validation (`12a656e`) - 2026-09-13
- fix(cli): treat candidate digests as protocol metadata (`a059c42`) - 2026-09-13
- fix(cli): scope wiki maintenance digest guard (`863ab2c`) - 2026-09-13
- fix(evolution): close CLI model egress inventory (`54bb76d`) - 2026-09-13
- fix(ci): retry interrupted Vitest workers with complete report validation (`0b32c79`) - 2026-09-13
- fix(ide): separate chat composer controls (`fff2e8f`) - 2026-09-13
- fix(cli): bind cache identifiers without privacy false positives (`b15104e`) - 2026-09-13
- fix(cli): restore undeployed agent chat for 0.166.46 (`673e15d`) - 2026-09-13
- fix(evolution): separate candidate body from evidence digests (`9075858`) - 2026-09-13
- fix(evolution): separate candidate body from evidence digests (`5a37a5f`) - 2026-09-13
- fix(codex): fail closed on ambiguous app-server turns (`fb19cb5`) - 2026-09-13
- fix(eval): validate terminal evidence and model continuity (`43a0c22`) - 2026-09-12
- fix(cli): govern PR recovery smoke model ingress (`32bef51`) - 2026-09-12
- fix(ci): bind model egress validation to exact source commits (`7a1d3ff`) - 2026-09-12
- fix(cli): run PR recovery through authenticated model ingress (`6613ec6`) - 2026-09-12
- fix(evolution): fence Wiki commits with current evidence leases (`43edf20`) - 2026-09-12
- fix(hub): restore governed default SDK transports (`8cf287c`) - 2026-09-12
- fix(cli): refresh eval command help index (`3bd3101`) - 2026-09-12
- fix(backend): preserve startup with model egress denied (`15b1cd0`) - 2026-09-12
- fix(android): avoid initializing denied model clients during cleanup (`af2ec8b`) - 2026-09-12
- fix(desktop): require model workflow admission before cache access (`34de841`) - 2026-09-12
- fix(cli): expose governed model readiness (`9eb73b0`) - 2026-09-12
- fix(android): close file browser model egress (`f2d7376`) - 2026-09-12
- fix(ios): deny system model egress (`0f55ec9`) - 2026-09-12
- fix(trajectory): resolve physical temporary workspace (`e8b147b`) - 2026-09-12
- fix(ide): align release metadata and host timing (`42b6a83`) - 2026-09-12
- fix(release): govern hub egress and ide usability (`df11b2b`) - 2026-09-12
- fix(release): complete governed egress migration (`384abd7`) - 2026-09-12
- fix(cli): use canonical sub-agent runtime boundary (`f28d8c7`) - 2026-09-12
- fix(uniapp): close model bootstrap egress (`1d52e93`) - 2026-09-12
- fix(cli): preserve protected context within recovery reserve (`90fc2b5`) - 2026-09-12

## 📚 Documentation

- docs(release): add CHANGELOG entry for cc CLI 0.166.53 TEST deployment (`dba986d`) - 2026-09-15
- docs(cli/evolution): document init-test/replace-test TEST deployment flow + format pass (`33ea2d1`) - 2026-09-15
- docs(gap): record clean persistent capacity smoke (`2247216`) - 2026-09-14
- docs: 发布记录更新至 CLI 0.166.47 / Open VSX 0.37.97 / JetBrains 0.4.123（2026-09-14） (`e1397ca`) - 2026-09-14
- docs(evolution): record final repository closure (`0f8d211`) - 2026-09-13
- docs(evolution): record ledger v2 closure (`80f2fbb`) - 2026-09-13
- docs(evolution): record eval and runtime closure (`7bd62b5`) - 2026-09-13
- docs(evolution): add task completion status tables (`f941cb5`) - 2026-09-13
- docs: sync CLI release and main runtime documentation (`efc19db`) - 2026-09-13
- docs(ide): pair VS Code extension with CLI 0.166.46 (`d750ca7`) - 2026-09-13
- docs(evolution): record installed Windows runtime verification (`b2bca17`) - 2026-09-12
- docs(evolution): audit repository closure evidence and remaining gaps (`78c3104`) - 2026-09-12
- docs(analysis): add agent capability gap audit (`b758382`) - 2026-09-12
- docs(evolution): record serialized desktop regression evidence (`d73be0d`) - 2026-09-12
- docs: v5.0.3.137 release — DeepSeek V4 Flash GA default model, governed skill evolution + desktop model ingress docs (`98d7ec0`) - 2026-09-11

## 💄 Styles

- style(cli): format ledger reliability evidence (`5cb51bb`) - 2026-09-13

## ⚡ Performance

- perf(capacity): measure persistent memory and agent state (`d856e5b`) - 2026-09-13

## ✅ Tests

- test(extension/jetbrains): cover test-deployment CLI routes + status fields (`c7e4ac0`) - 2026-09-15
- test(protocol): align release metadata expectations (`682d8b3`) - 2026-09-14
- test(headless): cover deferred recovery across processes (`f414a5d`) - 2026-09-14
- test(pdh): avoid hash substring privacy flake (`3138626`) - 2026-09-13
- test(cli): assert git commands never use a shell (`199c7a4`) - 2026-09-13
- test(cli): remove git injection test runner dependency (`4dfca7f`) - 2026-09-13
- test(cli): canonicalize runtime revalidation fixture path (`9dabbf4`) - 2026-09-13
- test(cli): align Anthropic output budget contract (`f6d4875`) - 2026-09-13
- test(cli): align model ingress and capability contracts (`f4fb49a`) - 2026-09-13
- test(cli): align Anthropic output budget assertion (`5baa8b6`) - 2026-09-13
- test(cli): retry interrupted Vitest workers safely (`91dbebb`) - 2026-09-13
- test(cli): align Anthropic output budget assertion (`e3b3cc9`) - 2026-09-13
- test(cli): align release contract with fresh registry install (`0124192`) - 2026-09-13
- test(evolution): add governed learning journeys (`9416197`) - 2026-09-13
- test(evolution): add governed learning journeys (`40730a7`) - 2026-09-13
- test(cli): close smoke model connections (`fc57a65`) - 2026-09-13
- test(cli): settle terminated worker invocations (`f5b445d`) - 2026-09-12
- test(ci): verify installed evolution runtime on all platforms (`b859db3`) - 2026-09-12
- test(evolution): isolate desktop cache and compaction regressions (`52aee17`) - 2026-09-12
- test(ios): verify model egress against shipped client sources (`e907729`) - 2026-09-12
- test(cli): stabilize concurrent cache fixture (`13fe45a`) - 2026-09-12
- test(cli): preserve compatibility egress facade (`feacce0`) - 2026-09-12
- test(cli): opt in indirect model egress fixtures (`c648e8d`) - 2026-09-12
- test(cli): refresh security map producer digests (`b6fe5dc`) - 2026-09-12
- test(cli): centralize evolution ingress fixtures (`89dea72`) - 2026-09-12
- test(cli): allow isolated validation startup (`ced4b68`) - 2026-09-12
- test(cli): migrate agent e2e ingress startup (`12d491a`) - 2026-09-12
- test(cli): propagate evolution ingress to sub-agent fixtures (`4344f8a`) - 2026-09-12
- test(cli): govern direct agent provider fixtures (`8a8bd5d`) - 2026-09-12
- test(security): refresh headless runner map digest (`d2d25f2`) - 2026-09-12
- test(cli): bind agent loop fixtures to evolution ingress (`3f0c704`) - 2026-09-12
- test(desktop): stabilize followup intent latency check (`a0e57b8`) - 2026-09-12

## 🔧 Chores

- chore(ide): pair test deployment with cli 0.166.56 (`ac0e61b`) - 2026-09-15
- chore(release):prepare-cli-0.166.55 (`9552dbc`) - 2026-09-15
- chore(docs): disable GitHub auto-trigger for doc generation, generate locally (`a510a64`) - 2026-09-15
- chore(release): prepare CLI 0.166.53 (`3427599`) - 2026-09-15
- chore(release): prepare CLI 0.166.49 and IDE 0.37.99 (`25fbc7d`) - 2026-09-14
- chore(ide): pair VS Code 0.37.98 with CLI 0.166.48 (`7168d2f`) - 2026-09-14
- chore(sdk): sync vendored protocol clients (`1e72c14`) - 2026-09-14
- chore(release): version generated protocol packages (`e5ee9b9`) - 2026-09-14
- chore(release): prepare CLI 0.166.48 (`ed04668`) - 2026-09-14
- chore(ide): pair plugins with cli 0.166.47 (`e9c514a`) - 2026-09-13
- chore(release): prepare CLI 0.166.47 (`40ff1fa`) - 2026-09-13
- chore(release): roll back CLI 0.166.45 latest (`fe2e512`) - 2026-09-13
- chore(evolution): reconcile remote recovery smoke changes (`9a1d747`) - 2026-09-12
- chore(evolution): integrate installed runtime validation (`6d67c65`) - 2026-09-12
- chore(evolution): integrate remote main for closure validation (`af836e9`) - 2026-09-12

## 📦 Other

- ci(release): use npm trusted publishing (`43c6bba`) - 2026-09-14
- Merge branch 'feature/fix-actions-worker-interruption' into main (`a6120f2`) - 2026-09-13
- Merge branch 'feature/evo-p0-4-repository-closure' (`a1db1f9`) - 2026-09-13
- Merge branch 'release/cli-help-index-52aee' into main (`c814edb`) - 2026-09-13
- Merge commit 'fc57a6537e22f60ebce63bdd72e5e6c8b9317676' into feature/evo-p0-4-repository-closure (`c5c4ff2`) - 2026-09-13
- Merge commit 'b2bca174a9596b89bf684037f5ebcbb0c403d4f0' into feature/evo-p0-4-repository-closure (`e43f6fd`) - 2026-09-13

