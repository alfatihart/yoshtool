// sessioncrypto.js
// Passphrase-based encryption for saved sessions (opt-in). AES-256-GCM with a key
// derived from the user's master passphrase via PBKDF2 (SHA-256). Pure Web Crypto —
// works in the extension popup (a secure context) and in Node for tests.
//
// A saved session always keeps its metadata (name, counts, dates) in clear text so the
// list renders without unlocking; only the sensitive payload (cookies + storage) is
// encrypted. The passphrase is never stored — a key is derived on unlock and kept in
// memory for the popup's lifetime. A small "verifier" blob lets us check a passphrase
// without decrypting any real session.

const textEnc = new TextEncoder();
const textDec = new TextDecoder();
const PBKDF2_ITERATIONS = 210000;
const VERIFIER_PLAINTEXT = "yoshtool-session-v1";

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("Web Crypto is not available in this context");
  return c.subtle;
}

export function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

export function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

// Derive a non-extractable AES-GCM key from a passphrase + salt.
export async function deriveKey(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const base = await subtle().importKey("raw", textEnc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Encrypt a JSON-serializable value → { iv, ct } (both base64).
export async function encryptJSON(key, value) {
  const iv = randomBytes(12);
  const data = textEnc.encode(JSON.stringify(value));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, data));
  return { iv: toB64(iv), ct: toB64(ct) };
}

// Decrypt a { iv, ct } blob back to its value. Throws if the key is wrong (GCM auth fails).
export async function decryptJSON(key, blob) {
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(textDec.decode(pt));
}

// Build the metadata stored once per install when encryption is enabled.
// { enabled, salt, iterations, verifier } — salt in base64, verifier is an encrypted
// known string used to validate a passphrase on unlock.
export async function makeEncMeta(passphrase) {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const verifier = await encryptJSON(key, VERIFIER_PLAINTEXT);
  return { meta: { enabled: true, salt: toB64(salt), iterations: PBKDF2_ITERATIONS, verifier }, key };
}

// Derive the key from a passphrase and verify it against stored meta. Resolves with the
// key on success, rejects on a wrong passphrase.
export async function unlockKey(passphrase, meta) {
  const key = await deriveKey(passphrase, fromB64(meta.salt), meta.iterations || PBKDF2_ITERATIONS);
  let ok = false;
  try {
    ok = (await decryptJSON(key, meta.verifier)) === VERIFIER_PLAINTEXT;
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Wrong passphrase");
  return key;
}
