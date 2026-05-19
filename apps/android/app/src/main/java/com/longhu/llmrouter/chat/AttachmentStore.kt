package com.longhu.llmrouter.chat

import android.content.ClipData
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.util.UUID
import kotlin.math.max

class AttachmentStore(
  private val context: Context,
  private val cryptoManager: CryptoManager
) {
  private val attachmentDir = File(context.filesDir, "encrypted_attachments").apply { mkdirs() }

  fun createFromUri(uri: Uri): PendingAttachment {
    val mimeType = context.contentResolver.getType(uri).orEmpty()
    return if (mimeType.startsWith("image/")) {
      createImage(uri, mimeType.ifBlank { "image/jpeg" })
    } else {
      createText(uri, mimeType.ifBlank { "text/plain" })
    }
  }

  fun createFromClipData(clipData: ClipData?): PendingAttachment? {
    val item = clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return null
    val uri = item.uri ?: return null
    return createFromUri(uri)
  }

  fun persist(messageId: String, pending: PendingAttachment): StoredAttachment {
    val id = pending.id
    val encrypted = cryptoManager.encryptBytes(pending.bytes)
    val file = File(attachmentDir, "$id.bin")
    file.writeText(encrypted, Charsets.UTF_8)
    return StoredAttachment(
      id = id,
      messageId = messageId,
      type = pending.type,
      name = pending.name,
      mimeType = pending.mimeType,
      encryptedPath = file.absolutePath,
      previewText = pending.previewText,
      createdAt = pending.createdAt
    )
  }

  fun createGeneratedImage(image: GeneratedImage): PendingAttachment {
    val encoded = Base64.encodeToString(image.bytes, Base64.NO_WRAP)
    return PendingAttachment(
      id = UUID.randomUUID().toString(),
      type = AttachmentType.Image,
      name = image.name.ifBlank { "generated-image.${image.mimeType.imageExtension()}" },
      mimeType = image.mimeType.ifBlank { "image/png" },
      bytes = image.bytes,
      previewText = null,
      dataUrl = "data:${image.mimeType.ifBlank { "image/png" }};base64,$encoded"
    )
  }

  fun readBytes(attachment: StoredAttachment): ByteArray =
    cryptoManager.decryptBytes(File(attachment.encryptedPath).readText(Charsets.UTF_8))

  private fun createImage(uri: Uri, mimeType: String): PendingAttachment {
    val bitmap = decodeBitmap(uri)
    val scaled = scaleBitmap(bitmap, 1600)
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 82, out)
    val bytes = out.toByteArray()
    val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
    return PendingAttachment(
      id = UUID.randomUUID().toString(),
      type = AttachmentType.Image,
      name = displayName(uri) ?: "image.jpg",
      mimeType = "image/jpeg",
      bytes = bytes,
      previewText = null,
      dataUrl = "data:image/jpeg;base64,$encoded"
    )
  }

  private fun createText(uri: Uri, mimeType: String): PendingAttachment {
    val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
      stream.readAtMost(256 * 1024 + 1)
    } ?: ByteArray(0)

    require(bytes.size <= 256 * 1024) { "文本附件不能超过 256 KB。" }

    val text = bytes.toString(Charsets.UTF_8)
    return PendingAttachment(
      id = UUID.randomUUID().toString(),
      type = AttachmentType.Text,
      name = displayName(uri) ?: "attachment.txt",
      mimeType = mimeType,
      bytes = bytes,
      previewText = "\n\n[文本附件：${displayName(uri) ?: "attachment"}]\n$text",
      dataUrl = null
    )
  }

  private fun decodeBitmap(uri: Uri): Bitmap =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val source = ImageDecoder.createSource(context.contentResolver, uri)
      ImageDecoder.decodeBitmap(source)
    } else {
      context.contentResolver.openInputStream(uri).use { stream ->
        requireNotNull(BitmapFactory.decodeStream(stream)) { "无法读取图片。" }
      }
    }

  private fun scaleBitmap(bitmap: Bitmap, maxDimension: Int): Bitmap {
    val largest = max(bitmap.width, bitmap.height)
    if (largest <= maxDimension) {
      return bitmap
    }
    val scale = maxDimension.toFloat() / largest.toFloat()
    val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
    val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun displayName(uri: Uri): String? {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor ->
        if (cursor.moveToFirst()) {
          val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (index >= 0) {
            return cursor.getString(index)
          }
        }
      }
    return uri.lastPathSegment
  }

  private fun InputStream.readAtMost(limit: Int): ByteArray {
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(8 * 1024)
    var total = 0
    while (true) {
      val read = read(chunk)
      if (read <= 0) {
        break
      }
      total += read
      if (total > limit) {
        buffer.write(chunk, 0, read)
        break
      }
      buffer.write(chunk, 0, read)
    }
    return buffer.toByteArray()
  }

  private fun String.imageExtension(): String =
    when (lowercase()) {
      "image/jpeg", "image/jpg" -> "jpg"
      "image/webp" -> "webp"
      else -> "png"
    }
}
