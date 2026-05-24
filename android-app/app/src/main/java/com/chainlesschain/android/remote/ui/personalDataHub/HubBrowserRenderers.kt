package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chainlesschain.android.pdh.LocalCcRunner.EventRow
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Phase 16 — category-keyed event renderer dispatch + 5 implementations.
 *
 * Mirrors the desktop RendererDispatcher.vue. Dispatch is by **category**
 * (stable) not subtype (drifts) per pdh_llm_routing_split_trap. Each
 * renderer is null-safe on missing content fields; falls back to the
 * generic card on any parse failure so a bad JSON payload from one
 * adapter never blanks the entire list.
 *
 * Categories handled here are FRONTEND mirror of the backend mapping in
 * packages/personal-data-hub/lib/categories.js. Keep PREFIX_MAP below in
 * sync with categories.js#PREFIX_RULES.
 */

private val PREFIX_MAP: List<Pair<String, String>> = listOf(
    "wechat" to "chat",
    "messaging-" to "chat",
    "social-" to "social",
    "email-" to "email",
    "shopping-" to "shopping",
    "alipay-" to "shopping",
    "travel-" to "travel",
    "system-data" to "system",
    "ai-chat-" to "ai-chat",
)

internal fun categoryFor(adapterName: String?): String {
    if (adapterName.isNullOrEmpty()) return "other"
    for ((pre, cat) in PREFIX_MAP) {
        if (pre.endsWith("-") || pre == "system-data") {
            if (adapterName.startsWith(pre)) return cat
        } else if (adapterName == pre) {
            return cat
        }
    }
    return "other"
}

/** Top-level dispatcher — pick a specialized Composable per category. */
@Composable
fun EventRenderer(event: EventRow) {
    when (categoryFor(event.sourceAdapter)) {
        "chat", "ai-chat" -> ChatBubbleRow(event)
        "shopping" -> OrderTableRow(event)
        "travel" -> TimelineRow(event)
        "email" -> EmailRow(event)
        else -> GenericCard(event)
    }
}

// ─── helpers ─────────────────────────────────────────────────────────

private fun formatTime(ms: Long): String {
    if (ms <= 0) return ""
    return try {
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(ms))
    } catch (_: Throwable) {
        ""
    }
}

private fun safeContent(event: EventRow): JSONObject {
    return try {
        val obj = JSONObject(event.rawJson)
        obj.optJSONObject("content") ?: JSONObject()
    } catch (_: Throwable) {
        JSONObject()
    }
}

private fun safeExtra(event: EventRow): JSONObject {
    return try {
        val obj = JSONObject(event.rawJson)
        obj.optJSONObject("extra") ?: JSONObject()
    } catch (_: Throwable) {
        JSONObject()
    }
}

private fun firstNonEmpty(vararg keys: String, src: JSONObject): String? {
    for (k in keys) {
        val v = src.optString(k, "")
        if (v.isNotEmpty()) return v
    }
    return null
}

// ─── ChatBubbleRow ───────────────────────────────────────────────────

@Composable
private fun ChatBubbleRow(event: EventRow) {
    val c = safeContent(event)
    val text = firstNonEmpty("text", "body", "message", "title", src = c)
        ?: event.summary ?: "(empty)"
    val from = firstNonEmpty("from", "sender", "senderName", src = c) ?: event.actor ?: "?"
    val isMine = (event.actor ?: "").lowercase().let {
        it.contains("self") || it == "me" || it.endsWith("_self")
    }
    val bubbleColor = if (isMine) MaterialTheme.colorScheme.primaryContainer
                     else MaterialTheme.colorScheme.surfaceVariant

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(0.78f)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = from,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = formatTime(event.occurredAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = text, style = MaterialTheme.typography.bodyMedium)
                Spacer(modifier = Modifier.height(4.dp))
                event.sourceAdapter?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.sp,
                    )
                }
            }
        }
    }
}

// ─── OrderTableRow ───────────────────────────────────────────────────

