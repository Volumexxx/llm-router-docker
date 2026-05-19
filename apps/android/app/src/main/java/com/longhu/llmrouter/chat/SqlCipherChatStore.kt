package com.longhu.llmrouter.chat

import android.content.Context
import android.database.Cursor
import net.zetetic.database.sqlcipher.SQLiteDatabase
import java.security.SecureRandom
import java.util.UUID

class SqlCipherChatStore(
  private val context: Context,
  private val securePrefs: SecurePrefs
) {
  private val passphrase: String by lazy { getOrCreatePassphrase() }
  private val db: SQLiteDatabase by lazy {
    System.loadLibrary("sqlcipher")
    val file = context.getDatabasePath("chat-history.db")
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, passphrase, null, null)
      .also { createSchema(it) }
  }

  fun listConversations(): List<Conversation> = synchronized(this) {
    val cursor = db.rawQuery(
      """
        SELECT id, title, created_at, updated_at, model_alias
        FROM conversations
        ORDER BY updated_at DESC
      """.trimIndent(),
      emptyArray<String>()
    )
    val items = mutableListOf<Conversation>()
    cursor.use {
      while (it.moveToNext()) {
        items += Conversation(
          id = it.getString(0),
          title = it.getString(1),
          createdAt = it.getLong(2),
          updatedAt = it.getLong(3),
          modelAlias = it.getNullableString(4)
        )
      }
    }
    items
  }

  fun upsertConversation(conversation: Conversation) = synchronized(this) {
    db.execSQL(
      """
        INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, model_alias)
        VALUES (?, ?, ?, ?, ?)
      """.trimIndent(),
      arrayOf<Any?>(
        conversation.id,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt,
        conversation.modelAlias
      )
    )
  }

  fun createConversation(title: String, modelAlias: String?): Conversation {
    val now = System.currentTimeMillis()
    val conversation = Conversation(
      id = UUID.randomUUID().toString(),
      title = title.ifBlank { "新对话" },
      createdAt = now,
      updatedAt = now,
      modelAlias = modelAlias
    )
    upsertConversation(conversation)
    return conversation
  }

  fun renameConversation(conversationId: String, title: String) = synchronized(this) {
    db.execSQL(
      "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
      arrayOf<Any?>(title, System.currentTimeMillis(), conversationId)
    )
  }

  fun deleteConversation(conversationId: String) = synchronized(this) {
    db.execSQL("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)", arrayOf<Any?>(conversationId))
    db.execSQL("DELETE FROM messages WHERE conversation_id = ?", arrayOf<Any?>(conversationId))
    db.execSQL("DELETE FROM conversations WHERE id = ?", arrayOf<Any?>(conversationId))
  }

  fun listMessages(conversationId: String): List<ChatMessage> = synchronized(this) {
    val messages = mutableListOf<ChatMessage>()
    val cursor = db.rawQuery(
      """
        SELECT id, conversation_id, role, content, model_alias, protocol, request_type, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      """.trimIndent(),
      arrayOf(conversationId)
    )
    cursor.use {
      while (it.moveToNext()) {
        val messageId = it.getString(0)
        messages += ChatMessage(
          id = messageId,
          conversationId = it.getString(1),
          role = MessageRole.fromWire(it.getString(2)),
          content = it.getString(3),
          modelAlias = it.getNullableString(4),
          protocol = it.getNullableString(5)?.let(GatewayProtocol.Companion::fromWire),
          requestType = it.getNullableString(6)?.let(OpenAiRequestType.Companion::fromWire),
          createdAt = it.getLong(7),
          attachments = listAttachments(messageId)
        )
      }
    }
    messages
  }

  fun addMessage(message: ChatMessage) = synchronized(this) {
    db.execSQL(
      """
        INSERT INTO messages (id, conversation_id, role, content, model_alias, protocol, request_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      """.trimIndent(),
      arrayOf<Any?>(
        message.id,
        message.conversationId,
        message.role.wireName,
        message.content,
        message.modelAlias,
        message.protocol?.wireName,
        message.requestType?.wireName,
        message.createdAt
      )
    )
    message.attachments.forEach { attachment -> addAttachment(attachment) }
    db.execSQL(
      "UPDATE conversations SET updated_at = ?, model_alias = COALESCE(?, model_alias) WHERE id = ?",
      arrayOf<Any?>(message.createdAt, message.modelAlias, message.conversationId)
    )
  }

  private fun addAttachment(attachment: StoredAttachment) {
    db.execSQL(
      """
        INSERT INTO attachments (
          id, message_id, type, name, mime_type, encrypted_path, preview_text, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      """.trimIndent(),
      arrayOf<Any?>(
        attachment.id,
        attachment.messageId,
        attachment.type.wireName,
        attachment.name,
        attachment.mimeType,
        attachment.encryptedPath,
        attachment.previewText,
        attachment.createdAt
      )
    )
  }

  private fun listAttachments(messageId: String): List<StoredAttachment> {
    val cursor = db.rawQuery(
      """
        SELECT id, message_id, type, name, mime_type, encrypted_path, preview_text, created_at
        FROM attachments
        WHERE message_id = ?
        ORDER BY created_at ASC
      """.trimIndent(),
      arrayOf(messageId)
    )
    val items = mutableListOf<StoredAttachment>()
    cursor.use {
      while (it.moveToNext()) {
        items += StoredAttachment(
          id = it.getString(0),
          messageId = it.getString(1),
          type = AttachmentType.fromWire(it.getString(2)),
          name = it.getString(3),
          mimeType = it.getString(4),
          encryptedPath = it.getString(5),
          previewText = it.getNullableString(6),
          createdAt = it.getLong(7)
        )
      }
    }
    return items
  }

  private fun createSchema(database: SQLiteDatabase) {
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          model_alias TEXT
        )
      """.trimIndent()
    )
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          model_alias TEXT,
          protocol TEXT,
          request_type TEXT,
          created_at INTEGER NOT NULL
        )
      """.trimIndent()
    )
    ensureColumn(database, "messages", "request_type", "TEXT")
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          encrypted_path TEXT NOT NULL,
          preview_text TEXT,
          created_at INTEGER NOT NULL
        )
      """.trimIndent()
    )
    database.execSQL("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)")
    database.execSQL("CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id, created_at)")
  }

  private fun ensureColumn(database: SQLiteDatabase, table: String, column: String, declaration: String) {
    val cursor = database.rawQuery("PRAGMA table_info($table)", emptyArray<String>())
    val exists = cursor.use {
      var found = false
      while (it.moveToNext()) {
        if (it.getString(1) == column) {
          found = true
          break
        }
      }
      found
    }
    if (!exists) {
      database.execSQL("ALTER TABLE $table ADD COLUMN $column $declaration")
    }
  }

  private fun getOrCreatePassphrase(): String {
    val existing = securePrefs.getString(SecurePrefs.Keys.DbPassphrase)
    if (existing != null) {
      return existing
    }
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val passphrase = bytes.joinToString("") { "%02x".format(it) }
    securePrefs.putString(SecurePrefs.Keys.DbPassphrase, passphrase)
    return passphrase
  }

  private fun Cursor.getNullableString(index: Int): String? =
    if (isNull(index)) null else getString(index)
}
