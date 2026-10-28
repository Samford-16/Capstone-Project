# Current

Swim lesson management web app. ISI 490 honors capstone, CUNY College of Staten Island.

| Part | Owner | Stack |
|---|---|---|
| `frontend/` Scheduler and role-based UI | Sami | React 19, Vite, Tailwind CSS |
| `backend/` REST API, database, bookkeeping | William | Node.js, Express, PostgreSQL, Prisma, JWT |

This version was built from the May prototype (design, stage colors, week grid, checkout
flow) and William's SwimSync project (roles, parent-child accounts, scheduling), rebuilt
on the stacks in our proposals. See `docs/decisions.md` for what changed and why.

## What it does

- **Current Schedule:** week grid, daily view and list view. Every class shows a Stage tag
  and a Coach tag, live enrollment vs. capacity, and hides sign-up when full. Filter by
  stage, coach, day, availability and enrollment; sort by time, stage, coach or openings.
- **Templates:** build a weekly pattern of classes once, apply it to any date range.
- **Role-based UI:** admins manage everything, coaches see only their own schedule and
  rosters, parents manage their children, swimmers manage themselves.
- **Current Pay:** enrolling creates an invoice (remaining sessions × the stage's price
  per session on that date). Families pay online (simulated card checkout); admins record
  cash and check payments, refund and void.
- **Current Admin:** stage pricing with effective dates, user management, and financial
  reports by stage or month.

## Run it locally

You need Node.js 20.19+ and PostgreSQL 14+.

```bash
# 1. Database
createdb current_dev
createdb current_test          # only needed for the test suite

# 2. Backend (terminal 1)
cd backend
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npx prisma migrate dev        # creates the tables
npm run db:test:deploy        # same tables in the test database
npm run db:seed               # demo data
npm run dev                   # API on http://localhost:3000/api

# 3. Frontend (terminal 2)
cd frontend
npm install
npm run dev                   # app on http://localhost:5173
```

### Demo accounts

All use the password **Current123!**. The login page has buttons that fill these in.

| Role | Email | What to try |
|---|---|---|
| Admin | admin@current.test | Templates, invoices, reports, pricing |
| Coach | mike@current.test | Only Mike's 4 classes; open Stroke Builders for a full roster |
| Parent | parent@current.test | Two children; enroll, cancel, pay |
| Swimmer | swimmer@current.test | Teen with their own login |

Test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is declined. Any future
expiry and any 3-digit CVC.

`npm run db:reset` (in `backend/`) wipes the database, reruns migrations and reseeds.
Use that rather than `npx prisma migrate reset` on its own: with `prisma.config.ts`,
Prisma 7 no longer runs the seed after a reset, so the database comes back with no
accounts. If that happens, run `npx prisma db seed`.

## Stripe payments (test mode)

Families pay through **Stripe Checkout**: they're sent to Stripe's hosted payment
page and come back to Current when they're done. Card numbers never touch our
server. Without a Stripe key, the app uses its built-in demo checkout instead.

1. Create a free account at **dashboard.stripe.com**. Stay in **test mode** (sandbox).
2. **Developers → API keys** → copy the **Secret key** (`sk_test_...`).
3. In `backend/.env` set `STRIPE_SECRET_KEY=sk_test_...` and restart the backend.
   Live keys (`sk_live_...`) are refused on purpose.
4. As a parent, go to **Billing → Pay now**. Pay with Stripe's test card
   `4242 4242 4242 4242`, any future date, any CVC, any ZIP.
5. You land back on Billing and the invoice shows **PAID**. The payment also
   appears in the Stripe Dashboard under **Payments** (test data).

Refunding a Stripe-paid invoice from **Invoices** sends the refund through Stripe
to the same card. Other useful test cards: `4000 0000 0000 0002` (declined),
`4000 0025 0000 3155` (asks for 3D Secure authentication).

**Optional: webhook.** The app records the payment when the family returns to
Billing. To also record it if they close the tab first, install the Stripe CLI and run
`stripe listen --forward-to localhost:3000/api/stripe/webhook`, then put the
`whsec_...` secret it prints into `STRIPE_WEBHOOK_SECRET`.

## Tests

```bash
cd backend
npm test        # wipes and reseeds TEST_DATABASE_URL, then runs 44 API tests
```

After pulling a change that adds a migration (a new folder in `prisma/migrations`), run
`npx prisma migrate deploy` for the app database and `npm run db:test:deploy` for the
test database.

The tests cover each backend commitment: login and roles, coaches seeing only their own
lessons, 8 simultaneous sign-ups for a 3-seat class (exactly 3 succeed), pricing by
effective date, card validation, partial payments, refunds, voids, lesson cancellation,
template application with coach-conflict rollback, report totals, and the Stripe
flow against a fake Stripe (payment recorded exactly once, webhook signatures,
refunds sent back through Stripe). The tests never contact the real Stripe.

## Production build

```bash
cd frontend && npm run build          # outputs frontend/dist
cd ../backend && npm run db:deploy && npm start
```

The Express server serves `frontend/dist` itself, so one process on one port runs the whole app.

## Layout

```
backend/
  prisma/schema.prisma      database schema (see docs/data-model.md)
  prisma/migrations/        SQL migrations, including CHECK constraints
  prisma/seed.js            demo data
  openapi.yaml              API contract (also served at /api/openapi.yaml)
  src/app.js                Express app, mounts routes
  src/routes/               auth, users, stages+pricing, swimmers, lessons+sessions,
                            templates, enrollments, invoices+payments, reports
  src/lib/                  billing, access rules, scheduling, card checks, dates
  test/api.test.js          end-to-end API tests
frontend/
  src/pages/                Schedule, Family, Billing, Login, Register, admin/*
  src/components/           WeekGrid, LessonCard, LessonDetailModal, PaymentModal, ...
  src/lib/                  API client, auth context, formatting
docs/
  decisions.md              running decision log (for the papers)
  data-model.md             tables, billing rules, permissions matrix
```

## Not built yet

- Email notifications and password reset.
- Terms or seasons as a first-class concept. Lessons carry their own start and end dates.
