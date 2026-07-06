# Content Contracts Deploy

## Prereqs

- Arc RPC in `ARC_RPC_URL`.
- USDC address in `USDC_ADDRESS`.
- Multisig or EC2 operator owner in `CONTENT_FACTORY_OWNER`.
- Foundry keystore account configured locally. Do not use plaintext private-key env vars.

## Deploy Factory

```bash
forge script contracts/script/DeployContentFactory.s.sol \
  --rpc-url "$ARC_RPC_URL" \
  --account "$FOUNDRY_ACCOUNT" \
  --sender "$CONTENT_FACTORY_OWNER" \
  --broadcast
```

Set the deployed address on EC2:

```bash
CONTENT_FACTORY_ADDRESS=0x...
CONTENT_TUNER_PRIVATE_KEY=0x... # EC2 only
CONTENT_TUNER_ADDRESS=0x...
```

## Verify Before Live

```bash
forge test -vvv
forge build --sizes
```

Run a real staging smoke after DB migration and Ghost sync:

```bash
cd agents
npm run smoke:staging
npm run smoke:staging -- --pay
```

## Audit Status

These contracts have unit coverage and compile-size checks, but no third-party audit yet.
Run `slither` or `aderyn` before mainnet/prod value.
