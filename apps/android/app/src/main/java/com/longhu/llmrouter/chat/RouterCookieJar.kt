package com.longhu.llmrouter.chat

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

class RouterCookieJar(private val securePrefs: SecurePrefs) : CookieJar {
  private val json = Json { ignoreUnknownKeys = true }
  private var cookies: MutableList<Cookie> = loadCookies().toMutableList()

  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    val current = this.cookies
      .filterNot { stored -> cookies.any { it.name == stored.name && it.domain == stored.domain && it.path == stored.path } }
      .toMutableList()
    current += cookies
    this.cookies = current
    persist()
  }

  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val now = System.currentTimeMillis()
    val valid = cookies.filter { it.expiresAt > now }
    if (valid.size != cookies.size) {
      cookies = valid.toMutableList()
      persist()
    }
    return valid.filter { it.matches(url) }
  }

  fun clear() {
    cookies.clear()
    securePrefs.remove(SecurePrefs.Keys.CookieJar)
  }

  private fun loadCookies(): List<Cookie> {
    val encoded = securePrefs.getString(SecurePrefs.Keys.CookieJar) ?: return emptyList()
    val base = securePrefs.getString(SecurePrefs.Keys.BaseUrl)?.toHttpUrl() ?: return emptyList()
    return runCatching {
      json.decodeFromString<List<String>>(encoded).mapNotNull { Cookie.parse(base, it) }
    }.getOrDefault(emptyList())
  }

  private fun persist() {
    securePrefs.putString(
      SecurePrefs.Keys.CookieJar,
      json.encodeToString(cookies.map { it.toString() })
    )
  }
}
