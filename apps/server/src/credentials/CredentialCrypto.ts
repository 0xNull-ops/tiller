// @effect-diagnostics-next-line nodeBuiltinImport:off -- AES-256-GCM and scrypt are node:crypto primitives Effect does not wrap.
import * as NodeCrypto from "node:crypto";

/**
 * Values are sealed with AES-256-GCM under the vault key. The AAD binds a ciphertext to the
 * credential and field it was written for, so a blob copied onto another field fails to open
 * instead of decrypting into the wrong place.
 */
const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const aad = (credentialId: string, fieldId: string): Buffer =>
  Buffer.from(`${credentialId}\u0000${fieldId}`, "utf8");

export const encryptCredentialValue = (input: {
  readonly key: Uint8Array;
  readonly credentialId: string;
  readonly fieldId: string;
  readonly plaintext: Uint8Array;
}): Uint8Array => {
  if (input.key.byteLength !== KEY_BYTES) throw new Error("The vault key must be 32 bytes.");
  const iv = NodeCrypto.randomBytes(IV_BYTES);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", input.key, iv);
  cipher.setAAD(aad(input.credentialId, input.fieldId));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(input.plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Uint8Array.from(Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, ciphertext]));
};

export const decryptCredentialValue = (input: {
  readonly key: Uint8Array;
  readonly credentialId: string;
  readonly fieldId: string;
  readonly envelope: Uint8Array;
}): Uint8Array => {
  if (input.key.byteLength !== KEY_BYTES) throw new Error("The vault key must be 32 bytes.");
  const envelope = Buffer.from(input.envelope);
  if (envelope.byteLength < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error("The stored credential value is truncated.");
  }
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new Error("The stored credential value uses an unknown format.");
  }
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = NodeCrypto.createDecipheriv("aes-256-gcm", input.key, iv);
  decipher.setAAD(aad(input.credentialId, input.fieldId));
  decipher.setAuthTag(tag);
  return Uint8Array.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
};

/**
 * scrypt at N=2^15 takes about 100 ms, which makes guessing the PIN expensive without making an
 * unlock feel slow. The parameters travel with the record so a later change can rehash on login.
 */
export const CREDENTIAL_PIN_PARAMS = { n: 2 ** 15, r: 8, p: 1 } as const;

export interface CredentialPinParams {
  readonly n: number;
  readonly r: number;
  readonly p: number;
}

const PIN_HASH_BYTES = 32;
// scrypt needs 128 * N * r bytes, and the default 32 MB cap is exactly the boundary.
const PIN_SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const credentialPinSalt = (): Uint8Array => Uint8Array.from(NodeCrypto.randomBytes(16));

export const deriveCredentialPinHash = (input: {
  readonly pin: string;
  readonly salt: Uint8Array;
  readonly params: CredentialPinParams;
}): Uint8Array =>
  Uint8Array.from(
    NodeCrypto.scryptSync(input.pin, Buffer.from(input.salt), PIN_HASH_BYTES, {
      N: input.params.n,
      r: input.params.r,
      p: input.params.p,
      maxmem: PIN_SCRYPT_MAXMEM,
    }),
  );

export const pinHashMatches = (input: {
  readonly pin: string;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
  readonly params: CredentialPinParams;
}): boolean => {
  const candidate = deriveCredentialPinHash(input);
  return (
    candidate.byteLength === input.hash.byteLength &&
    NodeCrypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(input.hash))
  );
};
