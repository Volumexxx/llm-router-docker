package com.longhu.llmrouter.chat

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun ChatTopBar(
  state: ChatUiState,
  showMenuButton: Boolean,
  onMenuClick: () -> Unit,
  onShowModels: () -> Unit,
  onNewConversation: () -> Unit,
  onRequestRename: () -> Unit,
  onRequestDelete: () -> Unit,
  onRefreshModels: () -> Unit,
  onOpenSettings: () -> Unit,
  onLogout: () -> Unit
) {
  var expanded by remember { mutableStateOf(false) }
  Surface(color = AppColors.Surface) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .statusBarsPadding()
        .height(64.dp)
        .padding(horizontal = 10.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      if (showMenuButton) {
        IconButton(onClick = onMenuClick) {
          Icon(Icons.Filled.Menu, contentDescription = "打开会话列表")
        }
      }
      Column(
        modifier = Modifier
          .weight(1f)
          .padding(start = if (showMenuButton) 2.dp else 8.dp, end = 8.dp),
        verticalArrangement = Arrangement.Center
      ) {
        Text(
          selectedConversationTitle(state),
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        ModelChip(
          label = selectedModelLabel(state),
          enabled = state.models.isNotEmpty(),
          onClick = onShowModels
        )
      }
      IconButton(onClick = onNewConversation, enabled = !state.busy) {
        Icon(Icons.Filled.Add, contentDescription = "新对话")
      }
      Box {
        IconButton(onClick = { expanded = true }) {
          Icon(Icons.Filled.MoreVert, contentDescription = "更多")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
          DropdownMenuItem(
            text = { Text("设置") },
            leadingIcon = { Icon(Icons.Filled.Settings, contentDescription = null) },
            enabled = !state.busy,
            onClick = {
              expanded = false
              onOpenSettings()
            }
          )
          DropdownMenuItem(
            text = { Text("刷新模型") },
            leadingIcon = { Icon(Icons.Filled.Refresh, contentDescription = null) },
            enabled = !state.busy,
            onClick = {
              expanded = false
              onRefreshModels()
            }
          )
          DropdownMenuItem(
            text = { Text("重命名当前对话") },
            leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
            enabled = state.selectedConversationId != null && !state.busy,
            onClick = {
              expanded = false
              onRequestRename()
            }
          )
          DropdownMenuItem(
            text = { Text("删除当前对话") },
            leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
            enabled = state.selectedConversationId != null && !state.busy,
            onClick = {
              expanded = false
              onRequestDelete()
            }
          )
          DropdownMenuItem(
            text = { Text("退出登录") },
            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null) },
            enabled = !state.busy,
            onClick = {
              expanded = false
              onLogout()
            }
          )
        }
      }
    }
  }
}

@Composable
private fun ModelChip(label: String, enabled: Boolean, onClick: () -> Unit) {
  Surface(
    modifier = Modifier
      .padding(top = 4.dp)
      .widthIn(max = 220.dp)
      .clip(RoundedCornerShape(8.dp))
      .clickable(enabled = enabled, onClick = onClick),
    shape = RoundedCornerShape(8.dp),
    color = AppColors.PrimarySoft,
    border = BorderStroke(1.dp, Color(0xFFD5E2FF))
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Text(
        label,
        modifier = Modifier.weight(1f, fill = false),
        color = AppColors.Primary,
        style = MaterialTheme.typography.labelMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
      )
      Icon(
        Icons.Filled.ExpandMore,
        contentDescription = null,
        tint = AppColors.Primary,
        modifier = Modifier.size(16.dp)
      )
    }
  }
}

