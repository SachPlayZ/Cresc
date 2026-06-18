// lib/repo/index.ts — M1 data layer barrel (public interface).
// Import from this barrel; do not import sub-files directly from outside lib/repo/.

export type {
  Creator, Piece, Session, Heartbeat, Payment,
  PriceDecision, TipDecision, Dispute, Job, Notification,
  JobPayload, PricingSweepPayload, ReaderEvalPayload, TipFeedbackPayload,
  SignalBundle, WindowStats,
} from './types.js';

export { getCreator, getCreatorByWallet, createCreator, upsertCreator } from './creators.js';

export {
  getPiece, getStandingPrice, listPiecesByCreator, listListedPieces,
  createPiece, updatePiecePrice, updatePieceStatus,
} from './pieces.js';

export {
  getSession, createSession, updateSessionDwell, endSession,
  incrementRevisit, getOpenSessions,
} from './sessions.js';

export { insertHeartbeat, getLastHeartbeat, getHeartbeatsSince } from './heartbeats.js';

export {
  createPayment, settlePayment, failPayment, getPaymentsByPiece, subscribeToPayments,
} from './payments.js';

export {
  createPriceDecision, getRecentPriceDecisions, subscribeToPriceDecisions,
} from './price_decisions.js';

export {
  createTipDecision, getTipDecision, getTipDecisionBySession, acceptTip, declineTip,
} from './tip_decisions.js';

export { createDispute, getDisputesByCreator } from './disputes.js';

export { enqueueJob, getJob } from './jobs.js';

export {
  createNotification, getUnreadNotifications, markNotificationRead, subscribeToNotifications,
} from './notifications.js';

export { getSignalBundle } from './signals.js';
