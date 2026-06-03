package com.chainlesschain.android.feature.familyguard.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Placeholder entry composable for :feature-family-guard.
 *
 * FAMILY-01 scaffold: proves Compose wiring + theming + Material3 dep flow
 * cleanly through the module. Replaced wholesale in FAMILY-04 (role chooser)
 * and FAMILY-18 (family tab).
 */
@Composable
fun FamilyGuardEntryScreen(
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "AI 陪学",
            style = MaterialTheme.typography.headlineMedium,
        )
        Text(
            text = "feature-family-guard scaffold (FAMILY-01)",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
