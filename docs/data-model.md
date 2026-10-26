# Data Model

PostgreSQL, managed with Prisma. The source of truth is `backend/prisma/schema.prisma`;
this page explains it. Money is integer cents. Calendar dates are `DATE` columns
(`YYYY-MM-DD`). Times are `"HH:MM"` 24-hour strings. `dayOfWeek` is 0 (Sunday) to 6 (Saturday).

## Entities

```
User ─┬─< ParentSwimmer >─┬─ Swimmer ──< Enrollment >── Lesson ──< LessonSession
      │                   │                  │             │
      │  (SWIMMER role) ──┘ userId           │ 1:1         ├── Stage ──< StagePrice
      │                                   Invoice ──< Payment
      │                                      ├──< InvoiceLine   >── LessonSession  (sessions billed)
      │                                      └──< InvoiceCredit >── LessonSession  (cancelled-session credits)
      └─ coaches Lessons, is billed on Invoices, records Payments

ScheduleTemplate ──< TemplateSlot        (applying a template creates Lessons)
```

| Table | What it is | Key rules |
|---|---|---|
| **User** | Anyone who signs in. `role` is ADMIN, COACH, PARENT or SWIMMER. | Email unique. `active=false` instead of deleting. |
| **Swimmer** | The person taking lessons. `stageId` is their current placement. | Either `userId` (own login) or linked to parents. |
| **ParentSwimmer** | Parent ↔ child link (many-to-many). | A child can have two parents. |
| **Stage** | Stage 1 to 5 with name, description, color. | Fixed ids 1 to 5. |
| **StagePrice** | Price per session for a stage from `effectiveFrom`. | One price per stage per date. Price ≥ 0. |
| **ScheduleTemplate / TemplateSlot** | A reusable weekly pattern of slots. | Editing a template never changes lessons already created. |
| **Lesson** | A class meeting weekly on one day and time between `startDate` and `endDate`. | Capacity > 0. Start time < end time. Status ACTIVE or CANCELLED. |
| **LessonSession** | One dated meeting of a lesson. | Unique per lesson and date. Can be cancelled individually. |
| **Enrollment** | A swimmer in a lesson. | At most one ACTIVE per swimmer per lesson. Active count ≤ capacity. |
| **Invoice** | One per enrollment. `sessionCount × ratePerSessionCents = amountCents`. | Never deleted. Status UNPAID, PAID, VOID or REFUNDED. |
| **InvoiceLine** | One line per session an invoice billed, at the invoice's rate. | One per invoice and session. Tells a cancelled session who paid for it. |
| **InvoiceCredit** | A credit for a billed session that was cancelled. Lowers the amount due. | Never deleted; restoring the session sets `reversedAt`. At most one live credit per invoice and session. |
| **Payment** | Money in (PAYMENT) or out (REFUND), with method and reference. | Amount > 0. Refunds never exceed what was paid. |

The CHECK constraints (capacity, prices, times, days, amounts) are in the first migration,
so the database rejects bad data even if the API had a bug.

## Billing rules

1. **Enroll** → in one transaction: lock the lesson row, check it's active, not ended, not full,
   and the swimmer isn't already in it. Count sessions from today on. Look up the stage rate
   effective today. Create the enrollment and its invoice together.
2. **Due date** → the first remaining session, or 7 days out if the class has already started.
3. **Who is billed** → the parent or swimmer who enrolled. If an admin enrolls someone, the
   swimmer's own account, otherwise their first linked parent.
4. **Pay** → admins record any amount up to the balance; families pay the full balance by card.
   Status becomes PAID when payments minus refunds ≥ amount.
5. **Cancel enrollment** → invoice with no payments is voided; otherwise left for an admin to refund.
   **Refund** → any amount up to what was paid. Refunding a swimmer who is still enrolled cancels the
   enrollment in the same step (the admin confirms it). After a refund on a cancelled enrollment the
   invoice is REFUNDED and nothing more is owed, even if part of the money was kept.
6. **Cancel lesson** → every enrollment cancelled, unpaid invoices voided, paid ones flagged.
7. **Price change** → only affects enrollments on or after the effective date.
8. **Cancel one session** → every active enrollment billed for that date gets a credit for one session
   at its invoice rate. Amount due = amount − live credits. If more was already paid than is now due,
   the difference is owed to the family and can be refunded without cancelling the enrollment.
   Restoring the session reverses the credits.

## Permissions matrix

|                                   | Admin | Coach | Parent | Swimmer |
|-----------------------------------|:-----:|:-----:|:------:|:-------:|
| View schedule                     | all | own lessons only | all | all |
| See a lesson's roster             | ✓ | own lessons | ✗ | ✗ |
| Create / edit / cancel lessons    | ✓ | ✗ | ✗ | ✗ |
| Templates                         | ✓ | ✗ | ✗ | ✗ |
| Enroll                            | anyone | ✗ | own children | self |
| Cancel enrollment                 | any | ✗ | own children | self |
| Edit a swimmer's name / birthday  | ✓ | ✗ | own children | self |
| Add a swimmer                     | ✓ (to a parent) | ✗ | own children | ✗ |
| Change a swimmer's stage          | ✓ | swimmers in own lessons | ✗ | ✗ |
| See invoices                      | all | ✗ | billed to them | billed to them |
| Pay online                        | ✗ | ✗ | own | own |
| Record desk payment, refund, void | ✓ | ✗ | ✗ | ✗ |
| Set stage prices                  | ✓ | ✗ | ✗ | ✗ |
| Financial reports                 | ✓ | ✗ | ✗ | ✗ |
| Manage users                      | ✓ | ✗ | ✗ | ✗ |

Every row is enforced by the API (`backend/src/middleware/auth.js`, `backend/src/lib/access.js`).
The React app hides what a role can't use, but the server is what decides.
