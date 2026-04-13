import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

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

export function sendJsonError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): void {
  reply.code(statusCode).send({
    error: {
      code,
      message
    }
  });
}
