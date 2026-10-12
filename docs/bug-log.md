# Bug and Issue Log

Everything found while testing Current. Update the Status column as items are fixed or tested.
Started Oct 12, 2026 (Windows setup + scenario testing).

Status key: **Open** (needs a fix), **Fixed, verify** (fix written, confirm on your PC), **Fixed** (confirmed), **Decide** (needs a choice from Sami and William), **Untested**.

---

## 1. Bugs found in scenario testing (Oct 12)

| # | Area | What's wrong | Found in | Status |
|---|---|---|---|---|
| B1 | Schedule (all roles) | Stat tiles at the top changed with the filters. Filtering showed "Enrolled classes 0" and "Classes with openings 0" even though the family had enrollments. | Parent test, step 4 | Fixed, verify (`Schedule.jsx`, in current-fixes-oct12.zip) |
| B2 | Billing | A refunded invoice still showed a balance owed (INV-00010: REFUNDED but Balance $770.00). | Admin test, step 19 | Fixed, verify (`billing.js`) |
| B3 | Reports | Outstanding counted the refunded invoice ($5,670), but the dashboard tile didn't, so the two disagreed. Should be $4,900. | Admin test, step 21 | Fixed, verify (`reports.js`) |
| B4 | Invoices (admin) | No way to see which paid invoices belong to cancelled enrollments. That's how the wrong invoice (INV-00010 instead of INV-00001) got refunded. | Admin test, step 19 | Fixed, verify (new "needs refund review" tag and filter in `Invoices.jsx`) |
| B5 | Lesson details | "Dates" showed the term range (Mon, Oct 12 to Sun, Jan 17) instead of the class's real first and last dates (Sat, Oct 17 to Sat, Jan 16). | Coach test, step 10 | Fixed, verify (`LessonDetailModal.jsx`) |
| B6 | Lesson details | Coaches and admins saw "$770 if you enroll today", which only makes sense for families. | Coach test, step 10 | Fixed, verify (`LessonDetailModal.jsx`) |

## 2. Gaps and inconsistencies (no fix yet)

| # | Area | What's wrong | Status |
|---|---|---|---|
| G1 | Swimmer stages | The Family page says "Stage placement is set by your coach after an assessment," and the API lets coaches and admins change a swimmer's stage, but **there's no screen to do it**. Coaches can't actually move a swimmer up a stage. Matters for Sami's proposal (stage tagging). | Open |
| G2 | Swimmer details | Parents can't fix a swimmer's name or birthday after adding them (for example the "Mark Riveria" typo). The API supports it; the page has no Edit button. | Open |
| G3 | Week grid | After applying a template to future dates, the week grid shows the current term **and** the future term side by side (two "Tiny Tots", two "Floaters", etc.), so class names get cut off. The "Classes with openings" tile also counts both terms (showed 18 instead of 9). There's no way to pick which term or week you're looking at. Confirmed in the swimmer test. | Open |
| G4 | Cancelled sessions | Cancelling one date (for example, Dec 1) lowers the price for **new** enrollments only. Families already enrolled were billed for 14 sessions and get no credit. Bookkeeping gap. | Decide: auto-credit, or document as a limitation in William's paper |
| G5 | Refunds | An admin can refund an **active** enrollment's invoice. The swimmer stays enrolled with nothing paid. Should a refund also cancel the enrollment, or be allowed only on cancelled ones? | Decide |
| G6 | Dependencies | `npm install` in `frontend` reports 1 high severity vulnerability. | Open: run `npm audit`, then `npm audit fix` (no `--force`) |

## 3. Setup problems hit on Windows (resolved, keep for the paper)

| # | Problem | Fix used | Status |
|---|---|---|---|
| S1 | PostgreSQL installer: "database cluster initialisation failed" | Uninstalled, reinstalled as administrator | Fixed |
| S2 | `psql` not recognized | Added `C:\Program Files\PostgreSQL\18\bin` to Path | Fixed |
| S3 | PowerShell: "running scripts is disabled on this system" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` | Fixed |
| S4 | `.gitignore` missing or incomplete: 10K files, including `node_modules` and `.env`, about to be committed | Added a root `.gitignore`; used GitHub Desktop's "Ignore file" for `backend\.env` | Fixed. Double-check `.env` never reached GitHub |
| S5 | "Something went wrong on the server" at login after the Postgres password change | `.env` wasn't saved, and backend was started from the wrong folder (`npm run dev` must run inside `backend`) | Fixed |
| S6 | Postgres password and JWT secret shown in screenshots | Password changed; new JWT secret generated | Fixed. Keep `.env` out of screenshots |

## 4. Bugs caught earlier, while building (Sept 23, fixed before handoff)

| # | What was wrong | Fix |
|---|---|---|
| E1 | The templates router's "admin only" check ran on every API request, so parents got "access denied" when enrolling. Caught by the automated tests. | Scoped each router's middleware to its own paths |
| E2 | Tailwind v4 build failed (`btn` class couldn't be reused) | Declared `btn` with `@utility` |
| E3 | Week grid: 30-minute classes were too short to show the coach tag; grid wasted space on empty morning hours | Coach name shown inline on short blocks; grid only spans hours with classes |
| E4 | Template editor slot rows were cramped (time fields cut off) | Two-row layout per slot |

## 5. Scenario steps not yet run

Done so far: 1 to 14, 15 (first half), 16 (first half), 17, 18, 21, 22, 23 (first half), 24, 25 (swimmer sign-up).

| Step | What to check |
|---|---|
| 15 (second half) | Apply the Fall template to the same dates again: should give a coach-conflict error and create nothing |
| 16 (second half) | As the parent, enroll a swimmer in a Stage 2 class: invoice should use $60/session; older Stage 2 invoices stay at $55 |
| 19 (redo) | Tick "Needs refund review only" on Invoices; INV-00001 should appear; refund it |
| 20 | Void Noah Okafor's unpaid invoice; no Void button on invoices with payments |
| 23 (second half) | Deactivate pat@current.test, then try to sign in as Pat (should fail) |
| 25 (parent version) | Sign up as a new parent with one child; child appears on My Family |
| 26 | Sign up again with the same email (should be rejected) |
| Day view | Not exercised much yet: check today's classes, a cancelled session, and filters in Day view |
| Phone width | Check the app on a phone or a narrow window before the demo |