@Composable
fun ConversationPanel(
  state: ChatUiState,
  onSelect: (String) -> Unit,
  onNew: () -> Unit,
  onRequestRename: (String) -> Unit,
  onRequestDelete: (String) -> Unit,
  onRefreshModels: () -> Unit,
  onOpenSettings: () -> Unit,
  onLogout: () -> Unit,
  modifier: Modifier = Modifier
) {
  Column(
    modifier = modifier
      .background(AppColors.Surface)
      .statusBarsPadding()
      .navigationBarsPadding()
      .padding(12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(
        Icons.Filled.AccountCircle,
        contentDescription = null,
        tint = AppColors.Primary,
        modifier = Modifier.size(36.dp)
      )
      Column(
        modifier = Modifier
          .weight(1f)
          .padding(start = 8.dp)
      ) {
        Text(
          state.user?.displayName.orEmpty(),
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          "${state.models.size} 个可用模型",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodySmall
        )
      }
    }

    Button(
      onClick = onNew,
      enabled = !state.busy,
      colors = ButtonDefaults.buttonColors(containerColor = AppColors.Primary),
      shape = RoundedCornerShape(8.dp),
      modifier = Modifier.fillMaxWidth()
    ) {
      Icon(Icons.Filled.Add, contentDescription = null)
      Text("新对话", modifier = Modifier.padding(start = 6.dp))
    }

    LazyColumn(
      modifier = Modifier.weight(1f),
      verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
      if (state.conversations.isEmpty()) {
        item {
          Text(
            "暂无历史会话",
            color = AppColors.MutedText,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(8.dp)
          )
        }
      }
      items(state.conversations, key = { it.id }) { conversation ->
        ConversationRow(
          conversation = conversation,
          selected = conversation.id == state.selectedConversationId,
          actionsEnabled = !state.busy,
          onSelect = { onSelect(conversation.id) },
          onRename = { onRequestRename(conversation.id) },
          onDelete = { onRequestDelete(conversation.id) }
        )
      }
    }

    OutlinedButton(
      onClick = onOpenSettings,
      enabled = !state.busy,
      shape = RoundedCornerShape(8.dp),
      modifier = Modifier.fillMaxWidth()
    ) {
      Icon(Icons.Filled.Settings, contentDescription = null)
      Text("设置", modifier = Modifier.padding(start = 4.dp))
    }

    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      OutlinedButton(
        onClick = onRefreshModels,
        enabled = !state.busy,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.weight(1f)
      ) {
        Icon(Icons.Filled.Refresh, contentDescription = null)
        Text("刷新", modifier = Modifier.padding(start = 4.dp))
      }
      OutlinedButton(
        onClick = onLogout,
        enabled = !state.busy,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.weight(1f)
      ) {
        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null)
        Text("退出", modifier = Modifier.padding(start = 4.dp))
      }
    }
  }
}

