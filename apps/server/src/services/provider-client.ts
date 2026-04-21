import { Readable } from "node:stream";

import type { FastifyReply } from "fastify";

import type { TokenUsage } from "../../../../packages/shared/src/index.ts";
import { estimateCost } from "../../../../packages/shared/src/index.ts";
import type { RuntimeConfig } from "../config.ts";
import {
  extractUsage,
  getErrorSummary,
  joinUrl,
  parseJson,
  serializeSseBlock
} from "../lib/utils.ts";
import { buildGatewayErrorPayload } from "../lib/http.ts";
import { decryptSecret } from "../security/crypto.ts";
import type { RoutableBinding } from "./models.ts";

type GatewayProtocol = "openai" | "anthropic";
type ProviderProtocol = "openai" | "anthropic";
type GatewayEndpointType = "chat_completions" | "responses" | "messages";

interface GatewayRequestContext {
  gatewayProtocol: GatewayProtocol;
  endpointType: GatewayEndpointType;
  anthropicVersion?: string | null;
}

interface UpstreamRequestConfig {
  url: string;
  init: RequestInit;
  requestBodyText: string;
}

interface UpstreamError extends Error {
  statusCode?: number;
  errorCode?: string | null;
  bodyText?: string;
}

export interface ProviderTestResult {
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  visibleModelCount: number | null;
  message: string;
}

export interface ProxySuccessResult {
  ok: true;
  httpStatus: number;
  contentType: string | null;
  bodyText: string | null;
  isStream: boolean;
  usage: TokenUsage;
  estimatedCost: number | null;
}

export interface ProxyFailureResult {
  ok: false;
  httpStatus: number;
  bodyText: string;
  errorCode: string | null;
  errorSummary: string;
}

export type ProxyResult = ProxySuccessResult | ProxyFailureResult;

interface ProxyRequestInput {
  fetchImpl: typeof fetch;
  config: RuntimeConfig;
  binding: RoutableBinding;
  request: GatewayRequestContext;
  body: unknown;
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function makeUpstreamError(
  message: string,
  options?: {
    statusCode?: number;
    errorCode?: string | null;
    bodyText?: string;
  }
): UpstreamError {
  const error = new Error(message) as UpstreamError;
  error.statusCode = options?.statusCode;
  error.errorCode = options?.errorCode ?? null;
  error.bodyText = options?.bodyText;
  return error;
}

function readTextBody(response: Response): Promise<string> {
  return response.text();
}

function copyUpstreamHeaders(reply: FastifyReply, response: Response): void {
  const contentType = response.headers.get("content-type");
  const cacheControl = response.headers.get("cache-control");
  if (contentType) {
    reply.header("content-type", contentType);
  }
  if (cacheControl) {
    reply.header("cache-control", cacheControl);
  }
}

function buildProviderModelsUrl(provider: {
  baseUrl: string;
  protocol: ProviderProtocol;
}): string {
  return provider.protocol === "anthropic"
    ? joinUrl(provider.baseUrl, "/v1/models")
    : joinUrl(provider.baseUrl, "models");
}

function buildProviderEndpointUrl(
  binding: RoutableBinding,
  endpointType: GatewayEndpointType
): string | null {
  if (binding.providerProtocol === "anthropic") {
    if (endpointType === "messages") {
      return joinUrl(binding.providerBaseUrl, "/v1/messages");
    }

    if (endpointType === "chat_completions") {
      return joinUrl(binding.providerBaseUrl, "/v1/messages");
    }

    return null;
  }

  if (endpointType === "messages") {
    return joinUrl(binding.providerBaseUrl, "chat/completions");
  }

  if (endpointType === "responses") {
    return joinUrl(binding.providerBaseUrl, "responses");
  }

  return joinUrl(binding.providerBaseUrl, "chat/completions");
}

function buildUpstreamHeaders(
  config: RuntimeConfig,
  binding: RoutableBinding,
  anthropicVersion?: string | null
): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json");

  const apiKey = decryptSecret(binding.providerApiKeyEncrypted, config.configEncryptionKey);
  if (binding.providerProtocol === "anthropic") {
    headers.set("x-api-key", apiKey);
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("anthropic-version", binding.providerApiVersion ?? anthropicVersion ?? "2023-06-01");
    return headers;
  }

