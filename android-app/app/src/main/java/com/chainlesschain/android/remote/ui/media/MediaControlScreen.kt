package com.chainlesschain.android.remote.ui.media

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.commands.AudioDevice
import com.chainlesschain.android.remote.p2p.ConnectionState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaControlScreen(
    viewModel: MediaControlViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val currentVolume by viewModel.currentVolume.collectAsState()
    val isMuted by viewModel.isMuted.collectAsState()
    val audioDevices by viewModel.audioDevices.collectAsState()
    val playbackStatus by viewModel.playbackStatus.collectAsState()

    val isConnected = connectionState == ConnectionState.CONNECTED

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Media Control") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 错误提示
            uiState.error?.let { error ->
                item {
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(error, color = MaterialTheme.colorScheme.onErrorContainer)
                            IconButton(onClick = { viewModel.clearError() }) {
                                Icon(Icons.Default.Close, contentDescription = "Dismiss")
                            }
                        }
                    }
                }
            }

            // 音量控制
            item {
                VolumeControlCard(
                    volume = currentVolume,
                    isMuted = isMuted,
                    enabled = isConnected && !uiState.isExecuting,
                    onVolumeChange = { viewModel.setVolume(it.toInt()) },
                    onVolumeUp = { viewModel.volumeUp() },
                    onVolumeDown = { viewModel.volumeDown() },
                    onToggleMute = { viewModel.toggleMute() }
                )
            }

            // 媒体播放控制
            item {
                MediaPlaybackCard(
                    playbackStatus = playbackStatus,
                    enabled = isConnected && !uiState.isExecuting,
                    onPlayPause = { viewModel.playPause() },
                    onNext = { viewModel.nextTrack() },
                    onPrevious = { viewModel.previousTrack() },
                    onStop = { viewModel.stop() }
                )
            }

            // 音频设备列表
            item {
                Text(
                    text = "Audio Devices",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            if (audioDevices.isEmpty()) {
                item {
                    Text(
                        text = "No audio devices found",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(audioDevices) { device ->
                    AudioDeviceItem(device)
                }
            }

            // 加载指示器
            if (uiState.isExecuting) {
                item {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun VolumeControlCard(
    volume: Int,
    isMuted: Boolean,
    enabled: Boolean,
    onVolumeChange: (Float) -> Unit,
    onVolumeUp: () -> Unit,
    onVolumeDown: () -> Unit,
    onToggleMute: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Volume",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = if (isMuted) "Muted" else "$volume%",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = if (isMuted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = onVolumeDown,
                    enabled = enabled
                ) {
                    Icon(Icons.Default.VolumeDown, contentDescription = "Volume Down")
                }

                Slider(
                    value = volume.toFloat(),
                    onValueChange = onVolumeChange,
                    valueRange = 0f..100f,
                    modifier = Modifier.weight(1f),
                    enabled = enabled && !isMuted
                )

                IconButton(
                    onClick = onVolumeUp,
                    enabled = enabled
                ) {
                    Icon(Icons.Default.VolumeUp, contentDescription = "Volume Up")
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                FilterChip(
                    selected = volume <= 25,
                    onClick = { onVolumeChange(25f) },
                    label = { Text("25%") },
                    enabled = enabled
                )
                FilterChip(
                    selected = volume in 26..50,
                    onClick = { onVolumeChange(50f) },
                    label = { Text("50%") },
                    enabled = enabled
                )
                FilterChip(
                    selected = volume in 51..75,
                    onClick = { onVolumeChange(75f) },
                    label = { Text("75%") },
                    enabled = enabled
                )
                FilterChip(
                    selected = volume > 75,
                    onClick = { onVolumeChange(100f) },
                    label = { Text("100%") },
                    enabled = enabled
                )
            }

            Button(
                onClick = onToggleMute,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isMuted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
                )
            ) {
                Icon(
                    if (isMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                    contentDescription = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(if (isMuted) "Unmute" else "Mute")
            }
        }
    }
}

@Composable
private fun MediaPlaybackCard(
    playbackStatus: com.chainlesschain.android.remote.commands.PlaybackStatus?,
    enabled: Boolean,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onStop: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Media Playback",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            playbackStatus?.let { status ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    status.title?.let { Text("Title: $it", style = MaterialTheme.typography.bodyMedium) }
                    status.artist?.let { Text("Artist: $it", style = MaterialTheme.typography.bodySmall) }
                    status.album?.let { Text("Album: $it", style = MaterialTheme.typography.bodySmall) }
                    Text(
                        "Status: ${status.state ?: "Unknown"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = when (status.state) {
                            "playing" -> MaterialTheme.colorScheme.primary
                            "paused" -> MaterialTheme.colorScheme.secondary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            } ?: Text(
                "No playback info available",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                IconButton(
                    onClick = onPrevious,
                    enabled = enabled
                ) {
                    Icon(
                        Icons.Default.SkipPrevious,
                        contentDescription = "Previous",
                        modifier = Modifier.size(32.dp)
                    )
                }

                FilledIconButton(
                    onClick = onPlayPause,
                    enabled = enabled,
                    modifier = Modifier.size(56.dp)
                ) {
                    Icon(
                        if (playbackStatus?.state == "playing") Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = "Play/Pause",
                        modifier = Modifier.size(32.dp)
                    )
                }

                IconButton(
                    onClick = onNext,
                    enabled = enabled
                ) {
                    Icon(
                        Icons.Default.SkipNext,
                        contentDescription = "Next",
                        modifier = Modifier.size(32.dp)
                    )
                }

                IconButton(
                    onClick = onStop,
                    enabled = enabled
                ) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = "Stop",
                        modifier = Modifier.size(32.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun AudioDeviceItem(device: AudioDevice) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = when (device.type) {
                    "speaker" -> Icons.Default.Speaker
                    "headphones" -> Icons.Default.Headphones
                    "microphone" -> Icons.Default.Mic
                    else -> Icons.Default.Audiotrack
                },
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = if (device.isDefault == true) MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = device.name,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (device.isDefault == true) FontWeight.Bold else FontWeight.Normal
                )
                device.type?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (device.isDefault == true) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Default",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}
