package com.longhu.llmrouter.chat

class ChatRepository(
  private val api: RouterApi,
  private val securePrefs: SecurePrefs,
  private val chatStore: SqlCipherChatStore
) {
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

  fun deleteConversation(conversationId: String) = chatStore.deleteConversation(conversationId)

  fun addMessage(message: ChatMessage) = chatStore.addMessage(message)

  suspend fun send(
    model: VisibleModel,
    history: List<ChatMessage>,
    userContent: String,
    attachments: List<PendingAttachment>
  ): String {
    val baseUrl = requireNotNull(savedBaseUrl()) { "服务地址不存在。" }
    val key = prepareGatewayKey()
    return try {
      api.chatCompletion(baseUrl, key.plaintext, model, history, userContent, attachments)
    } catch (error: RouterApiException) {
      if (error.code == "gateway_auth_invalid") {
        val refreshed = prepareGatewayKey(forceRefresh = true)
        api.chatCompletion(baseUrl, refreshed.plaintext, model, history, userContent, attachments)
      } else {
        throw error
      }
    }
  }

  private fun cacheGatewayKey(id: String, plaintext: String) {
    securePrefs.putString(SecurePrefs.Keys.GatewayKeyId, id)
    securePrefs.putString(SecurePrefs.Keys.GatewayKeyPlaintext, plaintext)
  }
}
