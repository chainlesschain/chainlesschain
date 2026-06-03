package com.chainlesschain.android.feature.familyguard.data.service

import android.content.Context
import android.os.Build
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyGuardState
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGuardServiceController
import com.chainlesschain.android.feature.familyguard.service.FamilyGuardForegroundService
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * FAMILY-05 默认实现. 用 ApplicationContext 注入避免 leaked Activity context;
 * startForegroundService 是 API 26+ 行为, 我们 minSdk=28 所以无 SDK check。
 *
 * onlyForeground 路径: Android 12+ 后台 startForeground 已不允许除非满足 FGS 启动豁免;
 * 主文档 §3.1 FAMILY-04 角色选定后立刻在前台调一次 start, 把 service 拉起 →
 * 后续 setState 走 startService (已 foreground 不会触发 12+ 限制)。
 */
@Singleton
class FamilyGuardServiceControllerImpl @Inject constructor(
    @ApplicationContext private val context: Context,
) : FamilyGuardServiceController {

    override fun setState(state: FamilyGuardState) {
        val intent = FamilyGuardForegroundService.intentToSetState(context, state)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            // minSdk=28 时此分支不会走; 保留以防未来降级 minSdk 重新激活 26+ 路径。
            context.startService(intent)
        }
    }

    override fun stop() {
        val intent = FamilyGuardForegroundService.intentToStop(context)
        context.startService(intent)
    }
}
