package com.chainlesschain.android.feature.ai.cowork.skills.gating

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import timber.log.Timber

/**
 * Gate checks for skill availability on Android.
 *
 * Checks platform, SDK version, and required permissions before allowing execution.
 */
class SkillGating(private val context: Context) {

    /**
     * Check whether a skill passes all gate conditions.
     *
     * @return GateResult with pass/fail and reason
     */
    fun check(skill: Skill): GateResult {
        val gate = skill.metadata.gate

        // 1. Platform check — skill must support "android"
        val osList = skill.metadata.os
        if (osList.isNotEmpty() && "android" !in osList.map { it.lowercase() }) {
            return GateResult(
                passed = false,
                reason = "Skill '${skill.name}' is not supported on Android (supported: ${osList.joinToString()})"
            )
        }

        if (gate == null) return GateResult(passed = true)

        // 2. Platform gate (more specific than os field)
        gate.platform?.let { platforms ->
            if ("android" !in platforms.map { it.lowercase() }) {
                return GateResult(
                    passed = false,
                    reason = "Skill '${skill.name}' platform gate excludes Android"
                )
            }
        }

        // 3. Minimum SDK version
        gate.minSdk?.let { minSdk ->
            if (Build.VERSION.SDK_INT < minSdk) {
                return GateResult(
                    passed = false,
                    reason = "Skill '${skill.name}' requires SDK $minSdk, current is ${Build.VERSION.SDK_INT}"
                )
            }
        }

        // 4. Required Android permissions
        gate.requiredPermissions?.let { permissions ->
            val missing = permissions.filter {
                ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
            }
            if (missing.isNotEmpty()) {
                return GateResult(
                    passed = false,
                    reason = "Skill '${skill.name}' requires permissions: ${missing.joinToString()}"
                )
            }
        }

        Timber.d("SkillGating: '${skill.name}' passed all gate checks")
        return GateResult(passed = true)
    }
}

/**
 * Result of a gate check.
 */
data class GateResult(
    val passed: Boolean,
    val reason: String = ""
)
