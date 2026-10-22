import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  id: string;
  email: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASYMMETRIC = ["ES256", "RS256", "EdDSA"];

/**
 * Verifies a Supabase access token: signature, issuer, audience, expiry, and that it is a
 * signed-in (non-anonymous) user. Asymmetric tokens are checked against the project JWKS;
 * legacy HS256 tokens only when a JWT secret is configured. The path is chosen from the
 * header, but each path accepts only its own algorithms (no alg confusion).
 */
export function createTokenVerifier(opts: {
  supabaseUrl: string;
  jwtSecret?: string;
  /** Test hook. */
  keySet?: JWTVerifyGetKey;
}): TokenVerifier {
  const issuer = `${opts.supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : null;
  const jwks = opts.keySet ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { cacheMaxAge: 600_000 });

  return async (token: string) => {
    const { alg } = decodeProtectedHeader(token);
    const options = { issuer, audience: "authenticated", clockTolerance: 5 };
    let payload;
    if (alg === "HS256") {
      if (!secret) throw new Error("hs256_not_allowed");
      ({ payload } = await jwtVerify(token, secret, { ...options, algorithms: ["HS256"] }));
    } else {
      ({ payload } = await jwtVerify(token, jwks, { ...options, algorithms: ASYMMETRIC }));
    }
    if (typeof payload.sub !== "string" || !UUID.test(payload.sub)) throw new Error("bad_sub");
    if (payload.role !== "authenticated" || payload.is_anonymous === true) throw new Error("bad_role");
    return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
  };
}
