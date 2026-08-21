-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "resetToken" TEXT,
    "resetTokenExpires" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserTwoFactor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserTwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradingPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "lotSize" REAL NOT NULL,
    "entryPrice" REAL NOT NULL,
    "currentPrice" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "trailingStop" REAL,
    "trailingType" TEXT NOT NULL DEFAULT 'manual',
    "pipValue" REAL,
    "riskAmount" REAL,
    "rewardAmount" REAL,
    "pnl" REAL NOT NULL DEFAULT 0,
    "pnlPips" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "strategy" TEXT,
    "marketCondition" TEXT,
    "aiConfidence" REAL,
    "riskLevel" TEXT,
    "aiRecommendation" TEXT,
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "commission" REAL NOT NULL DEFAULT 1,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PendingOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "lotSize" REAL NOT NULL,
    "price" REAL NOT NULL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "strategy" TEXT,
    "aiConfidence" REAL,
    "riskLevel" TEXT,
    "aiRecommendation" TEXT,
    "triggeredAt" DATETIME,
    "cancelledAt" DATETIME,
    "executedAt" DATETIME,
    "executedPrice" REAL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "targetPrice" REAL NOT NULL,
    "currentPrice" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTriggered" BOOLEAN NOT NULL DEFAULT false,
    "triggeredAt" DATETIME,
    "note" TEXT,
    "emailNotify" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL DEFAULT 'info',
    "category" TEXT NOT NULL DEFAULT 'general',
    "message" TEXT NOT NULL,
    "details" TEXT,
    "pair" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "marketCondition" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "recommendation" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "strategyUsed" TEXT,
    "indicatorsUsed" TEXT,
    "newsImpact" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "entryPrice" REAL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "lotSize" REAL,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "timeframes" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "initialBalance" REAL NOT NULL,
    "finalBalance" REAL NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winningTrades" INTEGER NOT NULL,
    "losingTrades" INTEGER NOT NULL,
    "winRate" REAL NOT NULL,
    "totalPnl" REAL NOT NULL,
    "maxDrawdown" REAL NOT NULL,
    "sharpeRatio" REAL,
    "profitFactor" REAL,
    "avgWin" REAL,
    "avgLoss" REAL,
    "maxConsecutiveWins" INTEGER,
    "maxConsecutiveLosses" INTEGER,
    "parameters" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT,
    "imageUrl" TEXT,
    "publishedAt" DATETIME,
    "category" TEXT,
    "pair" TEXT,
    "impact" TEXT,
    "sentiment" TEXT,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TradingConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "riskPerTrade" REAL NOT NULL DEFAULT 0.75,
    "stopLossMin" REAL NOT NULL DEFAULT 5,
    "stopLossMax" REAL NOT NULL DEFAULT 15,
    "riskRewardRatio" REAL NOT NULL DEFAULT 1.5,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 3,
    "minLot" REAL NOT NULL DEFAULT 0.01,
    "maxLotPerOrder" REAL NOT NULL DEFAULT 50,
    "dailyRiskLimit" REAL NOT NULL DEFAULT 2.5,
    "dailyTargetMin" REAL NOT NULL DEFAULT 1,
    "dailyTargetMax" REAL NOT NULL DEFAULT 3,
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "spreadPip" REAL NOT NULL DEFAULT 0.5,
    "commissionPerLot" REAL NOT NULL DEFAULT 1,
    "marginCallLevel" INTEGER NOT NULL DEFAULT 50,
    "stopOutLevel" INTEGER NOT NULL DEFAULT 20,
    "autoTrading" BOOLEAN NOT NULL DEFAULT false,
    "autoTrailingStop" BOOLEAN NOT NULL DEFAULT false,
    "trailingStopPips" REAL NOT NULL DEFAULT 10,
    "avoidNewsTrading" BOOLEAN NOT NULL DEFAULT true,
    "accountBalance" REAL NOT NULL DEFAULT 10000,
    "aiProvider" TEXT NOT NULL DEFAULT 'zai',
    "aiModel" TEXT NOT NULL DEFAULT 'default',
    "notifyEmail" TEXT,
    "emailOnPositionOpen" BOOLEAN NOT NULL DEFAULT false,
    "emailOnPositionClose" BOOLEAN NOT NULL DEFAULT false,
    "emailOnAlertTrigger" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pair" TEXT,
    "data" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EconomicEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "time" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "forecast" TEXT,
    "previous" TEXT,
    "actual" TEXT,
    "category" TEXT,
    "source" TEXT NOT NULL DEFAULT 'investing',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WatchlistPair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SharedSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalId" TEXT,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "stopLoss" REAL,
    "takeProfit" REAL,
    "confidence" REAL,
    "reasoning" TEXT,
    "strategy" TEXT,
    "sharedBy" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SignalComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalId" TEXT NOT NULL,
    "author" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignalComment_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "SharedSignal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balanceBefore" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserTwoFactor_userId_key" ON "UserTwoFactor"("userId");

