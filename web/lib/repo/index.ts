// lib/repo/index.ts — data layer barrel.

export type {
  Article, Reader, Telemetry, PaymentEvent, PriceHistory, Withdrawal,
  Creator,
} from './types';
export type { PublicCreator } from './creators';
export type { ArticleSearchRow } from './articles';

// New architecture repos
export {
  getArticleBySlug, listArticlesByCreator, upsertGhostArticle,
  updateArticlePrice, listActiveArticles, setArticleMonetization,
  searchArticles,
} from './articles';

export { getReader, ensureReader, recordReaderSpend } from './readers';

// Creator (used by ghost connect/sync and dashboard)
export { getCreator, getCreatorByEoaAddress, createCreator, updateGhostConnection } from './creators';
