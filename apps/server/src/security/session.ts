import { randomBytes } from "node:crypto";

import type { DatabaseSync } from "node:sqlite";

import { hashOpaqueToken } from "./crypto.ts";
import { createId, nowIso } from "../lib/utils.ts";
import type { ConsoleUser } from "../types.ts";

export interface SessionRecord {
  id: string;
  token: string;
  expiresAt: string;
}

export function createSession(
  sqlite: DatabaseSync,
  user: ConsoleUser,
  ttlHours: number,
  ip: string | null,
  userAgent: string | null
): SessionRecord {
  const token = randomBytes(32).toString("base64url");
  const sessionId = createId();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  sqlite
    .prepare(
      `
        INSERT INTO admin_sessions (
          id,
          user_id,
          token_hash,
          expires_at,
          created_at,
          last_seen_at,
          user_agent,
          ip
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(sessionId, user.id, hashOpaqueToken(token), expiresAt, timestamp, timestamp, userAgent, ip);

  return {
    id: sessionId,
    token,
    expiresAt
  };
}

export function loadSessionUserByToken(
  sqlite: DatabaseSync,
  token: string
): ConsoleUser | null {
  const now = nowIso();
  const row = sqlite
    .prepare(
      `
        SELECT
          admin_users.id AS id,
          admin_users.username AS username,
          admin_users.display_name AS display_name,
          admin_users.role AS role,
          admin_users.status AS status,
          admin_sessions.id AS session_id
        FROM admin_sessions
        INNER JOIN admin_users ON admin_users.id = admin_sessions.user_id
        WHERE admin_sessions.token_hash = ?
          AND admin_sessions.expires_at > ?
        LIMIT 1
      `
    )
    .get(hashOpaqueToken(token), now) as
    | {
        id: string;
        username: string;
        display_name: string | null;
        role: "admin" | "user";
        status: "pending" | "approved" | "rejected" | "disabled";
        session_id: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  sqlite
    .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
    .run(now, row.session_id);

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role,
    status: row.status
  };
}

export function destroySessionByToken(sqlite: DatabaseSync, token: string): void {
  sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashOpaqueToken(token));
}
