package com.longhu.llmrouter.chat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.Base64 as JavaBase64
import java.util.concurrent.TimeUnit

class RouterApi(private val cookieJar: RouterCookieJar) {
  private val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
  }
  private val client = OkHttpClient.Builder()
    .cookieJar(cookieJar)
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(180, TimeUnit.SECONDS)
    .writeTimeout(180, TimeUnit.SECONDS)
    .build()
  private val mediaType = "application/json; charset=utf-8".toMediaType()

  suspend fun login(baseUrl: String, username: String, password: String): ConsoleUser {
    val normalized = normalizeBaseUrl(baseUrl)
    return postJson<AuthResponse>(
      normalized,
      "/admin/api/auth/login",
      json.encodeToString(LoginRequest(username, password)),
      bearer = null
    ).user
  }

  suspend fun register(baseUrl: String, username: String, password: String): ConsoleUser {
    val normalized = normalizeBaseUrl(baseUrl)
    return postJson<AuthResponse>(
      normalized,
      "/admin/api/auth/register",
      json.encodeToString(LoginRequest(username, password)),
      bearer = null
    ).user
  }

  suspend fun me(baseUrl: String): ConsoleUser =
    getJson<AuthResponse>(normalizeBaseUrl(baseUrl), "/admin/api/auth/me", bearer = null).user

  suspend fun logout(baseUrl: String) {
    runCatching {
      postRaw(normalizeBaseUrl(baseUrl), "/admin/api/auth/logout", "{}", bearer = null)
    }
    cookieJar.clear()
  }

  suspend fun visibleModels(baseUrl: String): List<VisibleModel> =
    getJson<VisibleModelsResponse>(normalizeBaseUrl(baseUrl), "/admin/api/me/models", bearer = null).items

  suspend fun apiKeys(baseUrl: String): List<ApiKeyItem> =
    getJson<ApiKeyListResponse>(normalizeBaseUrl(baseUrl), "/admin/api/me/api-keys", bearer = null).items

  suspend fun createApiKey(baseUrl: String, name: String): CreateApiKeyResponse =
    postJson(
      normalizeBaseUrl(baseUrl),
      "/admin/api/me/api-keys",
      json.encodeToString(CreateApiKeyRequest(name)),
      bearer = null
    )

  suspend fun apiKeyPlaintext(baseUrl: String, apiKeyId: String): String =
    getJson<PlaintextApiKeyResponse>(
      normalizeBaseUrl(baseUrl),
      "/admin/api/me/api-keys/$apiKeyId/plaintext",
      bearer = null
    ).plaintext

  suspend fun chatCompletion(
    baseUrl: String,
    apiKey: String,
    model: VisibleModel,
    settings: ModelRuntimeSettings,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): AssistantReply {
    val protocol = model.preferredProtocol
    return if (protocol == GatewayProtocol.OpenAi && settings.requestType == OpenAiRequestType.Response) {
      postOpenAiResponses(baseUrl, apiKey, model.alias, settings.maxOutputTokens, history, userContent, attachments)
    } else if (protocol == GatewayProtocol.OpenAi) {
      postOpenAiChat(baseUrl, apiKey, model.alias, settings.maxOutputTokens, history, userContent, attachments)
    } else {
      postAnthropicMessages(baseUrl, apiKey, model.alias, history, userContent, attachments)
    }
  }

  private suspend fun postOpenAiChat(
    baseUrl: String,
    apiKey: String,
    modelAlias: String,
    maxOutputTokens: Int,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): AssistantReply {
    val payload = buildOpenAiChatPayload(modelAlias, maxOutputTokens, history, userContent, attachments)

    val response = postJsonObject(normalizeBaseUrl(baseUrl), "/v1/chat/completions", payload, apiKey)
    return parseOpenAiChatReply(response)
  }

  private suspend fun postOpenAiResponses(
    baseUrl: String,
    apiKey: String,
    modelAlias: String,
    maxOutputTokens: Int,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): AssistantReply {
    val payload = buildOpenAiResponsesPayload(
      modelAlias,
      maxOutputTokens,
      history,
      userContent,
      attachments
    )

    val response = postJsonObject(normalizeBaseUrl(baseUrl), "/v1/responses", payload, apiKey)
    return parseOpenAiResponsesReply(response)
  }

  private suspend fun postAnthropicMessages(
    baseUrl: String,
    apiKey: String,
    modelAlias: String,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): AssistantReply {
    val messages = buildJsonArray {
      history.filter { it.role != MessageRole.System }.forEach { message ->
        add(
          buildJsonObject {
            put("role", JsonPrimitive(if (message.role == MessageRole.Assistant) "assistant" else "user"))
            put("content", JsonPrimitive(message.content))
          }
        )
      }
      add(
        buildJsonObject {
          put("role", JsonPrimitive("user"))
          put("content", anthropicContent(userContent, attachments))
        }
      )
    }

    val payload = buildJsonObject {
      put("model", JsonPrimitive(modelAlias))
      put("max_tokens", JsonPrimitive(2048))
      put("messages", messages)
    }.toString()

    val response = postJsonObject(
      normalizeBaseUrl(baseUrl),
      "/v1/messages",
      payload,
      apiKey,
      anthropic = true
    )
    val content = response["content"] as? JsonArray ?: return AssistantReply("")
    val text = content.mapNotNull { part ->
      val item = part.jsonObject
      if (item["type"]?.jsonPrimitive?.contentOrNull == "text") {
        item["text"]?.jsonPrimitive?.contentOrNull
      } else {
        null
      }
    }.joinToString("")
    return AssistantReply(text)
  }

  private fun openAiContent(text: String, attachments: List<PendingAttachment>) =
    if (attachments.isEmpty()) {
      JsonPrimitive(text)
    } else {
      buildJsonArray {
        add(
          buildJsonObject {
            put("type", JsonPrimitive("text"))
            put("text", JsonPrimitive(text))
          }
        )
        attachments.forEach { attachment ->
          when (attachment.type) {
            AttachmentType.Text -> add(
              buildJsonObject {
                put("type", JsonPrimitive("text"))
                put("text", JsonPrimitive(attachment.previewText.orEmpty()))
              }
            )
            AttachmentType.Image -> add(
              buildJsonObject {
                put("type", JsonPrimitive("image_url"))
                put(
                  "image_url",
                  buildJsonObject {
                    put("url", JsonPrimitive(attachment.dataUrl.orEmpty()))
                  }
                )
              }
            )
          }
        }
      }
    }

  private fun anthropicContent(text: String, attachments: List<PendingAttachment>) =
    buildJsonArray {
      add(
        buildJsonObject {
          put("type", JsonPrimitive("text"))
          put("text", JsonPrimitive(text))
        }
      )
      attachments.forEach { attachment ->
        when (attachment.type) {
          AttachmentType.Text -> add(
            buildJsonObject {
              put("type", JsonPrimitive("text"))
              put("text", JsonPrimitive(attachment.previewText.orEmpty()))
            }
          )
          AttachmentType.Image -> {
            val dataUrl = attachment.dataUrl.orEmpty()
            val marker = ";base64,"
            val markerIndex = dataUrl.indexOf(marker)
            val mediaType = dataUrl.removePrefix("data:").substringBefore(marker)
            val data = if (markerIndex >= 0) dataUrl.substring(markerIndex + marker.length) else ""
            add(
              buildJsonObject {
                put("type", JsonPrimitive("image"))
                put(
                  "source",
                  buildJsonObject {
                    put("type", JsonPrimitive("base64"))
                    put("media_type", JsonPrimitive(mediaType))
                    put("data", JsonPrimitive(data))
                  }
                )
              }
            )
          }
        }
      }
    }

  private suspend inline fun <reified T> getJson(baseUrl: String, path: String, bearer: String?): T =
    withContext(Dispatchers.IO) {
      val request = Request.Builder()
        .url("$baseUrl$path")
        .applyAuth(bearer)
        .get()
        .build()
      executeJson(request)
    }

  private suspend inline fun <reified T> postJson(
    baseUrl: String,
    path: String,
    payload: String,
    bearer: String?
  ): T = withContext(Dispatchers.IO) {
    val request = Request.Builder()
      .url("$baseUrl$path")
      .applyAuth(bearer)
      .post(payload.toRequestBody(mediaType))
      .build()
    executeJson(request)
  }

  private suspend fun postJsonObject(
    baseUrl: String,
    path: String,
    payload: String,
    bearer: String,
    anthropic: Boolean = false
  ): JsonObject = withContext(Dispatchers.IO) {
    val request = Request.Builder()
      .url("$baseUrl$path")
      .applyAuth(bearer)
      .apply {
        if (anthropic) {
          header("anthropic-version", "2023-06-01")
        }
      }
      .post(payload.toRequestBody(mediaType))
      .build()
    executeJsonObject(request)
  }

  private suspend fun postRaw(baseUrl: String, path: String, payload: String, bearer: String?) =
    withContext(Dispatchers.IO) {
      val request = Request.Builder()
        .url("$baseUrl$path")
        .applyAuth(bearer)
        .post(payload.toRequestBody(mediaType))
        .build()
      client.newCall(request).execute().close()
    }

  private fun Request.Builder.applyAuth(bearer: String?): Request.Builder {
    if (!bearer.isNullOrBlank()) {
      header("Authorization", "Bearer $bearer")
    }
    return this
  }

  private inline fun <reified T> executeJson(request: Request): T {
    val body = executeBody(request)
    return try {
      json.decodeFromString(body)
    } catch (error: SerializationException) {
      throw RouterApiException(200, "invalid_response", "服务端返回格式无法解析。")
    }
  }

  private fun executeJsonObject(request: Request): JsonObject {
    val body = executeBody(request)
    return try {
      json.decodeFromString<JsonObject>(body)
    } catch (error: SerializationException) {
      throw RouterApiException(200, "invalid_response", "服务端返回格式无法解析。")
    }
  }

  private fun executeBody(request: Request): String {
    try {
      client.newCall(request).execute().use { response ->
        val body = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
          val parsed = runCatching { json.decodeFromString<ApiErrorPayload>(body) }.getOrNull()
          val code = parsed?.error?.code ?: "request_failed"
          val message = parsed?.error?.message ?: body.ifBlank { "请求失败" }
          throw RouterApiException(response.code, code, mapApiError(code, message))
        }
        return body
      }
    } catch (error: IOException) {
      throw RouterApiException(0, "network_error", "无法连接服务，请检查地址和网络。")
    }
  }
}

