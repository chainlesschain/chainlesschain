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

// ChainlessChain品牌色
private val ChainlessPurple = Color(0xFF6750A4)
private val ChainlessPurpleLight = Color(0xFF8E7CC3)
private val ChainlessPurpleDark = Color(0xFF4F378B)

private val DarkColorScheme = darkColorScheme(
    primary = ChainlessPurple,
    secondary = Color(0xFF625B71),
    tertiary = Color(0xFF7D5260),
    background = Color(0xFF1C1B1F),
    surface = Color(0xFF1C1B1F),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = Color(0xFFE6E1E5),
    onSurface = Color(0xFFE6E1E5),
)

private val LightColorScheme = lightColorScheme(
    primary = ChainlessPurple,
    secondary = Color(0xFF625B71),
    tertiary = Color(0xFF7D5260),
    background = Color(0xFFFFFBFE),
    surface = Color(0xFFFFFBFE),
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = Color.White,
    onBackground = Color(0xFF1C1B1F),
    onSurface = Color(0xFF1C1B1F),
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
    dynamicColor: Boolean = true,
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
