export type TurnstileVerifier = (token: string, ip: string | null) => Promise<boolean>;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function createTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): TurnstileVerifier {
  return async (token, ip) => {
    const body = new FormData();
    body.set("secret", secret);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    body.set("idempotency_key", crypto.randomUUID());
    try {
      const res = await fetchImpl(SITEVERIFY, { method: "POST", body });
      if (!res.ok) return false;
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}
