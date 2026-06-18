// lib/repo/index.ts — M1 data layer barrel (public interface).
// Import from this barrel; do not import sub-files directly from outside lib/repo/.

export type {
  Creator, Piece, Session, Heartbeat, Payment,
  PriceDecision, TipDecision, Dispute, Job, Notification,
  JobPayload, PricingSweepPayload, ReaderEvalPayload, TipFeedbackPayload,
  SignalBundle, WindowStats,
} from './types';

export { getCreator, getCreatorByWallet, createCreator, upsertCreator } from './creators';

export {
  getPiece, getStandingPrice, getStandingPriceWithCreator,
  listPiecesByCreator, listListedPieces, createPiece, updatePiecePrice, updatePieceStatus,
} from './pieces';

export {
  getSession, createSession, updateSessionDwell, endSession,
  incrementRevisit, getOpenSessions,
} from './sessions';

export { insertHeartbeat, getLastHeartbeat, getHeartbeatsSince } from './heartbeats';

export {
  createPayment, settlePayment, failPayment, getPaymentsByPiece, subscribeToPayments,
  getUnpaidEarnings, markPaymentsPaidOut,
} from './payments';

export {
  createPriceDecision, getRecentPriceDecisions, subscribeToPriceDecisions,
} from './price_decisions';

export {
  createTipDecision, getTipDecision, getTipDecisionBySession, acceptTip, declineTip,
} from './tip_decisions';

export { createDispute, getDisputesByCreator } from './disputes';

export { enqueueJob, getJob } from './jobs';

export {
  createNotification, getUnreadNotifications, markNotificationRead, subscribeToNotifications,
} from './notifications';

export { getSignalBundle } from './signals';
