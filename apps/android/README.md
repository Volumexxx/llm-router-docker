# LLM Router Chat Android

Native Android chat client for the existing `llm-router-docker` account and gateway APIs.

## Scope

- Login with an existing LLM Router account.
- Restore session with the router admin cookie.
- Load the current account's available models from `/admin/api/me/models`.
- Automatically prepare the current user's gateway API key through `/admin/api/me/api-keys`.
- Send non-streaming chat requests through `/v1/chat/completions` for OpenAI-capable models and `/v1/messages` for Anthropic-only models.
- Store the default model, gateway key, session cookies, chat history, and attachment metadata locally with encryption.
- Support image attachments and UTF-8 text attachments for the current message.

Provider management, routing management, user approval, and release signing are intentionally not part of this first Android client.

## Build

Requirements:

- JDK 17.
- Android SDK with API 36 installed.

From this directory:

```powershell
.\gradlew.bat assembleDebug
.\gradlew.bat testDebugUnitTest
```

The debug APK is written under `app/build/outputs/apk/debug/`.

## Runtime Notes

- The service URL must expose `/admin/api/auth/*`, `/admin/api/me/*`, and `/v1/*` to the Android device.
- HTTPS is recommended. HTTP is allowed for trusted LAN deployments and is called out in the login UI.
- If the administrator changes the user's model scope, the app refreshes the model list and clears a now-invalid default model.
- If the cached gateway key is disabled or removed, the app refreshes the user's API keys and prepares another usable key when possible.
