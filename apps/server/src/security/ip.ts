import type { FastifyRequest } from "fastify";
import ipaddr from "ipaddr.js";

import type { RuntimeConfig } from "../config.ts";

export function normalizeIp(ip: string): string {
  const cleaned = ip.trim();
  const parsed = ipaddr.process(cleaned);
  return parsed.toString();
}

export function isIpAllowed(ip: string, cidrs: string[]): boolean {
  if (cidrs.length === 0) {
    return true;
  }

  const normalized = ipaddr.process(ip);

  return cidrs.some((cidr) => {
    try {
      const [range, bits] = ipaddr.parseCIDR(cidr);
      return normalized.match(range, bits);
    } catch {
      return false;
    }
  });
}

export function getClientIp(request: FastifyRequest): string {
  try {
    return normalizeIp(request.ip);
  } catch {
    return request.ip;
  }
}

export function isRequestSecure(request: FastifyRequest): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  return request.protocol === "https";
}

export function deriveBaseUrl(request: FastifyRequest, config: RuntimeConfig): string {
  if (config.externalBaseUrl) {
    return config.externalBaseUrl;
  }

  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];

  const protocol =
    typeof forwardedProto === "string" ? forwardedProto.split(",")[0]?.trim() : request.protocol;
  const host =
    typeof forwardedHost === "string" ? forwardedHost.split(",")[0]?.trim() : request.headers.host;

  return `${protocol ?? "http"}://${host ?? `${config.host}:${config.port}`}`;
}
