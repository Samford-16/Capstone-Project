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

## Tests

```bash
cd backend
npm test        # wipes and reseeds TEST_DATABASE_URL, then runs 25 API tests
```

The tests cover each backend commitment: login and roles, coaches seeing only their own
lessons, 8 simultaneous sign-ups for a 3-seat class (exactly 3 succeed), pricing by
effective date, card validation, partial payments, refunds, voids, lesson cancellation,
template application with coach-conflict rollback, and report totals.

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

- Stripe sandbox (stretch goal). Only `backend/src/lib/cards.js` needs to change.
- Attendance tracking (was in SwimSync; not in either proposal).
- Email notifications and password reset.
- Terms or seasons as a first-class concept. Lessons carry their own start and end dates.
