/**
 * Request guard for the local host.
 *
 * A server on localhost is reachable by every page the user has open. Without
 * checks, any site can POST to /api/generate and spend the user's tokens, or
 * read their config. Two headers cover the realistic attacks:
 *
 *   - `Host`   — must be a loopback name. This is what stops DNS rebinding,
 *                where attacker.com resolves to 127.0.0.1 and the browser then
 *                sends requests with our origin but their host.
 *   - `Origin` — when present, must be our own origin. A cross-site POST from
 *                evil.com carries `Origin: https://evil.com`.
 *
 * Only the local host calls this. Cloudflare terminates TLS and routes by
 * hostname, so the same checks there would just be noise.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

function hostnameOf(value: string | null): string | null {
  if (!value) return null;
  try {
    // `Host` is authority-form, so give URL a scheme to parse it.
    return new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function guardLocalRequest(request: Request): Response | null {
  const hostname = hostnameOf(request.headers.get('host'));
  if (!hostname || !LOOPBACK_HOSTS.has(hostname)) {
    return forbidden('Requests must address this app on localhost.');
  }

  const origin = request.headers.get('origin');

  // Same-origin fetches from our own page either omit Origin (GET) or send our
  // own (POST/PUT). Anything else is cross-site.
  if (origin && origin !== 'null') {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      return forbidden('Malformed Origin header.');
    }
    if (!originHost || !LOOPBACK_HOSTS.has(originHost)) {
      return forbidden('Cross-site requests are not allowed.');
    }
  }

  return null;
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
