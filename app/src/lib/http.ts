/**
 * Route-handler helpers.
 *
 * Two jobs: turn thrown AuthErrors into the right status, and make sure an
 * unexpected exception never leaks a stack trace, a query, or a fragment of
 * someone's financial data to the client.
 */

import { NextResponse } from 'next/server';
import { AuthError } from './auth.ts';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const result = await fn();
    return result instanceof Response ? result : ok(result);
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message, err.status);

    // Log server-side with enough to debug; return nothing useful to a caller.
    console.error('[route error]', err instanceof Error ? err.message : err);
    return fail('Something went wrong. Please try again.', 500);
  }
}

/** Reject oversized bodies before parsing — a cheap DoS guard. */
export async function readJson(req: Request, maxBytes = 512 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AuthError('Request body too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError('Invalid JSON body.', 400);
  }
}