internal fun buildOpenAiResponsesPayload(
  modelAlias: String,
  maxOutputTokens: Int,
  history: List<ChatMessage>,
  userContent: String,
  attachments: List<PendingAttachment>
): String =
  buildJsonObject {
    put("model", JsonPrimitive(modelAlias))
    put("stream", JsonPrimitive(false))
    put("max_output_tokens", JsonPrimitive(maxOutputTokens))
    put(
      "tools",
      buildJsonArray {
        add(
          buildJsonObject {
            put("type", JsonPrimitive("image_generation"))
          }
        )
      }
    )
    put(
      "input",
      buildJsonArray {
        history.forEach { message ->
          add(
            buildJsonObject {
              put(
                "role",
                JsonPrimitive(
                  when (message.role) {
                    MessageRole.Assistant -> "assistant"
                    MessageRole.System -> "system"
                    MessageRole.User -> "user"
                  }
                )
              )
              put(
                "content",
                responseTextContent(
                  text = message.content,
                  textType = if (message.role == MessageRole.Assistant) "output_text" else "input_text"
                )
              )
            }
          )
        }
        add(
          buildJsonObject {
            put("role", JsonPrimitive("user"))
            put("content", responseUserContent(userContent, attachments))
          }
        )
      }
    )
  }.toString()

