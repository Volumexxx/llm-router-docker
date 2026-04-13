import { Readable } from "node:stream";

import type { FastifyReply } from "fastify";

import type { TokenUsage } from "../../../../packages/shared/src/index.ts";
import { estimateCost } from "../../../../packages/shared/src/index.ts";
import type { RuntimeConfig } from "../config.ts";
import { decryptSecret } from "../security/crypto.ts";
import { extractUsage, getErrorSummary, joinUrl, parseJson } from "../lib/utils.ts";
import type { RoutableBinding } from "./models.ts";

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

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export async function testProviderConnection(
  fetchImpl: typeof fetch,
  config: RuntimeConfig,
  provider: {
    baseUrl: string;
    apiKey: string;
    testTimeoutMs: number;
  }
): Promise<ProviderTestResult> {
  const started = Date.now();

  try {
    const response = await fetchImpl(joinUrl(provider.baseUrl, "models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`
      },
      signal: withTimeout(provider.testTimeoutMs || config.providerTestDefaultTimeoutMs)
    });

    const elapsed = Date.now() - started;
    const bodyText = await response.text();
    const parsed = parseJson<{ data?: unknown[] }>(bodyText);

    if (!response.ok) {
      const { summary } = getErrorSummary(bodyText, "上游返回错误");
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
      message: "连接成功"
    };
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      responseTimeMs: Date.now() - started,
      visibleModelCount: null,
      message: error instanceof Error ? error.message : "连接失败"
    };
  }
}

function overrideModel(body: unknown, upstreamModel: string): string {
  if (!body || typeof body !== "object") {
    return JSON.stringify({ model: upstreamModel });
  }

  return JSON.stringify({
    ...(body as Record<string, unknown>),
    model: upstreamModel
  });
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

function extractUsageFromSseBlocks(chunks: string): TokenUsage {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
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
      totalTokens = usage.totalTokens ?? totalTokens;
    }
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

export async function proxyProviderJson(
  fetchImpl: typeof fetch,
  config: RuntimeConfig,
  binding: RoutableBinding,
  endpointPath: "chat/completions" | "responses",
  body: unknown
): Promise<ProxyResult> {
  const requestBody = overrideModel(body, binding.upstreamModel);

  try {
    const response = await fetchImpl(joinUrl(binding.providerBaseUrl, endpointPath), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${decryptSecret(binding.providerApiKeyEncrypted, config.configEncryptionKey)}`
      },
      body: requestBody,
      signal: withTimeout(config.upstreamTimeoutMs)
    });

    if (!response.ok) {
      const bodyText = await response.text();
      const { code, summary } = getErrorSummary(bodyText, "上游返回错误");
      return {
        ok: false,
        httpStatus: response.status,
        bodyText,
        errorCode: code,
        errorSummary: summary
      };
    }

    const bodyText = await response.text();
    const usage = extractUsage(parseJson(bodyText));

    return {
      ok: true,
      httpStatus: response.status,
      contentType: response.headers.get("content-type"),
      bodyText,
      isStream: false,
      usage,
      estimatedCost: estimateCost(usage, binding.inputPrice, binding.outputPrice)
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 502,
      bodyText: JSON.stringify({
        error: {
          code: "network_error",
          message: error instanceof Error ? error.message : "上游网络错误"
        }
      }),
      errorCode: "network_error",
      errorSummary: error instanceof Error ? error.message : "上游网络错误"
    };
  }
}

export async function streamProviderResponse(
  fetchImpl: typeof fetch,
  config: RuntimeConfig,
  binding: RoutableBinding,
  endpointPath: "chat/completions" | "responses",
  body: unknown,
  reply: FastifyReply
): Promise<{
  httpStatus: number;
  usage: TokenUsage;
  estimatedCost: number | null;
}> {
  const requestBody = overrideModel(body, binding.upstreamModel);
  const response = await fetchImpl(joinUrl(binding.providerBaseUrl, endpointPath), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${decryptSecret(binding.providerApiKeyEncrypted, config.configEncryptionKey)}`
    },
    body: requestBody,
    signal: withTimeout(config.upstreamTimeoutMs)
  });

  if (!response.ok) {
    const bodyText = await response.text();
    copyUpstreamHeaders(reply, response);
    reply.code(response.status).send(parseJson(bodyText) ?? bodyText);
    const { code, summary } = getErrorSummary(bodyText, "上游返回错误");
    throw Object.assign(new Error(summary), {
      statusCode: response.status,
      errorCode: code,
      bodyText
    });
  }

  if (!response.body) {
    reply.code(502).send({
      error: {
        code: "empty_upstream_stream",
        message: "上游没有返回可读流"
      }
    });
    throw Object.assign(new Error("上游没有返回可读流"), {
      statusCode: 502,
      errorCode: "empty_upstream_stream",
      bodyText: ""
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
      reply.raw.write(chunk);
    });

    nodeStream.on("end", () => {
      reply.raw.end();
      resolve();
    });

    nodeStream.on("error", (error) => {
      reply.raw.destroy(error);
      reject(error);
    });
  });

  const usage = extractUsageFromSseBlocks(chunks.join(""));

  return {
    httpStatus: response.status,
    usage,
    estimatedCost: estimateCost(usage, binding.inputPrice, binding.outputPrice)
  };
}
