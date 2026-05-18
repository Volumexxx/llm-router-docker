package com.longhu.llmrouter.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelPolicyTest {
  @Test
  fun prefersOpenAiWhenModelSupportsBothProtocols() {
    val model = VisibleModel(
      alias = "router-model",
      displayName = "Router Model",
      protocols = listOf("anthropic", "openai")
    )

    assertEquals(GatewayProtocol.OpenAi, model.preferredProtocol)
  }

  @Test
  fun usesAnthropicForAnthropicOnlyModels() {
    val model = VisibleModel(
      alias = "claude-only",
      displayName = "Claude Only",
      protocols = listOf("anthropic")
    )

    assertEquals(GatewayProtocol.Anthropic, model.preferredProtocol)
  }

  @Test
  fun normalizesBaseUrlsWithoutTrailingSlashes() {
    assertEquals("https://llm.example.com", normalizeBaseUrl(" https://llm.example.com/// "))
  }

  @Test
  fun mapsAccountAndGatewayErrorsToUserFacingMessages() {
    assertEquals("账号正在等待管理员审批。", mapApiError("account_pending_approval", "pending"))
    assertEquals("当前账号的网关 Key 无效或已停用。", mapApiError("gateway_auth_invalid", "invalid"))
    assertEquals("custom", mapApiError("unknown", "custom"))
  }
}
