package com.longhu.llmrouter.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

class ModelPolicyTest {
  private val json = Json { ignoreUnknownKeys = true }

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
  fun defaultsRuntimeSettingsForVisibleOpenAiModels() {
    val openAiModel = VisibleModel(
      alias = "gpt",
      displayName = "GPT",
      protocols = listOf("openai")
    )
    val anthropicOnly = VisibleModel(
      alias = "claude",
      displayName = "Claude",
      protocols = listOf("anthropic")
    )

    val settings = runtimeSettingsForVisibleOpenAiModels(
      listOf(openAiModel, anthropicOnly),
      saved = emptyMap()
    )

    assertEquals(setOf("gpt"), settings.keys)
    assertEquals(OpenAiRequestType.Chat, settings["gpt"]?.requestType)
    assertNull(settings["gpt"]?.contextMaxTokens)
    assertEquals(DefaultMaxOutputTokens, settings["gpt"]?.maxOutputTokens)
  }

  @Test
  fun normalizesSavedRuntimeSettings() {
    val model = VisibleModel(
      alias = "gpt",
      displayName = "GPT",
      protocols = listOf("openai")
    )

    val settings = runtimeSettingsForVisibleOpenAiModels(
      listOf(model),
      saved = mapOf(
        "gpt" to ModelRuntimeSettings(
          modelAlias = "stale",
          requestType = OpenAiRequestType.Response,
          contextMaxTokens = -1,
          maxOutputTokens = 0
        )
      )
    ).getValue("gpt")

    assertEquals("gpt", settings.modelAlias)
    assertEquals(OpenAiRequestType.Response, settings.requestType)
    assertNull(settings.contextMaxTokens)
    assertEquals(DefaultMaxOutputTokens, settings.maxOutputTokens)
  }

  @Test
  fun scopesModelSettingsByServiceAndUser() {
    assertEquals(
      modelSettingsStorageKey("https://router.example.com", "user-1"),
      modelSettingsStorageKey("https://router.example.com", "user-1")
    )
    assertNotEquals(
      modelSettingsStorageKey("https://router.example.com", "user-1"),
      modelSettingsStorageKey("https://router.example.com", "user-2")
    )
    assertNotEquals(
      modelSettingsStorageKey("https://router.example.com", "user-1"),
      modelSettingsStorageKey("https://other.example.com", "user-1")
    )
  }

  @Test
  fun settingsModelSelectorUsesDefaultOpenAiModelOrFirstOpenAiModel() {
    val models = listOf(
      VisibleModel(alias = "claude", displayName = "Claude", protocols = listOf("anthropic")),
      VisibleModel(alias = "gpt-a", displayName = "GPT A", protocols = listOf("openai")),
      VisibleModel(alias = "gpt-b", displayName = "GPT B", protocols = listOf("openai"))
    )

    assertEquals("gpt-b", defaultOpenAiSettingsModelAlias(models, "gpt-b"))
    assertEquals("gpt-a", defaultOpenAiSettingsModelAlias(models, "claude"))
    assertEquals("gpt-a", defaultOpenAiSettingsModelAlias(models, null))
  }

  @Test
  fun openAiChatPayloadUsesConfiguredMaxTokens() {
    val payload = json.parseToJsonElement(
      buildOpenAiChatPayload(
        modelAlias = "gpt",
        maxOutputTokens = 777,
        history = listOf(
          ChatMessage(
            id = "m1",
            conversationId = "c1",
            role = MessageRole.User,
            content = "hello",
            modelAlias = "gpt",
            protocol = GatewayProtocol.OpenAi,
            requestType = OpenAiRequestType.Chat,
            createdAt = 1
          )
        ),
        userContent = "next",
        attachments = emptyList()
      )
    ).jsonObject

    assertEquals("gpt", payload["model"]?.jsonPrimitive?.contentOrNull)
    assertEquals(777, payload["max_tokens"]?.jsonPrimitive?.int)
    assertEquals("next", payload["messages"]?.jsonArray?.last()?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull)
  }

