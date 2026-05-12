package com.chainlesschain.android.auto

import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template

/**
 * v1.2 #1 Android Auto Phase 0 — Voice Mode 占位 Screen。
 *
 * Phase 0：仅显示 "Voice Mode 准备中…" + Refresh action（未来 Phase 1 替成 Mic 按钮
 * → 调 AsrEngineRouter）。MessageTemplate 是 Auto template-set 里最简单的，符合
 * Auto template constraints (https://developer.android.com/training/cars/apps#templates)。
 *
 * Phase 1 改造点：
 *   1. 改用 [androidx.car.app.model.Pane] 或自定义 voice-action template
 *   2. Mic 按钮 onClick → [AsrEngineRouter.recognize] → [P2PChatClient.send]
 *   3. 接 Auto host 的 long-press steering-wheel voice key（系统级 intent）
 */
class VoiceModeScreen(carContext: CarContext) : Screen(carContext) {

    override fun onGetTemplate(): Template {
        return MessageTemplate.Builder("Voice Mode 准备中…\n\n开车场景仅支持语音对话。")
            .setTitle("ChainlessChain Voice")
            .setHeaderAction(Action.APP_ICON)
            .addAction(
                Action.Builder()
                    .setTitle("刷新")
                    .setBackgroundColor(CarColor.PRIMARY)
                    .setOnClickListener { invalidate() }
                    .build(),
            )
            .build()
    }
}
