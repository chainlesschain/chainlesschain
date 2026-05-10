package com.chainlesschain.android.core.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

// ChainlessChain 品牌色板 —— 视觉对齐 Claude app（暖珊瑚橙 + 暖灰底）
// 启动 splash 仍保留紫色作为品牌瞬间，跟主题色板互补不冲突。
private val ClaudeCoral = Color(0xFFD97757)         // primary
private val ClaudeCoralDeep = Color(0xFFC15F40)     // pressed/active
private val ClaudeCoralPale = Color(0xFFF5E0D6)     // primaryContainer light
private val ClaudeCoralOnDark = Color(0xFF3E2820)   // primaryContainer dark backing

private val LightBg = Color(0xFFFAF9F5)             // 米白底（不刺眼）
private val LightSurface = Color(0xFFFFFFFF)
private val LightSurfaceVariant = Color(0xFFF1EEE5)
private val LightOnBg = Color(0xFF1F1E1B)
private val LightOnSurfaceVariant = Color(0xFF6F6B61)
private val LightOutline = Color(0xFFE5E1D8)
private val LightOutlineVariant = Color(0xFFEDE9DE)

private val DarkBg = Color(0xFF262624)              // 暖灰，不冷蓝
private val DarkSurface = Color(0xFF30302E)
private val DarkSurfaceVariant = Color(0xFF3A3A37)
private val DarkOnBg = Color(0xFFEDEAE0)
private val DarkOnSurfaceVariant = Color(0xFFA8A496)
private val DarkOutline = Color(0xFF3E3D3A)
private val DarkOutlineVariant = Color(0xFF35342F)

private val DarkColorScheme = darkColorScheme(
    primary = ClaudeCoral,
    onPrimary = Color.White,
    primaryContainer = ClaudeCoralOnDark,
    onPrimaryContainer = ClaudeCoralPale,
    secondary = Color(0xFF7DA8B8),
    onSecondary = Color.White,
    tertiary = Color(0xFFB8AB8A),
    onTertiary = Color.White,
    background = DarkBg,
    onBackground = DarkOnBg,
    surface = DarkSurface,
    onSurface = DarkOnBg,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,
    error = Color(0xFFE36F61),
    onError = Color.White,
    errorContainer = Color(0xFF4A2522),
    onErrorContainer = Color(0xFFFFD0CC),
)

private val LightColorScheme = lightColorScheme(
    primary = ClaudeCoral,
    onPrimary = Color.White,
    primaryContainer = ClaudeCoralPale,
    onPrimaryContainer = ClaudeCoralDeep,
    secondary = Color(0xFF5A8A9C),
    onSecondary = Color.White,
    tertiary = Color(0xFF8B7B5E),
    onTertiary = Color.White,
    background = LightBg,
    onBackground = LightOnBg,
    surface = LightSurface,
    onSurface = LightOnBg,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline,
    outlineVariant = LightOutlineVariant,
    error = Color(0xFFB3261E),
    onError = Color.White,
    errorContainer = Color(0xFFFADBD7),
    onErrorContainer = Color(0xFF410E0B),
)

/**
 * ChainlessChain主题
 *
 * @param darkTheme 是否使用暗色主题
 * @param dynamicColor 是否使用动态颜色（Android 12+）
 * @param content 应用内容
 */
@Composable
fun ChainlessChainTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // 默认关闭 dynamicColor —— 否则 Android 12+ 会用系统主题色覆盖品牌珊瑚橙
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }

        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            // 使用透明状态栏以支持边到边显示
            window.statusBarColor = Color.Transparent.toArgb()
            window.navigationBarColor = Color.Transparent.toArgb()

            // 配置状态栏和导航栏的图标颜色
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = !darkTheme
            insetsController.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    val animatedColorScheme = colorScheme.animate()

    MaterialTheme(
        colorScheme = animatedColorScheme,
        typography = Typography,
        content = content
    )
}

/**
 * Animate ColorScheme transitions for smooth dark/light mode switching
 */
@Composable
private fun ColorScheme.animate(durationMs: Int = 400): ColorScheme {
    val animSpec = tween<Color>(durationMillis = durationMs)
    return copy(
        primary = animateColorAsState(primary, animSpec, label = "primary").value,
        onPrimary = animateColorAsState(onPrimary, animSpec, label = "onPrimary").value,
        primaryContainer = animateColorAsState(primaryContainer, animSpec, label = "primaryContainer").value,
        onPrimaryContainer = animateColorAsState(onPrimaryContainer, animSpec, label = "onPrimaryContainer").value,
        secondary = animateColorAsState(secondary, animSpec, label = "secondary").value,
        onSecondary = animateColorAsState(onSecondary, animSpec, label = "onSecondary").value,
        secondaryContainer = animateColorAsState(secondaryContainer, animSpec, label = "secondaryContainer").value,
        onSecondaryContainer = animateColorAsState(onSecondaryContainer, animSpec, label = "onSecondaryContainer").value,
        tertiary = animateColorAsState(tertiary, animSpec, label = "tertiary").value,
        onTertiary = animateColorAsState(onTertiary, animSpec, label = "onTertiary").value,
        background = animateColorAsState(background, animSpec, label = "background").value,
        onBackground = animateColorAsState(onBackground, animSpec, label = "onBackground").value,
        surface = animateColorAsState(surface, animSpec, label = "surface").value,
        onSurface = animateColorAsState(onSurface, animSpec, label = "onSurface").value,
        surfaceVariant = animateColorAsState(surfaceVariant, animSpec, label = "surfaceVariant").value,
        onSurfaceVariant = animateColorAsState(onSurfaceVariant, animSpec, label = "onSurfaceVariant").value,
        error = animateColorAsState(error, animSpec, label = "error").value,
        onError = animateColorAsState(onError, animSpec, label = "onError").value,
        errorContainer = animateColorAsState(errorContainer, animSpec, label = "errorContainer").value,
        onErrorContainer = animateColorAsState(onErrorContainer, animSpec, label = "onErrorContainer").value,
        outline = animateColorAsState(outline, animSpec, label = "outline").value,
        inverseSurface = animateColorAsState(inverseSurface, animSpec, label = "inverseSurface").value,
        inverseOnSurface = animateColorAsState(inverseOnSurface, animSpec, label = "inverseOnSurface").value,
        inversePrimary = animateColorAsState(inversePrimary, animSpec, label = "inversePrimary").value
    )
}
