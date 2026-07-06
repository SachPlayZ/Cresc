# Cresc — Contract-Native Architecture

*Pay-per-article monetization for Ghost, settled in USDC on Arc via Circle Gateway + x402.*
*Deployment: Next.js frontend on Vercel, always-on agents on EC2, per-content contracts on Arc.*

The new core primitive is **one onchain content contract per Ghost post**. A Ghost webhook hits the EC2 agent; the agent calls a factory contract; the factory deploys a small content vault for that post. That vault stores content metadata, current price, owner/tuner permissions, and receives all Gateway payments for that specific post.

Example:

- Content A contract price = `$0.05` (`50000` atomic USDC). 10 readers pay. Contract A receives `500000`.
- Content B contract price = `$0.02` (`20000` atomic USDC). 20 readers pay. Contract B receives `400000`.
- Gateway batches EIP-3009 authorizations and settles each payment to the `payTo` contract for that content.
- The creator withdraws from each content contract, or through a dashboard action that batches withdrawals.

The architecture doc is the source of truth. If repo comments or README text disagree, this file wins.

---

## 1. Non-Negotiable Invariants

1. **The x402 buyer is a raw-key EOA.** Gateway verifies payment signatures with `ecrecover`, so SCA/EIP-1271 signatures do not work for nanopayments. `BUYER_PRIVATE_KEY` is the raw x402 payment key and lives only on EC2.
2. **Creators do not need seller raw keys.** Creator wallets stay Circle dev-controlled/user-controlled. They receive withdrawals; they do not sign x402 authorizations.
3. **Each monetized post has a content contract.** The content contract is the x402 `payTo`, the price source of truth, and the USDC balance bucket for that post.
4. **Pricing is tuned onchain.** The agent may compute a new price offchain, but the authoritative price update is a cheap `tunePrice(...)` transaction on the content contract.
5. **Money is atomic 6dp USDC.** `$0.05 = 50000`. No floats in storage or contracts. Native Arc USDC is 18dp only for gas accounting; app amounts use ERC-20 6dp.
6. **`ARC_RPC_URL` is secret.** EC2 env + Vercel encrypted env only. Never `NEXT_PUBLIC_*`.
7. **Single buyer nonce writer.** Run exactly one Reader Agent instance per buyer EOA, or shard readers across buyer keys.
8. **`payment_events` remains append-only.** It mirrors settlement for dashboards and idempotency, but contract balances are the payout source of truth.
9. **Idempotency.** Key unlock attempts by `(reader_id, content_contract, request_id)` and check `payment_events` before signing.

---

## 2. System At A Glance

| Plane | Owner | Runs on | Role |
|---|---|---|---|
| Ghost ingest | Creator + Ghost | Ghost → EC2 agent | Emits post webhook to agent |
| Content factory | Cresc protocol | Arc | Deploys one content contract per post |
| Content contract | Creator-owned | Arc | Stores metadata, price, revenue, withdrawal rules |
| Reader Agent | Cresc | EC2 | Decides pay/skip, signs x402 buyer auth |
| Pricing Agent | Cresc | EC2 | Audits demand, calls `tunePrice` on content contracts |
| Frontend + x402 seller | Cresc | Vercel | Serves gate, builds `PAYMENT-REQUIRED`, verifies/settles |
| Settlement | Circle Gateway | Circle + Arc | Batches EIP-3009 authorizations into Arc USDC transfers |

Critical shift:

- Old model: `articles.current_price_atomic` in Postgres, `payTo = creator EOA`.
- New model: `ContentVault.priceAtomic()` onchain, `payTo = content contract`.

---

## 3. Contract Model

### `ContentFactory`

Deployed once on Arc.

Responsibilities:

- Deploy a minimal content contract for every Ghost post.
- Enforce deterministic uniqueness by `contentId = keccak256(creatorId, ghostPostId || slug)`.
- Emit `ContentCreated(contentId, contentContract, creator, initialPriceAtomic, metadataURI)`.
- Store `contentId → contentContract` lookup.
- Optionally deploy with CREATE2 for predictable addresses.

Expected interface:

```solidity
function createContent(
    bytes32 contentId,
    address creator,
    uint256 initialPriceAtomic,
    string calldata metadataURI,
    bytes32 metadataHash,
    address priceTuner
) external returns (address contentContract);
```

### `ContentVault`

One per post.

Stores:

- `contentId`
- `creator`
- `metadataURI` (Ghost canonical URL, S3 JSON, or IPFS URI)
- `metadataHash`
- `priceAtomic`
- `priceTuner`
- `active`
- `totalReceivedAtomic`

