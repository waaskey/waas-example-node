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
 * Required env: WAASKEY_API_KEY (dashboard), WAASKEY_BASE_URL (your deployment's API
 * origin, including /api — there is no default and no public sandbox), SHARE_SECRET
 * (>=16 chars — seals the device share at rest). Optional: RECOVERY_EMAIL.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Waaskey, EncryptedShareStore, MemoryKeyValueStore, PrimePool, generateRecoveryCode } from '@waaskey/sdk';
import { NodeWorkerMpcCore } from '@waaskey/sdk/node';

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

/**
 * Read a required variable, or stop with a line that names it.
 *
 * A quickstart's job is to teach, and an unset variable otherwise surfaces far from its
 * cause — as a constructor error, or (worse, before the SDK required a base URL) as a
 * network failure on every call.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env.local, fill it in, and export it — see the README.`);
    process.exit(1);
  }
  return value;
}

// Worker-thread MPC core (waas-sdk#82): the wasm computes in a worker while the relay
// WebSocket stays responsive (and pinging) on the main thread.
const mpc = new NodeWorkerMpcCore();
const waaskey = new Waaskey({
  apiKey: requireEnv('WAASKEY_API_KEY'),
  // Required: the SDK has no default base URL (the old one pointed at a host that does
  // not resolve), and there is no public sandbox — point this at your own deployment.
  baseUrl: requireEnv('WAASKEY_BASE_URL'),
  mpc,
  // In-memory for the demo. In a real server, back EncryptedShareStore with your own
  // persistent KeyValueStore (DB/file) — losing the store means recovering via waaskey.recovery.
  shareStore: new EncryptedShareStore(new MemoryKeyValueStore(), requireEnv('SHARE_SECRET')),
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
await mpc.terminate(); // the worker keeps the process alive until terminated
