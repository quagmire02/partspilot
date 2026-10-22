import type { SecureStore } from "./types";

/** Windows Credential Manager limits a credential blob to 2560 bytes. */
export const CHUNK_BYTES = 2000;

export interface ByteVault {
  get(name: string): Promise<Uint8Array | null>;
  set(name: string, bytes: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * Stores values larger than one credential by splitting them: `<key>` holds the chunk
 * count, `<key>#0..n` the UTF-8 chunks. Writes go chunks-first, header last, so a crash
 * mid-write never leaves a header pointing at missing chunks.
 */
export function chunkedStore(vault: ByteVault): SecureStore {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const header = async (key: string) => {
    const h = await vault.get(key);
    const n = h ? Number(dec.decode(h)) : 0;
    return Number.isInteger(n) && n > 0 && n < 64 ? n : 0;
  };
  return {
    async getItem(key) {
      const n = await header(key);
      if (!n) return null;
      const parts: Uint8Array[] = [];
      for (let i = 0; i < n; i++) {
        const c = await vault.get(`${key}#${i}`);
        if (!c) return null;
        parts.push(c);
      }
      const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
      let o = 0;
      for (const p of parts) {
        all.set(p, o);
        o += p.length;
      }
      return dec.decode(all);
    },
    async setItem(key, value) {
      const bytes = enc.encode(value);
      const n = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
      const old = await header(key);
      for (let i = 0; i < n; i++) await vault.set(`${key}#${i}`, bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
      await vault.set(key, enc.encode(String(n)));
      for (let i = n; i < old; i++) await vault.remove(`${key}#${i}`);
    },
    async removeItem(key) {
      const n = await header(key);
      await vault.remove(key);
      for (let i = 0; i < n; i++) await vault.remove(`${key}#${i}`);
    },
  };
}
