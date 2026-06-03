package com.chainlesschain.android.feature.filebrowser.ui.components

import android.net.Uri
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.filebrowser.R
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.chainlesschain.android.core.database.entity.ExternalFileEntity
import com.chainlesschain.android.core.database.entity.FileCategory
import kotlinx.coroutines.delay
import kotlin.time.Duration.Companion.milliseconds

/**
 * 媒体播放器组件
 *
 * 功能:
 * - 使用ExoPlayer播放视频和音频
 * - 视频播放器控制（播放/暂停、进度、全屏等）
 * - 音频播放器控制（播放/暂停、进度、音量等）
 * - 自动播放控制
 * - 播放状态管理
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun MediaPlayerScreen(
    file: ExternalFileEntity,
    uri: String
) {
    val context = LocalContext.current
    val isVideo = file.category == FileCategory.VIDEO

    // ExoPlayer instance
    val exoPlayer = remember {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
            prepare()
            playWhenReady = false // Don't auto-play
        }
    }

    // Player state
    var isPlaying by remember { mutableStateOf(false) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var bufferedPercentage by remember { mutableIntStateOf(0) }
    var showControls by remember { mutableStateOf(true) }

    // Update player state
    LaunchedEffect(exoPlayer) {
        while (true) {
            isPlaying = exoPlayer.isPlaying
            currentPosition = exoPlayer.currentPosition
            duration = exoPlayer.duration.coerceAtLeast(0L)
            bufferedPercentage = exoPlayer.bufferedPercentage
            delay(100.milliseconds)
        }
    }

    // Auto-hide controls for video
    LaunchedEffect(showControls, isPlaying) {
        if (isVideo && showControls && isPlaying) {
            delay(3000.milliseconds)
            showControls = false
        }
    }

    // Clean up player on dispose
    DisposableEffect(exoPlayer) {
        onDispose {
            exoPlayer.release()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null
            ) {
                if (isVideo) {
                    showControls = !showControls
                }
            }
    ) {
        if (isVideo) {
            // Video player view
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        player = exoPlayer
                        useController = false // Use custom controls
                        layoutParams = FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        } else {
            // Audio player - show album art placeholder
            AudioPlayerBackground(file = file)
        }

        // Custom controls overlay
        AnimatedVisibility(
            visible = showControls || !isVideo,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            MediaControls(
                isVideo = isVideo,
                isPlaying = isPlaying,
                currentPosition = currentPosition,
                duration = duration,
                bufferedPercentage = bufferedPercentage,
                onPlayPause = {
                    if (exoPlayer.isPlaying) {
                        exoPlayer.pause()
                    } else {
                        exoPlayer.play()
                    }
                },
                onSeek = { position ->
                    exoPlayer.seekTo(position)
                },
                onRewind = {
                    exoPlayer.seekTo((exoPlayer.currentPosition - 10000).coerceAtLeast(0))
                },
                onForward = {
                    exoPlayer.seekTo((exoPlayer.currentPosition + 10000).coerceAtMost(duration))
                },
                file = file
            )
        }
    }
}

/**
 * 音频播放器背景
 */
@Composable
private fun AudioPlayerBackground(file: ExternalFileEntity) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Audio icon
        Icon(
            imageVector = Icons.Default.MusicNote,
            contentDescription = null,
            modifier = Modifier.size(120.dp),
            tint = Color.White.copy(alpha = 0.7f)
        )

        Spacer(modifier = Modifier.height(32.dp))

        // File name
        Text(
            text = file.displayName,
            style = MaterialTheme.typography.headlineSmall,
            color = Color.White,
            maxLines = 2
        )

        Spacer(modifier = Modifier.height(8.dp))

        // File size
        Text(
            text = file.getReadableSize(),
            style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.7f)
        )
    }
}

/**
 * 媒体控制器
 */
@Composable
private fun MediaControls(
    isVideo: Boolean,
    isPlaying: Boolean,
    currentPosition: Long,
    duration: Long,
    bufferedPercentage: Int,
    onPlayPause: () -> Unit,
    onSeek: (Long) -> Unit,
    onRewind: () -> Unit,
    onForward: () -> Unit,
    file: ExternalFileEntity
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                if (isVideo) {
                    Color.Black.copy(alpha = 0.3f)
                } else {
                    Color.Transparent
                }
            )
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(
                    if (isVideo) {
                        Color.Black.copy(alpha = 0.7f)
                    } else {
                        MaterialTheme.colorScheme.surface
                    }
                )
                .padding(16.dp)
        ) {
            // Progress slider
            Column(modifier = Modifier.fillMaxWidth()) {
                // Time labels
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = formatTime(currentPosition),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isVideo) Color.White else MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = formatTime(duration),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (isVideo) Color.White else MaterialTheme.colorScheme.onSurface
                    )
                }

                // Progress slider
                Slider(
                    value = if (duration > 0) currentPosition.toFloat() else 0f,
                    onValueChange = { onSeek(it.toLong()) },
                    valueRange = 0f..duration.toFloat(),
                    colors = SliderDefaults.colors(
                        thumbColor = if (isVideo) Color.White else MaterialTheme.colorScheme.primary,
                        activeTrackColor = if (isVideo) Color.White else MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = if (isVideo) {
                            Color.White.copy(alpha = 0.3f)
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        }
                    )
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Control buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Rewind 10s button
                IconButton(onClick = onRewind) {
                    Icon(
                        imageVector = Icons.Default.Replay10,
                        contentDescription = stringResource(R.string.media_rewind),
                        tint = if (isVideo) Color.White else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.size(32.dp)
                    )
                }

                // Play/Pause button
                FilledIconButton(
                    onClick = onPlayPause,
                    modifier = Modifier.size(64.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = if (isVideo) {
                            Color.White.copy(alpha = 0.9f)
                        } else {
                            MaterialTheme.colorScheme.primary
                        }
                    )
                ) {
                    Icon(
                        imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (isPlaying) stringResource(R.string.media_pause) else stringResource(R.string.media_play),
                        modifier = Modifier.size(40.dp),
                        tint = if (isVideo) Color.Black else MaterialTheme.colorScheme.onPrimary
                    )
                }

                // Forward 10s button
                IconButton(onClick = onForward) {
                    Icon(
                        imageVector = Icons.Default.Forward10,
                        contentDescription = stringResource(R.string.media_forward),
                        tint = if (isVideo) Color.White else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.size(32.dp)
                    )
                }
            }

            // Additional info (for audio)
            if (!isVideo) {
                Spacer(modifier = Modifier.height(16.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    shape = MaterialTheme.shapes.small
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Info,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = stringResource(R.string.media_audio_info, file.mimeType ?: stringResource(R.string.media_unknown_format)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

/**
 * 格式化时间显示
 *
 * @param timeMs 时间（毫秒）
 * @return 格式化字符串 (MM:SS)
 */
private fun formatTime(timeMs: Long): String {
    if (timeMs < 0) return "00:00"

    val totalSeconds = timeMs / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60

    return String.format("%02d:%02d", minutes, seconds)
}
