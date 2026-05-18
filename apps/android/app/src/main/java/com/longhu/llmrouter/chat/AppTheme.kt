package com.longhu.llmrouter.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object AppColors {
  val Background = Color(0xFFF7F8FA)
  val Surface = Color(0xFFFFFFFF)
  val Panel = Color(0xFFF1F3F6)
  val Border = Color(0xFFE1E5EA)
  val Primary = Color(0xFF2563EB)
  val PrimarySoft = Color(0xFFEAF1FF)
  val UserBubble = Color(0xFF2563EB)
  val AssistantBubble = Color(0xFFFFFFFF)
  val Text = Color(0xFF111827)
  val MutedText = Color(0xFF6B7280)
  val Danger = Color(0xFFDC2626)
}

private val AppLightColors = lightColorScheme(
  primary = AppColors.Primary,
  onPrimary = Color.White,
  primaryContainer = AppColors.PrimarySoft,
  onPrimaryContainer = AppColors.Text,
  secondary = Color(0xFF475569),
  onSecondary = Color.White,
  background = AppColors.Background,
  onBackground = AppColors.Text,
  surface = AppColors.Surface,
  onSurface = AppColors.Text,
  surfaceVariant = AppColors.Panel,
  onSurfaceVariant = AppColors.MutedText,
  outline = AppColors.Border,
  error = AppColors.Danger,
  onError = Color.White
)

@Composable
fun LlmRouterTheme(content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = AppLightColors,
    content = content
  )
}