  headers.set("Authorization", `Bearer ${apiKey}`);
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeAnthropicSystem(system: unknown): string | Array<Record<string, unknown>> | undefined {
  if (typeof system === "string" && system.trim()) {
    return system;
  }

  if (Array.isArray(system)) {
    return system.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  }

  return undefined;
}

function openAiContentPartToAnthropicBlock(part: unknown): Record<string, unknown> {
  if (typeof part === "string") {
    return {
      type: "text",
      text: part
    };
  }

  const record = asRecord(part);
  if (!record) {
    throw makeUpstreamError("Unsupported OpenAI content block", {
      statusCode: 400,
      errorCode: "unsupported_openai_content"
    });
  }

  if (record.type === "text" && typeof record.text === "string") {
    return {
      type: "text",
      text: record.text
    };
  }

  if (record.type === "image_url") {
    const imageUrl = asRecord(record.image_url);
    if (!imageUrl || typeof imageUrl.url !== "string" || !imageUrl.url.startsWith("data:")) {
      throw makeUpstreamError("Only data URL images are supported for Anthropic adapters", {
        statusCode: 400,
        errorCode: "unsupported_openai_content"
      });
    }

    const match = imageUrl.url.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      throw makeUpstreamError("Only base64 data URL images are supported for Anthropic adapters", {
        statusCode: 400,
        errorCode: "unsupported_openai_content"
      });
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: match[1],
        data: match[2]
      }
    };
  }

  throw makeUpstreamError("Unsupported OpenAI content block", {
    statusCode: 400,
    errorCode: "unsupported_openai_content"
  });
}

function normalizeOpenAiMessageContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [
      {
        type: "text",
        text: content
      }
    ];
  }

  if (!Array.isArray(content)) {
    throw makeUpstreamError("Unsupported OpenAI message content", {
      statusCode: 400,
      errorCode: "unsupported_openai_content"
    });
  }

  return content.map((part) => openAiContentPartToAnthropicBlock(part));
}

function mapOpenAiChatToAnthropic(body: unknown, binding: RoutableBinding): string {
  const record = asRecord(body);
  if (!record) {
    throw makeUpstreamError("Invalid OpenAI chat payload", {
      statusCode: 400,
      errorCode: "invalid_request"
    });
  }

  if (typeof record.max_tokens !== "number" || !Number.isFinite(record.max_tokens)) {
    throw makeUpstreamError("Anthropic providers require max_tokens for chat completions", {
      statusCode: 400,
      errorCode: "max_tokens_required_for_anthropic"
    });
  }

  const messages = Array.isArray(record.messages) ? record.messages : null;
  if (!messages) {
    throw makeUpstreamError("Request body is missing messages", {
      statusCode: 400,
      errorCode: "messages_required"
    });
  }

  const anthropicMessages: Array<Record<string, unknown>> = [];
  const systemSegments: string[] = [];

  for (const message of messages) {
    const item = asRecord(message);
    if (!item || typeof item.role !== "string") {
      throw makeUpstreamError("Unsupported OpenAI message", {
        statusCode: 400,
        errorCode: "unsupported_openai_content"
      });
    }

    if (item.role === "system") {
      if (typeof item.content === "string") {
        systemSegments.push(item.content);
        continue;
      }

      throw makeUpstreamError("System message content must be plain text for Anthropic adapters", {
        statusCode: 400,
        errorCode: "unsupported_openai_content"
      });
    }

    if (item.role !== "user" && item.role !== "assistant") {
      throw makeUpstreamError("Only user and assistant roles are supported for Anthropic adapters", {
        statusCode: 400,
        errorCode: "unsupported_openai_content"
      });
    }

    anthropicMessages.push({
      role: item.role,
      content: normalizeOpenAiMessageContent(item.content)
    });
  }

  const nextPayload: Record<string, unknown> = {
    ...record,
    model: binding.upstreamModel,
    messages: anthropicMessages
  };

  if (systemSegments.length > 0) {
    nextPayload.system = systemSegments.join("\n\n");
  } else {
    delete nextPayload.system;
  }

  return JSON.stringify(nextPayload);
}