@Composable
private fun ConversationRow(
  conversation: Conversation,
  selected: Boolean,
  actionsEnabled: Boolean,
  onSelect: () -> Unit,
  onRename: () -> Unit,
  onDelete: () -> Unit
) {
  var expanded by remember { mutableStateOf(false) }
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onSelect),
    shape = RoundedCornerShape(8.dp),
    color = if (selected) AppColors.PrimarySoft else Color.Transparent,
    border = if (selected) BorderStroke(1.dp, Color(0xFFD5E2FF)) else null
  ) {
    Row(
      modifier = Modifier.padding(start = 10.dp, top = 8.dp, end = 4.dp, bottom = 8.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(
          conversation.title,
          color = AppColors.Text,
          fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          conversation.modelAlias ?: "未记录模型",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodySmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
      Box {
        IconButton(
          onClick = { expanded = true },
          enabled = actionsEnabled,
          modifier = Modifier.size(36.dp)
        ) {
          Icon(
            Icons.Filled.MoreVert,
            contentDescription = "会话操作",
            tint = AppColors.MutedText,
            modifier = Modifier.size(18.dp)
          )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
          DropdownMenuItem(
            text = { Text("重命名") },
            leadingIcon = { Icon(Icons.Filled.Edit, contentDescription = null) },
            onClick = {
              expanded = false
              onRename()
            }
          )
          DropdownMenuItem(
            text = { Text("删除") },
            leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
            onClick = {
              expanded = false
              onDelete()
            }
          )
        }
      }
    }
  }
}

@Composable
fun MessageList(
  state: ChatUiState,
  onLoadAttachmentBytes: (StoredAttachment) -> ByteArray?,
  modifier: Modifier = Modifier
) {
  val listState = rememberLazyListState()
  LaunchedEffect(state.messages.size, state.sendingMessage) {
    val targetIndex = state.messages.size + if (state.sendingMessage) 1 else 0
    if (targetIndex > 0) {
      listState.animateScrollToItem(targetIndex)
    }
  }

  if (state.messages.isEmpty() && !state.sendingMessage) {
    EmptyConversation(modifier = modifier)
    return
  }

  LazyColumn(
    state = listState,
    modifier = modifier
      .fillMaxWidth()
      .padding(horizontal = 14.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)
  ) {
    item { Spacer(modifier = Modifier.height(2.dp)) }
    items(state.messages, key = { it.id }) { message ->
      MessageBubble(message, onLoadAttachmentBytes)
    }
    if (state.sendingMessage) {
      item(key = "assistant-waiting") {
        AssistantWaitingBubble()
      }
    }
    item { Spacer(modifier = Modifier.height(12.dp)) }
  }
}

@Composable
private fun EmptyConversation(modifier: Modifier = Modifier) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .padding(28.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally
  ) {
    Surface(
      shape = CircleShape,
      color = AppColors.PrimarySoft,
      modifier = Modifier.size(56.dp)
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Add, contentDescription = null, tint = AppColors.Primary)
      }
    }
    Text(
      "开始一个新对话",
      modifier = Modifier.padding(top = 14.dp),
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold
    )
    Text(
      "选择模型后输入消息，附件可从底部添加。",
      color = AppColors.MutedText,
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(top = 4.dp)
    )
  }
}

@Composable
private fun MessageBubble(
  message: ChatMessage,
  onLoadAttachmentBytes: (StoredAttachment) -> ByteArray?
) {
  val isUser = message.role == MessageRole.User
  Box(modifier = Modifier.fillMaxWidth()) {
    Surface(
      modifier = Modifier
        .align(if (isUser) Alignment.CenterEnd else Alignment.CenterStart)
        .fillMaxWidth(if (isUser) 0.86f else 0.9f)
        .widthIn(max = 680.dp),
      shape = RoundedCornerShape(8.dp),
      color = if (isUser) AppColors.UserBubble else AppColors.AssistantBubble,
      border = if (isUser) null else BorderStroke(1.dp, AppColors.Border),
      shadowElevation = if (isUser) 0.dp else 1.dp
    ) {
      Column(
        modifier = Modifier.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
      ) {
        Text(
          if (isUser) "你" else "助手",
          color = if (isUser) Color.White.copy(alpha = 0.86f) else AppColors.MutedText,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = FontWeight.SemiBold
        )
        if (message.content.isNotBlank()) {
          SelectionContainer {
            Text(
              message.content,
              color = if (isUser) Color.White else AppColors.Text,
              style = MaterialTheme.typography.bodyLarge
            )
          }
        }
        StoredAttachmentPreview(
          attachments = message.attachments,
          isUser = isUser,
          onLoadAttachmentBytes = onLoadAttachmentBytes
        )
        if (message.content.isBlank() && message.attachments.isEmpty()) {
          Text(
            "（空响应）",
            color = if (isUser) Color.White else AppColors.MutedText,
            style = MaterialTheme.typography.bodyLarge
          )
        }
        message.modelAlias?.let { model ->
          Text(
            "$model · ${messageRequestLabel(message)}",
            color = if (isUser) Color.White.copy(alpha = 0.76f) else AppColors.MutedText,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      }
    }
  }
}

@Composable
private fun StoredAttachmentPreview(
  attachments: List<StoredAttachment>,
  isUser: Boolean,
  onLoadAttachmentBytes: (StoredAttachment) -> ByteArray?
) {
  if (attachments.isEmpty()) {
    return
  }
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    attachments.forEach { attachment ->
      when (attachment.type) {
        AttachmentType.Image -> StoredImageAttachment(
          attachment = attachment,
          isUser = isUser,
          onLoadAttachmentBytes = onLoadAttachmentBytes
        )
        AttachmentType.Text -> StoredTextAttachment(attachment, isUser)
      }
    }
  }
}

@Composable
private fun StoredImageAttachment(
  attachment: StoredAttachment,
  isUser: Boolean,
  onLoadAttachmentBytes: (StoredAttachment) -> ByteArray?
) {
  val imageBitmap = remember(attachment.id, attachment.encryptedPath) {
    val bytes = onLoadAttachmentBytes(attachment) ?: return@remember null
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
  }
  if (imageBitmap == null) {
    StoredTextAttachment(attachment, isUser)
    return
  }
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = if (isUser) Color.White.copy(alpha = 0.12f) else AppColors.Panel,
    border = BorderStroke(1.dp, if (isUser) Color.White.copy(alpha = 0.22f) else AppColors.Border)
  ) {
    androidx.compose.foundation.Image(
      bitmap = imageBitmap,
      contentDescription = attachment.name,
      contentScale = ContentScale.Fit,
      modifier = Modifier
        .fillMaxWidth()
        .heightIn(min = 120.dp, max = 280.dp)
        .padding(4.dp)
        .clip(RoundedCornerShape(6.dp))
        .background(if (isUser) Color.Transparent else Color.White)
    )
  }
}