internal fun buildOpenAiChatPayload(
  modelAlias: String,
  maxOutputTokens: Int,
  history: List<ChatMessage>,
  userContent: String,
  attachments: List<PendingAttachment>
): String {
  val messages = buildJsonArray {
    history.forEach { message ->
      add(
        buildJsonObject {
          put("role", JsonPrimitive(message.role.wireName))
          put("content", JsonPrimitive(message.content))
        }
      )
    }
    add(
      buildJsonObject {
        put("role", JsonPrimitive("user"))
        put("content", openAiChatContent(userContent, attachments))
      }
    )
  }

  return buildJsonObject {
    put("model", JsonPrimitive(modelAlias))
    put("stream", JsonPrimitive(false))
    put("temperature", JsonPrimitive(0.7))
    put("max_tokens", JsonPrimitive(maxOutputTokens))
    put("messages", messages)
  }.toString()
}

internal fun parseOpenAiChatReply(response: JsonObject): AssistantReply {
  val choices = response["choices"] as? JsonArray ?: return AssistantReply("")
  val message = choices.firstOrNull()?.asObject()?.get("message")?.asObject() ?: return AssistantReply("")
  return parseOpenAiMessageContent(message["content"])
}

internal fun parseOpenAiResponsesText(response: JsonObject): String =
  parseOpenAiResponsesReply(response).text