  @Test
  fun openAiResponsesPayloadIncludesHistoryAttachmentsAndMaxOutputTokens() {
    val payload = json.parseToJsonElement(
      buildOpenAiResponsesPayload(
        modelAlias = "gpt",
        maxOutputTokens = 512,
        history = listOf(
          ChatMessage(
            id = "m1",
            conversationId = "c1",
            role = MessageRole.Assistant,
            content = "old answer",
            modelAlias = "gpt",
            protocol = GatewayProtocol.OpenAi,
            requestType = OpenAiRequestType.Response,
            createdAt = 1
          )
        ),
        userContent = "look",
        attachments = listOf(
          PendingAttachment(
            id = "t1",
            type = AttachmentType.Text,
            name = "notes.txt",
            mimeType = "text/plain",
            bytes = "note".toByteArray(),
            previewText = "file text",
            dataUrl = null
          ),
          PendingAttachment(
            id = "i1",
            type = AttachmentType.Image,
            name = "image.jpg",
            mimeType = "image/jpeg",
            bytes = byteArrayOf(1),
            previewText = null,
            dataUrl = "data:image/jpeg;base64,abc"
          )
        )
      )
    ).jsonObject

    val input = payload["input"]!!.jsonArray
    val assistantContent = input.first().jsonObject["content"]!!.jsonArray.first().jsonObject
    val userContent = input.last().jsonObject["content"]!!.jsonArray

    assertEquals("gpt", payload["model"]?.jsonPrimitive?.contentOrNull)
    assertEquals(512, payload["max_output_tokens"]?.jsonPrimitive?.int)
    assertEquals("image_generation", payload["tools"]?.jsonArray?.first()?.jsonObject?.get("type")?.jsonPrimitive?.contentOrNull)
    assertEquals("assistant", input.first().jsonObject["role"]?.jsonPrimitive?.contentOrNull)
    assertEquals("output_text", assistantContent["type"]?.jsonPrimitive?.contentOrNull)
    assertEquals("input_text", userContent[0].jsonObject["type"]?.jsonPrimitive?.contentOrNull)
    assertEquals("input_text", userContent[1].jsonObject["type"]?.jsonPrimitive?.contentOrNull)
    assertEquals("input_image", userContent[2].jsonObject["type"]?.jsonPrimitive?.contentOrNull)
  }

  @Test
  fun parsesResponsesOutputTextBlocks() {
    val response = json.parseToJsonElement(
      """
        {
          "output": [
            { "content": [{ "type": "output_text", "text": "hello" }] },
            { "content": [{ "type": "output_text", "text": " world" }] }
          ]
        }
      """.trimIndent()
    ).jsonObject

    assertEquals("hello world", parseOpenAiResponsesText(response))
  }

  @Test
  fun parsesResponsesTextAndGeneratedImages() {
    val bytes = byteArrayOf(1, 2, 3, 4)
    val encoded = Base64.getEncoder().encodeToString(bytes)
    val response = json.parseToJsonElement(
      """
        {
          "output": [
            { "type": "message", "content": [{ "type": "output_text", "text": "done" }] },
            { "type": "image_generation_call", "result": "$encoded" }
          ]
        }
      """.trimIndent()
    ).jsonObject

    val reply = parseOpenAiResponsesReply(response)

    assertEquals("done", reply.text)
    assertEquals(1, reply.generatedImages.size)
    assertEquals("image/png", reply.generatedImages.first().mimeType)
    assertArrayEquals(bytes, reply.generatedImages.first().bytes)
  }

  @Test
  fun parsesPureImageResponsesWithoutText() {
    val bytes = byteArrayOf(9, 8, 7)
    val encoded = Base64.getEncoder().encodeToString(bytes)
    val response = json.parseToJsonElement(
      """
        {
          "output": [
            { "type": "image_generation_call", "result": "data:image/webp;base64,$encoded" }
          ]
        }
      """.trimIndent()
    ).jsonObject

    val reply = parseOpenAiResponsesReply(response)

    assertEquals("", reply.text)
    assertEquals(1, reply.generatedImages.size)
    assertEquals("image/webp", reply.generatedImages.first().mimeType)
    assertArrayEquals(bytes, reply.generatedImages.first().bytes)
  }

  @Test
  fun parsesChatCompletionImageContentParts() {
    val bytes = byteArrayOf(5, 6, 7)
    val encoded = Base64.getEncoder().encodeToString(bytes)
    val response = json.parseToJsonElement(
      """
        {
          "choices": [
            {
              "message": {
                "content": [
                  { "type": "text", "text": "image ready" },
                  { "type": "image_url", "image_url": { "url": "data:image/png;base64,$encoded" } }
                ]
              }
            }
          ]
        }
      """.trimIndent()
    ).jsonObject

    val reply = parseOpenAiChatReply(response)

    assertEquals("image ready", reply.text)
    assertEquals(1, reply.generatedImages.size)
    assertArrayEquals(bytes, reply.generatedImages.first().bytes)
  }

  @Test
  fun mapsAccountAndGatewayErrorsToUserFacingMessages() {
    assertEquals("当前模型或上游不支持 response 请求，请到设置中切回 chat 后重试。", mapApiError("responses_not_supported", "unsupported"))
    assertEquals("custom", mapApiError("unknown", "custom"))
  }
}
