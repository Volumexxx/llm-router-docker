import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

import { sha256 } from "../lib/utils.ts";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export async function hashCredential(value: string): Promise<string> {
  return hash(value, {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyCredential(hashedValue: string, plainValue: string): Promise<boolean> {
  return verify(hashedValue, plainValue);
}

export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const key = deriveKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivEncoded, tagEncoded, bodyEncoded] = payload.split(".");

  if (!ivEncoded || !tagEncoded || !bodyEncoded) {
    throw new Error("Encrypted secret payload is malformed");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivEncoded, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bodyEncoded, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function hashOpaqueToken(token: string): string {
  return sha256(token);
}