internal fun parseOpenAiResponsesReply(response: JsonObject): AssistantReply {
  val texts = mutableListOf<String>()
  val images = mutableListOf<GeneratedImage>()

  response["output_text"]?.asString()?.takeIf { it.isNotBlank() }?.let { texts += it }

  val output = response["output"] as? JsonArray ?: return AssistantReply(texts.joinToString(""), images)
  output.forEachIndexed { outputIndex, item ->
    val record = item.asObject() ?: return@forEachIndexed
    collectImage(record, "response-image-${outputIndex + 1}")?.let { images += it }

    val content = record["content"] as? JsonArray ?: return@forEachIndexed
    content.forEachIndexed { contentIndex, part ->
      val block = part.asObject() ?: return@forEachIndexed
      when (block["type"]?.asString()) {
        "output_text", "text" -> block["text"]?.asString()?.let { texts += it }
        "image_url", "output_image" -> {
          collectImage(block, "response-image-${outputIndex + 1}-${contentIndex + 1}")?.let {
            images += it
          } ?: collectRemoteImageUrl(block)?.let { texts += "\n[图片链接] $it" }
        }
      }
    }
  }
  return AssistantReply(texts.joinToString(""), images)
}

private fun parseOpenAiMessageContent(content: JsonElement?): AssistantReply {
  if (content == null) {
    return AssistantReply("")
  }
  content.asString()?.let {
    return AssistantReply(it)
  }

  val blocks = content as? JsonArray ?: return AssistantReply("")
  val texts = mutableListOf<String>()
  val images = mutableListOf<GeneratedImage>()
  blocks.forEachIndexed { index, part ->
    val block = part.asObject() ?: return@forEachIndexed
    when (block["type"]?.asString()) {
      "text", "output_text" -> block["text"]?.asString()?.let { texts += it }
      "image_url", "output_image" -> {
        collectImage(block, "chat-image-${index + 1}")?.let {
          images += it
        } ?: collectRemoteImageUrl(block)?.let { texts += "\n[图片链接] $it" }
      }
      else -> {
        block["text"]?.asString()?.let { texts += it }
        collectImage(block, "chat-image-${index + 1}")?.let { images += it }
      }
    }
  }
  return AssistantReply(texts.joinToString(""), images)
}

private fun collectImage(record: JsonObject, fallbackName: String): GeneratedImage? {
  val type = record["type"]?.asString()
  val direct = listOf("result", "b64_json", "base64", "data", "image_base64")
    .firstNotNullOfOrNull { key -> record[key]?.asString() }
  if (!direct.isNullOrBlank()) {
    return decodeGeneratedImage(direct, fallbackName, record["mime_type"]?.asString())
  }

  val imageUrl = record["image_url"]
  val imageUrlValue = imageUrl?.asString()
    ?: imageUrl?.asObject()?.get("url")?.asString()
  if (!imageUrlValue.isNullOrBlank() && imageUrlValue.startsWith("data:")) {
    return decodeGeneratedImage(imageUrlValue, fallbackName, record["mime_type"]?.asString())
  }

  if (type == "image_generation_call") {
    record["result"]?.asString()?.let {
      return decodeGeneratedImage(it, fallbackName, record["mime_type"]?.asString())
    }
  }
  return null
}

