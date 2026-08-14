# Transcend

Verified capital for African MSMEs, built on [Arc](https://docs.arc.network) — a USDC-native,
sub-second-finality L1.

Transcend connects investors to established small businesses on a milestone-gated,
capped revenue-share basis. Instead of handing a business a lump sum and hoping,
capital releases in tranches — each one confirmed by an independent verifier, and
often by the on-chain counterparty fulfilling it — before investors vote to
release it.

This README covers: what's actually built, why it's built this way, what's still a
known gap, and how to run it.

---

## Why Arc

- **USDC is the native gas token.** Investors and businesses transact directly in
  USDC — no wrapped-asset detour, no bridging risk for the core flow.
- **Sub-second finality.** A milestone approval or a repayment settles immediately,
  not after a multi-day float sits between "investor sent money" and "it's secured."
- **Predictable, cheap gas** (EIP-1559 + EWMA smoothing, ~$0.01/tx target) makes
  frequent, small on-chain actions — like milestone confirmations — actually viable
  for a retail-scale MSME platform, not just large institutional transfers.

---

## Architecture

```
contracts/   Solidity: BusinessRegistry + InvestmentPool (the escrow/deal engine)
backend/     Express + SQLite: indexes on-chain events, serves a REST API,
             and holds the off-chain "private ledger" (pitch text, photos)
frontend/    Vite + React + viem: marketplace, deal detail, business &
             verifier dashboards
```

### Two ledgers, deliberately

- **Public, on-chain ledger** (the contracts): identity hashes, verification
  status, milestone evidence *hashes*, attestations, fund movements, repayment
  events. Anyone can audit it; it contains no raw personal or commercially
  sensitive data.
- **Private, off-chain ledger** (the backend's `profiles` table): pitch text,
  photos, descriptions — anything a business wants to *show* investors, gated by a
  wallet-signature proof of ownership (`backend/src/auth.js`), not a password the
  platform has to custody.

This split means the contract never has to store (or leak) a document, and the
backend never has to be trusted for the money-movement logic — it's a read cache and
a UI convenience layer, not a source of truth.

---

## The investor-protection model

No on-chain mechanism can cryptographically prove a real-world receipt is genuine —
this is the same wall every real-world-asset lending protocol hits (Goldfinch,
Maple, Centrifuge all solve it with human backers/originators, not magic). Transcend
doesn't pretend otherwise. What the contract *can* do is control how much money is
exposed before independent confirmation happens, and raise the bar exactly where
verification gets weaker.

**Layer 1 — Identity.** A business can register freely, but can't raise until an
admin/verifier confirms it reviewed real documents (e.g. CAC registration).

**Layer 2 — Sybil resistance.** A hashed registration number can only ever bind to
one wallet — a defaulted business can't just re-register under a new address.

**Layer 3 — Milestone escrow with independent, tiered verification.**
Capital never releases as a lump sum.
- The business submits an evidence hash (globally unique — no reusing one real
  receipt to justify two different tranches).
- An independent, registry-appointed verifier must attest before investors can even
  vote. If a deal has an assigned verifier, only that address may attest — no
  self-selecting friendly deals out of an open pool. Milestones above an
  admin-configurable threshold require **two** distinct verifiers (a lightweight
  multisig-committee rule for high-value releases).
- **Traceable vs. untraceable payees.** If a milestone's payee is itself a
  registered on-chain business (e.g. a supplier), *that payee* must independently
  confirm receipt — a second, non-fakeable on-chain action from a party with no
  reason to collude — and release only needs a simple majority investor vote.
  If the payee is the business itself or any unregistered wallet — the actual
  moment money exits anything we can keep tracking — release requires a
  **supermajority** (two-thirds of raised weight). The safe, easy path is
  structurally the one that stays traceable.

**Layer 4 — Collateral + reputation, with real teeth.**
- The business posts a **minimum 10% USDC first-loss bond** before any investor money moves; forfeited
  pro-rata to investors on default.
- Raise caps grow only with a track record of *completed* deals — reputation
  tiers (Unverified → New → Trusted → Established).
- A default freezes the business (manual admin unfreeze required) **and** dents
  every attesting verifier's own on-chain track record — a verifier who keeps
  rubber-stamping bad deals becomes visibly unreliable.
- Every disbursement is tagged traceable/untraceable and accumulated per business,
  so investors can see for themselves what fraction of a business's capital has
  historically stayed inside auditable rails.

**Accountable supplier references — not upvotes.** Supplier status is a separate
admin-granted credential—ordinary verified merchants cannot endorse each other. A supplier must be a verified,
unfrozen business and commit unique evidence of at least a three-month trading
relationship. References expire, are capped at eight per merchant and must disclose
related ownership; a related-party reference stays visible but has zero weight. The
supplier's score depends on its own completed/defaulted deals and every
merchant default later linked to its endorsements. This makes collusion attributable
and costly, but not impossible. Responsible revocation stays auditable but is not
penalised, so suppliers have an incentive to flag concerns early. The signal never
replaces independent verification.

**Anti-collusion, investor side.** The business cannot invest in its own raise. No
single investor can hold more than 40% of a deal — which mathematically forces at
least 3 genuinely distinct funders before a deal can even activate, raising the cost
of a self-funding attack from "one wallet" to "a coordinated Sybil ring."

**Verifier-attested collections, not self-declared profit.** For every reporting
period, the merchant commits gross-collection evidence. An assigned independent
verifier attests it, then the contract computes the exact investor distribution from
the agreed basis points. The merchant cannot choose an arbitrary remittance amount.

**Capped, not open-ended, returns.** A deal can set a total-distribution ceiling;
completion triggers the moment that's hit, independent of the repayment schedule —
investors know their maximum return upfront (a capped revenue-share structure, not
an open-ended profit share that's trivially easy to misreport).

**Emergency brake.** Admin can pause an in-progress deal's entire milestone pipeline
instantly on a fraud signal, without waiting for a full missed-payment default.

All of this is exercised in `contracts/test/Transcend.test.js` — 23 tests covering
the full lifecycle plus every mechanism above, including the specific attacks each
one closes (self-funding, evidence-hash reuse, verifier self-selection, bare-majority
exits to untraceable wallets).

### What's real, and what's explicitly not solved here

Money staying on traceable rails only works if the *counterparties* are also
on-chain. Today, most Nigerian informal retail isn't. Transcend doesn't require
that on day one — it makes the traceable path structurally easier and cheaper,
which is the actual mechanism that pulls suppliers on-chain over time, rather than
mandating something unrealistic at launch.

**Explicitly out of scope for a smart contract, and not built here:**
- Live bank/POS/inventory integrations and revenue-diversion detection
- Full related-party graph analysis (shared directors, devices, bank accounts and
  beneficial owners). Self-disclosure is enforced today; automated discovery is not.
- Licensed crowdfunding-intermediary status, custodianship, insurance partnerships
- Legal enforceability of the off-chain agreement, recovery/dispute process,
  jurisdiction and arbitration terms
- Investor-side KYC (true Sybil resistance beyond the 40%-share/3-investor rule
  needs this — a real product/compliance decision, not a contract tweak)
- A verifier or supplier bond/slashing mechanism (both currently have reputational,
  not financial, skin in the game)

These are real gaps, not oversights, and they need data partners, legal counsel, and
a regulatory strategy — not more Solidity. A production launch should treat this
repo as the money-custody and verification-workflow layer of a larger system, not
the whole system.

---

## Running it locally

Requires Node 18+. All three services run independently; start them in this order.

### 1. Contracts — local chain + deploy + seed

```bash
cd contracts
npm install
node scripts/compile.js          # uses npm solc (JS/WASM), not a native binary download
npx hardhat node                 # in its own terminal — leave running
```

In a second terminal:

```bash
cd contracts
npx hardhat run scripts/deploy-local.js --network localhost --no-compile
```

This deploys `MockUSDC` + `BusinessRegistry` + `InvestmentPool`, registers a demo
verifier/business/supplier, and seeds one partially-funded demo deal. It writes
`backend/deployment.local.json` so the backend auto-discovers the addresses.

Run the test suite any time with:

```bash
npm run test   # compiles then runs all 23 tests
```

### 2. Backend — indexer + API

```bash
cd backend
npm install
node index.js
```

Serves on `:4000`. `GET /config` reports the live chain/contract addresses (this is
what the frontend calls on load — no env vars needed for local dev).

Run `npm test` for backend syntax validation.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Serves on `:5173`. Connect an injected wallet (MetaMask) pointed at the local chain
(chain ID `31337`, RPC `http://127.0.0.1:8545`) — the app will prompt to add/switch
automatically. Import one of the Hardhat node's default dev accounts to act as the
seeded business, supplier, verifier, or investors (private keys are printed in the
`hardhat node` terminal output — well-known, dev-only, never use on a real network).

---

## Deploying to Arc Testnet

Arc Testnet: chain ID `5042002`, RPC `https://rpc.testnet.arc.io`, explorer
[testnet.arcscan.app](https://testnet.arcscan.app), faucet
[faucet.circle.com](https://faucet.circle.com). USDC ERC-20 interface (6 decimals):
`0x3600000000000000000000000000000000000000`.

```bash
cd contracts
PRIVATE_KEY=0x... npm run deploy:arc-testnet
```

Then point the backend and frontend at the deployed addresses instead of the local
seed file — see `backend/.env.example` and set matching `VITE_*` vars for the
frontend build.

---

## Repo layout reference

```
contracts/
  contracts/BusinessRegistry.sol   identity, Sybil resistance, verifiers, reputation
  contracts/InvestmentPool.sol     escrow/deal engine — the core safety logic
  scripts/deploy.js                Arc Testnet deploy
  scripts/deploy-local.js          local Hardhat node deploy + demo seed
  scripts/compile.js               solc-js compile (bypasses blocked native binary download)
  test/Transcend.test.js           23 tests, lifecycle + adversarial control cases

backend/
  src/db.js          SQLite schema (the indexed public-ledger cache)
  src/chain.js        viem client, ABI loading, address resolution
  src/indexer.js       polls on-chain logs, refetches full struct state, upserts
  src/auth.js          wallet-signature verification for the profile endpoint
  src/routes/          businesses, deals, verifiers, profiles
  index.js             Express app entrypoint

frontend/
  src/lib/chain.js      runtime config (fetched from backend /config), viem setup
  src/lib/contracts.js  all contract write actions (invest, attest, confirm, etc.)
  src/lib/api.js        backend REST client
  src/components/       Marketplace, DealDetail, BusinessDashboard, VerifierDashboard
```
