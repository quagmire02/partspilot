import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTVerifyGetKey } from "jose";
import { createTokenVerifier } from "../src/lib/jwt.js";

const URL_ = "https://proj.supabase.co";
const ISS = `${URL_}/auth/v1`;
const SUB = "11111111-1111-4111-8111-111111111111";

let priv: CryptoKey;
let other: CryptoKey;
let keySet: JWTVerifyGetKey;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  priv = kp.privateKey;
  other = (await generateKeyPair("ES256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "ES256" };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

const sign = (claims: Record<string, unknown>, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT({ role: "authenticated", email: "a@test.local", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setSubject((claims.sub as string) ?? SUB)
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? priv);

describe("token verifier", () => {
  it("accepts a valid Supabase access token", async () => {
    const verify = createTokenVerifier({ supabaseUrl: URL_, keySet });
    expect(await verify(await sign({}))).toEqual({ id: SUB, email: "a@test.local" });
  });

  it.each([
    ["wrong issuer", () => sign({}, { iss: "https://evil.example/auth/v1" })],
    ["wrong audience", () => sign({}, { aud: "service_role" })],
    ["expired", () => sign({}, { exp: "-10m" })],
    ["foreign key", () => sign({}, { key: other })],
    ["anon role", () => sign({ role: "anon" })],
    ["anonymous user", () => sign({ is_anonymous: true })],
    ["non-uuid subject", () => sign({ sub: "admin" })],
  ])("rejects %s", async (_, make) => {
    const verify = createTokenVerifier({ supabaseUrl: URL_, keySet });
    await expect(verify(await make())).rejects.toThrow();
  });

  const hs256 = (secret: string) =>
    new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(SUB)
      .setIssuer(ISS)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
  const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

  it("accepts legacy HS256 only with the configured secret, and ES256 via JWKS alongside it", async () => {
    const verify = createTokenVerifier({ supabaseUrl: URL_, jwtSecret: SECRET, keySet });
    expect((await verify(await hs256(SECRET))).id).toBe(SUB);
    expect((await verify(await sign({}))).id).toBe(SUB);
    await expect(verify(await hs256("another-secret-another-secret-another-secret"))).rejects.toThrow();
  });

  it("rejects HS256 tokens when no secret is configured (no alg confusion with the JWKS)", async () => {
    const verify = createTokenVerifier({ supabaseUrl: URL_, keySet });
    await expect(verify(await hs256(SECRET))).rejects.toThrow("hs256_not_allowed");
    await expect(verify("not.a.jwt")).rejects.toThrow();
  });
});
