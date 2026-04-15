import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export type GatewayResponseProtocol = "openai" | "anthropic";

export function sendValidationError(reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof ZodError)) {
    return false;
  }

  reply.code(400).send({
    error: {
      code: "validation_error",
      message: error.issues.map((issue) => issue.message).join("; ")
    }
  });

  return true;
}

export function buildGatewayErrorPayload(
  protocol: GatewayResponseProtocol,
  code: string,
  message: string
) {
  if (protocol === "anthropic") {
    return {
      type: "error",
      error: {
        type: code,
        message
      }
    };
  }

  return {
    error: {
      code,
      message
    }
  };
}

export function sendGatewayError(
  reply: FastifyReply,
  statusCode: number,
  protocol: GatewayResponseProtocol,
  code: string,
  message: string
): void {
  reply.code(statusCode).send(buildGatewayErrorPayload(protocol, code, message));
}

export function sendJsonError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): void {
  sendGatewayError(reply, statusCode, "openai", code, message);
}