function anthropicBlockToOpenAiPart(block: unknown): string | Record<string, unknown> {
  const record = asRecord(block);
  if (!record || typeof record.type !== "string") {
    throw makeUpstreamError("Unsupported Anthropic content block", {
      statusCode: 400,
      errorCode: "unsupported_anthropic_feature"
    });
  }

  if (record.type === "text" && typeof record.text === "string") {
    return {
      type: "text",
      text: record.text
    };
  }

  if (record.type === "image") {
    const source = asRecord(record.source);
    if (
      !source ||
      source.type !== "base64" ||
      typeof source.media_type !== "string" ||
      typeof source.data !== "string"
    ) {
      throw makeUpstreamError("Unsupported Anthropic image block", {
        statusCode: 400,
        errorCode: "unsupported_anthropic_feature"
      });
    }

    return {
      type: "image_url",
      image_url: {
        url: `data:${source.media_type};base64,${source.data}`
      }
    };
  }

  throw makeUpstreamError("Unsupported Anthropic feature", {
    statusCode: 400,
    errorCode: "unsupported_anthropic_feature"
  });
}

function mapAnthropicMessagesToOpenAiChat(body: unknown, binding: RoutableBinding): string {
  const record = asRecord(body);
  if (!record) {
    throw makeUpstreamError("Invalid Anthropic messages payload", {
      statusCode: 400,
      errorCode: "invalid_request"
    });
  }

  const messages = Array.isArray(record.messages) ? record.messages : null;
  if (!messages) {
    throw makeUpstreamError("Request body is missing messages", {
      statusCode: 400,
      errorCode: "messages_required"
    });
  }

  const openAiMessages: Array<Record<string, unknown>> = [];
  const system = normalizeAnthropicSystem(record.system);
  if (typeof system === "string" && system.trim()) {
    openAiMessages.push({
      role: "system",
      content: system
    });
  }

  for (const message of messages) {
    const item = asRecord(message);
    if (!item || typeof item.role !== "string") {
      throw makeUpstreamError("Unsupported Anthropic message", {
        statusCode: 400,
        errorCode: "unsupported_anthropic_feature"
      });
    }

    const content = item.content;
    if (typeof content === "string") {
      openAiMessages.push({
        role: item.role,
        content
      });
      continue;
    }

    if (!Array.isArray(content)) {
      throw makeUpstreamError("Unsupported Anthropic message content", {
        statusCode: 400,
        errorCode: "unsupported_anthropic_feature"
      });
    }

    const mapped = content.map((block) => anthropicBlockToOpenAiPart(block));
    const allText = mapped.every((block) => typeof block !== "string" && block.type === "text");
    openAiMessages.push({
      role: item.role,
      content: allText
        ? mapped.map((block) => (block as { text: string }).text).join("")
        : mapped
    });
  }

  return JSON.stringify({
    ...record,
    model: binding.upstreamModel,
    messages: openAiMessages
  });
}

function buildUpstreamRequest(input: ProxyRequestInput): UpstreamRequestConfig {
  const { binding, request, body, config } = input;
  const url = buildProviderEndpointUrl(binding, request.endpointType);
  if (!url) {
    throw makeUpstreamError("The selected provider protocol does not support this endpoint", {
      statusCode: 400,
      errorCode: "endpoint_not_supported_for_provider_protocol"
    });
  }

  let requestBodyText: string;
  if (request.gatewayProtocol === "openai" && binding.providerProtocol === "openai") {
    requestBodyText = JSON.stringify({
      ...(asRecord(body) ?? {}),
      model: binding.upstreamModel
    });
  } else if (request.gatewayProtocol === "openai" && binding.providerProtocol === "anthropic") {
    requestBodyText = mapOpenAiChatToAnthropic(body, binding);
  } else if (request.gatewayProtocol === "anthropic" && binding.providerProtocol === "anthropic") {
    requestBodyText = JSON.stringify({
      ...(asRecord(body) ?? {}),
      model: binding.upstreamModel
    });
  } else {
    requestBodyText = mapAnthropicMessagesToOpenAiChat(body, binding);
  }

  return {
    url,
    requestBodyText,
    init: {
      method: "POST",
      headers: buildUpstreamHeaders(config, binding, request.anthropicVersion),
      body: requestBodyText,
      signal: withTimeout(config.upstreamTimeoutMs)
    }
  };
}

function mapOpenAiChatResponseToAnthropic(bodyText: string, status: number): string {
  const parsed = parseJson<Record<string, unknown>>(bodyText);
  const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content
            .map((part) => {
              const record = asRecord(part);
              return record?.type === "text" && typeof record.text === "string" ? record.text : "";
            })
            .join("")
        : "";

  const usage = extractUsage(parsed);

  return JSON.stringify({
    id: parsed?.id ?? null,
    type: "message",
    role: "assistant",
    model: parsed?.model ?? null,
    content: [
      {
        type: "text",
        text: content
      }
    ],
    stop_reason:
      typeof firstChoice?.finish_reason === "string" ? firstChoice.finish_reason : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.inputTokens ?? 0,
      output_tokens: usage.outputTokens ?? 0
    },
    _meta: {
      status
    }
  });
}

