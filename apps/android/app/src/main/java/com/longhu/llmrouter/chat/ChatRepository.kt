package com.longhu.llmrouter.chat

import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ChatRepository(
  private val api: RouterApi,
  private val securePrefs: SecurePrefs,
  private val chatStore: SqlCipherChatStore
) {
  private val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
  }

  fun savedBaseUrl(): String? = securePrefs.getString(SecurePrefs.Keys.BaseUrl)

  fun saveBaseUrl(baseUrl: String) {
    securePrefs.putString(SecurePrefs.Keys.BaseUrl, normalizeBaseUrl(baseUrl))
  }

  fun defaultModelAlias(): String? = securePrefs.getString(SecurePrefs.Keys.DefaultModelAlias)

  fun saveDefaultModel(alias: String?) {
    if (alias == null) {
      securePrefs.remove(SecurePrefs.Keys.DefaultModelAlias)
    } else {
      securePrefs.putString(SecurePrefs.Keys.DefaultModelAlias, alias)
    }
  }

  suspend fun login(baseUrl: String, username: String, password: String): ConsoleUser {
    val normalized = normalizeBaseUrl(baseUrl)
    val user = api.login(normalized, username, password)
    saveBaseUrl(normalized)
    return user
  }

  suspend fun register(baseUrl: String, username: String, password: String): ConsoleUser =
    api.register(normalizeBaseUrl(baseUrl), username, password)

  suspend fun restoreUser(): ConsoleUser? {
    val baseUrl = savedBaseUrl() ?: return null
    return runCatching { api.me(baseUrl) }.getOrNull()
  }

  suspend fun logout() {
    savedBaseUrl()?.let { api.logout(it) }
    securePrefs.clearSession()
  }

  suspend fun loadModels(): List<VisibleModel> {
    val baseUrl = requireNotNull(savedBaseUrl()) { "服务地址不存在。" }
    return api.visibleModels(baseUrl)
  }

  fun modelRuntimeSettings(user: ConsoleUser?, models: List<VisibleModel>): Map<String, ModelRuntimeSettings> {
    if (user == null) {
      return runtimeSettingsForVisibleOpenAiModels(models, emptyMap())
    }
    return runtimeSettingsForVisibleOpenAiModels(models, readAllModelRuntimeSettings(user))
  }

  fun modelRuntimeSettings(user: ConsoleUser?, model: VisibleModel): ModelRuntimeSettings =
    if (user == null || !model.supportsOpenAi) {
      ModelRuntimeSettings(model.alias)
    } else {
      readAllModelRuntimeSettings(user)[model.alias]?.normalized(model.alias)
        ?: ModelRuntimeSettings(model.alias)
    }

  fun saveModelRuntimeSettings(user: ConsoleUser, settings: ModelRuntimeSettings) {
    val next = readAllModelRuntimeSettings(user).toMutableMap()
    val normalized = settings.normalized()
    next[normalized.modelAlias] = normalized
    securePrefs.putString(modelRuntimeSettingsKey(user), encodeModelRuntimeSettings(next))
  }

  suspend fun prepareGatewayKey(forceRefresh: Boolean = false): PreparedGatewayKey {
    val baseUrl = requireNotNull(savedBaseUrl()) { "服务地址不存在。" }
    if (!forceRefresh) {
      val cachedId = securePrefs.getString(SecurePrefs.Keys.GatewayKeyId)
      val cachedPlaintext = securePrefs.getString(SecurePrefs.Keys.GatewayKeyPlaintext)
      if (!cachedId.isNullOrBlank() && !cachedPlaintext.isNullOrBlank()) {
        val stillEnabled = api.apiKeys(baseUrl).any { it.id == cachedId && it.enabled && it.deletedAt == null }
        if (stillEnabled) {
          return PreparedGatewayKey(cachedId, cachedPlaintext)
        }
      }
    }

    val keys = api.apiKeys(baseUrl).filter { it.enabled && it.deletedAt == null }
    for (key in keys) {
      val plaintext = runCatching { api.apiKeyPlaintext(baseUrl, key.id) }.getOrNull()
      if (!plaintext.isNullOrBlank()) {
        cacheGatewayKey(key.id, plaintext)
        return PreparedGatewayKey(key.id, plaintext)
      }
    }

    val created = api.createApiKey(baseUrl, "Android 客户端")
    cacheGatewayKey(created.item.id, created.createdKeyPlaintext)
    return PreparedGatewayKey(created.item.id, created.createdKeyPlaintext)
  }

  fun conversations(): List<Conversation> = chatStore.listConversations()

  fun messages(conversationId: String): List<ChatMessage> = chatStore.listMessages(conversationId)

  fun createConversation(title: String, modelAlias: String?): Conversation =
    chatStore.createConversation(title, modelAlias)

  fun renameConversation(conversationId: String, title: String) =
    chatStore.renameConversation(conversationId, title)

  fun deleteConversation(conversationId: String) = chatStore.deleteConversation(conversationId)

  fun addMessage(message: ChatMessage) = chatStore.addMessage(message)

  suspend fun send(
    model: VisibleModel,
    settings: ModelRuntimeSettings,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): AssistantReply {
    val baseUrl = requireNotNull(savedBaseUrl()) { "服务地址不存在。" }
    val key = prepareGatewayKey()
    return try {
      api.chatCompletion(baseUrl, key.plaintext, model, settings, history, userContent, attachments)
    } catch (error: RouterApiException) {
      if (error.code == "gateway_auth_invalid") {
        val refreshed = prepareGatewayKey(forceRefresh = true)
        try {
          api.chatCompletion(baseUrl, refreshed.plaintext, model, settings, history, userContent, attachments)
        } catch (refreshedError: RouterApiException) {
          throw refreshedError.asResponseModeError(settings)
        }
      } else {
        throw error.asResponseModeError(settings)
      }
    }
  }

  private fun cacheGatewayKey(id: String, plaintext: String) {
    securePrefs.putString(SecurePrefs.Keys.GatewayKeyId, id)
    securePrefs.putString(SecurePrefs.Keys.GatewayKeyPlaintext, plaintext)
  }

  private fun readAllModelRuntimeSettings(user: ConsoleUser): Map<String, ModelRuntimeSettings> =
    decodeModelRuntimeSettings(securePrefs.getString(modelRuntimeSettingsKey(user)))

  private fun modelRuntimeSettingsKey(user: ConsoleUser): String {
    val baseUrl = requireNotNull(savedBaseUrl()) { "服务地址不存在。" }
    return modelSettingsStorageKey(baseUrl, user.id)
  }

  private fun encodeModelRuntimeSettings(settings: Map<String, ModelRuntimeSettings>): String =
    json.encodeToString(
      ModelRuntimeSettingsCollection(
        settings.values
          .map { it.normalized() }
          .sortedBy { it.modelAlias }
      )
    )

  private fun decodeModelRuntimeSettings(encoded: String?): Map<String, ModelRuntimeSettings> {
    if (encoded.isNullOrBlank()) {
      return emptyMap()
    }
    return try {
      json.decodeFromString<ModelRuntimeSettingsCollection>(encoded)
        .items
        .map { it.normalized() }
        .associateBy { it.modelAlias }
    } catch (_: SerializationException) {
      emptyMap()
    }
  }

  private fun RouterApiException.asResponseModeError(settings: ModelRuntimeSettings): RouterApiException {
    if (settings.requestType != OpenAiRequestType.Response) {
      return this
    }
    val likelyUnsupported = status in setOf(400, 404, 405, 501) ||
      code in setOf(
        "endpoint_not_supported_for_provider_protocol",
        "not_found",
        "unsupported_endpoint",
        "unsupported_url",
        "request_failed"
      )
    return if (likelyUnsupported) {
      RouterApiException(status, "responses_not_supported", mapApiError("responses_not_supported", message))
    } else {
      this
    }
  }
}
