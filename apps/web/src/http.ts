/**
 * The small amount of HTTP plumbing a form-driven app needs.
 *
 * No client-side JavaScript anywhere: every mutation is a plain form POST. That
 * keeps the whole app dependency-free, and it means the deadline logic lives in
 * one place on the server rather than being duplicated into a browser bundle.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export const SESSION_COOKIE = 'ql_session';

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  options: { expires?: Date; maxAge?: number } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  const existing = response.getHeader('set-cookie');
  const all = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  response.setHeader('set-cookie', [...all, parts.join('; ')]);
}

export function clearCookie(response: ServerResponse, name: string): void {
  setCookie(response, name, '', { maxAge: 0 });
}

const MAX_BODY = 64 * 1024;

/** Parse an urlencoded form body. Repeated keys collect into an array. */
export async function readForm(request: IncomingMessage): Promise<Map<string, string[]>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('that form is too large');
    chunks.push(chunk as Buffer);
  }

  const parsed = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const form = new Map<string, string[]>();
  for (const [key, value] of parsed) {
    form.set(key, [...(form.get(key) ?? []), value]);
  }
  return form;
}

export function field(form: Map<string, string[]>, name: string): string {
  return form.get(name)?.[0]?.trim() ?? '';
}

export function fields(form: Map<string, string[]>, name: string): string[] {
  return (form.get(name) ?? []).map((value) => value.trim()).filter(Boolean);
}

/**
 * Same-origin check for state-changing requests.
 *
 * Cheap CSRF protection that costs no tokens and no session state: a cross-site
 * form post carries an Origin the browser sets and cannot be forged.
 */
export function sameOrigin(request: IncomingMessage, port: number): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // curl and other non-browser clients send none
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
      ? url.port === String(port) || url.port === ''
      : false;
  } catch {
    return false;
  }
}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

/** Carry a one-line result through a redirect without needing session storage. */
export function withNotice(path: string, notice: string, kind: 'ok' | 'problem' = 'ok'): string {
  const params = new URLSearchParams({ [kind]: notice });
  return `${path}${path.includes('?') ? '&' : '?'}${params.toString()}`;
}