function mapAnthropicResponseToOpenAiChat(bodyText: string): string {
  const parsed = parseJson<Record<string, unknown>>(bodyText);
  const content = Array.isArray(parsed?.content) ? parsed.content : [];
  const text = content
    .map((block) => {
      const record = asRecord(block);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
  const usage = extractUsage(parsed);

  return JSON.stringify({
    id: parsed?.id ?? "chatcmpl-router",
    object: "chat.completion",
    model: parsed?.model ?? null,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text
        },
        finish_reason:
          typeof parsed?.stop_reason === "string" && parsed.stop_reason !== "end_turn"
            ? parsed.stop_reason
            : "stop"
      }
    ],
    usage: {
      prompt_tokens: usage.inputTokens ?? 0,
      completion_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    }
  });
}

function extractUsageFromSseBlocks(chunks: string): TokenUsage {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cachedInputTokens: number | null = null;
  let totalTokens: number | null = null;

  for (const block of chunks.split("\n\n")) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, "").trim())
      .filter(Boolean);

    for (const line of dataLines) {
      if (line === "[DONE]") {
        continue;
      }

      const parsed = parseJson<Record<string, unknown>>(line);
      const usage = extractUsage(parsed);
      inputTokens = usage.inputTokens ?? inputTokens;
      outputTokens = usage.outputTokens ?? outputTokens;
      cachedInputTokens = usage.cachedInputTokens ?? cachedInputTokens;
      totalTokens = usage.totalTokens ?? totalTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens
  };
}

function extractAnthropicSseUsage(chunks: string): TokenUsage {
  return extractUsageFromSseBlocks(chunks);
}

function convertAnthropicSseToOpenAiChunks(
  chunks: string,
  model: string
): { text: string; usage: TokenUsage } {
  const outputBlocks: string[] = [];
  let finishReason = "stop";

  for (const block of chunks.split("\n\n")) {
    const lines = block.split("\n");
    const event = lines
      .find((line) => line.startsWith("event:"))
      ?.replace(/^event:\s*/, "")
      .trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""))
      .join("\n");

    if (!data) {
      continue;
    }

    const parsed = parseJson<Record<string, unknown>>(data);
    if (event === "content_block_delta") {
      const delta = asRecord(parsed?.delta);
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        outputBlocks.push(
          serializeSseBlock({
            data: JSON.stringify({
              id: parsed?.message_id ?? "chatcmpl-router",
              object: "chat.completion.chunk",
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: delta.text
                  },
                  finish_reason: null
                }
              ]
            })
          })
        );
      }
      continue;
    }

    if (event === "message_delta") {
      const delta = asRecord(parsed?.delta);
      if (typeof delta?.stop_reason === "string" && delta.stop_reason) {
        finishReason = delta.stop_reason === "end_turn" ? "stop" : delta.stop_reason;
      }
    }
  }

  outputBlocks.push(
    serializeSseBlock({
      data: JSON.stringify({
        id: "chatcmpl-router",
        object: "chat.completion.chunk",
        model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: finishReason
          }
        ]
      })
    })
  );
  outputBlocks.push(serializeSseBlock({ data: "[DONE]" }));

  return {
    text: outputBlocks.join(""),
    usage: extractAnthropicSseUsage(chunks)
  };
}