@Composable
private fun StoredTextAttachment(attachment: StoredAttachment, isUser: Boolean) {
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = if (isUser) Color.White.copy(alpha = 0.12f) else AppColors.Panel,
    border = BorderStroke(1.dp, if (isUser) Color.White.copy(alpha = 0.22f) else AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Icon(
        if (attachment.type == AttachmentType.Image) Icons.Filled.Image else Icons.AutoMirrored.Filled.InsertDriveFile,
        contentDescription = null,
        tint = if (isUser) Color.White.copy(alpha = 0.82f) else AppColors.MutedText,
        modifier = Modifier.size(18.dp)
      )
      Column(
        modifier = Modifier
          .padding(start = 6.dp)
          .weight(1f)
      ) {
        Text(
          attachment.name,
          color = if (isUser) Color.White else AppColors.Text,
          style = MaterialTheme.typography.bodySmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          attachment.mimeType,
          color = if (isUser) Color.White.copy(alpha = 0.72f) else AppColors.MutedText,
          style = MaterialTheme.typography.labelSmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
    }
  }
}

@Composable
private fun AssistantWaitingBubble() {
  Box(modifier = Modifier.fillMaxWidth()) {
    Surface(
      modifier = Modifier
        .align(Alignment.CenterStart)
        .fillMaxWidth(0.72f)
        .widthIn(max = 520.dp),
      shape = RoundedCornerShape(8.dp),
      color = AppColors.AssistantBubble,
      border = BorderStroke(1.dp, AppColors.Border),
      shadowElevation = 1.dp
    ) {
      Row(
        modifier = Modifier.padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
      ) {
        CircularProgressIndicator(
          modifier = Modifier.size(18.dp),
          strokeWidth = 2.dp,
          color = AppColors.Primary
        )
        Text(
          "正在思考…",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodyMedium
        )
      }
    }
  }
}

@Composable
fun ChatInputBar(
  state: ChatUiState,
  onInputChange: (String) -> Unit,
  onSend: () -> Unit,
  onPickImages: () -> Unit,
  onPickFiles: () -> Unit,
  onPasteClipboard: () -> Unit,
  onRemoveAttachment: (String) -> Unit
) {
  var attachmentMenuExpanded by remember { mutableStateOf(false) }
  Surface(
    color = AppColors.Surface,
    shadowElevation = 4.dp
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .navigationBarsPadding()
        .imePadding()
        .padding(horizontal = 10.dp, vertical = 10.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      PendingAttachmentChips(state.pendingAttachments, onRemoveAttachment)
      Row(
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        Box {
          IconButton(
            onClick = { attachmentMenuExpanded = true },
            enabled = !state.busy,
            modifier = Modifier
              .size(44.dp)
              .clip(CircleShape)
              .background(AppColors.Panel)
          ) {
            Icon(Icons.Filled.AttachFile, contentDescription = "添加附件")
          }
          DropdownMenu(
            expanded = attachmentMenuExpanded,
            onDismissRequest = { attachmentMenuExpanded = false }
          ) {
            AttachmentMenuItem("图片", Icons.Filled.Image) {
              attachmentMenuExpanded = false
              onPickImages()
            }
            AttachmentMenuItem("文本附件", Icons.AutoMirrored.Filled.InsertDriveFile) {
              attachmentMenuExpanded = false
              onPickFiles()
            }
            AttachmentMenuItem("粘贴图片", Icons.Filled.ContentPaste) {
              attachmentMenuExpanded = false
              onPasteClipboard()
            }
          }
        }

        OutlinedTextField(
          value = state.input,
          onValueChange = onInputChange,
          placeholder = { Text("输入消息") },
          minLines = 1,
          maxLines = 5,
          enabled = !state.busy,
          shape = RoundedCornerShape(8.dp),
          modifier = Modifier
            .weight(1f)
            .defaultMinSize(minHeight = 44.dp)
        )

        IconButton(
          onClick = onSend,
          enabled = !state.busy && state.models.isNotEmpty(),
          modifier = Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(if (!state.busy && state.models.isNotEmpty()) AppColors.Primary else AppColors.Border)
        ) {
          Icon(
            Icons.AutoMirrored.Filled.Send,
            contentDescription = if (state.busy) "发送中" else "发送",
            tint = Color.White
          )
        }
      }
    }
  }
}

@Composable
private fun AttachmentMenuItem(label: String, icon: ImageVector, onClick: () -> Unit) {
  DropdownMenuItem(
    text = { Text(label) },
    leadingIcon = { Icon(icon, contentDescription = null) },
    onClick = onClick
  )
}

@Composable
private fun PendingAttachmentChips(
  attachments: List<PendingAttachment>,
  onRemoveAttachment: (String) -> Unit
) {
  if (attachments.isEmpty()) {
    return
  }
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    attachments.forEach { attachment ->
      AttachmentChip(attachment, onRemoveAttachment)
    }
  }
}