private fun collectRemoteImageUrl(record: JsonObject): String? {
  val direct = record["url"]?.asString()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
  if (direct != null) {
    return direct
  }
  val imageUrl = record["image_url"]
  return imageUrl?.asString()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
    ?: imageUrl?.asObject()?.get("url")?.asString()?.takeIf { it.startsWith("http://") || it.startsWith("https://") }
}

private fun decodeGeneratedImage(raw: String, fallbackName: String, explicitMimeType: String?): GeneratedImage? {
  val trimmed = raw.trim()
  val dataUrlMatch = Regex("^data:(image/[A-Za-z0-9.+-]+);base64,(.+)$").matchEntire(trimmed)
  val mimeType = explicitMimeType
    ?: dataUrlMatch?.groupValues?.getOrNull(1)
    ?: "image/png"
  val base64 = dataUrlMatch?.groupValues?.getOrNull(2) ?: trimmed
  val bytes = runCatching { JavaBase64.getDecoder().decode(base64) }.getOrNull() ?: return null
  return GeneratedImage(
    name = "$fallbackName.${mimeType.generatedImageExtension()}",
    mimeType = mimeType,
    bytes = bytes
  )
}

private fun String.generatedImageExtension(): String =
  when (lowercase()) {
    "image/jpeg", "image/jpg" -> "jpg"
    "image/webp" -> "webp"
    else -> "png"
  }

private fun JsonElement.asObject(): JsonObject? = this as? JsonObject

private fun JsonElement.asString(): String? = (this as? JsonPrimitive)?.contentOrNull

private fun responseTextContent(text: String, textType: String): JsonArray =
  buildJsonArray {
    add(
      buildJsonObject {
        put("type", JsonPrimitive(textType))
        put("text", JsonPrimitive(text))
      }
    )
  }

private fun responseUserContent(text: String, attachments: List<PendingAttachment>): JsonArray =
  buildJsonArray {
    if (text.isNotBlank()) {
      add(
        buildJsonObject {
          put("type", JsonPrimitive("input_text"))
          put("text", JsonPrimitive(text))
        }
      )
    }
    attachments.forEach { attachment ->
      when (attachment.type) {
        AttachmentType.Text -> add(
          buildJsonObject {
            put("type", JsonPrimitive("input_text"))
            put("text", JsonPrimitive(attachment.previewText.orEmpty()))
          }
        )
        AttachmentType.Image -> add(
          buildJsonObject {
            put("type", JsonPrimitive("input_image"))
            put("image_url", JsonPrimitive(attachment.dataUrl.orEmpty()))
          }
        )
      }
    }
  }

private fun openAiChatContent(text: String, attachments: List<PendingAttachment>): JsonElement =
  if (attachments.isEmpty()) {
    JsonPrimitive(text)
  } else {
    buildJsonArray {
      add(
        buildJsonObject {
          put("type", JsonPrimitive("text"))
          put("text", JsonPrimitive(text))
        }
      )
      attachments.forEach { attachment ->
        when (attachment.type) {
          AttachmentType.Text -> add(
            buildJsonObject {
              put("type", JsonPrimitive("text"))
              put("text", JsonPrimitive(attachment.previewText.orEmpty()))
            }
          )
          AttachmentType.Image -> add(
            buildJsonObject {
              put("type", JsonPrimitive("image_url"))
              put(
                "image_url",
                buildJsonObject {
                  put("url", JsonPrimitive(attachment.dataUrl.orEmpty()))
                }
              )
            }
          )
        }
      }
    }
  }
