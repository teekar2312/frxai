-- ============================================================
-- FINEX Indonesia — PostgreSQL Migration
-- Converted from SQLite: REAL → NUMERIC/DECIMAL for financial precision
-- TradingConfig now multi-tenant (userId FK, unique per user)
--
-- Apply with: prisma migrate dev --schema=prisma/schema.postgres.prisma
-- Or raw:    psql $DATABASE_URL -f prisma/migrations/postgres_init/migration.sql
-- ============================================================

-- CreateTable: users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user_two_factor
CREATE TABLE "user_two_factor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable: trading_positions
CREATE TABLE "trading_positions" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "lotSize" DECIMAL(10,2) NOT NULL,
    "entryPrice" DECIMAL(18,5) NOT NULL,
    "currentPrice" DECIMAL(18,5),
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "trailingStop" DECIMAL(18,5),
    "trailingType" TEXT NOT NULL DEFAULT 'manual',
    "pipValue" DECIMAL(18,5),
    "riskAmount" DECIMAL(18,2),
    "rewardAmount" DECIMAL(18,2),
    "pnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pnlPips" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "strategy" TEXT,
    "marketCondition" TEXT,
    "aiConfidence" DECIMAL(5,4),
    "riskLevel" TEXT,
    "aiRecommendation" TEXT,
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "commission" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trading_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pending_orders
CREATE TABLE "pending_orders" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "lotSize" DECIMAL(10,2) NOT NULL,
    "price" DECIMAL(18,5) NOT NULL,
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "strategy" TEXT,
    "aiConfidence" DECIMAL(5,4),
    "riskLevel" TEXT,
    "aiRecommendation" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "executedPrice" DECIMAL(18,5),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pending_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: price_alerts
CREATE TABLE "price_alerts" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "targetPrice" DECIMAL(18,5) NOT NULL,
    "currentPrice" DECIMAL(18,5),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTriggered" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" TIMESTAMP(3),
    "note" TEXT,
    "emailNotify" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: activity_logs
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "category" TEXT NOT NULL DEFAULT 'general',
    "message" TEXT NOT NULL,
    "details" TEXT,
    "pair" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ai_analyses
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "marketCondition" TEXT NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "strategyUsed" TEXT,
    "indicatorsUsed" TEXT,
    "newsImpact" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "entryPrice" DECIMAL(18,5),
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "lotSize" DECIMAL(10,2),
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "timeframes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: backtest_results
CREATE TABLE "backtest_results" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "initialBalance" DECIMAL(18,2) NOT NULL,
    "finalBalance" DECIMAL(18,2) NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winningTrades" INTEGER NOT NULL,
    "losingTrades" INTEGER NOT NULL,
    "winRate" DECIMAL(5,4) NOT NULL,
    "totalPnl" DECIMAL(18,2) NOT NULL,
    "maxDrawdown" DECIMAL(8,4) NOT NULL,
    "sharpeRatio" DECIMAL(10,4),
    "profitFactor" DECIMAL(10,4),
    "avgWin" DECIMAL(18,2),
    "avgLoss" DECIMAL(18,2),
    "maxConsecutiveWins" INTEGER,
    "maxConsecutiveLosses" INTEGER,
    "parameters" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backtest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: news_items
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "category" TEXT,
    "pair" TEXT,
    "impact" TEXT,
    "sentiment" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: trading_configs (MULTI-TENANT)
-- userId=NULL → system-wide default config
-- userId=XYZ  → per-user override config
CREATE TABLE "trading_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "riskPerTrade" DECIMAL(5,2) NOT NULL DEFAULT 0.75,
    "stopLossMin" DECIMAL(10,2) NOT NULL DEFAULT 5,
    "stopLossMax" DECIMAL(10,2) NOT NULL DEFAULT 15,
    "riskRewardRatio" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 3,
    "minLot" DECIMAL(10,2) NOT NULL DEFAULT 0.01,
    "maxLotPerOrder" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "dailyRiskLimit" DECIMAL(5,2) NOT NULL DEFAULT 2.5,
    "dailyTargetMin" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "dailyTargetMax" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "spreadPip" DECIMAL(10,2) NOT NULL DEFAULT 0.5,
    "commissionPerLot" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "marginCallLevel" INTEGER NOT NULL DEFAULT 50,
    "stopOutLevel" INTEGER NOT NULL DEFAULT 20,
    "autoTrading" BOOLEAN NOT NULL DEFAULT false,
    "autoTrailingStop" BOOLEAN NOT NULL DEFAULT false,
    "trailingStopPips" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "avoidNewsTrading" BOOLEAN NOT NULL DEFAULT true,
    "accountBalance" DECIMAL(18,2) NOT NULL DEFAULT 10000,
    "aiProvider" TEXT NOT NULL DEFAULT 'zai',
    "aiModel" TEXT NOT NULL DEFAULT 'default',
    "notifyEmail" TEXT,
    "emailOnPositionOpen" BOOLEAN NOT NULL DEFAULT false,
    "emailOnPositionClose" BOOLEAN NOT NULL DEFAULT false,
    "emailOnAlertTrigger" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trading_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pair" TEXT,
    "data" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: economic_events