Core functions:

```solidity
function priceAtomic() external view returns (uint256);
function metadata() external view returns (string memory uri, bytes32 hash);
function tunePrice(uint256 newPriceAtomic, bytes32 reasonHash) external;
function withdraw(address to, uint256 amountAtomic) external;
function withdrawAll(address to) external;
```

Rules:

- `tunePrice` is callable only by `priceTuner` or an authorized agent role.
- `withdraw*` is callable only by the creator or a creator-authorized payout operator.
- Price is clamped onchain: `PRICE_MIN_ATOMIC <= newPrice <= PRICE_MAX_ATOMIC`.
- Optional volatility clamp onchain: e.g. max ±20% per tuning window.
- The contract holds Arc USDC ERC-20. Gateway settlements transfer USDC to the contract address.
- Contract never accepts price values in dollars or 18dp native units.

### Metadata

Metadata should be enough to prove which content the contract represents:

```json
{
  "creator_id": "0x...",
  "ghost_post_id": "...",
  "slug": "my-post",
  "canonical_url": "https://creator.ghost.io/my-post",
  "title": "...",
  "excerpt_hash": "0x...",
  "created_at": "ISO-8601"
}
```

Store the full JSON in S3/IPFS; store URI + hash onchain.

---

## 4. Deployment Topology

### EC2 Agent Service

Always-on Express service behind HMAC auth.

Owns:

- Ghost webhook receiver: `POST /agent/ghost/webhook`.
- Content deployment: calls `ContentFactory.createContent`.
- Reader Agent: budget gates, Groq quality/interest/confidence, x402 `GatewayClient.pay`.
- Pricing Agent: audits telemetry and calls `ContentVault.tunePrice`.
- Withdrawal orchestration when dashboard asks to withdraw.
- Gateway deposit/redeposit loop for the buyer EOA.

Signing model:

- Buyer x402 payment: raw `BUYER_PRIVATE_KEY`, EC2 only.
- Factory/tune/withdraw orchestration: prefer Circle-controlled operational wallet via SDK transaction APIs. If a raw protocol admin key is used for hackathon speed, keep it EC2-only and separate from `BUYER_PRIVATE_KEY`.

### Vercel

Stateless app, no hot payment key.

Owns:

- Creator dashboard.
- Reader gate and `/read?slug=...`.
- x402 route: reads content contract address + onchain price, builds `PAYMENT-REQUIRED`, verifies/settles via facilitator.
- Ghost snippet status endpoint.
- Dashboard reads from Postgres plus onchain contract state.

### Arc

Owns source of truth for:

- Content registry.
- Per-content price.
- Per-content USDC balances.
- Creator withdrawal availability.

Postgres remains an index/cache/event log, not the source of truth for price or earned balance.

---

## 5. End-To-End Flows

### Flow A — New Ghost Post

```
Creator publishes in Ghost
  → Ghost webhook POST /agent/ghost/webhook (EC2)
  → Agent validates Ghost HMAC
  → Agent normalizes metadata + initial price
  → Agent calls ContentFactory.createContent(...)
  → Factory deploys ContentVault for that post
  → Agent stores content_contract in Postgres index
  → Vercel/Ghost snippet can now show "Unlock for $X"
```

Postgres row after deployment:

- `slug`
- `creator_id`
- `ghost_post_id`
- `content_id`
- `content_contract`
- `metadata_uri`
- `metadata_hash`
- `last_seen_price_atomic` cache
- `factory_tx`

If the webhook is retried, agent checks `contentId → contentContract` first and returns the existing contract.

### Flow B — Reader Unlock

```
Reader opens Ghost article
  → Ghost snippet calls Vercel post-status
  → Vercel finds content_contract
  → Vercel reads ContentVault.priceAtomic()
  → Vercel asks EC2 Reader Agent to evaluate/pay
  → Reader Agent passes budget + quality gates
  → Agent calls GatewayClient.pay(unlock_url)
  → Vercel x402 route returns 402 PAYMENT-REQUIRED
      payTo = content_contract
      amount = ContentVault.priceAtomic()
  → Agent signs EIP-3009 and retries
  → Facilitator verify/settle
  → Gateway settlement transfers USDC to content_contract
  → Vercel writes payment_events row
  → Unlock token returned; content served
```

The content contract, not the creator wallet, receives the payment. The creator withdraws later.

### Flow C — Onchain Price Tuning

```
Telemetry lands in Postgres/S3
  → Audit Agent filters bot/self/low-quality events
  → Pricing Agent computes target price
  → Pricing Agent calls ContentVault.tunePrice(newPriceAtomic, reasonHash)
  → Contract emits PriceTuned(oldPrice, newPrice, reasonHash)
  → Postgres caches latest price for fast UI
```

