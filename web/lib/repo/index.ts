// lib/repo/index.ts — data layer barrel.

export type {
  Article, Reader, Telemetry, PaymentEvent, PriceHistory, Withdrawal,
  Creator, Piece,
} from './types';

// New architecture repos
export {
  getArticleBySlug, listArticlesByCreator, upsertGhostArticle,
  updateArticlePrice, listActiveArticles,
} from './articles';

export { getReader, ensureReader, recordReaderSpend } from './readers';

// Creator (used by ghost connect/sync and dashboard)
export { getCreator, getCreatorByWallet, createCreator, upsertCreator, updateGhostConnection } from './creators';

// Legacy pieces repo (kept for backward compat with existing dashboard)
export {
  getPiece, getStandingPrice, getStandingPriceWithCreator,
  listPiecesByCreator, listListedPieces, createPiece, updatePiecePrice, updatePieceStatus,
  upsertGhostPiece,
} from './pieces';