@Composable
private fun AttachmentChip(attachment: PendingAttachment, onRemoveAttachment: (String) -> Unit) {
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = AppColors.Panel,
    border = BorderStroke(1.dp, AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(start = 8.dp, top = 6.dp, end = 4.dp, bottom = 6.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Icon(
        if (attachment.type == AttachmentType.Image) Icons.Filled.Image else Icons.AutoMirrored.Filled.InsertDriveFile,
        contentDescription = null,
        tint = AppColors.MutedText,
        modifier = Modifier.size(18.dp)
      )
      Column(
        modifier = Modifier
          .padding(start = 6.dp)
          .widthIn(max = 180.dp)
      ) {
        Text(
          attachment.name,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          style = MaterialTheme.typography.bodySmall
        )
        Text(
          "${attachment.sizeBytes / 1024} KB",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.labelSmall
        )
      }
      IconButton(onClick = { onRemoveAttachment(attachment.id) }, modifier = Modifier.size(30.dp)) {
        Icon(Icons.Filled.Close, contentDescription = "移除附件", modifier = Modifier.size(16.dp))
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelPickerSheet(
  state: ChatUiState,
  onDismiss: () -> Unit,
  onSelect: (String) -> Unit,
  onSetDefault: (String?) -> Unit
) {
  ModalBottomSheet(onDismissRequest = onDismiss, containerColor = AppColors.Surface) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .navigationBarsPadding()
        .padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Text("选择模型", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
      Text("切换只影响后续发送，历史消息保持原模型记录。", color = AppColors.MutedText)
      state.models.forEach { model ->
        ModelPickerRow(
          model = model,
          selected = model.alias == state.selectedModelAlias,
          isDefault = model.alias == state.defaultModelAlias,
          onSelect = { onSelect(model.alias) },
          onSetDefault = {
            onSetDefault(if (model.alias == state.defaultModelAlias) null else model.alias)
          }
        )
      }
    }
  }
}

@Composable
private fun ModelPickerRow(
  model: VisibleModel,
  selected: Boolean,
  isDefault: Boolean,
  onSelect: () -> Unit,
  onSetDefault: () -> Unit
) {
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onSelect),
    shape = RoundedCornerShape(8.dp),
    color = if (selected) AppColors.PrimarySoft else AppColors.Surface,
    border = BorderStroke(1.dp, if (selected) Color(0xFFD5E2FF) else AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(start = 12.dp, top = 10.dp, end = 6.dp, bottom = 10.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(
          model.displayName.ifBlank { model.alias },
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        Text(
          "${model.alias} · ${model.protocols.joinToString("/")}",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodySmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
      if (selected) {
        Icon(Icons.Filled.Check, contentDescription = "当前模型", tint = AppColors.Primary)
      }
      IconButton(onClick = onSetDefault) {
        Icon(
          if (isDefault) Icons.Filled.Star else Icons.Filled.StarBorder,
          contentDescription = if (isDefault) "取消默认模型" else "设为默认模型",
          tint = if (isDefault) AppColors.Primary else AppColors.MutedText
        )
      }
    }
  }
}

@Composable
fun DeleteConversationDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("删除当前对话？") },
    text = { Text("本机历史会被删除，此操作不会影响账号或服务端模型配置。") },
    confirmButton = {
      TextButton(onClick = onConfirm) {
        Text("删除", color = AppColors.Danger)
      }
    },
    dismissButton = {
      TextButton(onClick = onDismiss) {
        Text("取消")
      }
    }
  )
}

@Composable
fun RenameConversationDialog(
  initialTitle: String,
  onDismiss: () -> Unit,
  onConfirm: (String) -> Unit
) {
  var title by remember(initialTitle) { mutableStateOf(initialTitle) }
  val normalized = title.trim()
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("重命名对话") },
    text = {
      OutlinedTextField(
        value = title,
        onValueChange = { title = it.take(80) },
        label = { Text("对话标题") },
        singleLine = true,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
      )
    },
    confirmButton = {
      TextButton(
        onClick = { onConfirm(normalized) },
        enabled = normalized.isNotBlank()
      ) {
        Text("保存")
      }
    },
    dismissButton = {
      TextButton(onClick = onDismiss) {
        Text("取消")
      }
    }
  )
}

