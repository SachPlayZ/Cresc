// src/index.ts — Cresc-Agents entry point.
// Long-running Node.js worker service: consumes jobs queue, dispatches to workers.
// No HTTP server — DB only. (CLAUDE.md §0.5)

// Env: loaded from process.env (Railway injects vars; local dev uses tsx --env-file=../.env.local).
import { validateAgentConfig } from './config.js';
import { createServerClient } from './db.js';
import { startConsumer, registerWorker } from './queue/consumer.js';
import { makePricingWorker, startPricingClock } from './workers/pricing.js';
import { makeReaderWorker } from './workers/reader.js';
import { makeTipFeedbackWorker } from './workers/tipFeedback.js';

async function main() {
  validateAgentConfig();

  const db = createServerClient();

  registerWorker('pricing_sweep', makePricingWorker(db));
  registerWorker('reader_eval', makeReaderWorker(db));
  registerWorker('tip_feedback', makeTipFeedbackWorker(db));

  // Start the PricingAgent clock: sweeps all listed pieces on startup + every SWEEP_INTERVAL_MINUTES.
  // This is independent of the job queue — the clock is the primary driver of routine sweeps.
  startPricingClock(db);

  await startConsumer(db);
}

main().catch((err) => {
  console.error('[cresc-agents] fatal:', err);
  process.exit(1);
});
