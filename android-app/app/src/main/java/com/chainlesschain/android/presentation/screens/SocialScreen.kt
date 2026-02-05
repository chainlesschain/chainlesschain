package com.chainlesschain.android.presentation.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SocialScreen(
    onNavigateToFriendDetail: (String) -> Unit = {},
    onNavigateToAddFriend: () -> Unit = {},
    onNavigateToPublishPost: () -> Unit = {},
    onNavigateToPostDetail: (String) -> Unit = {},
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToEditPost: (String) -> Unit = {},
    onNavigateToComment: (String) -> Unit = {}
) {
    var selectedTab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf("Friends", "Timeline", "Notifications")

    Scaffold { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, label ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(label) }
                    )
                }
            }

            Box(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                when (selectedTab) {
                    0 -> Text("Friends screen is temporarily simplified for build stability.")
                    1 -> Text("Timeline screen is temporarily simplified for build stability.")
                    else -> Text("Notifications screen is temporarily simplified for build stability.")
                }
            }
        }
    }
}
