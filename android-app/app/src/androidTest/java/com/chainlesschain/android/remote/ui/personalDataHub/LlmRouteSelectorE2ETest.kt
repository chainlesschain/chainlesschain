package com.chainlesschain.android.remote.ui.personalDataHub

import org.junit.Ignore
import org.junit.Test

/**
 * 2026-05-24 — Real-device E2E for the 4-route LLM picker (committed `7079de909`).
 *
 * **Status**: `@Ignore`'d (per project convention for real-device suites that need
 * a paired desktop / live Ollama / live cloud API keys — see memory
 * `pdh_social_collector_test_gap_audit` + `android_quarantined_tests_llm_hallucinated`).
 *
 * **Blockers preventing automated execution on CI:**
 *  1. CLOUD_ANDROID requires a real cloud API key (Doubao / DeepSeek / Claude),
 *     stored under SecurePreferences — not seeded in CI.
 *  2. PC_LOCAL requires a paired desktop running Ollama with a non-empty vault.
 *     The pairing handshake (Plan A/B) uses a real WebRTC signaling server.
 *  3. LAN_OLLAMA requires reachable LAN host running Ollama-compat — CI emulator
 *     network is isolated.
 *  4. LOCAL_DEVICE requires the MediaPipe .so + 1GB Qwen2.5-1.5B model on device.
 *
 * **Manual run instructions** (after unignoring locally):
 *  1. `adb install -r app/build/outputs/apk/debug/app-debug.apk`
 *  2. Launch app → 个人数据中台 → 本机数据 / 本机提问 / 提问 (各试一遍)
 *  3. Verify radio renders 4 rows, disabled state matches availability
 *  4. Tap each available radio → tap "提问" → answer surfaces (or expected error
 *     for unconfigured route).
 *
 * **Acceptance criteria per scenario:**
 *
 *  S1 — LOCAL_DEVICE (端侧 MediaPipe):
 *    - Pre: model downloaded (tab 4 banner shows READY)
 *    - Tap "本地模型" radio → 提问 → 答案在 ≤30s 内出
 *    - llmName 含 "(端侧)" 或 "(本机·直答)"
 *    - 飞机模式下仍可走通
 *
 *  S2 — CLOUD_ANDROID (手机端云 LLM):
 *    - Pre: 设置 → 大模型 配置 Doubao API key
 *    - Tap "云 LLM（手机端）" radio → 提问 → 答案在 ≤10s 内出
 *    - llmName 含 "(云)" 或厂商名
 *    - isLocal=false → UI 显 "云端" 标
 *
 *  S3 — PC_LOCAL (桌面 Ollama):
 *    - Pre: 桌面已配对 + 启动 Ollama with `qwen2.5:1.5b`
 *    - Tap "PC 本机模型" radio → 提问 → 答案 ≤15s + citation chip 可点
 *    - llmName == "ollama:qwen2.5:1.5b" (raw cc-reported name)
 *
 *  S4 — LAN_OLLAMA (用户自填 LAN URL):
 *    - Pre: 设置 → AI 后端 填 "http://<LAN host>:11434"
 *    - Tap "局域网 LLM" radio → 提问 → 答案 ≤15s
 *    - llmName 含 "@ LAN" 或 raw "llama3" 等
 *
 *  S5 — 0 routes available (全空 banner):
 *    - 卸载 app → 全新装 → 不配 API key / 不配对 / 不下端侧
 *    - 进任一 ask 屏 → errorContainer banner 显 "暂无可用 LLM"
 *
 *  S6 — 路由切换不丢已选 question 文本:
 *    - 在输入框打字 "你好"
 *    - 切换 radio (LOCAL_DEVICE → LAN_OLLAMA) — question 仍为 "你好"
 *    - 同一 VM 实例下 question 字段在 setAskRoute() 后保持
 *
 *  S7 — isLoading=true 期间 radio disabled:
 *    - 提问按钮按下 → 等待答案
 *    - 在 isLoading=true 时所有 radio 应 disabled (灰显，不能点)
 *    - 答案出后 radio 重新 enabled
 *
 *  S8 — Settings LAN URL 写入实时反映:
 *    - 在 tab 3 路由选择器看见 "局域网 LLM" 未配置
 *    - 进 Settings 输入 LAN URL "http://10.0.0.5:11434" → 返回
 *    - radio subtitle 立即变成 URL (StateFlow 实时同步)
 */
@Ignore("Real-device E2E — requires paired desktop / live API keys / LAN Ollama (see KDoc)")
class LlmRouteSelectorE2ETest {

    @Test
    fun s1_localDeviceRoute_offlineInferenceSucceeds() {
        TODO("需要 model READY + 飞机模式真机；手动跑见 KDoc S1")
    }

    @Test
    fun s2_cloudAndroidRoute_doubaoApiAnswers() {
        TODO("需要 Doubao API key 配置；手动跑见 KDoc S2")
    }

    @Test
    fun s3_pcLocalRoute_desktopOllamaAnswers() {
        TODO("需要配对桌面 + 桌面端 Ollama 在跑；手动跑见 KDoc S3")
    }

    @Test
    fun s4_lanOllamaRoute_customUrlAnswers() {
        TODO("需要 LAN host 上 Ollama 可达 (curl test 先验)；手动跑见 KDoc S4")
    }

    @Test
    fun s5_noRoutesAvailable_showsConfigBanner() {
        TODO("全新装 + 不配置任何路由；手动跑见 KDoc S5")
    }

    @Test
    fun s6_routeSwitchPreservesQuestionText() {
        TODO("切换 radio 时 question state 保持；手动跑见 KDoc S6")
    }

    @Test
    fun s7_isLoadingDisablesAllRadios() {
        TODO("提问中所有 radio 灰显；手动跑见 KDoc S7")
    }

    @Test
    fun s8_settingsLanUrlPropagatesRealtime() {
        TODO("Settings 改 URL → 路由 selector 立即反映；手动跑见 KDoc S8")
    }
}
