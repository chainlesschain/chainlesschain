package com.chainlesschain.android.feature.auth.presentation.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

/**
 * PIN码输入指示器
 *
 * 显示6个圆点，已输入的显示实心，未输入的显示空心
 */
@Composable
fun PinIndicator(
    pinLength: Int,
    modifier: Modifier = Modifier,
    shake: Boolean = false
) {
    val shakeAnimation = remember { Animatable(0f) }

    LaunchedEffect(shake) {
        if (shake) {
            shakeAnimation.animateTo(
                targetValue = 0f,
                animationSpec = tween(durationMillis = 0)
            )
            repeat(3) {
                shakeAnimation.animateTo(
                    targetValue = -10f,
                    animationSpec = tween(durationMillis = 50)
                )
                shakeAnimation.animateTo(
                    targetValue = 10f,
                    animationSpec = tween(durationMillis = 50)
                )
            }
            shakeAnimation.animateTo(
                targetValue = 0f,
                animationSpec = tween(durationMillis = 50)
            )
        }
    }

    Row(
        modifier = modifier.graphicsLayer { translationX = shakeAnimation.value },
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        repeat(6) { index ->
            PinDot(filled = index < pinLength)
        }
    }
}

@Composable
private fun PinDot(filled: Boolean) {
    Box(
        modifier = Modifier
            .size(16.dp)
            .clip(CircleShape)
            .then(
                if (filled) {
                    Modifier.background(MaterialTheme.colorScheme.primary)
                } else {
                    Modifier.border(
                        width = 2.dp,
                        color = MaterialTheme.colorScheme.outline,
                        shape = CircleShape
                    )
                }
            )
    )
}

/**
 * 数字键盘
 */
@Composable
fun NumberKeypad(
    onNumberClick: (Int) -> Unit,
    onDeleteClick: () -> Unit,
    onBiometricClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 第一行: 1 2 3
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            NumberKey(number = 1, onClick = { onNumberClick(1) }, modifier = Modifier.weight(1f))
            NumberKey(number = 2, onClick = { onNumberClick(2) }, modifier = Modifier.weight(1f))
            NumberKey(number = 3, onClick = { onNumberClick(3) }, modifier = Modifier.weight(1f))
        }

        // 第二行: 4 5 6
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            NumberKey(number = 4, onClick = { onNumberClick(4) }, modifier = Modifier.weight(1f))
            NumberKey(number = 5, onClick = { onNumberClick(5) }, modifier = Modifier.weight(1f))
            NumberKey(number = 6, onClick = { onNumberClick(6) }, modifier = Modifier.weight(1f))
        }

        // 第三行: 7 8 9
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            NumberKey(number = 7, onClick = { onNumberClick(7) }, modifier = Modifier.weight(1f))
            NumberKey(number = 8, onClick = { onNumberClick(8) }, modifier = Modifier.weight(1f))
            NumberKey(number = 9, onClick = { onNumberClick(9) }, modifier = Modifier.weight(1f))
        }

        // 第四行: 生物识别/空 0 删除
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 左侧：生物识别按钮（如果支持）
            if (onBiometricClick != null) {
                BiometricKey(
                    onClick = onBiometricClick,
                    modifier = Modifier.weight(1f)
                )
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }

            // 中间：0
            NumberKey(number = 0, onClick = { onNumberClick(0) }, modifier = Modifier.weight(1f))

            // 右侧：删除
            DeleteKey(onClick = onDeleteClick, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun NumberKey(
    number: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    androidx.compose.material3.FilledTonalButton(
        onClick = onClick,
        modifier = modifier.aspectRatio(1f),
        shape = CircleShape
    ) {
        Text(
            text = number.toString(),
            style = MaterialTheme.typography.headlineMedium
        )
    }
}

@Composable
private fun DeleteKey(
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    androidx.compose.material3.OutlinedButton(
        onClick = onClick,
        modifier = modifier.aspectRatio(1f),
        shape = CircleShape
    ) {
        Text(
            text = "⌫",
            style = MaterialTheme.typography.headlineMedium
        )
    }
}

@Composable
private fun BiometricKey(
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    androidx.compose.material3.OutlinedButton(
        onClick = onClick,
        modifier = modifier.aspectRatio(1f),
        shape = CircleShape
    ) {
        Text(
            text = "👆",
            style = MaterialTheme.typography.headlineMedium
        )
    }
}
