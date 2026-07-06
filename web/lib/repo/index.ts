// lib/repo/index.ts — data layer barrel.

export type {
  Article, Reader, Telemetry, PaymentEvent, PriceHistory, Withdrawal,
  Creator,
} from './types';
export type { PublicCreator } from './creators';

// New architecture repos
export {
  getArticleBySlug, listArticlesByCreator, upsertGhostArticle,
  updateArticlePrice, listActiveArticles,
} from './articles';

export { getReader, ensureReader, recordReaderSpend } from './readers';

// Creator (used by ghost connect/sync and dashboard)
export { getCreator, getCreatorByEoaAddress, createCreator, updateGhostConnection } from './creators';
