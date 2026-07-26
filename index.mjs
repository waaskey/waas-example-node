/**
 * Waaskey Node.js quickstart — create a non-custodial MPC wallet and sign, no browser.
 *
 * The flow (verified end-to-end against a live Waaskey backend):
 *   1. load the wasm MPC engine from disk (Node's fetch can't read file paths),
 *   2. pre-generate the Paillier primes with a PrimePool (minutes of CPU — done
 *      off the hot path and persisted, so the actual ceremony takes seconds),
 *   3. create the wallet: this process runs BOTH client parties (device + user_backup)
 *      of the 2-of-3 ceremony; Waaskey's server runs the third,
 *   4. sign a 32-byte digest with the device+server quorum.
 *
 * Required env: WAASKEY_API_KEY (dashboard), SHARE_SECRET (>=16 chars — seals the
 * device share at rest). Optional: WAASKEY_BASE_URL, RECOVERY_EMAIL.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Waaskey, WasmMpcCore, EncryptedShareStore, MemoryKeyValueStore, PrimePool, generateRecoveryCode } from '@waaskey/sdk';

const require = createRequire(import.meta.url);

// Node wasm loader: read the engine bytes from the installed package and initialize with them.
async function loadClientWasmNode() {
  const mod = await import('@waaskey/client-wasm');
  const bytes = await readFile(require.resolve('@waaskey/client-wasm/client_wasm_bg.wasm'));
  await mod.default(await WebAssembly.compile(bytes));
  return mod;
}

// File-backed prime store: a crash or restart never throws away generated primes.
class FilePrimeStore {
  constructor(path) {
    this.path = path;
  }
  #load() {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      return {};
    }
  }
  #save(data) {
    writeFileSync(this.path, JSON.stringify(data));
  }
  async take(curve) {
    const data = this.#load();
    const primes = (data[curve] ?? []).shift();
    this.#save(data);
    return primes;
  }
  async add(curve, primes) {
    const data = this.#load();
    (data[curve] ??= []).push(primes);
    this.#save(data);
  }
  async size(curve) {
    return (this.#load()[curve] ?? []).length;
  }
}

const mpc = new WasmMpcCore(loadClientWasmNode);
const waaskey = new Waaskey({
  apiKey: process.env.WAASKEY_API_KEY,
  baseUrl: process.env.WAASKEY_BASE_URL, // omit for production
  mpc,
  // In-memory for the demo. In a real server, back EncryptedShareStore with your own
  // persistent KeyValueStore (DB/file) — losing the store means recovering via waaskey.recovery.
  shareStore: new EncryptedShareStore(new MemoryKeyValueStore(), process.env.SHARE_SECRET),
  primePool: new PrimePool(mpc, { store: new FilePrimeStore(new URL('./prime-pool.json', import.meta.url).pathname) }),
});

console.log('prewarming the prime pool (first run: several minutes of CPU)…');
console.time('prewarm');
await waaskey.wallets.prewarm('ethereum');
console.timeEnd('prewarm');

// Recovery material sealing the user_backup share — show recoveryCode to the user ONCE.
const backup = {
  recoveryCode: generateRecoveryCode(),
  totpSecret: 'JBSWY3DPEHPK3PXP', // demo TOTP secret — enrol a real authenticator in production
  email: process.env.RECOVERY_EMAIL ?? 'demo@example.com',
};

console.time('create');
const wallet = await waaskey.wallets.create({ chain: 'ethereum' }, { backup, activationTimeoutMs: 300_000 });
console.timeEnd('create');
console.log('wallet:', wallet.id, wallet.address, `nonCustodial=${wallet.isNonCustodial}`);
console.log('recovery code (store it safely!):', backup.recoveryCode);

console.time('sign');
const signature = await wallet.sign('c0ffee'.repeat(10) + 'c0ff'); // any 32-byte hex digest
console.timeEnd('sign');
console.log('signature:', `${String(signature).slice(0, 32)}…`);
