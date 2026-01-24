package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Breadcrumb navigation component
 * Shows the navigation path: Projects → ProjectName → FileName
 */
@Composable
fun BreadcrumbNav(
    items: List<BreadcrumbItem>,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Row(
        modifier = modifier
            .horizontalScroll(scrollState)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        items.forEachIndexed { index, item ->
            // Breadcrumb item
            Text(
                text = item.label,
                style = MaterialTheme.typography.bodyMedium,
                color = if (index == items.lastIndex) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                fontWeight = if (index == items.lastIndex) {
                    FontWeight.Medium
                } else {
                    FontWeight.Normal
                },
                modifier = Modifier.clickable(
                    enabled = index != items.lastIndex && item.onClick != null
                ) {
                    item.onClick?.invoke()
                }
            )

            // Separator (chevron)
            if (index < items.lastIndex) {
                Icon(
                    imageVector = Icons.Default.ChevronRight,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                )
            }
        }
    }
}

/**
 * Breadcrumb item data class
 */
data class BreadcrumbItem(
    val label: String,
    val onClick: (() -> Unit)? = null
)
