import {
  SignJWT,
  jwtVerify,
  importJWK,
  exportJWK,
  generateKeyPair,
  type JWK,
} from 'jose';
import { nanoid } from 'nanoid';

export type BridgeKeypair = {
  kid: string;
  publicJwk: JWK;
  privateJwk: JWK;
};

export async function generateBridgeKeypair(): Promise<BridgeKeypair> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = nanoid();
  return { kid, publicJwk, privateJwk };
}

export type CapTokenClaims = {
  sub: string;
  aud: string;
  scope: string[];
};

export async function signCapToken(args: {
  privateJwk: JWK;
  kid: string;
  issuer: string;
  claims: CapTokenClaims;
  expiresInSeconds: number;
}) {
  const key = await importJWK(args.privateJwk, 'EdDSA');
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ scope: args.claims.scope })
    .setProtectedHeader({ alg: 'EdDSA', kid: args.kid, typ: 'JWT' })
    .setIssuedAt(now)
    .setIssuer(args.issuer)
    .setSubject(args.claims.sub)
    .setAudience(args.claims.aud)
    .setExpirationTime(now + args.expiresInSeconds)
    .setJti(nanoid())
    .sign(key);
}

export async function verifyCapToken(args: {
  token: string;
  publicJwk: JWK;
  expectedAudience: string;
  expectedScope: string;
}) {
  const key = await importJWK(args.publicJwk, 'EdDSA');
  const { payload, protectedHeader } = await jwtVerify(args.token, key, {
    audience: args.expectedAudience,
  });

  const scope = (payload.scope as unknown) as string[] | undefined;
  if (!scope?.includes(args.expectedScope)) {
    throw new Error('missing scope');
  }

  return { payload, protectedHeader };
}
