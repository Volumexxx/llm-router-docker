package com.longhu.llmrouter.chat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): String {
    val protocol = model.preferredProtocol
    return if (protocol == GatewayProtocol.OpenAi) {
      postOpenAiChat(baseUrl, apiKey, model.alias, history, userContent, attachments)
    } else {
      postAnthropicMessages(baseUrl, apiKey, model.alias, history, userContent, attachments)
    }
  }

  private suspend fun postOpenAiChat(
    baseUrl: String,
    apiKey: String,
    modelAlias: String,
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
          put("content", openAiContent(userContent, attachments))
        }
      )
    }

    val payload = buildJsonObject {
      put("model", JsonPrimitive(modelAlias))
      put("stream", JsonPrimitive(false))
      put("temperature", JsonPrimitive(0.7))
      put("max_tokens", JsonPrimitive(2048))
      put("messages", messages)
    }.toString()

    val response = postJsonObject(normalizeBaseUrl(baseUrl), "/v1/chat/completions", payload, apiKey)
    val choices = response["choices"] as? JsonArray ?: return ""
    val message = choices.firstOrNull()?.jsonObject?.get("message")?.jsonObject ?: return ""
    val content = message["content"] ?: return ""
    if (content is JsonPrimitive) {
      return content.contentOrNull.orEmpty()
    }
    if (content is JsonArray) {
      return content.mapNotNull { part ->
        val item = part.jsonObject
        item["text"]?.jsonPrimitive?.contentOrNull
      }.joinToString("")
    }
    return ""
  }

  private suspend fun postAnthropicMessages(
    baseUrl: String,
    apiKey: String,
    modelAlias: String,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): String {
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
    val content = response["content"] as? JsonArray ?: return ""
    return content.mapNotNull { part ->
      val item = part.jsonObject
      if (item["type"]?.jsonPrimitive?.contentOrNull == "text") {
        item["text"]?.jsonPrimitive?.contentOrNull
      } else {
        null
      }
    }.joinToString("")
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
