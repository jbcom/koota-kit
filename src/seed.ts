// Seed derivation and master seeds.
//
// A seeded game usually has a chain of seeds: a buried master seed for the
// profile, a run seed derived from it, a level seed derived from that, and
// one stream per generator. Building those keys by string concatenation is
// ambiguous ("1" + "23" === "12" + "3"), so `deriveSeed` hashes length-prefixed
// parts instead. Leaf module: no runtime dependency, so it is identical in
// browsers and Node and in both the ESM and CommonJS builds.

/** A value that can seed a stream or be mixed into a derived seed. */
export type SeedPart = string | number;

/** The subset of Web Crypto that `createMasterSeed` needs. Inject one in tests. */
// ArrayBuffer-backed, matching Web Crypto's signature: with DOM typings,
// `Crypto.getRandomValues` rejects a bare `Uint8Array<ArrayBufferLike>`.
export type EntropySource = {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
};

/** Byte length of a master seed (128 bits). */
export const MASTER_SEED_BYTES = 16;

// Changing the domain tag or the encoding changes every derived seed in every
// consumer's saves. Treat both as a frozen public contract.
const DERIVE_DOMAIN = "koota-kit:deriveSeed:v1";
const HEX_SEED = /^[0-9a-f]{32}$/;

function canonicalPart(value: unknown, label: string, api: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError(`${api}: ${label} must be a string or finite number.`);
}

/** UTF-8 encode, mapping lone surrogates to U+FFFD exactly like TextEncoder. */
function utf8(text: string): number[] {
  const bytes: number[] = [];
  // String iteration yields whole code points; an unpaired surrogate arrives
  // alone as its own code unit, so it is the only surrogate value seen here.
  for (const char of text) {
    let code = char.codePointAt(0) as number;
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** FIPS 180-4 SHA-256 of `message`, as eight big-endian 32-bit words. */
function sha256(message: number[]): Uint32Array {
  const bitLength = message.length * 8;
  const zeroPadding = (55 - (message.length % 64) + 64) % 64;
  // Seed inputs are far below 2**32 bits, so the high length word is zero.
  const padded = [
    ...message,
    0x80,
    ...new Array<number>(zeroPadding).fill(0),
    0,
    0,
    0,
    0,
    bitLength >>> 24,
    (bitLength >>> 16) & 0xff,
    (bitLength >>> 8) & 0xff,
    bitLength & 0xff,
  ];

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const i = offset + t * 4;
      w[t] =
        ((padded[i] as number) << 24) |
        ((padded[i + 1] as number) << 16) |
        ((padded[i + 2] as number) << 8) |
        (padded[i + 3] as number);
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15] as number;
      const w2 = w[t - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) >>> 0;
    }
    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;
    let f = hash[5] as number;
    let g = hash[6] as number;
    let h = hash[7] as number;
    for (let t = 0; t < 64; t += 1) {
      const t1 =
        (h +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (K[t] as number) +
          (w[t] as number)) >>>
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    hash[0] = ((hash[0] as number) + a) >>> 0;
    hash[1] = ((hash[1] as number) + b) >>> 0;
    hash[2] = ((hash[2] as number) + c) >>> 0;
    hash[3] = ((hash[3] as number) + d) >>> 0;
    hash[4] = ((hash[4] as number) + e) >>> 0;
    hash[5] = ((hash[5] as number) + f) >>> 0;
    hash[6] = ((hash[6] as number) + g) >>> 0;
    hash[7] = ((hash[7] as number) + h) >>> 0;
  }
  return hash;
}

const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Derive a child seed from `parent` and ordered `parts`. Returns the first 128
 * bits of SHA-256 over a domain tag plus each value as a 4-byte big-endian
 * UTF-8 length and its UTF-8 text, as 32 lowercase hex characters. Numbers
 * canonicalize to their string form, matching `createRng`.
 */
export function deriveSeed(parent: SeedPart, ...parts: SeedPart[]): string {
  const values = [canonicalPart(parent, "parent", "deriveSeed")];
  parts.forEach((part, index) => {
    values.push(canonicalPart(part, `parts[${index}]`, "deriveSeed"));
  });
  const chunks = [utf8(DERIVE_DOMAIN)];
  for (const value of values) {
    const encoded = utf8(value);
    const length = encoded.length;
    const prefix = [
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    ];
    chunks.push(prefix, encoded);
  }
  const digest = sha256(chunks.flat());
  return Array.from(digest.subarray(0, 4), (word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * Create a 128-bit master seed from `entropy` (default `globalThis.crypto`)
 * as 32 lowercase hex characters. Fails closed when no source exists, when it
 * returns anything but the requested 16-byte buffer, or when the buffer is
 * still all zero (an unfilled stub, not entropy).
 */
export function createMasterSeed(entropy?: EntropySource): string {
  const source = entropy ?? (globalThis as { crypto?: EntropySource }).crypto;
  if (!source || typeof source.getRandomValues !== "function") {
    throw new TypeError("createMasterSeed: no entropy source with getRandomValues is available.");
  }
  const requested = new Uint8Array(MASTER_SEED_BYTES);
  const bytes = source.getRandomValues(requested);
  if (bytes !== requested) {
    throw new TypeError(
      "createMasterSeed: the entropy source must fill the requested 16-byte array.",
    );
  }
  if (bytes.every((byte) => byte === 0)) {
    throw new RangeError("createMasterSeed: the entropy source returned all zero bytes.");
  }
  return toHex(bytes);
}

/** True for exactly 32 lowercase hex characters: the shape of a master or derived seed. */
export function isMasterSeed(value: unknown): value is string {
  return typeof value === "string" && HEX_SEED.test(value);
}
