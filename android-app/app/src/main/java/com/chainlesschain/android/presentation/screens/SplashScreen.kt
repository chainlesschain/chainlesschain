package com.chainlesschain.android.presentation.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * 启动动画界面
 */
@Composable
fun SplashScreen(
    onAnimationEnd: () -> Unit
) {
    var animationStarted by remember { mutableStateOf(false) }

    // 启动动画
    LaunchedEffect(Unit) {
        animationStarted = true
        delay(2500) // 显示2.5秒
        onAnimationEnd()
    }

    // Logo缩放动画
    val scale by animateFloatAsState(
        targetValue = if (animationStarted) 1f else 0.3f,
        animationSpec = tween(
            durationMillis = 1000,
            easing = FastOutSlowInEasing
        ),
        label = "scale"
    )

    // Logo透明度动画
    val alpha by animateFloatAsState(
        targetValue = if (animationStarted) 1f else 0f,
        animationSpec = tween(
            durationMillis = 800,
            easing = LinearEasing
        ),
        label = "alpha"
    )

    // 文字透明度动画
    val textAlpha by animateFloatAsState(
        targetValue = if (animationStarted) 1f else 0f,
        animationSpec = tween(
            durationMillis = 800,
            delayMillis = 400,
            easing = LinearEasing
        ),
        label = "textAlpha"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.primaryContainer
                    )
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // Logo图标
            Box(
                modifier = Modifier
                    .size(120.dp)
                    .scale(scale)
                    .alpha(alpha),
                contentAlignment = Alignment.Center
            ) {
                // 可以替换为实际的Logo图片
                Icon(
                    painter = painterResource(id = android.R.drawable.ic_menu_compass),
                    contentDescription = "Logo",
                    modifier = Modifier.fillMaxSize(),
                    tint = Color.White
                )
            }

            // 应用名称
            Text(
                text = "ChainlessChain",
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White,
                modifier = Modifier.alpha(textAlpha)
            )

            // 副标题
            Text(
                text = "去中心化个人AI管理系统",
                fontSize = 14.sp,
                color = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.alpha(textAlpha)
            )

            Spacer(modifier = Modifier.height(32.dp))

            // 加载指示器
            CircularProgressIndicator(
                modifier = Modifier
                    .size(32.dp)
                    .alpha(textAlpha),
                color = Color.White,
                strokeWidth = 3.dp
            )
        }
    }
}

/**
 * 带动画效果的启动屏幕（高级版）
 */
@Composable
fun AnimatedSplashScreen(
    onAnimationEnd: () -> Unit
) {
    var currentPhase by remember { mutableStateOf(0) }

    // 控制动画阶段
    LaunchedEffect(Unit) {
        delay(500)
        currentPhase = 1  // Logo出现
        delay(800)
        currentPhase = 2  // 文字出现
        delay(1200)
        onAnimationEnd()
    }

    // 背景渐变动画
    val bgColors by animateFloatAsState(
        targetValue = if (currentPhase >= 1) 1f else 0f,
        animationSpec = tween(800),
        label = "bgAnimation"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.secondary
                    )
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Logo动画
            AnimatedLogoSection(visible = currentPhase >= 1)

            Spacer(modifier = Modifier.height(24.dp))

            // 文字动画
            AnimatedTextSection(visible = currentPhase >= 2)
        }
    }
}

@Composable
private fun AnimatedLogoSection(visible: Boolean) {
    val scale by animateFloatAsState(
        targetValue = if (visible) 1f else 0.5f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "logoScale"
    )

    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(500),
        label = "logoAlpha"
    )

    Box(
        modifier = Modifier
            .size(120.dp)
            .scale(scale)
            .alpha(alpha),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = painterResource(id = android.R.drawable.ic_menu_compass),
            contentDescription = "Logo",
            modifier = Modifier.fillMaxSize(),
            tint = Color.White
        )
    }
}

@Composable
private fun AnimatedTextSection(visible: Boolean) {
    val offsetY by animateDpAsState(
        targetValue = if (visible) 0.dp else 20.dp,
        animationSpec = tween(500),
        label = "textOffset"
    )

    val alpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = tween(500),
        label = "textAlpha"
    )

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .offset(y = offsetY)
            .alpha(alpha)
    ) {
        Text(
            text = "ChainlessChain",
            fontSize = 32.sp,
            fontWeight = FontWeight.Bold,
            color = Color.White
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "去中心化个人AI管理系统",
            fontSize = 14.sp,
            color = Color.White.copy(alpha = 0.9f)
        )

        Spacer(modifier = Modifier.height(32.dp))

        CircularProgressIndicator(
            modifier = Modifier.size(32.dp),
            color = Color.White,
            strokeWidth = 3.dp
        )
    }
}
