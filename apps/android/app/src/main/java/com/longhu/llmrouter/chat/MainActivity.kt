package com.longhu.llmrouter.chat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
  if (state.loading) {
    CenterText("正在恢复登录状态...")
    return
  }

  if (state.user == null) {
    LoginScreen(state, vm)
  } else {
    ChatScreen(state, vm)
  }
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
