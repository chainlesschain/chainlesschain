package com.chainlesschain.android.remote.session

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteSessionScreen(
    onNavigateBack: () -> Unit,
    viewModel: RemoteSessionViewModel = viewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var prompt by remember { mutableStateOf("") }
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(viewModel::pair)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Remote Coding Session") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Status: ${state.status}")
            state.error?.let { Text(it) }
            if (state.status == RemoteSessionStatus.REVOKED) {
                Text("This device was revoked by the host. Scan a new code to reconnect.")
            }
            val canPair = state.status == RemoteSessionStatus.IDLE ||
                state.status == RemoteSessionStatus.DISCONNECTED ||
                state.status == RemoteSessionStatus.REVOKED ||
                state.status == RemoteSessionStatus.ERROR
            if (canPair) {
                Button(
                    onClick = {
                        scanner.launch(
                            ScanOptions()
                                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                                .setPrompt("Scan the Desktop Remote Session code")
                                .setBeepEnabled(false),
                        )
                    },
                ) { Text("Scan pairing code") }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = viewModel::interrupt) { Text("Interrupt") }
                    OutlinedButton(onClick = viewModel::disconnect) { Text("Disconnect") }
                }
                OutlinedTextField(
                    value = prompt,
                    onValueChange = { prompt = it },
                    label = { Text("Message") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(onClick = { viewModel.sendPrompt(prompt); prompt = "" }) { Text("Send") }
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.events.reversed(), key = { it.optString("eventId", it.toString()) }) { event ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(event.optString("type", "event"))
                            Text(event.optString("content", event.optJSONObject("payload")?.optString("content") ?: ""))
                            if (event.optString("type").contains("approval")) {
                                val requestId = event.optString("requestId", event.optString("approvalId"))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { viewModel.approve(requestId, true) }) { Text("Approve") }
                                    OutlinedButton(onClick = { viewModel.approve(requestId, false) }) { Text("Reject") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