@Composable
fun FeedbackBanner(state: ChatUiState, modifier: Modifier = Modifier) {
  state.error?.let {
    StatusBanner(it, isError = true, modifier = modifier)
    return
  }
  state.notice?.let {
    StatusBanner(it, isError = false, modifier = modifier)
  }
}

@Composable
fun StatusBanner(text: String, isError: Boolean, modifier: Modifier = Modifier) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(8.dp),
    color = if (isError) Color(0xFFFFF1F2) else AppColors.PrimarySoft,
    border = BorderStroke(1.dp, if (isError) Color(0xFFFECACA) else Color(0xFFD5E2FF))
  ) {
    Text(
      text,
      color = if (isError) AppColors.Danger else AppColors.Primary,
      style = MaterialTheme.typography.bodySmall,
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)
    )
  }
}

private fun selectedConversationTitle(state: ChatUiState): String =
  state.conversations.firstOrNull { it.id == state.selectedConversationId }?.title ?: "新对话"

private fun selectedModelLabel(state: ChatUiState): String {
  val alias = state.selectedModelAlias ?: return "选择模型"
  val model = state.models.firstOrNull { it.alias == alias }
  return model?.displayName?.ifBlank { model.alias } ?: alias
}

private fun messageRequestLabel(message: ChatMessage): String =
  when (message.protocol) {
    GatewayProtocol.OpenAi -> "openai/${message.requestType?.wireName ?: OpenAiRequestType.Chat.wireName}"
    GatewayProtocol.Anthropic -> "anthropic/messages"
    null -> "-"
  }