@Composable
private fun OrderTableRow(event: EventRow) {
    val c = safeContent(event)
    val e = safeExtra(event)
    val merchant = firstNonEmpty("merchant", "counterparty", src = e)
        ?: firstNonEmpty("merchant", "counterparty", src = c) ?: "—"
    val item = firstNonEmpty("title", "name", "itemName", "text", src = c) ?: "—"
    val amount = c.opt("amount")?.toString() ?: c.opt("price")?.toString() ?: c.opt("total")?.toString()
    val currency = c.optString("currency", "¥")
    val orderNo = firstNonEmpty("orderNo", "orderId", src = e)
        ?: firstNonEmpty("orderNo", "orderId", src = c)

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.ShoppingCart, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = formatTime(event.occurredAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.width(8.dp))
                event.sourceAdapter?.let {
                    AssistChip(onClick = {}, label = { Text(it, fontSize = 10.sp) },
                        colors = AssistChipDefaults.assistChipColors(containerColor = Color(0xFFFFF4D6)))
                }
            }
            Spacer(modifier = Modifier.height(6.dp))
            kvLine("商户", merchant)
            kvLine("商品", item)
            if (amount != null) {
                kvLine("金额", "$currency $amount", emphasize = true)
            }
            orderNo?.let { kvLine("单号", it, mono = true) }
        }
    }
}

@Composable
private fun kvLine(key: String, value: String, emphasize: Boolean = false, mono: Boolean = false) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(
            text = key,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(48.dp),
        )
        Text(
            text = value,
            style = if (mono) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodyMedium,
            fontWeight = if (emphasize) FontWeight.SemiBold else FontWeight.Normal,
            color = if (emphasize) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface,
        )
    }
}

// ─── TimelineRow ────────────────────────────────────────────────────

@Composable
private fun TimelineRow(event: EventRow) {
    val c = safeContent(event)
    val from = c.optString("from", "")
    val to = c.optString("to", "")
    val route = if (from.isNotEmpty() && to.isNotEmpty()) "$from → $to" else null
    val trainNo = c.optString("trainNo", "").takeIf { it.isNotEmpty() }
    val flightNo = c.optString("flightNo", "").takeIf { it.isNotEmpty() }
    val placeName = event.summary?.takeIf { route == null }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, contentDescription = null,
                    modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = formatTime(event.occurredAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.width(8.dp))
                event.sourceAdapter?.let {
                    AssistChip(onClick = {}, label = { Text(it, fontSize = 10.sp) })
                }
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = route ?: placeName ?: "(无路线)",
                fontWeight = FontWeight.Medium,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (trainNo != null || flightNo != null) {
                Spacer(modifier = Modifier.height(4.dp))
                AssistChip(
                    onClick = {},
                    label = { Text(trainNo ?: flightNo!!, fontSize = 11.sp) },
                    colors = AssistChipDefaults.assistChipColors(containerColor = Color(0xFFE6F4FF)),
                )
            }
        }
    }
}

// ─── EmailRow ────────────────────────────────────────────────────────

@Composable
private fun EmailRow(event: EventRow) {
    val c = safeContent(event)
    val subject = firstNonEmpty("subject", "title", src = c) ?: "(无主题)"
    val from = firstNonEmpty("from", "sender", "fromName", src = c) ?: event.actor ?: "(未知发件人)"
    val snippet = firstNonEmpty("snippet", "preview", src = c)
        ?: c.optString("body", "").take(80).takeIf { it.isNotEmpty() }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Row(modifier = Modifier.padding(12.dp)) {
            Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = from,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = formatTime(event.occurredAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = subject,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
                snippet?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                }
            }
        }
    }
}

// ─── GenericCard (fallback) ──────────────────────────────────────────

@Composable
private fun GenericCard(event: EventRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = formatTime(event.occurredAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.width(8.dp))
                event.sourceAdapter?.let {
                    AssistChip(onClick = {}, label = { Text(it, fontSize = 10.sp) })
                }
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = event.subtype,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = event.summary ?: "(无摘要)",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 4,
            )
        }
    }
}
