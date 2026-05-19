package com.longhu.llmrouter.chat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val container = (application as LlmRouterChatApplication).container
    setContent {
      LlmRouterTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
          val vm: ChatViewModel = viewModel(
            factory = ChatViewModel.Factory(application, container.repository, container.attachmentStore)
          )
          LlmRouterChatApp(vm)
        }
      }
    }
  }
}

@Composable
fun LlmRouterChatApp(vm: ChatViewModel) {
  val state = vm.state
  var screen by remember { mutableStateOf(AppScreen.Chat) }
  LaunchedEffect(state.user?.id) {
    if (state.user == null) {
      screen = AppScreen.Chat
    }
  }
  if (state.loading) {
    CenterText("正在恢复登录状态...")
    return
  }

  if (state.user == null) {
    LoginScreen(state, vm)
  } else if (screen == AppScreen.Settings) {
    SettingsScreen(state, vm, onBack = { screen = AppScreen.Chat })
  } else {
    ChatScreen(state, vm, onOpenSettings = { screen = AppScreen.Settings })
  }
}

private enum class AppScreen {
  Chat,
  Settings
}

@Composable
fun CenterText(text: String, modifier: Modifier = Modifier, color: Color = AppColors.MutedText) {
  androidx.compose.foundation.layout.Box(
    modifier = modifier.fillMaxSize(),
    contentAlignment = Alignment.Center
  ) {
    Text(text, color = color)
  }
}
