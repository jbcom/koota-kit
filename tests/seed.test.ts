import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMasterSeed, deriveSeed, isMasterSeed, MASTER_SEED_BYTES } from "../src/seed.js";

// Independent reference for the documented encoding: a domain tag, then each
// value as a 4-byte big-endian UTF-8 byte length followed by its UTF-8 bytes,
// hashed with SHA-256 and truncated to the first 16 bytes. Built on
// node:crypto so the noble implementation is checked against a second one.
function referenceDerive(...values: Array<string | number>): string {
  const chunks: Buffer[] = [Buffer.from("koota-kit:deriveSeed:v1", "utf8")];
  for (const value of values) {
    const text = Buffer.from(String(value), "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(text.length);
    chunks.push(length, text);
  }
  return createHash("sha256").update(Buffer.concat(chunks)).digest("hex").slice(0, 32);
}

describe("deriveSeed", () => {
  it("returns 32 lowercase hex characters matching the documented encoding", () => {
    const seed = deriveSeed("master", "tier-1", 4);
    expect(seed).toMatch(/^[0-9a-f]{32}$/);
    expect(seed).toBe(referenceDerive("master", "tier-1", 4));
    expect(deriveSeed("solo")).toBe(referenceDerive("solo"));
    expect(deriveSeed("ünïcødé", "🜏")).toBe(referenceDerive("ünïcødé", "🜏"));
    expect(deriveSeed("€ ankh ☥", "𓂀")).toBe(referenceDerive("€ ankh ☥", "𓂀"));
  });

  it("encodes lone surrogates as U+FFFD exactly like TextEncoder", () => {
    for (const malformed of ["\ud800", "a\ud800b", "\udc00", "x\udfff", "\ud83d"]) {
      expect(deriveSeed("m", malformed)).toBe(referenceDerive("m", malformed));
      expect(deriveSeed("m", malformed)).toBe(
        deriveSeed("m", malformed.replace(/[\ud800-\udfff]/g, "�")),
      );
    }
  });

  it("is frozen against a golden vector so the derivation can never drift silently", () => {
    expect(deriveSeed("koota-kit", "golden", 1)).toBe("880d27c83cf91870d3d81d05d7dff3cb");
  });

  it("is deterministic and order-sensitive", () => {
    expect(deriveSeed("m", "a", "b")).toBe(deriveSeed("m", "a", "b"));
    expect(deriveSeed("m", "a", "b")).not.toBe(deriveSeed("m", "b", "a"));
    expect(deriveSeed("m", "a")).not.toBe(deriveSeed("m"));
  });

  it("length-prefixes parts so concatenation-equal inputs never collide", () => {
    expect(deriveSeed("m", "a", "bc")).not.toBe(deriveSeed("m", "ab", "c"));
    expect(deriveSeed("m", 1, 23)).not.toBe(deriveSeed("m", 12, 3));
    expect(deriveSeed("m", "")).not.toBe(deriveSeed("m"));
    expect(deriveSeed("ma")).not.toBe(deriveSeed("m", "a"));
  });

  it("canonicalizes numbers like createRng does", () => {
    expect(deriveSeed(7, "x")).toBe(deriveSeed("7", "x"));
    expect(deriveSeed("m", -0)).toBe(deriveSeed("m", 0));
    expect(deriveSeed("m", 0.5)).toBe(deriveSeed("m", "0.5"));
  });

  it("chains: a derived seed is a valid parent", () => {
    const reign = deriveSeed("0123456789abcdef0123456789abcdef", "dynasty-1", 0);
    const round = deriveSeed(reign, 3);
    expect(round).toMatch(/^[0-9a-f]{32}$/);
    expect(round).toBe(referenceDerive(reign, 3));
  });

  it("rejects non-finite numbers and non-seed values", () => {
    expect(() => deriveSeed(Number.NaN)).toThrow(/deriveSeed: parent must be a string or finite/);
    expect(() => deriveSeed("m", Number.POSITIVE_INFINITY)).toThrow(/deriveSeed: parts\[0\]/);
    expect(() => deriveSeed("m", "ok", {} as never)).toThrow(/deriveSeed: parts\[1\]/);
    expect(() => deriveSeed(undefined as never)).toThrow(TypeError);
    expect(() => deriveSeed("m", 1n as never)).toThrow(TypeError);
  });
});

describe("createMasterSeed", () => {
  it("fills MASTER_SEED_BYTES from the injected source and hex-encodes them", () => {
    expect(MASTER_SEED_BYTES).toBe(16);
    const seed = createMasterSeed({
      getRandomValues: (bytes) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index * 17;
        return bytes;
      },
    });
    expect(seed).toBe("00112233445566778899aabbccddeeff");
    expect(isMasterSeed(seed)).toBe(true);
  });

  it("uses globalThis.crypto by default and produces distinct seeds", () => {
    const first = createMasterSeed();
    const second = createMasterSeed();
    expect(isMasterSeed(first)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("fails closed on a missing, unfilled, or misbehaving entropy source", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      expect(() => createMasterSeed()).toThrow(/createMasterSeed: no entropy source/);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
    expect(() => createMasterSeed({ getRandomValues: (bytes) => bytes })).toThrow(/all zero/);
    expect(() => createMasterSeed({ getRandomValues: () => new Uint8Array(8).fill(1) })).toThrow(
      /16-byte/,
    );
    expect(() => createMasterSeed({} as never)).toThrow(/createMasterSeed: no entropy source/);
  });
});

describe("isMasterSeed", () => {
  it("accepts exactly 32 lowercase hex characters", () => {
    expect(isMasterSeed("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isMasterSeed("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(isMasterSeed("0123456789abcdef")).toBe(false);
    expect(isMasterSeed(`${"0".repeat(32)}0`)).toBe(false);
    expect(isMasterSeed(42)).toBe(false);
  });
});
