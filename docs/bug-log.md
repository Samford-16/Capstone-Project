# Bug and Issue Log

Everything found while building and testing Current. Update the Status column as items are fixed or tested.
Last updated Oct 26, 2026 (G1, G2, G3, G5, G6, B7, S10 and the partial refund screen, all in the Oct 26 repo zip).

Status key: **Open** (needs a fix), **Fixed, verify** (fix written, confirm on your PC), **Fixed** (confirmed working), **Decide** (needs a choice from Sami and William), **Backlog** (new feature, not a bug).

**At a glance:** 8 bugs fixed (verify), 1 feature done (Stripe), 5 gaps fixed (verify), 1 gap still needs a decision (G4), 10 setup problems solved, 6 backlog ideas, 9 scenario steps left.

**Note on Oct 26:** G1, G3 and B7 were written on Oct 14 but never made it into the GitHub repo (the repo on Sami's Mac still had 33 tests and no week arrows). They are in the Oct 26 zip, along with everything else below. `npm test` in `backend` now runs 38 tests.

---

## 1. Bugs found in scenario testing

| # | Area | What was wrong | Found in | Status | How to verify |
|---|---|---|---|---|---|
| B1 | Schedule (all roles) | Stat tiles changed with the filters ("Enrolled classes 0", "Classes with openings 0" while filtering). | Parent test, step 4 | Fixed, verify | Set a few filters; the tiles at the top shouldn't change |
| B2 | Billing | A refunded invoice still showed a balance owed (INV-00010: REFUNDED but Balance $770.00). | Admin test, step 19 | Fixed, verify | Refunded invoices show Balance $0.00 |
| B3 | Reports | Outstanding counted the refunded invoice ($5,670) while the dashboard tile didn't, so the two disagreed. | Admin test, step 21 | Fixed, verify | Reports outstanding matches the Schedule "Outstanding" tile |
| B4 | Invoices (admin) | No way to see which paid invoices belong to cancelled enrollments, which is how the wrong invoice got refunded. | Admin test, step 19 | Fixed, verify | Tick "Needs refund review only"; a paid invoice on a cancelled enrollment appears with a red tag. The tag goes away once it's refunded |
| B5 | Lesson details | "Dates" showed the term range (Mon, Oct 12 to Sun, Jan 17) instead of the class's real first and last dates. | Coach test, step 10 | Fixed, verify | A Saturday class shows Sat to Sat dates |
| B6 | Lesson details | Coaches and admins saw "$770 if you enroll today", which only makes sense for families. | Coach test, step 10 | Fixed, verify | Sign in as coach; that text is gone |
| B7 | Reports and invoice filters | Date ranges started at midnight UTC, not New York, so after 8 PM ET that day's invoices and payments dropped out of "today" and "this month". | Automated tests, Oct 14 | Fixed, verify | `npm test` in backend: "counts evening activity in New York's day" passes at any hour |
| B8 | Refunds | A partial refund put the invoice back to UNPAID with the refunded amount owed again, and the admin screen had no way to enter a partial amount (it always refunded everything). | Demo prep, Oct 15 | Fixed, verify | Admin → Invoices → Refund: an amount field appears. Refund part of a cancelled enrollment's payment; the invoice shows REFUNDED, Balance $0.00 |

## 2. Features added

| # | Feature | Status | Notes |
|---|---|---|---|
| F1 | **Stripe Checkout (test mode)**: Pay now sends families to Stripe's hosted page and back; payment recorded once (PaymentIntent id); refunds of Stripe payments go back through Stripe; signed webhook endpoint; simulated checkout kept as fallback when no key is set; live keys refused. | **Fixed (works on Sami's PC, Oct 12)** | Still to try: cancel on Stripe's page ("Nothing was charged"), declined card `4000 0000 0000 0002`, refund from Admin → Invoices shows as refunded in Stripe. Webhook optional (needs Stripe CLI). |

## 3. Gaps and inconsistencies