The calculation may be offchain. The actual mutation is onchain.

Suggested pricing function:

```
demand = W_VIEWS*norm(views_24h)
       + W_DWELL*norm(avg_dwell_24h)
       + W_TIPS*norm(tips_24h)

target = round(base_price_atomic * (0.5 + demand))
target = clamp(target, PRICE_MIN_ATOMIC, PRICE_MAX_ATOMIC)
target = clamp(target, prev*0.8, prev*1.2)
```

Onchain `tunePrice` should enforce min/max and optional volatility bounds so a bad agent cannot push absurd prices.

### Flow D — Creator Withdraw

```
Creator clicks withdraw in dashboard
  → Vercel calls EC2 /agent/withdraw-content
  → Agent verifies creator owns content contract / authorized payout path
  → ContentVault.withdraw(to, amountAtomic)
  → USDC transfers from content contract to creator wallet
  → withdrawal row recorded
```

For cross-chain payout, use Circle Gateway/CCTP V2 after the contract withdraws to an Arc wallet that can initiate the burn/mint flow.

---

## 6. x402 Payment Requirements

For every paid read, Vercel builds requirements from the content contract:

```txt
scheme: exact
network: eip155:5042002
asset: Arc USDC ERC-20
amount: ContentVault.priceAtomic()
payTo: ContentVault address
maxTimeoutSeconds: 345600
extra:
  name: GatewayWalletBatched
  version: "1"
  verifyingContract: GATEWAY_WALLET_ADDRESS
```

Gateway can batch many signed authorizations, even when `payTo` differs per content contract. Settlement credits each `payTo`.

---

## 7. Agent Decision Logic

Reader Agent stays mostly unchanged.

Gates:

1. Budget: fail if `spent_today + price > daily_budget` or `spent_session + price > session_budget`.
2. Quality: Groq JSON score `0..1`.
3. Interest: Groq JSON score `0..1`.
4. Confidence: Groq JSON score `0..100`.

Decision:

```txt
pay iff budget_ok
  and quality >= QUALITY_MIN
  and interest >= INTEREST_MIN
  and confidence >= CONFIDENCE_MIN
```

Inputs now include `content_contract`, `metadataHash`, and `priceAtomic()` read from chain/cache.

Mock mode: no `GROQ_API_KEY` means deterministic pass scores so the rail can be tested.

---

## 8. Datastore

Postgres indexes the onchain system.

- `creators` (user_id, circle_wallet_id, wallet_address, ghost_url, ghost_key_enc)
- `readers` (user_id, daily_budget_atomic, session_budget_atomic, spent_today_atomic, spent_session_atomic, session_reset_at)
- `articles` (slug, creator_id, ghost_post_id, content_id, content_contract, metadata_uri, metadata_hash, last_seen_price_atomic, factory_tx, active)
- `telemetry` (content_contract, reader_id, event_type, dwell_ms, ip_hash, ts)
- `telemetry_audited` (content_contract, window_start, views, avg_dwell_ms, tips_atomic, authentic_fraction)
- `payment_events` (endpoint, payer, pay_to, amount_usdc text, network, gateway_tx, reader_id, content_contract, request_id, raw)
- `price_history` (content_contract, old_price_atomic, new_price_atomic, reason_hash, tune_tx, ts)
- `withdrawals` (content_contract, amount_atomic, destination_chain, destination_address, status, tx_hash)
- `contract_deployments` (content_id, content_contract, factory, tx_hash, status, raw)

Stored procedures:

- `record_reader_spend(p_user_id, p_amount)`
- `reset_daily_budgets()`

Do not use Postgres price as authority. It is cache/UI only.

---

## 9. Contract Events To Index

```solidity
event ContentCreated(
    bytes32 indexed contentId,
    address indexed contentContract,
    address indexed creator,
    uint256 initialPriceAtomic,
    string metadataURI
);

event PriceTuned(
    uint256 oldPriceAtomic,
    uint256 newPriceAtomic,
    bytes32 indexed reasonHash
);

event Withdrawn(
    address indexed creator,
    address indexed to,
    uint256 amountAtomic
);
```

Optional:

```solidity
event PaymentObserved(address indexed payer, uint256 amountAtomic, bytes32 indexed requestId);
```

Gateway transfers may not call a hook on the content contract, so do not rely on `PaymentObserved` unless you explicitly add a settlement adapter. Use ERC-20 `Transfer` logs and `payment_events` for accounting.

---

## 10. Security

