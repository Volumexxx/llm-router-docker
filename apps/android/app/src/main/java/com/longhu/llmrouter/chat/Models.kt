package com.longhu.llmrouter.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.security.MessageDigest

enum class GatewayProtocol(val wireName: String) {
  OpenAi("openai"),
  Anthropic("anthropic");

  companion object {
    fun fromWire(value: String): GatewayProtocol =
      if (value == "anthropic") Anthropic else OpenAi
  }
}

@Serializable
enum class OpenAiRequestType(val wireName: String) {
  @SerialName("chat")
  Chat("chat"),

  @SerialName("response")
  Response("response");

  companion object {
    fun fromWire(value: String?): OpenAiRequestType =
      if (value == Response.wireName) Response else Chat
  }
}

enum class MessageRole(val wireName: String) {
  User("user"),
  Assistant("assistant"),
  System("system");

  companion object {
    fun fromWire(value: String): MessageRole =
      when (value) {
        "assistant" -> Assistant
        "system" -> System
        else -> User
      }
  }
}

enum class AttachmentType(val wireName: String) {
  Image("image"),
  Text("text");

  companion object {
    fun fromWire(value: String): AttachmentType =
      if (value == "image") Image else Text
  }
}

@Serializable
data class ConsoleUser(
  val id: String,
  val username: String,
  val displayName: String,
  val role: String,
  val status: String
)

@Serializable
data class AuthResponse(
  val user: ConsoleUser
)

@Serializable
data class LoginRequest(
  val username: String,
  val password: String
)

@Serializable
data class ApiErrorPayload(
  val error: ApiErrorBody? = null
)

@Serializable
data class ApiErrorBody(
  val code: String? = null,
  val message: String? = null
)

@Serializable
data class VisibleModelsResponse(
  val items: List<VisibleModel>
)

@Serializable
data class VisibleModel(
  val alias: String,
  val displayName: String,
  val protocols: List<String>
) {
  val gatewayProtocols: List<GatewayProtocol>
    get() = protocols.map(GatewayProtocol.Companion::fromWire)

  val preferredProtocol: GatewayProtocol
    get() = if (gatewayProtocols.contains(GatewayProtocol.OpenAi)) {
      GatewayProtocol.OpenAi
    } else {
      GatewayProtocol.Anthropic
    }

  val supportsOpenAi: Boolean
    get() = gatewayProtocols.contains(GatewayProtocol.OpenAi)
}

const val DefaultMaxOutputTokens = 2048

@Serializable
data class ModelRuntimeSettings(
  val modelAlias: String,
  val requestType: OpenAiRequestType = OpenAiRequestType.Chat,
  val contextMaxTokens: Int? = null,
  val maxOutputTokens: Int = DefaultMaxOutputTokens
) {
  fun normalized(alias: String = modelAlias): ModelRuntimeSettings =
    copy(
      modelAlias = alias,
      contextMaxTokens = contextMaxTokens?.takeIf { it > 0 },
      maxOutputTokens = maxOutputTokens.takeIf { it > 0 } ?: DefaultMaxOutputTokens
    )
}

@Serializable
data class ModelRuntimeSettingsCollection(
  val items: List<ModelRuntimeSettings> = emptyList()
)

fun modelSettingsStorageKey(baseUrl: String, userId: String): String {
  val digest = MessageDigest.getInstance("SHA-256")
    .digest("${baseUrl.trim()}|$userId".toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }
  return "${SecurePrefs.Keys.ModelRuntimeSettings}:$digest"
}

fun runtimeSettingsForVisibleOpenAiModels(
  models: List<VisibleModel>,
  saved: Map<String, ModelRuntimeSettings>
): Map<String, ModelRuntimeSettings> =
  models
    .filter { it.supportsOpenAi }
    .associate { model ->
      val settings = saved[model.alias]?.normalized(model.alias) ?: ModelRuntimeSettings(model.alias)
      model.alias to settings
    }

fun defaultOpenAiSettingsModelAlias(
  models: List<VisibleModel>,
  defaultModelAlias: String?
): String? {
  val openAiModels = models.filter { it.supportsOpenAi }
  return defaultModelAlias
    ?.takeIf { alias -> openAiModels.any { it.alias == alias } }
    ?: openAiModels.firstOrNull()?.alias
}

@Serializable
data class ApiKeyListResponse(
  val items: List<ApiKeyItem>
)

@Serializable
data class ApiKeyItem(
  val id: String,
  val name: String,
  val maskedPreview: String,
  val enabled: Boolean,
  val deletedAt: String? = null,
  val plaintextAvailable: Boolean? = null
)

@Serializable
data class CreateApiKeyRequest(
  val name: String
)

@Serializable
data class CreateApiKeyResponse(
  val item: ApiKeyItem,
  val createdKeyPlaintext: String
)

@Serializable
data class PlaintextApiKeyResponse(
  val plaintext: String
)

data class Conversation(
  val id: String,
  val title: String,
  val createdAt: Long,
  val updatedAt: Long,
  val modelAlias: String?
)

data class ChatMessage(
  val id: String,
  val conversationId: String,
  val role: MessageRole,
  val content: String,
  val modelAlias: String?,
  val protocol: GatewayProtocol?,
  val requestType: OpenAiRequestType? = null,
  val createdAt: Long,
  val attachments: List<StoredAttachment> = emptyList()
)

data class AssistantReply(
  val text: String,
  val generatedImages: List<GeneratedImage> = emptyList()
)

data class GeneratedImage(
  val name: String,
  val mimeType: String,
  val bytes: ByteArray
) {
  val sizeBytes: Int get() = bytes.size
}

data class StoredAttachment(
  val id: String,
  val messageId: String,
  val type: AttachmentType,
  val name: String,
  val mimeType: String,
  val encryptedPath: String,
  val previewText: String?,
  val createdAt: Long
)

data class PendingAttachment(
  val id: String,
  val type: AttachmentType,
  val name: String,
  val mimeType: String,
  val bytes: ByteArray,
  val previewText: String?,
  val dataUrl: String?,
  val createdAt: Long = System.currentTimeMillis()
) {
  val sizeBytes: Int get() = bytes.size
}

data class PreparedGatewayKey(
  val id: String,
  val plaintext: String
)

class RouterApiException(
  val status: Int,
  val code: String,
  override val message: String
) : RuntimeException(message)

fun normalizeBaseUrl(raw: String): String {
  val trimmed = raw.trim().trimEnd('/')
  require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    "服务地址必须以 http:// 或 https:// 开头"
  }
  return trimmed
}

fun mapApiError(code: String, fallback: String): String =
  when (code) {
    "account_pending_approval" -> "账号正在等待管理员审批。"
    "account_rejected" -> "账号注册已被拒绝。"
    "account_disabled" -> "账号已被停用。"
    "account_not_approved" -> "账号尚未通过审批。"
    "admin_session_invalid", "admin_auth_required" -> "登录会话已失效，请重新登录。"
    "gateway_auth_invalid" -> "当前账号的网关 Key 无效或已停用。"
    "model_not_routable" -> "当前账号无权使用该模型，或模型暂不可路由。"
    "api_rate_limited" -> "请求过于频繁，请稍后再试。"
    "proxy_concurrency_limited" -> "服务端并发已满，请稍后再试。"
    "responses_not_supported", "endpoint_not_supported_for_provider_protocol" -> "当前模型或上游不支持 response 请求，请到设置中切回 chat 后重试。"
    "request_failed" -> fallback
    else -> fallback.ifBlank { code }
  }
