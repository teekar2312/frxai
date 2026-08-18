-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
    "leverage" INTEGER NOT NULL DEFAULT 100,
    "commission" REAL NOT NULL DEFAULT 1,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TradingPosition_status_idx" ON "TradingPosition"("status");

-- CreateIndex
CREATE INDEX "TradingPosition_pair_idx" ON "TradingPosition"("pair");

-- CreateIndex
CREATE INDEX "TradingPosition_createdAt_idx" ON "TradingPosition"("createdAt");

-- CreateIndex
CREATE INDEX "TradingPosition_status_closedAt_idx" ON "TradingPosition"("status", "closedAt");

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

