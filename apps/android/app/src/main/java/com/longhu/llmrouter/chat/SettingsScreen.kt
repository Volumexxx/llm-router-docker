package com.longhu.llmrouter.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
  state: ChatUiState,
  vm: ChatViewModel,
  onBack: () -> Unit
) {
  val openAiModels = state.models.filter { it.supportsOpenAi }
  var selectedAlias by remember(state.user?.id) {
    mutableStateOf(defaultOpenAiSettingsModelAlias(state.models, state.defaultModelAlias))
  }
  var showModelSheet by remember { mutableStateOf(false) }

  LaunchedEffect(state.models, state.defaultModelAlias) {
    selectedAlias = selectedAlias
      ?.takeIf { alias -> openAiModels.any { it.alias == alias } }
      ?: defaultOpenAiSettingsModelAlias(state.models, state.defaultModelAlias)
  }

  val selectedModel = openAiModels.firstOrNull { it.alias == selectedAlias }

  Scaffold(
    containerColor = AppColors.Background,
    topBar = {
      SettingsTopBar(onBack)
    }
  ) { padding ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(padding)
        .background(AppColors.Background)
    ) {
      Column(
        modifier = Modifier
          .align(Alignment.TopCenter)
          .fillMaxWidth()
          .widthIn(max = 720.dp)
          .verticalScroll(rememberScrollState())
          .navigationBarsPadding()
          .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
      ) {
        FeedbackBanner(state)
        SettingsSectionTitle("模型设置")
        DefaultModelSummary(state)

        if (openAiModels.isEmpty()) {
          EmptySettingsCard("当前账号没有可配置的 OpenAI 模型。Anthropic-only 模型会继续使用 messages 请求。")
        } else {
          SelectedModelPickerCard(
            model = selectedModel,
            onClick = { showModelSheet = true }
          )
          selectedModel?.let { model ->
            ModelRuntimeSettingsCard(
              model = model,
              settings = state.modelSettings[model.alias] ?: ModelRuntimeSettings(model.alias),
              isDefault = model.alias == state.defaultModelAlias,
              onSetDefault = {
                vm.setDefaultModel(if (model.alias == state.defaultModelAlias) null else model.alias)
              },
              onRequestTypeChange = { vm.setModelRequestType(model.alias, it) },
              onContextTokensChange = { vm.updateContextMaxTokens(model.alias, it) },
              onMaxOutputTokensChange = { vm.updateMaxOutputTokens(model.alias, it) }
            )
          }
        }
        Spacer(modifier = Modifier.height(12.dp))
      }
    }
  }

  if (showModelSheet) {
    SettingsModelPickerSheet(
      models = openAiModels,
      selectedAlias = selectedAlias,
      onDismiss = { showModelSheet = false },
      onSelect = { alias ->
        selectedAlias = alias
        showModelSheet = false
      }
    )
  }
}

@Composable
private fun SettingsTopBar(onBack: () -> Unit) {
  Surface(color = AppColors.Surface) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .statusBarsPadding()
        .height(58.dp)
        .padding(horizontal = 8.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      IconButton(onClick = onBack) {
        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
      }
      Icon(Icons.Filled.Settings, contentDescription = null, tint = AppColors.Primary)
      Text(
        "设置",
        modifier = Modifier.padding(start = 8.dp),
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.SemiBold
      )
    }
  }
}

@Composable
private fun SettingsSectionTitle(text: String) {
  Text(
    text,
    color = AppColors.Text,
    style = MaterialTheme.typography.titleMedium,
    fontWeight = FontWeight.SemiBold
  )
}

