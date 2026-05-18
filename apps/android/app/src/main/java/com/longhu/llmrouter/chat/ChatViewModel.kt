package com.longhu.llmrouter.chat

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

data class ChatUiState(
  val loading: Boolean = true,
  val busy: Boolean = false,
  val baseUrl: String = "",
  val username: String = "",
  val password: String = "",
  val user: ConsoleUser? = null,
  val models: List<VisibleModel> = emptyList(),
  val defaultModelAlias: String? = null,
  val selectedModelAlias: String? = null,
  val conversations: List<Conversation> = emptyList(),
  val selectedConversationId: String? = null,
  val messages: List<ChatMessage> = emptyList(),
  val input: String = "",
  val pendingAttachments: List<PendingAttachment> = emptyList(),
  val notice: String? = null,
  val error: String? = null
)

class ChatViewModel(
  application: Application,
  private val repository: ChatRepository,
  private val attachmentStore: AttachmentStore
) : AndroidViewModel(application) {
  var state by mutableStateOf(ChatUiState(baseUrl = repository.savedBaseUrl().orEmpty()))
    private set

  init {
    restore()
  }

  fun updateBaseUrl(value: String) {
    state = state.copy(baseUrl = value)
  }

  fun updateUsername(value: String) {
    state = state.copy(username = value)
  }

  fun updatePassword(value: String) {
    state = state.copy(password = value)
  }

  fun updateInput(value: String) {
    state = state.copy(input = value)
  }

  fun login() {
    runBusy {
      val user = repository.login(state.baseUrl, state.username, state.password)
      prepareSignedInState(user, notice = "登录成功。")
    }
  }

  fun register() {
    runBusy {
      repository.register(state.baseUrl, state.username, state.password)
      state = state.copy(
        busy = false,
        notice = "注册已提交，请等待管理员审批。",
        error = null,
        password = ""
      )
    }
  }

  fun logout() {
    runBusy {
      repository.logout()
      state = ChatUiState(
        loading = false,
        baseUrl = repository.savedBaseUrl().orEmpty(),
        notice = "已退出登录。"
      )
    }
  }

  fun refreshModels() {
    runBusy {
      val models = repository.loadModels()
      applyModels(models, notice = "模型列表已刷新。")
    }
  }

  fun setDefaultModel(alias: String?) {
    repository.saveDefaultModel(alias)
    state = state.copy(
      defaultModelAlias = alias,
      selectedModelAlias = alias ?: state.selectedModelAlias,
      notice = if (alias == null) "默认模型已清空。" else "默认模型已更新。"
    )
  }

  fun selectChatModel(alias: String) {
    state = state.copy(selectedModelAlias = alias)
  }

  fun newConversation() {
    val model = state.selectedModelAlias ?: state.defaultModelAlias
    val conversation = repository.createConversation("新对话", model)
    state = state.copy(
      conversations = repository.conversations(),
      selectedConversationId = conversation.id,
      messages = emptyList(),
      selectedModelAlias = model,
      notice = null,
      error = null
    )
  }

  fun selectConversation(conversationId: String) {
    val conversation = state.conversations.firstOrNull { it.id == conversationId }
    state = state.copy(
      selectedConversationId = conversationId,
      messages = repository.messages(conversationId),
      selectedModelAlias = conversation?.modelAlias ?: state.defaultModelAlias ?: state.selectedModelAlias,
      notice = null,
      error = null
    )
  }

  fun deleteCurrentConversation() {
    val conversationId = state.selectedConversationId ?: return
    repository.deleteConversation(conversationId)
    val conversations = repository.conversations()
    val next = conversations.firstOrNull()
    state = state.copy(
      conversations = conversations,
      selectedConversationId = next?.id,
      messages = next?.let { repository.messages(it.id) }.orEmpty(),
      notice = "对话已删除。"
    )
  }

  fun addAttachments(uris: List<Uri>) {
    if (uris.isEmpty()) {
      return
    }
    viewModelScope.launch {
      try {
        val next = withContext(Dispatchers.IO) {
          uris.map { attachmentStore.createFromUri(it) }
        }
        val combined = state.pendingAttachments + next
        validateAttachmentLimits(combined)
        state = state.copy(pendingAttachments = combined, error = null)
      } catch (error: Throwable) {
        state = state.copy(error = error.message ?: "附件读取失败。")
      }
    }
  }

  fun addClipboardAttachment() {
    val clipboard = getApplication<Application>()
      .getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    viewModelScope.launch {
      try {
        val pending = withContext(Dispatchers.IO) {
          attachmentStore.createFromClipData(clipboard.primaryClip)
        } ?: throw IllegalArgumentException("剪贴板中没有可读取的图片或文件。")
        val combined = state.pendingAttachments + pending
        validateAttachmentLimits(combined)
        state = state.copy(pendingAttachments = combined, error = null)
      } catch (error: Throwable) {
        state = state.copy(error = error.message ?: "无法读取剪贴板内容。")
      }
    }
  }

  fun removeAttachment(id: String) {
    state = state.copy(pendingAttachments = state.pendingAttachments.filterNot { it.id == id })
  }

  fun sendMessage() {
    val text = state.input.trim()
    val attachments = state.pendingAttachments
    if (text.isBlank() && attachments.isEmpty()) {
      state = state.copy(error = "请输入消息或添加附件。")
      return
    }

    val model = state.models.firstOrNull { it.alias == state.selectedModelAlias }
    if (model == null) {
      state = state.copy(error = "请先选择可用模型。")
      return
    }

    runBusy {
      validateRequestSize(text, attachments)

      val conversation = ensureConversation(model.alias, text)
      val history = repository.messages(conversation.id)
      val now = System.currentTimeMillis()
      val userMessageId = UUID.randomUUID().toString()
      val storedAttachments = attachments.map { attachmentStore.persist(userMessageId, it) }
      val userMessage = ChatMessage(
        id = userMessageId,
        conversationId = conversation.id,
        role = MessageRole.User,
        content = displayContent(text, attachments),
        modelAlias = model.alias,
        protocol = model.preferredProtocol,
        createdAt = now,
        attachments = storedAttachments
      )

      repository.addMessage(userMessage)
      state = state.copy(
        input = "",
        pendingAttachments = emptyList(),
        messages = repository.messages(conversation.id)
      )

      val reply = repository.send(model, history, text, attachments)
      repository.addMessage(
        ChatMessage(
          id = UUID.randomUUID().toString(),
          conversationId = conversation.id,
          role = MessageRole.Assistant,
          content = reply.ifBlank { "（空响应）" },
          modelAlias = model.alias,
          protocol = model.preferredProtocol,
          createdAt = System.currentTimeMillis()
        )
      )
      state = state.copy(
        busy = false,
        conversations = repository.conversations(),
        messages = repository.messages(conversation.id),
        selectedConversationId = conversation.id,
        error = null
      )
    }
  }

  private fun restore() {
    viewModelScope.launch {
      try {
        val user = repository.restoreUser()
        if (user == null) {
          state = state.copy(loading = false)
          return@launch
        }
        prepareSignedInState(user, notice = null)
      } catch (error: Throwable) {
        state = state.copy(
          loading = false,
          error = error.toUserMessage()
        )
      }
    }
  }

  private suspend fun prepareSignedInState(user: ConsoleUser, notice: String?) {
    repository.prepareGatewayKey()
    val models = repository.loadModels()
    state = state.copy(
      loading = false,
      busy = false,
      user = user,
      username = "",
      password = "",
      notice = notice,
      error = null
    )
    applyModels(models, notice = notice)
    val conversations = repository.conversations()
    val selected = conversations.firstOrNull()
    state = state.copy(
      conversations = conversations,
      selectedConversationId = selected?.id,
      messages = selected?.let { repository.messages(it.id) }.orEmpty()
    )
  }

  private fun applyModels(models: List<VisibleModel>, notice: String?) {
    val savedDefault = repository.defaultModelAlias()
    val validDefault = savedDefault?.takeIf { alias -> models.any { it.alias == alias } }
    if (savedDefault != null && validDefault == null) {
      repository.saveDefaultModel(null)
    }
    val selected = state.selectedModelAlias?.takeIf { alias -> models.any { it.alias == alias } }
      ?: validDefault
      ?: models.firstOrNull()?.alias
    state = state.copy(
      models = models,
      defaultModelAlias = validDefault,
      selectedModelAlias = selected,
      notice = if (savedDefault != null && validDefault == null) {
        "原默认模型已不可用，请重新选择。"
      } else {
        notice
      }
    )
  }

  private fun ensureConversation(modelAlias: String, firstMessage: String): Conversation {
    val existing = state.selectedConversationId
      ?.let { id -> state.conversations.firstOrNull { it.id == id } }
    if (existing != null) {
      return existing
    }
    val title = firstMessage.take(28).ifBlank { "带附件的对话" }
    val conversation = repository.createConversation(title, modelAlias)
    state = state.copy(
      selectedConversationId = conversation.id,
      conversations = repository.conversations()
    )
    return conversation
  }

  private fun validateAttachmentLimits(attachments: List<PendingAttachment>) {
    val imageCount = attachments.count { it.type == AttachmentType.Image }
    val textCount = attachments.count { it.type == AttachmentType.Text }
    require(imageCount <= 4) { "单轮最多添加 4 张图片。" }
    require(textCount <= 5) { "单轮最多添加 5 个文本附件。" }
  }

  private fun validateRequestSize(text: String, attachments: List<PendingAttachment>) {
    val estimated = text.toByteArray(Charsets.UTF_8).size +
      attachments.sumOf { attachment ->
        when (attachment.type) {
          AttachmentType.Image -> attachment.dataUrl?.length ?: attachment.sizeBytes
          AttachmentType.Text -> attachment.previewText?.toByteArray(Charsets.UTF_8)?.size ?: attachment.sizeBytes
        }
      }
    require(estimated <= 40 * 1024 * 1024) { "本轮请求超过 40 MB，请减少附件后再发送。" }
  }

  private fun displayContent(text: String, attachments: List<PendingAttachment>): String {
    if (attachments.isEmpty()) {
      return text
    }
    val summary = attachments.joinToString("\n") { attachment ->
      "- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes / 1024} KB)"
    }
    return "$text\n\n附件：\n$summary".trim()
  }

  private fun runBusy(block: suspend () -> Unit) {
    state = state.copy(busy = true, error = null, notice = null)
    viewModelScope.launch {
      try {
        block()
        if (state.busy) {
          state = state.copy(busy = false)
        }
      } catch (error: Throwable) {
        state = state.copy(
          busy = false,
          error = error.toUserMessage()
        )
      }
    }
  }

  private fun Throwable.toUserMessage(): String =
    when (this) {
      is RouterApiException -> mapApiError(code, message)
      else -> message ?: "操作失败，请稍后再试。"
    }

  class Factory(
    private val application: Application,
    private val repository: ChatRepository,
    private val attachmentStore: AttachmentStore
  ) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
      ChatViewModel(application, repository, attachmentStore) as T
  }
}