-- CreateIndex
CREATE INDEX "TradingPosition_status_idx" ON "TradingPosition"("status");

-- CreateIndex
CREATE INDEX "TradingPosition_pair_idx" ON "TradingPosition"("pair");

-- CreateIndex
CREATE INDEX "TradingPosition_createdAt_idx" ON "TradingPosition"("createdAt");

-- CreateIndex
CREATE INDEX "TradingPosition_status_closedAt_idx" ON "TradingPosition"("status", "closedAt");

-- CreateIndex
CREATE INDEX "PendingOrder_status_idx" ON "PendingOrder"("status");

-- CreateIndex
CREATE INDEX "PendingOrder_pair_idx" ON "PendingOrder"("pair");

-- CreateIndex
CREATE INDEX "PendingOrder_orderType_idx" ON "PendingOrder"("orderType");

-- CreateIndex
CREATE INDEX "PendingOrder_createdAt_idx" ON "PendingOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PriceAlert_isActive_isTriggered_idx" ON "PriceAlert"("isActive", "isTriggered");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_category_idx" ON "ActivityLog"("category");

-- CreateIndex
CREATE INDEX "ActivityLog_pair_idx" ON "ActivityLog"("pair");

-- CreateIndex
CREATE INDEX "AiAnalysis_pair_idx" ON "AiAnalysis"("pair");

-- CreateIndex
CREATE INDEX "AiAnalysis_createdAt_idx" ON "AiAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "BacktestResult_pair_idx" ON "BacktestResult"("pair");

-- CreateIndex
CREATE INDEX "BacktestResult_createdAt_idx" ON "BacktestResult"("createdAt");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsItem_pair_idx" ON "NewsItem"("pair");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_source_title_key" ON "NewsItem"("source", "title");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_createdAt_idx" ON "Notification"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "EconomicEvent_date_idx" ON "EconomicEvent"("date");

-- CreateIndex
CREATE INDEX "EconomicEvent_currency_idx" ON "EconomicEvent"("currency");

-- CreateIndex
CREATE INDEX "EconomicEvent_impact_idx" ON "EconomicEvent"("impact");

-- CreateIndex
CREATE INDEX "EconomicEvent_date_currency_idx" ON "EconomicEvent"("date", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistPair_pair_key" ON "WatchlistPair"("pair");

-- CreateIndex
CREATE INDEX "SharedSignal_pair_idx" ON "SharedSignal"("pair");

-- CreateIndex
CREATE INDEX "SharedSignal_createdAt_idx" ON "SharedSignal"("createdAt");

-- CreateIndex
CREATE INDEX "SignalComment_signalId_idx" ON "SignalComment"("signalId");

-- CreateIndex
CREATE INDEX "SignalComment_createdAt_idx" ON "SignalComment"("createdAt");

