-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobNumber" TEXT,
    "xeroTracking" TEXT,
    "client" TEXT,
    "contractValue" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Live',
    "startDate" TEXT,
    "finishDate" TEXT,
    "pm" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pct" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "hook" TEXT,
    "invoiceNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Not due',
    "invoicedDate" TEXT,
    "dueDate" TEXT,
    "receivedInc" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "JobClaim_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobCostLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "supplier" TEXT,
    "cost" REAL NOT NULL DEFAULT 0,
    "costStatus" TEXT NOT NULL DEFAULT 'Quoted',
    "paid" REAL,
    "claimSeq" INTEGER,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JobCostLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "costLineId" TEXT,
    "supplier" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Authorised',
    "dueDate" TEXT,
    "paidDate" TEXT,
    "claimSeq" INTEGER,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    CONSTRAINT "JobBill_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobBill_costLineId_fkey" FOREIGN KEY ("costLineId") REFERENCES "JobCostLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobLabour" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "costLineId" TEXT,
    "date" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "hours" REAL NOT NULL,
    "rate" REAL NOT NULL DEFAULT 0,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "JobLabour_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobLabour_costLineId_fkey" FOREIGN KEY ("costLineId") REFERENCES "JobCostLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "costLineId" TEXT,
    "date" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT,
    "amount" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "JobMaterial_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobMaterial_costLineId_fkey" FOREIGN KEY ("costLineId") REFERENCES "JobCostLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "finish" TEXT NOT NULL,
    "claimSeq" INTEGER,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "JobTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "weekOf" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_leadId_key" ON "Job"("leadId");

-- CreateIndex
CREATE INDEX "Job_brand_status_idx" ON "Job"("brand", "status");

-- CreateIndex
CREATE INDEX "JobClaim_jobId_seq_idx" ON "JobClaim"("jobId", "seq");

-- CreateIndex
CREATE INDEX "JobCostLine_jobId_idx" ON "JobCostLine"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobBill_externalId_key" ON "JobBill"("externalId");

-- CreateIndex
CREATE INDEX "JobBill_jobId_idx" ON "JobBill"("jobId");

-- CreateIndex
CREATE INDEX "JobLabour_jobId_idx" ON "JobLabour"("jobId");

-- CreateIndex
CREATE INDEX "JobMaterial_jobId_idx" ON "JobMaterial"("jobId");

-- CreateIndex
CREATE INDEX "JobTask_jobId_start_idx" ON "JobTask"("jobId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "JobSnapshot_jobId_weekOf_key" ON "JobSnapshot"("jobId", "weekOf");

