package com.chainlesschain.android.feature.p2p.ui.social

import android.Manifest
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.chainlesschain.android.feature.p2p.viewmodel.social.QRCodeScannerViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import timber.log.Timber
import java.util.concurrent.Executors

/**
 * 二维码扫描页面
 *
 * 功能：
 * - 相机预览
 * - 实时二维码扫描（ML Kit）
 * - 扫描框引导
 * - 手电筒开关
 * - 权限请求
 *
 * @param onNavigateBack 返回上一页
 * @param onQRCodeScanned 扫描成功回调（返回二维码内容）
 * @param viewModel ViewModel
 *
 * @since v0.31.0
 */
@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun QRCodeScannerScreen(
    onNavigateBack: () -> Unit,
    onQRCodeScanned: (String) -> Unit,
    viewModel: QRCodeScannerViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraPermissionState = rememberPermissionState(Manifest.permission.CAMERA)

    val uiState by viewModel.uiState.collectAsState()
    var hasScanned by remember { mutableStateOf(false) }

    // 请求相机权限
    LaunchedEffect(Unit) {
        if (!cameraPermissionState.status.isGranted) {
            cameraPermissionState.launchPermissionRequest()
        }
    }

    // 监听扫描结果
    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is com.chainlesschain.android.feature.p2p.viewmodel.social.QRCodeScannerEvent.ScanSuccess -> {
                    if (!hasScanned) {
                        hasScanned = true
                        onQRCodeScanned(event.qrCode)
                    }
                }
                is com.chainlesschain.android.feature.p2p.viewmodel.social.QRCodeScannerEvent.ScanError -> {
                    // 可以显示Toast或Snackbar
                    Timber.e("QR scan error: ${event.message}")
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫描二维码") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    // 手电筒开关
                    if (cameraPermissionState.status.isGranted) {
                        IconButton(onClick = { viewModel.toggleFlashlight() }) {
                            Icon(
                                imageVector = if (uiState.isFlashlightOn)
                                    Icons.Default.FlashlightOff
                                else
                                    Icons.Default.FlashlightOn,
                                contentDescription = if (uiState.isFlashlightOn) "关闭手电筒" else "打开手电筒"
                            )
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (cameraPermissionState.status.isGranted) {
                // 相机预览
                CameraPreview(
                    onQRCodeDetected = { qrCode ->
                        viewModel.processQRCode(qrCode)
                    },
                    modifier = Modifier.fillMaxSize()
                )

                // 扫描框覆盖层
                ScannerOverlay()

                // 底部提示
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 48.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Surface(
                        color = Color.Black.copy(alpha = 0.6f),
                        shape = MaterialTheme.shapes.medium
                    ) {
                        Text(
                            text = "将二维码放入框内",
                            color = Color.White,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp)
                        )
                    }

                    if (uiState.isProcessing) {
                        Spacer(modifier = Modifier.height(16.dp))
                        CircularProgressIndicator(
                            modifier = Modifier.size(32.dp),
                            color = Color.White
                        )
                    }
                }
            } else {
                // 权限未授予提示
                PermissionRequestContent(
                    onRequestPermission = {
                        cameraPermissionState.launchPermissionRequest()
                    }
                )
            }
        }
    }
}

/**
 * 相机预览组件
 */
@Composable
private fun CameraPreview(
    onQRCodeDetected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

            cameraProviderFuture.addListener({
                try {
                    val cameraProvider = cameraProviderFuture.get()

                    // 预览
                    val preview = Preview.Builder()
                        .build()
                        .also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }

                    // 图像分析（二维码扫描）
                    val imageAnalysis = ImageAnalysis.Builder()
                        .setTargetResolution(Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            it.setAnalyzer(
                                cameraExecutor,
                                QRCodeAnalyzer { qrCode ->
                                    onQRCodeDetected(qrCode)
                                }
                            )
                        }

                    // 相机选择器（后置摄像头）
                    val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                    // 绑定到生命周期
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        lifecycleOwner,
                        cameraSelector,
                        preview,
                        imageAnalysis
                    )
                } catch (e: Exception) {
                    Timber.e(e, "Camera bind failed")
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
        modifier = modifier
    )

    DisposableEffect(Unit) {
        onDispose {
            cameraExecutor.shutdown()
        }
    }
}