function convertOpenAiSseToAnthropicBlocks(
  chunks: string,
  model: string
): { text: string; usage: TokenUsage } {
  const deltas: string[] = [];
  let text = "";
  let finishReason = "end_turn";
  const usage = extractUsageFromSseBlocks(chunks);

  for (const block of chunks.split("\n\n")) {
    const dataLines = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, "").trim())
      .filter(Boolean);

    for (const line of dataLines) {
      if (line === "[DONE]") {
        continue;
      }

      const parsed = parseJson<Record<string, unknown>>(line);
      const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
      const choice = asRecord(choices[0]);
      const delta = asRecord(choice?.delta);
      if (typeof delta?.content === "string" && delta.content) {
        text += delta.content;
        deltas.push(
          serializeSseBlock({
            event: "content_block_delta",
            data: JSON.stringify({
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: delta.content
              }
            })
          })
        );
      }

      if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason;
      }
    }
  }

  const blocks = [
    serializeSseBlock({
      event: "message_start",
      data: JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_router",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: usage.inputTokens ?? 0,
            output_tokens: 0
          }
        }
      })
    }),
    serializeSseBlock({
      event: "content_block_start",
      data: JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: ""
        }
      })
    }),
    ...deltas,
    serializeSseBlock({
      event: "content_block_stop",
      data: JSON.stringify({
        type: "content_block_stop",
        index: 0
      })
    }),
    serializeSseBlock({
      event: "message_delta",
      data: JSON.stringify({
        type: "message_delta",
        delta: {
          stop_reason: finishReason,
          stop_sequence: null
        },
        usage: {
          output_tokens: usage.outputTokens ?? 0
        }
      })
    }),
    serializeSseBlock({
      event: "message_stop",
      data: JSON.stringify({
        type: "message_stop"
      })
    })
  ];

  return {
    text: blocks.join(""),
    usage
  };
}

function mapUpstreamSuccessBody(
  request: GatewayRequestContext,
  binding: RoutableBinding,
  bodyText: string,
  httpStatus: number
): { bodyText: string; contentType: string } {
  if (request.gatewayProtocol === binding.providerProtocol) {
    return {
      bodyText,
      contentType: request.gatewayProtocol === "anthropic" ? "application/json" : "application/json"
    };
  }

  if (request.gatewayProtocol === "anthropic") {
    return {
      bodyText: mapOpenAiChatResponseToAnthropic(bodyText, httpStatus),
      contentType: "application/json"
    };
  }

  return {
    bodyText: mapAnthropicResponseToOpenAiChat(bodyText),
    contentType: "application/json"
  };
}

function mapFailureBody(
  request: GatewayRequestContext,
  bodyText: string,
  errorCode: string | null,
  summary: string
): string {
  if (request.gatewayProtocol === "anthropic") {
    return JSON.stringify(
      buildGatewayErrorPayload("anthropic", errorCode ?? "upstream_error", summary)
    );
  }

  return bodyText;
}

export async function testProviderConnection(
  fetchImpl: typeof fetch,
  config: RuntimeConfig,
  provider: {
    baseUrl: string;
    apiKey: string;
    protocol: ProviderProtocol;
    apiVersion: string | null;
    testTimeoutMs: number;
  }
): Promise<ProviderTestResult> {
  const started = Date.now();

  try {
    const headers = new Headers();
    if (provider.protocol === "anthropic") {
      headers.set("x-api-key", provider.apiKey);
      headers.set("Authorization", `Bearer ${provider.apiKey}`);
      headers.set("anthropic-version", provider.apiVersion ?? "2023-06-01");
    } else {
      headers.set("Authorization", `Bearer ${provider.apiKey}`);
    }

    const response = await fetchImpl(buildProviderModelsUrl(provider), {
      method: "GET",
      headers,
      signal: withTimeout(provider.testTimeoutMs || config.providerTestDefaultTimeoutMs)
    });

    const elapsed = Date.now() - started;
    const bodyText = await response.text();
    const parsed = parseJson<{ data?: unknown[] }>(bodyText);

    if (!response.ok) {
      const { summary } = getErrorSummary(bodyText, "Upstream provider request failed");
      return {
        success: false,
        statusCode: response.status,
        responseTimeMs: elapsed,
        visibleModelCount: Array.isArray(parsed?.data) ? parsed.data.length : null,
        message: summary
      };
    }

    return {
      success: true,
      statusCode: response.status,
      responseTimeMs: elapsed,
      visibleModelCount: Array.isArray(parsed?.data) ? parsed.data.length : null,
      message: "Provider connection succeeded"
    };
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      responseTimeMs: Date.now() - started,
      visibleModelCount: null,
      message: error instanceof Error ? error.message : "Provider connection failed"
    };
  }
}