@Composable
private fun DefaultModelSummary(state: ChatUiState) {
  val defaultAlias = state.defaultModelAlias
  val defaultModel = state.models.firstOrNull { it.alias == defaultAlias }
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = AppColors.Surface,
    border = BorderStroke(1.dp, AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(12.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Icon(
        if (defaultAlias == null) Icons.Filled.StarBorder else Icons.Filled.Star,
        contentDescription = null,
        tint = if (defaultAlias == null) AppColors.MutedText else AppColors.Primary
      )
      Column(
        modifier = Modifier
          .weight(1f)
          .padding(start = 10.dp)
      ) {
        Text(
          "当前默认模型",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodySmall
        )
        Text(
          defaultModel?.displayName?.ifBlank { defaultModel.alias }
            ?: defaultAlias
            ?: "未设置",
          color = AppColors.Text,
          style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      }
    }
  }
}

@Composable
private fun SelectedModelPickerCard(
  model: VisibleModel?,
  onClick: () -> Unit
) {
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onClick),
    shape = RoundedCornerShape(8.dp),
    color = AppColors.Surface,
    border = BorderStroke(1.dp, AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(12.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(
          "正在编辑",
          color = AppColors.MutedText,
          style = MaterialTheme.typography.bodySmall
        )
        Text(
          model?.displayName?.ifBlank { model.alias } ?: "选择 OpenAI 模型",
          color = AppColors.Text,
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
        model?.let {
          Text(
            "${it.alias} · ${it.protocols.joinToString("/")}",
            color = AppColors.MutedText,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      }
      Icon(Icons.Filled.ExpandMore, contentDescription = "选择模型", tint = AppColors.Primary)
    }
  }
}

@Composable
private fun ModelRuntimeSettingsCard(
  model: VisibleModel,
  settings: ModelRuntimeSettings,
  isDefault: Boolean,
  onSetDefault: () -> Unit,
  onRequestTypeChange: (OpenAiRequestType) -> Unit,
  onContextTokensChange: (String) -> Unit,
  onMaxOutputTokensChange: (String) -> Unit
) {
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = AppColors.Surface,
    border = BorderStroke(1.dp, AppColors.Border)
  ) {
    Column(
      modifier = Modifier.padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
          Text(
            model.displayName.ifBlank { model.alias },
            style = MaterialTheme.typography.titleMedium,
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
        IconButton(onClick = onSetDefault) {
          Icon(
            if (isDefault) Icons.Filled.Star else Icons.Filled.StarBorder,
            contentDescription = if (isDefault) "取消默认模型" else "设为默认模型",
            tint = if (isDefault) AppColors.Primary else AppColors.MutedText
          )
        }
      }

      RequestTypeSelector(
        selected = settings.requestType,
        onChange = onRequestTypeChange
      )

      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
          value = settings.contextMaxTokens?.toString().orEmpty(),
          onValueChange = onContextTokensChange,
          label = { Text("上下文最大 token") },
          placeholder = { Text("不限制") },
          singleLine = true,
          shape = RoundedCornerShape(8.dp),
          modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
          value = settings.maxOutputTokens.toString(),
          onValueChange = onMaxOutputTokensChange,
          label = { Text("最大输出 token") },
          singleLine = true,
          shape = RoundedCornerShape(8.dp),
          modifier = Modifier.fillMaxWidth()
        )
      }
    }
  }
}

@Composable
private fun RequestTypeSelector(
  selected: OpenAiRequestType,
  onChange: (OpenAiRequestType) -> Unit
) {
  Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    RequestTypeButton(
      label = "chat",
      selected = selected == OpenAiRequestType.Chat,
      onClick = { onChange(OpenAiRequestType.Chat) },
      modifier = Modifier.weight(1f)
    )
    RequestTypeButton(
      label = "response",
      selected = selected == OpenAiRequestType.Response,
      onClick = { onChange(OpenAiRequestType.Response) },
      modifier = Modifier.weight(1f)
    )
  }
}

@Composable
private fun RequestTypeButton(
  label: String,
  selected: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier
) {
  OutlinedButton(
    onClick = onClick,
    shape = RoundedCornerShape(8.dp),
    border = BorderStroke(1.dp, if (selected) AppColors.Primary else AppColors.Border),
    colors = ButtonDefaults.outlinedButtonColors(
      containerColor = if (selected) AppColors.PrimarySoft else AppColors.Surface,
      contentColor = if (selected) AppColors.Primary else AppColors.Text
    ),
    modifier = modifier.height(40.dp)
  ) {
    Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsModelPickerSheet(
  models: List<VisibleModel>,
  selectedAlias: String?,
  onDismiss: () -> Unit,
  onSelect: (String) -> Unit
) {
  ModalBottomSheet(onDismissRequest = onDismiss, containerColor = AppColors.Surface) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .navigationBarsPadding()
        .padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Text("选择要配置的模型", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
      models.forEach { model ->
        SettingsModelPickerRow(
          model = model,
          selected = model.alias == selectedAlias,
          onClick = { onSelect(model.alias) }
        )
      }
    }
  }
}

@Composable
private fun SettingsModelPickerRow(
  model: VisibleModel,
  selected: Boolean,
  onClick: () -> Unit
) {
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = onClick),
    shape = RoundedCornerShape(8.dp),
    color = if (selected) AppColors.PrimarySoft else AppColors.Surface,
    border = BorderStroke(1.dp, if (selected) Color(0xFFD5E2FF) else AppColors.Border)
  ) {
    Row(
      modifier = Modifier.padding(start = 12.dp, top = 10.dp, end = 10.dp, bottom = 10.dp),
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
        Icon(Icons.Filled.Check, contentDescription = "当前配置模型", tint = AppColors.Primary)
      }
    }
  }
}

@Composable
private fun EmptySettingsCard(text: String) {
  Surface(
    shape = RoundedCornerShape(8.dp),
    color = AppColors.Surface,
    border = BorderStroke(1.dp, AppColors.Border)
  ) {
    Text(
      text,
      color = AppColors.MutedText,
      style = MaterialTheme.typography.bodyMedium,
      modifier = Modifier.padding(12.dp)
    )
  }
}
