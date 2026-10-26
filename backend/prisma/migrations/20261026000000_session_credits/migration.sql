-- G4: credit families for cancelled sessions they already paid for.

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCredit" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "reversedAt" TIMESTAMP(3),
    "reversedById" INTEGER,

    CONSTRAINT "InvoiceCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceLine_sessionId_idx" ON "InvoiceLine"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_sessionId_key" ON "InvoiceLine"("invoiceId", "sessionId");

-- CreateIndex
CREATE INDEX "InvoiceCredit_invoiceId_idx" ON "InvoiceCredit"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceCredit_sessionId_idx" ON "InvoiceCredit"("sessionId");

-- CreateIndex
CREATE INDEX "InvoiceCredit_createdAt_idx" ON "InvoiceCredit"("createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCredit" ADD CONSTRAINT "InvoiceCredit_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCredit" ADD CONSTRAINT "InvoiceCredit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCredit" ADD CONSTRAINT "InvoiceCredit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCredit" ADD CONSTRAINT "InvoiceCredit_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Business-rule checks (hand-added; Prisma leaves CHECK constraints alone)
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_amountCents_check" CHECK ("amountCents" >= 0);
ALTER TABLE "InvoiceCredit" ADD CONSTRAINT "InvoiceCredit_amountCents_check" CHECK ("amountCents" > 0);

-- Backfill lines for invoices issued before this migration: the first
-- sessionCount sessions of the lesson on or after the day the invoice was
-- issued (New York time) that are not cancelled, which is how they were billed.
INSERT INTO "InvoiceLine" ("invoiceId", "sessionId", "amountCents")
SELECT x."invoiceId", x."sessionId", x."rate"
FROM (
    SELECT i."id" AS "invoiceId", s."id" AS "sessionId", i."ratePerSessionCents" AS "rate", i."sessionCount",
           ROW_NUMBER() OVER (PARTITION BY i."id" ORDER BY s."date") AS n
    FROM "Invoice" i
    JOIN "Enrollment" e ON e."id" = i."enrollmentId"
    JOIN "LessonSession" s ON s."lessonId" = e."lessonId"
    WHERE s."cancelled" = false
      AND s."date" >= (i."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date
) x
WHERE x.n <= x."sessionCount";
