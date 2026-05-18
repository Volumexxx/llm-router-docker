package com.longhu.llmrouter.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(state: ChatUiState, vm: ChatViewModel) {
  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(AppColors.Background)
      .statusBarsPadding()
      .navigationBarsPadding()
      .padding(20.dp),
    contentAlignment = Alignment.Center
  ) {
    Surface(
      modifier = Modifier
        .fillMaxWidth()
        .widthIn(max = 420.dp)
        .verticalScroll(rememberScrollState()),
      shape = RoundedCornerShape(12.dp),
      color = AppColors.Surface,
      shadowElevation = 1.dp
    ) {
      Column(
        modifier = Modifier.padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
      ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(
            "LLM Router Chat",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
          Text(
            "使用账号登录后自动准备模型和聊天 Key",
            color = AppColors.MutedText,
            style = MaterialTheme.typography.bodyMedium
          )
        }

        OutlinedTextField(
          value = state.baseUrl,
          onValueChange = vm::updateBaseUrl,
          label = { Text("服务地址") },
          placeholder = { Text("https://llm.example.com") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
          value = state.username,
          onValueChange = vm::updateUsername,
          label = { Text("用户名") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
          value = state.password,
          onValueChange = vm::updatePassword,
          label = { Text("密码") },
          visualTransformation = PasswordVisualTransformation(),
          singleLine = true,
          modifier = Modifier.fillMaxWidth()
        )

        if (state.baseUrl.startsWith("http://")) {
          StatusBanner(
            text = "当前使用 HTTP，仅适合局域网或可信网络。",
            isError = true
          )
        }
        FeedbackBanner(state)

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Button(
            onClick = vm::login,
            enabled = !state.busy,
            colors = ButtonDefaults.buttonColors(containerColor = AppColors.Primary),
            modifier = Modifier.weight(1f)
          ) {
            Icon(Icons.AutoMirrored.Filled.Login, contentDescription = null)
            Text(if (state.busy) "处理中" else "登录", modifier = Modifier.padding(start = 6.dp))
          }
          OutlinedButton(
            onClick = vm::register,
            enabled = !state.busy,
            modifier = Modifier.weight(1f)
          ) {
            Icon(Icons.Filled.PersonAdd, contentDescription = null)
            Text("注册", modifier = Modifier.padding(start = 6.dp))
          }
        }
      }
    }
  }
}
