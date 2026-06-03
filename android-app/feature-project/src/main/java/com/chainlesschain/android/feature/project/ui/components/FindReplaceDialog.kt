package com.chainlesschain.android.feature.project.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FindReplace
import androidx.compose.material.icons.filled.TextFormat
import androidx.compose.material.icons.filled.Pattern
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.chainlesschain.android.feature.project.R
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

/**
 * Find and replace dialog for code editor
 *
 * Provides search and replace functionality with options for:
 * - Case sensitivity
 * - Regular expressions
 * - Whole word matching
 * - Find next/previous
 * - Replace one or all occurrences
 */
@Composable
fun FindReplaceDialog(
    content: String,
    onReplace: (newContent: String) -> Unit,
    onFindResult: (matchIndex: Int, totalMatches: Int) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    var findText by remember { mutableStateOf("") }
    var replaceText by remember { mutableStateOf("") }
    var caseSensitive by remember { mutableStateOf(false) }
    var useRegex by remember { mutableStateOf(false) }
    var wholeWord by remember { mutableStateOf(false) }

    var currentMatchIndex by remember { mutableIntStateOf(0) }
    var matches by remember { mutableStateOf<List<IntRange>>(emptyList()) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Find matches
    fun findMatches() {
        errorMessage = null
        if (findText.isEmpty()) {
            matches = emptyList()
            onFindResult(0, 0)
            return
        }

        try {
            matches = if (useRegex) {
                val flags = if (caseSensitive) 0 else Pattern.CASE_INSENSITIVE
                val pattern = Pattern.compile(findText, flags)
                val matcher = pattern.matcher(content)
                buildList {
                    while (matcher.find()) {
                        add(matcher.start()..matcher.end())
                    }
                }
            } else {
                val searchText = findText
                val targetText = if (caseSensitive) content else content.lowercase()
                val needle = if (caseSensitive) searchText else searchText.lowercase()

                buildList {
                    var startIndex = 0
                    while (true) {
                        val index = targetText.indexOf(needle, startIndex)
                        if (index == -1) break

                        // Check whole word if needed
                        if (wholeWord) {
                            val beforeChar = if (index > 0) content[index - 1] else ' '
                            val afterChar = if (index + needle.length < content.length)
                                content[index + needle.length] else ' '
                            val isWholeWord = !beforeChar.isLetterOrDigit() &&
                                            !afterChar.isLetterOrDigit()
                            if (isWholeWord) {
                                add(index until (index + needle.length))
                            }
                        } else {
                            add(index until (index + needle.length))
                        }

                        startIndex = index + 1
                    }
                }
            }

            currentMatchIndex = if (matches.isNotEmpty()) 0 else -1
            onFindResult(
                if (matches.isNotEmpty()) currentMatchIndex + 1 else 0,
                matches.size
            )
        } catch (e: PatternSyntaxException) {
            errorMessage = "Invalid regex: ${e.message}"
            matches = emptyList()
            onFindResult(0, 0)
        }
    }

    // Navigate to next match
    fun findNext() {
        if (matches.isNotEmpty()) {
            currentMatchIndex = (currentMatchIndex + 1) % matches.size
            onFindResult(currentMatchIndex + 1, matches.size)
        }
    }

    // Navigate to previous match
    fun findPrevious() {
        if (matches.isNotEmpty()) {
            currentMatchIndex = if (currentMatchIndex - 1 < 0)
                matches.size - 1 else currentMatchIndex - 1
            onFindResult(currentMatchIndex + 1, matches.size)
        }
    }

    // Replace current match
    fun replaceCurrent() {
        if (matches.isNotEmpty() && currentMatchIndex >= 0) {
            val match = matches[currentMatchIndex]
            val newContent = content.replaceRange(match, replaceText)
            onReplace(newContent)
            findMatches() // Re-find to update indices
        }
    }

    // Replace all matches
    fun replaceAll() {
        if (matches.isEmpty()) return

        var newContent = content
        // Replace from end to start to preserve indices
        matches.asReversed().forEach { match ->
            newContent = newContent.replaceRange(match, replaceText)
        }
        onReplace(newContent)
        findMatches() // Re-find to update
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
        title = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.FindReplace,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(24.dp)
                )
                Text(
                    text = stringResource(R.string.find_and_replace),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
            }
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Find field
                OutlinedTextField(
                    value = findText,
                    onValueChange = {
                        findText = it
                        findMatches()
                    },
                    label = { Text(stringResource(R.string.find)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    isError = errorMessage != null,
                    supportingText = errorMessage?.let { { Text(it) } },
                    trailingIcon = {
                        Row {
                            if (matches.isNotEmpty()) {
                                Text(
                                    text = "${currentMatchIndex + 1}/${matches.size}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                            }
                            IconButton(onClick = ::findPrevious, enabled = matches.isNotEmpty()) {
                                Icon(Icons.Default.ArrowUpward, "Previous", Modifier.size(18.dp))
                            }
                            IconButton(onClick = ::findNext, enabled = matches.isNotEmpty()) {
                                Icon(Icons.Default.ArrowDownward, "Next", Modifier.size(18.dp))
                            }
                        }
                    }
                )

                // Replace field
                OutlinedTextField(
                    value = replaceText,
                    onValueChange = { replaceText = it },
                    label = { Text(stringResource(R.string.replace_with)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                // Options
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = caseSensitive,
                            onCheckedChange = {
                                caseSensitive = it
                                findMatches()
                            }
                        )
                        Icon(
                            imageVector = Icons.Default.TextFormat,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.case_sensitive),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = wholeWord,
                            onCheckedChange = {
                                wholeWord = it
                                findMatches()
                            }
                        )
                        Text(
                            text = stringResource(R.string.whole_word),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = useRegex,
                            onCheckedChange = {
                                useRegex = it
                                findMatches()
                            }
                        )
                        Icon(
                            imageVector = Icons.Default.Pattern,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.use_regex),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Replace buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = ::replaceCurrent,
                        enabled = matches.isNotEmpty() && currentMatchIndex >= 0,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.replace))
                    }
                    FilledTonalButton(
                        onClick = ::replaceAll,
                        enabled = matches.isNotEmpty(),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.replace_all))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(stringResource(R.string.close))
                }
            }
        }
    )
}
