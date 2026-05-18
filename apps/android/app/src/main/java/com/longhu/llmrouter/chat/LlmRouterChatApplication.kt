package com.longhu.llmrouter.chat

import android.app.Application

class LlmRouterChatApplication : Application() {
  val container: AppContainer by lazy { AppContainer(this) }
}

class AppContainer(application: Application) {
  private val cryptoManager = CryptoManager()
  val securePrefs = SecurePrefs(application, cryptoManager)
  val cookieJar = RouterCookieJar(securePrefs)
  val api = RouterApi(cookieJar)
  val attachmentStore = AttachmentStore(application, cryptoManager)
  val chatStore = SqlCipherChatStore(application, securePrefs)
  val repository = ChatRepository(api, securePrefs, chatStore)
}