export async function proxyProviderJson(input: ProxyRequestInput): Promise<ProxyResult> {
  let upstreamRequest: UpstreamRequestConfig;

  try {
    upstreamRequest = buildUpstreamRequest(input);
  } catch (error) {
    const statusCode =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    const errorCode =
      error instanceof Error && "errorCode" in error && typeof error.errorCode === "string"
        ? error.errorCode
        : "invalid_request";
    const summary = error instanceof Error ? error.message : "Invalid request";

    return {
      ok: false,
      httpStatus: statusCode,
      bodyText: JSON.stringify(
        buildGatewayErrorPayload(input.request.gatewayProtocol, errorCode, summary)
      ),
      errorCode,
      errorSummary: summary
    };
  }

  try {
    const response = await input.fetchImpl(upstreamRequest.url, upstreamRequest.init);

    if (!response.ok) {
      const bodyText = await response.text();
      const { code, summary } = getErrorSummary(bodyText, "Upstream provider request failed");
      return {
        ok: false,
        httpStatus: response.status,
        bodyText: mapFailureBody(input.request, bodyText, code, summary),
        errorCode: code,
        errorSummary: summary
      };
    }

    const upstreamBodyText = await readTextBody(response);
    const mapped = mapUpstreamSuccessBody(
      input.request,
      input.binding,
      upstreamBodyText,
      response.status
    );
    const usage = extractUsage(parseJson(mapped.bodyText));

    return {
      ok: true,
      httpStatus: response.status,
      contentType: mapped.contentType,
      bodyText: mapped.bodyText,
      isStream: false,
      usage,
      estimatedCost: estimateCost(usage, input.binding.inputPrice, input.binding.outputPrice)
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message : "Upstream network error";
    return {
      ok: false,
      httpStatus: 502,
      bodyText: JSON.stringify(
        buildGatewayErrorPayload(input.request.gatewayProtocol, "network_error", summary)
      ),
      errorCode: "network_error",
      errorSummary: summary
    };
  }
}

export async function streamProviderResponse(
  input: ProxyRequestInput,
  reply: FastifyReply
): Promise<{
  httpStatus: number;
  usage: TokenUsage;
  estimatedCost: number | null;
}> {
  let upstreamRequest: UpstreamRequestConfig;

  try {
    upstreamRequest = buildUpstreamRequest(input);
  } catch (error) {
    const statusCode =
      error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 400;
    const errorCode =
      error instanceof Error && "errorCode" in error && typeof error.errorCode === "string"
        ? error.errorCode
        : "invalid_request";
    const summary = error instanceof Error ? error.message : "Invalid request";
    reply.code(statusCode).send(buildGatewayErrorPayload(input.request.gatewayProtocol, errorCode, summary));
    throw makeUpstreamError(summary, {
      statusCode,
      errorCode
    });
  }

  const response = await input.fetchImpl(upstreamRequest.url, upstreamRequest.init);
  if (!response.ok) {
    const bodyText = await response.text();
    copyUpstreamHeaders(reply, response);
    const { code, summary } = getErrorSummary(bodyText, "Upstream provider request failed");
    reply.code(response.status).send(parseJson(mapFailureBody(input.request, bodyText, code, summary)) ?? bodyText);
    throw makeUpstreamError(summary, {
      statusCode: response.status,
      errorCode: code,
      bodyText
    });
  }

  if (!response.body) {
    reply.code(502).send(buildGatewayErrorPayload(input.request.gatewayProtocol, "empty_upstream_stream", "Upstream did not return a readable stream"));
    throw makeUpstreamError("Upstream did not return a readable stream", {
      statusCode: 502,
      errorCode: "empty_upstream_stream"
    });
  }

  copyUpstreamHeaders(reply, response);
  reply.code(response.status);
  reply.hijack();

  const nodeStream = Readable.fromWeb(response.body as never);
  const chunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    nodeStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
    });

    nodeStream.on("end", () => resolve());
    nodeStream.on("error", (error) => reject(error));
  });

  const joined = chunks.join("");
  let outputText = joined;
  let usage = extractUsageFromSseBlocks(joined);

  if (input.request.gatewayProtocol === "openai" && input.binding.providerProtocol === "anthropic") {
    const converted = convertAnthropicSseToOpenAiChunks(joined, input.binding.upstreamModel);
    outputText = converted.text;
    usage = converted.usage;
  } else if (
    input.request.gatewayProtocol === "anthropic" &&
    input.binding.providerProtocol === "openai"
  ) {
    const converted = convertOpenAiSseToAnthropicBlocks(joined, input.binding.upstreamModel);
    outputText = converted.text;
    usage = converted.usage;
  }

  reply.raw.write(outputText);
  reply.raw.end();

  return {
    httpStatus: response.status,
    usage,
    estimatedCost: estimateCost(usage, input.binding.inputPrice, input.binding.outputPrice)
  };
}