CREATE TABLE "economic_events" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "time" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "forecast" TEXT,
    "previous" TEXT,
    "actual" TEXT,
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'investing',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "economic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: watchlist_pairs
CREATE TABLE "watchlist_pairs" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "watchlist_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: shared_signals
CREATE TABLE "shared_signals" (
    "id" TEXT NOT NULL,
    "signalId" TEXT,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryPrice" DECIMAL(18,5) NOT NULL,
    "stopLoss" DECIMAL(18,5),
    "takeProfit" DECIMAL(18,5),
    "confidence" DECIMAL(5,4),
    "reasoning" TEXT,
    "strategy" TEXT,
    "sharedBy" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shared_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: signal_comments
CREATE TABLE "signal_comments" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "author" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signal_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: transactions
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balanceBefore" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- Foreign Keys
-- ============================================================

ALTER TABLE "user_two_factor" ADD CONSTRAINT "user_two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trading_configs" ADD CONSTRAINT "trading_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "signal_comments" ADD CONSTRAINT "signal_comments_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "shared_signals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ============================================================
-- Unique Constraints
-- ============================================================

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "user_two_factor_userId_key" ON "user_two_factor"("userId");
CREATE UNIQUE INDEX "trading_configs_userId_key" ON "trading_configs"("userId");
CREATE UNIQUE INDEX "news_items_source_title_key" ON "news_items"("source", "title");
CREATE UNIQUE INDEX "watchlist_pairs_pair_key" ON "watchlist_pairs"("pair");

-- ============================================================
-- Performance Indexes
-- ============================================================

CREATE INDEX "TradingPosition_status_idx" ON "trading_positions"("status");
CREATE INDEX "TradingPosition_pair_idx" ON "trading_positions"("pair");
CREATE INDEX "TradingPosition_createdAt_idx" ON "trading_positions"("createdAt");
CREATE INDEX "TradingPosition_status_closedAt_idx" ON "trading_positions"("status", "closedAt");

CREATE INDEX "PendingOrder_status_idx" ON "pending_orders"("status");
CREATE INDEX "PendingOrder_pair_idx" ON "pending_orders"("pair");
CREATE INDEX "PendingOrder_orderType_idx" ON "pending_orders"("orderType");
CREATE INDEX "PendingOrder_createdAt_idx" ON "pending_orders"("createdAt");

CREATE INDEX "PriceAlert_isActive_isTriggered_idx" ON "price_alerts"("isActive", "isTriggered");

CREATE INDEX "ActivityLog_createdAt_idx" ON "activity_logs"("createdAt");
CREATE INDEX "ActivityLog_category_idx" ON "activity_logs"("category");
CREATE INDEX "ActivityLog_pair_idx" ON "activity_logs"("pair");

CREATE INDEX "AiAnalysis_pair_idx" ON "ai_analyses"("pair");
CREATE INDEX "AiAnalysis_createdAt_idx" ON "ai_analyses"("createdAt");

CREATE INDEX "BacktestResult_pair_idx" ON "backtest_results"("pair");
CREATE INDEX "BacktestResult_createdAt_idx" ON "backtest_results"("createdAt");

CREATE INDEX "NewsItem_publishedAt_idx" ON "news_items"("publishedAt");
CREATE INDEX "NewsItem_pair_idx" ON "news_items"("pair");

CREATE INDEX "TradingConfig_userId_idx" ON "trading_configs"("userId");

CREATE INDEX "Notification_userId_idx" ON "notifications"("userId");
CREATE INDEX "Notification_isRead_createdAt_idx" ON "notifications"("isRead", "createdAt");
CREATE INDEX "Notification_type_idx" ON "notifications"("type");
CREATE INDEX "Notification_createdAt_idx" ON "notifications"("createdAt");

CREATE INDEX "EconomicEvent_date_idx" ON "economic_events"("date");
CREATE INDEX "EconomicEvent_currency_idx" ON "economic_events"("currency");
CREATE INDEX "EconomicEvent_impact_idx" ON "economic_events"("impact");
CREATE INDEX "EconomicEvent_date_currency_idx" ON "economic_events"("date", "currency");

CREATE INDEX "SharedSignal_pair_idx" ON "shared_signals"("pair");
CREATE INDEX "SharedSignal_createdAt_idx" ON "shared_signals"("createdAt");

CREATE INDEX "SignalComment_signalId_idx" ON "signal_comments"("signalId");
CREATE INDEX "SignalComment_createdAt_idx" ON "signal_comments"("createdAt");

-- ============================================================
-- Seed: System default TradingConfig (userId = NULL)
-- ============================================================
INSERT INTO "trading_configs" (
    "id", "userId",
    "riskPerTrade", "stopLossMin", "stopLossMax", "riskRewardRatio",
    "maxOpenPositions", "minLot", "maxLotPerOrder",
    "dailyRiskLimit", "dailyTargetMin", "dailyTargetMax",
    "leverage", "spreadPip", "commissionPerLot",
    "marginCallLevel", "stopOutLevel",
    "autoTrading", "autoTrailingStop", "trailingStopPips",
    "avoidNewsTrading", "accountBalance",
    "aiProvider", "aiModel",
    "emailOnPositionOpen", "emailOnPositionClose", "emailOnAlertTrigger"
) VALUES (
    'system-default', NULL,
    0.75, 5, 15, 1.5,
    3, 0.01, 50,
    2.5, 1, 3,
    100, 0.5, 1,
    50, 20,
    false, false, 10,
    true, 10000,
    'zai', 'default',
    false, false, true
) ON CONFLICT DO NOTHING;
