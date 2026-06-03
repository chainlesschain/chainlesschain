package com.chainlesschain.android.presentation.aistudy

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 孩子学习档案 (学段 / 学科 / 昵称) 持久化。
 *
 * 这些是"设置"性质字段，非私密聊天 —— 落 SharedPreferences 即可。
 * (陪伴 tab 的聊天内容本版本内存态不落盘，不经此 store。)
 *
 * 接口化以便 AiStudyViewModel 单测注入 fake。
 */
interface StudyProfileStore {
    val profile: StateFlow<StudyProfile>
    fun update(profile: StudyProfile)
}

@Singleton
class DefaultStudyProfileStore @Inject constructor(
    @ApplicationContext context: Context,
) : StudyProfileStore {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val _profile = MutableStateFlow(load())
    override val profile: StateFlow<StudyProfile> = _profile.asStateFlow()

    override fun update(profile: StudyProfile) {
        prefs.edit()
            .putString(KEY_GRADE, profile.grade.name)
            .putString(KEY_SUBJECT, profile.subject.name)
            .putString(KEY_NICKNAME, profile.nickname)
            .apply()
        _profile.value = profile
    }

    private fun load(): StudyProfile {
        val grade = prefs.getString(KEY_GRADE, null)
            ?.let { runCatching { GradeLevel.valueOf(it) }.getOrNull() }
            ?: GradeLevel.P4
        val subject = prefs.getString(KEY_SUBJECT, null)
            ?.let { runCatching { Subject.valueOf(it) }.getOrNull() }
            ?: Subject.MATH
        val nickname = prefs.getString(KEY_NICKNAME, null)?.ifBlank { null } ?: "同学"
        return StudyProfile(grade = grade, subject = subject, nickname = nickname)
    }

    private companion object {
        const val PREFS = "ai_study_profile"
        const val KEY_GRADE = "grade"
        const val KEY_SUBJECT = "subject"
        const val KEY_NICKNAME = "nickname"
    }
}