| # | Area | What was wrong | Status |
|---|---|---|---|
| G1 | Swimmer stages | No screen for a coach or admin to change a swimmer's stage. | Fixed, verify: as Mike, open Stroke Builders; the roster has a "Stage placement" dropdown. Change one; "Noah Okafor is now Stage 4." appears |
| G2 | Swimmer details | Parents couldn't fix a swimmer's name or birthday after adding them (for example "Mark Riveria"). | Fixed, verify: as a parent, My Family → Edit on a swimmer card; change the last name and save |
| G3 | Week grid | After applying a template to future dates, the grid showed the current term **and** the future term side by side, names got cut off, and "Classes with openings" counted both terms (18 instead of 9). | Fixed, verify: Week and List views show one week with ← → arrows and dates on each column; future terms appear only in their own weeks |
| G4 | Cancelled sessions | Cancelling one date (for example, Dec 1) lowers the price for **new** enrollments only. Families already enrolled were billed for every session and get no credit. | **Decide**: auto-credit, or document as a known limitation in William's paper |
| G5 | Refunds | An admin could refund an **active** enrollment's invoice and the swimmer stayed enrolled with nothing paid. | Fixed, verify. **Default chosen, confirm with William:** refunding a swimmer who is still enrolled also cancels the enrollment, and the admin has to tick a box to confirm. See `decisions.md`, Oct 26 |
| G6 | Dependencies | `npm install` in `frontend` reported 1 high severity vulnerability (Vite 8.3.0). The backend also had 7 (body-parser, zod, fast-uri and Prisma's dependencies). | Fixed, verify: `npm audit` shows 0 in both folders. Vite is now 8.3.5 and Prisma 7.10.1 |

## 4. Setup and repository problems (resolved; good material for the methodology section)

| # | Problem | Fix used | Status |
|---|---|---|---|
| S1 | PostgreSQL installer: "database cluster initialisation failed" | Uninstalled and reinstalled as administrator | Fixed |
| S2 | `psql` not recognized in the terminal | Added `C:\Program Files\PostgreSQL\18\bin` to Path | Fixed |
| S3 | PowerShell: "running scripts is disabled on this system" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` | Fixed |
| S4 | `.gitignore` missing or incomplete: thousands of files, including `.env`, about to be committed | Root `.gitignore` with `node_modules/`, `dist/`, `.env`, `*.log`, `.DS_Store`, `.vscode/` | Fixed |
| S5 | "Something went wrong on the server" at login after the Postgres password change | `.env` wasn't saved, and the backend was started from the wrong folder (`npm run dev` must run inside `backend`) | Fixed |
| S6 | Postgres password and JWT secret visible in screenshots | Password changed, new JWT secret generated | Fixed. Never screenshot `.env`, especially now that it holds the Stripe key |
| S7 | `node_modules` had already been pushed to GitHub before the `.gitignore` fix | `git rm -r --cached --ignore-unmatch backend/node_modules frontend/node_modules frontend/dist`, then commit and push | **Confirm** on github.com that `backend` and `frontend` have no `node_modules` folder |
| S8 | "Cannot find module 'stripe'" after installing the update | `npm install stripe` inside `backend` (libraries aren't shared through GitHub or zips) | Fixed |
| S9 | `.env` had no Stripe lines (made from the older template) | Added `STRIPE_SECRET_KEY` and `APP_URL` by hand | Fixed |
| S10 | After `npx prisma migrate reset` the database came back empty with no admin account. With `prisma.config.ts`, Prisma 7 no longer runs the seed after a reset. | Ran `npx prisma db seed`. `npm run db:reset` now runs the seed itself | Fixed |

## 5. Bugs caught while building (fixed before handoff)

| # | What was wrong | Fix |
|---|---|---|
| E1 | The templates router's "admin only" check ran on every API request, so parents got "access denied" when enrolling. Caught by the automated tests. | Scoped each router's checks to its own paths |
| E2 | Tailwind v4 build failed (the `btn` class couldn't be reused) | Declared `btn` with `@utility` |
| E3 | Week grid: 30-minute classes were too short for the coach tag; grid wasted space on empty morning hours | Coach name shown inline on short blocks; grid spans only hours with classes |
| E4 | Template editor slot rows were cramped (time fields cut off) | Two-row layout per slot |

## 6. Backlog (new features, from the Oct 12 review against the honors guidelines)

| # | Feature | Owner | Why it matters |
|---|---|---|---|
| K1 | Accounts receivable aging report (current, 1 to 30, 31 to 60, 60+ days) and CSV export of invoices and payments | William | Standard bookkeeping; "managerially relevant" |
| K2 | Audit trail: who voided, refunded, changed a price or a role, and when | William | Internal controls (COSO, segregation of duties) for the paper |
| K3 | Load test: many families enrolling in one class at once, measuring that the cap holds and response times | Both | Real numbers for the Findings section |
| K4 | Waitlist for full classes, offering the seat when one opens | Sami | Extends the capacity work; real swim-school need |
| K5 | Attendance per session, marked by coaches | Sami | Coaches' daily task; fair basis for G4 credits |
| K6 | Live URL (Google Cloud free-tier VM chosen Oct 15) and a recorded backup demo video | Both | Lets Prof. Kum try it; safety net for presentations. Before going live: set `APP_URL`, new JWT secret and Postgres password, change the demo passwords |

## 7. Scenario steps not yet run

Done: 1 to 14, 15 (first half), 16 (first half), 17, 18, 21, 22, 23 (first half), 24, 25 (swimmer sign-up), Stripe payment.

| Step | What to check |
|---|---|
| 15 (second half) | Apply the Fall template to the same dates again: coach-conflict error, nothing created |
| 16 (second half) | As the parent, enroll in a Stage 2 class: invoice uses $60/session; older Stage 2 invoices stay at $55 |
| 19 (redo) | Tick "Needs refund review only" on Invoices; INV-00001 appears; refund it (try a partial amount) |
| 20 | Void Noah Okafor's unpaid invoice; no Void button on invoices with payments |
| 23 (second half) | Deactivate pat@current.test, then try to sign in as Pat (should fail) |
| 25 (parent version) | Sign up as a new parent with one child; child appears on My Family |
| 26 | Sign up again with the same email (should be rejected) |
| Stripe extras | Cancel on Stripe's page; declined card; Admin refund shows in Stripe |
| Day view and phone width | Today's classes, a cancelled session, filters in Day view; app on a phone or narrow window |

## 8. Questions for Prof. Kum

- Paper length: the honors guidelines say about 20 pages; our project notes say 12 pages each. Which applies to two-person papers?
- The guidelines ask for 40 to 50 sources and about two citations per page. Confirm that applies to each paper.
- Both proposals say "no human subjects." Confirm we shouldn't survey parents or coaches without IRB approval.
