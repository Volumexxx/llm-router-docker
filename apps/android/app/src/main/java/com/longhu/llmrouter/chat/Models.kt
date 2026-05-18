package com.longhu.llmrouter.chat

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

enum class GatewayProtocol(val wireName: String) {
  OpenAi("openai"),
  Anthropic("anthropic");

  companion object {
    fun fromWire(value: String): GatewayProtocol =
      if (value == "anthropic") Anthropic else OpenAi
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
  val createdAt: Long,
  val attachments: List<StoredAttachment> = emptyList()
)

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
    "request_failed" -> fallback
    else -> fallback.ifBlank { code }
  }