- Factory must prevent duplicate content contracts for the same `contentId`.
- `tunePrice` must be role-gated and bounded.
- Withdrawals must be creator-gated.
- Content contracts should use standard OpenZeppelin guards: `SafeERC20`, `ReentrancyGuard`, `Ownable`/`AccessControl`.
- Never allow arbitrary token withdrawal unless explicitly admin-only recovery; normal withdraw is Arc USDC only.
- Keep `BUYER_PRIVATE_KEY` separate from any protocol admin/tuner signer.
- HMAC all Vercel ↔ EC2 calls.
- Validate Ghost webhook signatures.
- Read `USDC.decimals()` and assert 6 at startup.
- Read `chainId` and assert Arc testnet/mainnet expected value.

---

## 11. Stack

- Frontend + x402 seller: Next.js on Vercel.
- Agents: Node/TS on EC2, Express, systemd.
- Buyer signing: `viem` + `@circle-fin/x402-batching`, raw `BUYER_PRIVATE_KEY`.
- Contract deployment/tuning: `viem` or Circle SDK transaction APIs against `ContentFactory` / `ContentVault`.
- Contracts: Solidity + OpenZeppelin, deployed on Arc.
- State/cache: Supabase Postgres.
- Metadata/content blobs: S3 or IPFS.
- LLM: Groq OpenAI-compatible API. No key → mock mode.
- Cross-chain payout: CCTP V2/Gateway after Arc withdrawal.

---

## 12. Arc Testnet Constants

Read from env where possible; do not blindly hardcode in app code.

```txt
ARC_CHAIN_ID / CAIP-2: 5042002 / eip155:5042002
ARC_SDK_CHAIN: arcTestnet
USDC ERC-20: 0x3600000000000000000000000000000000000000
Gateway Wallet: 0x0077777d7EBA4688BDeF3E311b846F25870A19B9
Gateway Minter: 0x0022222ABE238Cc2C7Bb1f21003F0a260052475B
Facilitator API: https://gateway-api-testnet.circle.com
RPC: ARC_RPC_URL, secret
```

---

## 13. Environment Manifest

Shared:

- `INTERNAL_HMAC_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ARC_CAIP2`
- `USDC_ADDRESS`
- `GATEWAY_WALLET_ADDRESS`
- `CONTENT_FACTORY_ADDRESS`

Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EC2_AGENT_BASE_URL`
- `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID`, `NEXT_PUBLIC_CIRCLE_GOOGLE_CLIENT_ID` (UCW creator wallets)
- `GHOST_KEY_ENCRYPTION_SECRET`

EC2:

- `ARC_RPC_URL`
- `ARC_SDK_CHAIN`
- `BUYER_PRIVATE_KEY`
- `CONTENT_TUNER_PRIVATE_KEY` (relays creator-signed withdrawals + calls `tunePrice`; treat as a hot admin key — EC2 only, never Vercel, never client)
- `CONTENT_FACTORY_ADDRESS`
- `GROQ_API_KEY`
- `GROQ_BASE_URL`
- `GROQ_MODEL`
- `QUALITY_MIN`
- `INTEREST_MIN`
- `CONFIDENCE_MIN`
- `PRICE_MIN_ATOMIC`
- `PRICE_MAX_ATOMIC`
- `W_VIEWS`
- `W_DWELL`
- `W_TIPS`

---

## 14. Build Order

1. Write and test `ContentFactory` + `ContentVault`.
2. Deploy factory to Arc testnet.
3. Change Ghost webhook path to EC2 agent → factory deploy → Postgres index.
4. Change x402 seller route to use `payTo = content_contract` and `amount = priceAtomic()`.
5. Change Reader Agent request/response to include `content_contract`.
6. Replace off-chain Watcher writes with Pricing Agent `tunePrice` txs.
7. Build creator withdraw from content contracts.
8. Add indexer jobs for `ContentCreated`, `PriceTuned`, ERC-20 transfers, and withdrawals.
9. Verify happy path with two posts at different prices and separate balances.

---

## 15. Verification Scenario

Use two Ghost posts:

- Content A initial price `50000`.
- Content B initial price `20000`.

Expected:

- Webhook creates two distinct content contracts.
- x402 requirements for A use `payTo = contractA`, `amount = 50000`.
- x402 requirements for B use `payTo = contractB`, `amount = 20000`.
- 10 paid reads of A produce contract A USDC balance `500000`.
- 20 paid reads of B produce contract B USDC balance `400000`.
- Pricing Agent can call `contractA.tunePrice(...)` without touching B.
- Creator can withdraw from A and B independently.