/**
 * 二维码分析器
 */
private class QRCodeAnalyzer(
    private val onQRCodeDetected: (String) -> Unit
) : ImageAnalysis.Analyzer {

    private val scanner = BarcodeScanning.getClient()
    private var lastScanTime = 0L
    private val scanThrottle = 1000L // 1秒扫描一次，避免重复

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val currentTime = System.currentTimeMillis()

            // 节流处理
            if (currentTime - lastScanTime < scanThrottle) {
                imageProxy.close()
                return
            }

            val image = InputImage.fromMediaImage(
                mediaImage,
                imageProxy.imageInfo.rotationDegrees
            )

            scanner.process(image)
                .addOnSuccessListener { barcodes ->
                    for (barcode in barcodes) {
                        when (barcode.valueType) {
                            Barcode.TYPE_TEXT,
                            Barcode.TYPE_URL -> {
                                barcode.rawValue?.let { qrCode ->
                                    lastScanTime = currentTime
                                    onQRCodeDetected(qrCode)
                                    Timber.d("QR code detected: $qrCode")
                                }
                            }
                        }
                    }
                }
                .addOnFailureListener { e ->
                    Timber.e(e, "Barcode scanning failed")
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}

/**
 * 扫描框覆盖层
 */
@Composable
private fun ScannerOverlay() {
    Canvas(modifier = Modifier.fillMaxSize()) {
        val scanSize = size.minDimension * 0.7f
        val left = (size.width - scanSize) / 2
        val top = (size.height - scanSize) / 2

        // 半透明遮罩
        drawRect(
            color = Color.Black.copy(alpha = 0.5f),
            size = size
        )

        // 扫描框（透明区域）
        drawRect(
            color = Color.Transparent,
            topLeft = Offset(left, top),
            size = ComposeSize(scanSize, scanSize),
            blendMode = BlendMode.Clear
        )

        // 扫描框边框（白色）
        drawRect(
            color = Color.White,
            topLeft = Offset(left, top),
            size = ComposeSize(scanSize, scanSize),
            style = Stroke(width = 3.dp.toPx())
        )

        // 四个角的加强线
        val cornerLength = 40.dp.toPx()
        val cornerWidth = 4.dp.toPx()

        // 左上角
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left, top),
            end = Offset(left + cornerLength, top),
            strokeWidth = cornerWidth
        )
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left, top),
            end = Offset(left, top + cornerLength),
            strokeWidth = cornerWidth
        )

        // 右上角
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left + scanSize - cornerLength, top),
            end = Offset(left + scanSize, top),
            strokeWidth = cornerWidth
        )
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left + scanSize, top),
            end = Offset(left + scanSize, top + cornerLength),
            strokeWidth = cornerWidth
        )

        // 左下角
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left, top + scanSize),
            end = Offset(left + cornerLength, top + scanSize),
            strokeWidth = cornerWidth
        )
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left, top + scanSize - cornerLength),
            end = Offset(left, top + scanSize),
            strokeWidth = cornerWidth
        )

        // 右下角
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left + scanSize - cornerLength, top + scanSize),
            end = Offset(left + scanSize, top + scanSize),
            strokeWidth = cornerWidth
        )
        drawLine(
            color = Color(0xFF4CAF50),
            start = Offset(left + scanSize, top + scanSize - cornerLength),
            end = Offset(left + scanSize, top + scanSize),
            strokeWidth = cornerWidth
        )
    }
}

/**
 * 权限请求内容
 */
@Composable
private fun PermissionRequestContent(
    onRequestPermission: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.CameraAlt,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "需要相机权限",
            style = MaterialTheme.typography.titleLarge
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "请授予相机权限以扫描二维码",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(onClick = onRequestPermission) {
            Icon(Icons.Default.CameraAlt, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("授予权限")
        }
    }
}
