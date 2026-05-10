package com.chainlesschain.android.remote.ui.desktop

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteDesktopScreen(
    deviceDid: String = "pc-default",
    onNavigateBack: () -> Unit,
    viewModel: RemoteDesktopViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentFrame by viewModel.currentFrame.collectAsState()
    val displays by viewModel.displays.collectAsState()
    val stats by viewModel.statistics.collectAsState()
    var inputText by remember { mutableStateOf("") }
    var renderSize by remember { mutableStateOf(IntSize(1, 1)) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.rs_desktop_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { viewModel.startSession(deviceDid) },
                    enabled = !uiState.isConnected && !uiState.isLoading
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Text(stringResource(R.string.rs_desktop_start), modifier = Modifier.padding(start = 6.dp))
                }
                Button(
                    onClick = { viewModel.stopSession() },
                    enabled = uiState.isConnected
                ) {
                    Icon(Icons.Default.Stop, contentDescription = null)
                    Text(stringResource(R.string.rs_desktop_stop), modifier = Modifier.padding(start = 6.dp))
                }
            }

            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                val frame = currentFrame
                if (frame != null) {
                    Image(
                        bitmap = frame.asImageBitmap(),
                        contentDescription = stringResource(R.string.rs_desktop_remote_frame),
                        modifier = Modifier
                            .fillMaxSize()
                            .onSizeChanged {
                                renderSize = IntSize(
                                    width = if (it.width <= 0) 1 else it.width,
                                    height = if (it.height <= 0) 1 else it.height
                                )
                            }
                            .pointerInput(uiState.isConnected, currentFrame, renderSize) {
                                if (!uiState.isConnected) return@pointerInput
                                detectTapGestures(
                                    onTap = { offset ->
                                        val frame = currentFrame ?: return@detectTapGestures
                                        val (x, y) = mapToFrameCoordinates(
                                            x = offset.x,
                                            y = offset.y,
                                            renderWidth = renderSize.width,
                                            renderHeight = renderSize.height,
                                            frameWidth = frame.width,
                                            frameHeight = frame.height
                                        )
                                        viewModel.sendMouseMove(x, y)
                                        viewModel.sendMouseClick(button = "left", double = false)
                                    },
                                    onDoubleTap = { offset ->
                                        val frame = currentFrame ?: return@detectTapGestures
                                        val (x, y) = mapToFrameCoordinates(
                                            x = offset.x,
                                            y = offset.y,
                                            renderWidth = renderSize.width,
                                            renderHeight = renderSize.height,
                                            frameWidth = frame.width,
                                            frameHeight = frame.height
                                        )
                                        viewModel.sendMouseMove(x, y)
                                        viewModel.sendMouseClick(button = "left", double = true)
                                    },
                                    onLongPress = { offset ->
                                        val frame = currentFrame ?: return@detectTapGestures
                                        val (x, y) = mapToFrameCoordinates(
                                            x = offset.x,
                                            y = offset.y,
                                            renderWidth = renderSize.width,
                                            renderHeight = renderSize.height,
                                            frameWidth = frame.width,
                                            frameHeight = frame.height
                                        )
                                        viewModel.sendMouseMove(x, y)
                                        viewModel.sendMouseClick(button = "right", double = false)
                                    }
                                )
                            }
                            .pointerInput(uiState.isConnected, currentFrame, renderSize) {
                                if (!uiState.isConnected) return@pointerInput
                                detectDragGestures(
                                    onDrag = { change, _ ->
                                        val frame = currentFrame
                                        if (frame == null) return@detectDragGestures
                                        val (x, y) = mapToFrameCoordinates(
                                            x = change.position.x,
                                            y = change.position.y,
                                            renderWidth = renderSize.width,
                                            renderHeight = renderSize.height,
                                            frameWidth = frame.width,
                                            frameHeight = frame.height
                                        )
                                        viewModel.sendMouseMove(x, y)
                                    }
                                )
                            },
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(stringResource(R.string.rs_desktop_no_frame))
                        Text(
                            text = if (uiState.isConnected) stringResource(R.string.rs_desktop_waiting_frame) else stringResource(R.string.rs_desktop_start_session_hint),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }

            displays.firstOrNull()?.let { first ->
                Button(
                    onClick = { viewModel.switchDisplay(first.id) },
                    enabled = uiState.isConnected
                ) {
                    Text(stringResource(R.string.rs_desktop_switch_display_fmt, first.id))
                }
            }

            OutlinedTextField(
                value = inputText,
                onValueChange = { inputText = it },
                label = { Text(stringResource(R.string.rs_desktop_send_text_input)) },
                modifier = Modifier.fillMaxWidth(),
                enabled = uiState.isConnected
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = {
                        if (inputText.isNotBlank()) {
                            viewModel.sendTextInput(inputText)
                            inputText = ""
                        }
                    },
                    enabled = uiState.isConnected
                ) {
                    Text(stringResource(R.string.rs_desktop_send_text))
                }
                Button(
                    onClick = { viewModel.sendMouseClick() },
                    enabled = uiState.isConnected
                ) {
                    Text(stringResource(R.string.rs_desktop_click))
                }
                Button(
                    onClick = { viewModel.sendMouseScroll(0, 120) },
                    enabled = uiState.isConnected
                ) {
                    Text(stringResource(R.string.rs_desktop_scroll_down))
                }
                Button(
                    onClick = { viewModel.sendMouseScroll(0, -120) },
                    enabled = uiState.isConnected
                ) {
                    Text(stringResource(R.string.rs_desktop_scroll_up))
                }
            }

            Text(
                text = stringResource(R.string.rs_desktop_frames_fmt, uiState.totalFrames, uiState.totalBytes),
                style = MaterialTheme.typography.bodySmall
            )
            stats?.let {
                Text(
                    text = stringResource(R.string.rs_desktop_stats_fmt, it.activeSessions, "%.1f".format(it.avgFrameSize)),
                    style = MaterialTheme.typography.bodySmall
                )
            }
            uiState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    fontWeight = FontWeight.Medium
                )
            }
        }
    }
}

private fun mapToFrameCoordinates(
    x: Float,
    y: Float,
    renderWidth: Int,
    renderHeight: Int,
    frameWidth: Int,
    frameHeight: Int
): Pair<Int, Int> {
    val safeRenderWidth = renderWidth.coerceAtLeast(1)
    val safeRenderHeight = renderHeight.coerceAtLeast(1)
    val safeFrameWidth = frameWidth.coerceAtLeast(1)
    val safeFrameHeight = frameHeight.coerceAtLeast(1)

    val mappedX = (x / safeRenderWidth * safeFrameWidth)
        .toInt()
        .coerceIn(0, safeFrameWidth - 1)
    val mappedY = (y / safeRenderHeight * safeFrameHeight)
        .toInt()
        .coerceIn(0, safeFrameHeight - 1)

    return mappedX to mappedY
}
