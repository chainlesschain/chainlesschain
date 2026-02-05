package com.chainlesschain.android.remote.ui.system

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Screenshot
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.remote.p2p.ConnectionState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteScreenshotScreen(
    viewModel: RemoteScreenshotViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val screenshots by viewModel.screenshots.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()

    var showSettings by remember { mutableStateOf(false) }
    var showFullScreen by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            kotlinx.coroutines.delay(1500)
            viewModel.clearSaveSuccess()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Remote Screenshot") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    if (uiState.currentScreenshot != null) {
                        IconButton(onClick = { showFullScreen = true }) {
                            Icon(Icons.Default.Fullscreen, contentDescription = "Fullscreen")
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            if (connectionState == ConnectionState.CONNECTED) {
                ExtendedFloatingActionButton(
                    onClick = {
                        viewModel.takeScreenshot(
                            display = uiState.selectedDisplay,
                            format = uiState.format,
                            quality = uiState.quality
                        )
                    },
                    icon = { Icon(Icons.Default.Screenshot, null) },
                    text = { Text("Capture") },
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when {
                connectionState != ConnectionState.CONNECTED -> {
                    EmptyState("Not connected to PC", Icons.Default.CloudOff)
                }
                uiState.isTakingScreenshot -> {
                    LoadingState("Capturing screenshot...")
                }
                uiState.currentScreenshot != null -> {
                    val current = uiState.currentScreenshot!!
                    ScreenshotInfoCard(screenshot = current)

                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        ZoomableImage(screenshot = current, modifier = Modifier.fillMaxSize())

                        FloatingActionButton(
                            onClick = { viewModel.saveScreenshot(current) },
                            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                            containerColor = MaterialTheme.colorScheme.secondaryContainer
                        ) {
                            if (uiState.isSaving) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Default.Save, contentDescription = "Save")
                            }
                        }
                    }

                    if (screenshots.size > 1) {
                        ScreenshotHistorySection(
                            screenshots = screenshots,
                            currentScreenshot = current,
                            onScreenshotClick = { viewModel.selectScreenshot(it) }
                        )
                    }
                }
                else -> {
                    EmptyState("No screenshot yet", Icons.Default.Screenshot)
                }
            }

            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) {
                            Text("Close")
                        }
                    }
                ) {
                    Text(error)
                }
            }

            if (uiState.saveSuccess) {
                Snackbar(
                    modifier = Modifier.padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.CheckCircle, null)
                        Text("Saved to gallery")
                    }
                }
            }
        }
    }

    if (showSettings) {
        ScreenshotSettingsDialog(
            selectedDisplay = uiState.selectedDisplay,
            selectedFormat = uiState.format,
            quality = uiState.quality,
            onDisplayChange = { viewModel.setDisplay(it) },
            onFormatChange = { viewModel.setFormat(it) },
            onQualityChange = { viewModel.setQuality(it) },
            onDismiss = { showSettings = false }
        )
    }

    if (showFullScreen && uiState.currentScreenshot != null) {
        FullScreenImageDialog(
            screenshot = uiState.currentScreenshot!!,
            onDismiss = { showFullScreen = false }
        )
    }
}

@Composable
private fun EmptyState(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
            Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LoadingState(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            CircularProgressIndicator()
            Text(text)
        }
    }
}

@Composable
fun ScreenshotInfoCard(screenshot: ScreenshotItem) {
    val dateFormat = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }

    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            InfoItem("Resolution", "${screenshot.width}x${screenshot.height}")
            InfoItem("Display", "#${screenshot.display}")
            InfoItem("Format", screenshot.format.uppercase())
            InfoItem("Time", dateFormat.format(Date(screenshot.timestamp)).substring(11))
        }
    }
}

@Composable
fun InfoItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(value, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun ZoomableImage(screenshot: ScreenshotItem, modifier: Modifier = Modifier) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    Box(
        modifier = modifier
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 5f)
                    offset = if (scale > 1f) offset + pan else Offset.Zero
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Image(
            bitmap = screenshot.bitmap.asImageBitmap(),
            contentDescription = "Screenshot",
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y
                ),
            contentScale = ContentScale.Fit
        )
    }
}

@Composable
fun ScreenshotHistorySection(
    screenshots: List<ScreenshotItem>,
    currentScreenshot: ScreenshotItem?,
    onScreenshotClick: (ScreenshotItem) -> Unit
) {
    Column(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("History (${screenshots.size})", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(screenshots, key = { it.id }) { screenshot ->
                ScreenshotThumbnail(
                    screenshot = screenshot,
                    isSelected = screenshot.id == currentScreenshot?.id,
                    onClick = { onScreenshotClick(screenshot) }
                )
            }
        }
    }
}

@Composable
fun ScreenshotThumbnail(
    screenshot: ScreenshotItem,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.size(84.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Image(
            bitmap = screenshot.bitmap.asImageBitmap(),
            contentDescription = "Thumbnail",
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )
    }
}

@Composable
fun ScreenshotSettingsDialog(
    selectedDisplay: Int,
    selectedFormat: String,
    quality: Int,
    onDisplayChange: (Int) -> Unit,
    onFormatChange: (String) -> Unit,
    onQualityChange: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Screenshot Settings") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                SettingRow("Display") {
                    (0..2).forEach { display ->
                        FilterChip(
                            selected = selectedDisplay == display,
                            onClick = { onDisplayChange(display) },
                            label = { Text("#$display") }
                        )
                    }
                }

                SettingRow("Format") {
                    FilterChip(
                        selected = selectedFormat == "png",
                        onClick = { onFormatChange("png") },
                        label = { Text("PNG") }
                    )
                    FilterChip(
                        selected = selectedFormat == "jpeg",
                        onClick = { onFormatChange("jpeg") },
                        label = { Text("JPEG") }
                    )
                }

                Column {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Quality", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                        Text("$quality%")
                    }
                    Slider(
                        value = quality.toFloat(),
                        onValueChange = { onQualityChange(it.toInt()) },
                        valueRange = 50f..100f,
                        steps = 4
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    )
}

@Composable
private fun SettingRow(title: String, content: @Composable RowScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
fun FullScreenImageDialog(screenshot: ScreenshotItem, onDismiss: () -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black).clickable(onClick = onDismiss)
    ) {
        ZoomableImage(screenshot = screenshot, modifier = Modifier.fillMaxSize())
        IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopEnd).padding(16.dp)) {
            Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
        }
    }
}
