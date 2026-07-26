# Node.js quickstart

Create a non-custodial MPC wallet and sign a digest from a plain Node ≥ 22 process — no browser.

```bash
cp .env.example .env.local   # fill in your key
export $(grep -v '^#' .env.local | xargs)
pnpm start
```

The first run pre-generates the Paillier primes (several minutes of CPU, persisted to
`prime-pool.json`); after that, wallet creation takes seconds. The device share is sealed
(AES-256-GCM keyed from `SHARE_SECRET`) — here into memory for the demo; use your own
persistent `KeyValueStore` in a real server.

> **Note:** requires `@waaskey/sdk` ≥ 0.2.1 (the 0.2.0 `PrimePool` auto-refill stalls
> single-threaded ceremonies); the pin here is bumped as soon as 0.2.1 is on npm.
