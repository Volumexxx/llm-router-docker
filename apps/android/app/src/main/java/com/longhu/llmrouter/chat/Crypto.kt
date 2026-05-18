package com.longhu.llmrouter.chat

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class CryptoManager {
  private val keyAlias = "llm_router_chat_master_key"
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun getOrCreateKey(): SecretKey {
    val existing = keyStore.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry
    if (existing != null) {
      return existing.secretKey
    }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      keyAlias,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()
    generator.init(spec)
    return generator.generateKey()
  }

  fun encryptBytes(plain: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(plain)
    val payload = ByteArray(cipher.iv.size + encrypted.size)
    System.arraycopy(cipher.iv, 0, payload, 0, cipher.iv.size)
    System.arraycopy(encrypted, 0, payload, cipher.iv.size, encrypted.size)
    return Base64.encodeToString(payload, Base64.NO_WRAP)
  }

  fun decryptBytes(encoded: String): ByteArray {
    val payload = Base64.decode(encoded, Base64.NO_WRAP)
    val iv = payload.copyOfRange(0, 12)
    val encrypted = payload.copyOfRange(12, payload.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    return cipher.doFinal(encrypted)
  }

  fun encryptString(value: String): String = encryptBytes(value.toByteArray(Charsets.UTF_8))

  fun decryptString(value: String): String =
    decryptBytes(value).toString(Charsets.UTF_8)
}

class SecurePrefs(context: Context, private val cryptoManager: CryptoManager) {
  private val prefs: SharedPreferences =
    context.getSharedPreferences("llm_router_chat_secure", Context.MODE_PRIVATE)

  fun getString(key: String): String? {
    val encrypted = prefs.getString(key, null) ?: return null
    return runCatching { cryptoManager.decryptString(encrypted) }.getOrNull()
  }

  fun putString(key: String, value: String) {
    prefs.edit().putString(key, cryptoManager.encryptString(value)).apply()
  }

  fun remove(key: String) {
    prefs.edit().remove(key).apply()
  }

  fun clearSession() {
    prefs.edit()
      .remove(Keys.CookieJar)
      .remove(Keys.GatewayKeyPlaintext)
      .remove(Keys.GatewayKeyId)
      .apply()
  }

  object Keys {
    const val BaseUrl = "base_url"
    const val CookieJar = "cookie_jar"
    const val GatewayKeyId = "gateway_key_id"
    const val GatewayKeyPlaintext = "gateway_key_plaintext"
    const val DefaultModelAlias = "default_model_alias"
    const val DbPassphrase = "db_passphrase"
  }
}
