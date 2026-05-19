package com.longhu.llmrouter.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(state: ChatUiState, vm: ChatViewModel, onOpenSettings: () -> Unit) {
  val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) {
    vm.addAttachments(it)
  }
  val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) {
    vm.addAttachments(it)
  }
  var showModelSheet by remember { mutableStateOf(false) }
  var showDeleteDialog by remember { mutableStateOf(false) }
  var renameConversationId by remember { mutableStateOf<String?>(null) }
  val pickImages = { imagePicker.launch("image/*") }
  val pickFiles = { filePicker.launch(arrayOf("text/*", "application/json", "application/xml")) }

  BoxWithConstraints(
    modifier = Modifier
      .fillMaxSize()
      .background(AppColors.Background)
  ) {
    if (maxWidth < 600.dp) {
      PhoneChatLayout(
        state = state,
        vm = vm,
        onShowModels = { showModelSheet = true },
        onRequestRename = { renameConversationId = it },
        onRequestDelete = { showDeleteDialog = true },
        onOpenSettings = onOpenSettings,
        onPickImages = pickImages,
        onPickFiles = pickFiles
      )
    } else {
      WideChatLayout(
        state = state,
        vm = vm,
        onShowModels = { showModelSheet = true },
        onRequestRename = { renameConversationId = it },
        onRequestDelete = { showDeleteDialog = true },
        onOpenSettings = onOpenSettings,
        onPickImages = pickImages,
        onPickFiles = pickFiles
      )
    }
  }

  if (showModelSheet) {
    ModelPickerSheet(
      state = state,
      onDismiss = { showModelSheet = false },
      onSelect = { alias ->
        vm.selectChatModel(alias)
        showModelSheet = false
      },
      onSetDefault = vm::setDefaultModel
    )
  }

  if (showDeleteDialog) {
    DeleteConversationDialog(
      onDismiss = { showDeleteDialog = false },
      onConfirm = {
        showDeleteDialog = false
        vm.deleteCurrentConversation()
      }
    )
  }

  val renameConversation = state.conversations.firstOrNull { it.id == renameConversationId }
  if (renameConversation != null) {
    RenameConversationDialog(
      initialTitle = renameConversation.title,
      onDismiss = { renameConversationId = null },
      onConfirm = { title ->
        renameConversationId = null
        vm.renameConversation(renameConversation.id, title)
      }
    )
  }
}

@Composable
private fun PhoneChatLayout(
  state: ChatUiState,
  vm: ChatViewModel,
  onShowModels: () -> Unit,
  onRequestRename: (String) -> Unit,
  onRequestDelete: () -> Unit,
  onOpenSettings: () -> Unit,
  onPickImages: () -> Unit,
  onPickFiles: () -> Unit
) {
  val drawerState = rememberDrawerState(DrawerValue.Closed)
  val scope = rememberCoroutineScope()
  ModalNavigationDrawer(
    drawerState = drawerState,
    drawerContent = {
      ModalDrawerSheet(
        modifier = Modifier
          .width(316.dp)
          .fillMaxHeight(),
        drawerContainerColor = AppColors.Surface
      ) {
        ConversationPanel(
          state = state,
          onSelect = { conversationId ->
            vm.selectConversation(conversationId)
            scope.launch { drawerState.close() }
          },
          onNew = {
            vm.newConversation()
            scope.launch { drawerState.close() }
          },
          onRequestRename = onRequestRename,
          onRequestDelete = { conversationId ->
            if (conversationId != state.selectedConversationId) {
              vm.selectConversation(conversationId)
            }
            onRequestDelete()
          },
          onRefreshModels = vm::refreshModels,
          onOpenSettings = onOpenSettings,
          onLogout = vm::logout,
          modifier = Modifier.fillMaxSize()
        )
      }
    }
  ) {
    ChatScaffold(
      state = state,
      vm = vm,
      showMenuButton = true,
      onMenuClick = { scope.launch { drawerState.open() } },
      onShowModels = onShowModels,
      onNewConversation = vm::newConversation,
      onRequestRename = { state.selectedConversationId?.let(onRequestRename) },
      onRequestDelete = onRequestDelete,
      onOpenSettings = onOpenSettings,
      onPickImages = onPickImages,
      onPickFiles = onPickFiles
    )
  }
}

@Composable
private fun WideChatLayout(
  state: ChatUiState,
  vm: ChatViewModel,
  onShowModels: () -> Unit,
  onRequestRename: (String) -> Unit,
  onRequestDelete: () -> Unit,
  onOpenSettings: () -> Unit,
  onPickImages: () -> Unit,
  onPickFiles: () -> Unit
) {
  Row(modifier = Modifier.fillMaxSize()) {
    ConversationPanel(
      state = state,
      onSelect = vm::selectConversation,
      onNew = vm::newConversation,
      onRequestRename = onRequestRename,
      onRequestDelete = { conversationId ->
        if (conversationId != state.selectedConversationId) {
          vm.selectConversation(conversationId)
        }
        onRequestDelete()
      },
      onRefreshModels = vm::refreshModels,
      onOpenSettings = onOpenSettings,
      onLogout = vm::logout,
      modifier = Modifier
        .width(288.dp)
        .fillMaxHeight()
    )
    VerticalDivider(color = AppColors.Border)
    ChatScaffold(
      state = state,
      vm = vm,
      showMenuButton = false,
      onMenuClick = {},
      onShowModels = onShowModels,
      onNewConversation = vm::newConversation,
      onRequestRename = { state.selectedConversationId?.let(onRequestRename) },
      onRequestDelete = onRequestDelete,
      onOpenSettings = onOpenSettings,
      onPickImages = onPickImages,
      onPickFiles = onPickFiles,
      modifier = Modifier.weight(1f)
    )
  }
}

@Composable
private fun ChatScaffold(
  state: ChatUiState,
  vm: ChatViewModel,
  showMenuButton: Boolean,
  onMenuClick: () -> Unit,
  onShowModels: () -> Unit,
  onNewConversation: () -> Unit,
  onRequestRename: () -> Unit,
  onRequestDelete: () -> Unit,
  onOpenSettings: () -> Unit,
  onPickImages: () -> Unit,
  onPickFiles: () -> Unit,
  modifier: Modifier = Modifier
) {
  Scaffold(
    modifier = modifier.fillMaxSize(),
    containerColor = AppColors.Background,
    topBar = {
      ChatTopBar(
        state = state,
        showMenuButton = showMenuButton,
        onMenuClick = onMenuClick,
        onShowModels = onShowModels,
        onNewConversation = onNewConversation,
        onRequestRename = onRequestRename,
        onRequestDelete = onRequestDelete,
        onRefreshModels = vm::refreshModels,
        onOpenSettings = onOpenSettings,
        onLogout = vm::logout
      )
      HorizontalDivider(color = AppColors.Border)
    },
    bottomBar = {
      ChatInputBar(
        state = state,
        onInputChange = vm::updateInput,
        onSend = vm::sendMessage,
        onPickImages = onPickImages,
        onPickFiles = onPickFiles,
        onPasteClipboard = vm::addClipboardAttachment,
        onRemoveAttachment = vm::removeAttachment
      )
    }
  ) { padding ->
    Column(
      modifier = Modifier
        .fillMaxSize()
        .padding(padding)
    ) {
      FeedbackBanner(state, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
      MessageList(
        state = state,
        onLoadAttachmentBytes = vm::loadAttachmentBytes,
        modifier = Modifier.weight(1f)
      )
    }
  }
}
