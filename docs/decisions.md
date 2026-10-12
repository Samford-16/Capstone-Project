# Decision Log

A running log of meaningful decisions. Both partners append here. Newest entries at the top.
Entries that were later replaced are marked **Superseded** and link to what replaced them.

---

## 2026-10-12: Stripe Checkout for online payments (test mode)
**Decision:** Families pay through Stripe Checkout, Stripe's hosted payment page. The backend creates a checkout session for the invoice balance; when the family returns, the backend retrieves the session from Stripe and records the payment. A signed webhook records it too, in case the family closes the tab. The PaymentIntent id (`pi_...`) is the payment reference and is checked under a row lock, so a payment is recorded exactly once no matter how many times it's confirmed. Refunds of Stripe payments are sent back through Stripe's Refunds API.
**Why:** The backend proposal's stretch goal. Hosted Checkout keeps card data off our server entirely (the simplest PCI posture) and needs less code than building a card form with Stripe Elements.
**Tradeoff:** Families leave the app briefly to pay. Only test-mode keys (`sk_test_`) are accepted, on purpose.
**Supersedes:** the simulated card checkout as the main way to pay online. It remains as the fallback when no Stripe key is set, and the automated tests use a fake Stripe client.

## 2026-09-23: Stack matches the proposals
**Decision:** Frontend is React + Vite + Tailwind CSS. Backend is Node.js + Express + PostgreSQL + Prisma ORM, with JWT auth. Monorepo: `frontend/` and `backend/`.
**Why:** These are the stacks named in the approved proposals (Sami: React, Tailwind, Vite; William: Express, PostgreSQL, Prisma). The May prototype (plain JS + localStorage) and William's SwimSync code (MySQL + raw SQL) were reused for ideas, design and logic, not as the codebase.
**Tradeoff:** A rebuild instead of patching either older codebase. In return, both papers can describe exactly the system that was built.

## 2026-09-23: Real backend replaces browser-only storage
**Decision:** All data lives in PostgreSQL behind the REST API. Nothing is stored in the browser except the login token and the preferred schedule view.
**Why:** The backend, database and bookkeeping are William's half of the project. Browser-only storage also meant any user could edit their own role and every "permission" was cosmetic.
**Supersedes:** 2026-05-09 Browser-only architecture, 2026-05-09 Password hashing in-browser.

## 2026-09-23: Four roles, with parents linked to children
**Decision:** Roles are ADMIN, COACH, PARENT and SWIMMER. A Swimmer record is the person in the water. It either has its own login (older swimmers) or is linked to one or more parents (ParentSwimmer).
**Why:** Matches the backend proposal's JWT roles and lets one parent manage several children with one bill.
**Supersedes:** 2026-05-09 Three roles.

## 2026-09-23: Public sign-up is for families only
**Decision:** Anyone can register as a PARENT or SWIMMER. Coaches and admins are created by an admin.
**Why:** The May prototype let anyone pick "Admin" on the sign-up form.

## 2026-09-23: Lessons meet weekly; each meeting is a session
**Decision:** A Lesson is a class on one weekday and time between a start and end date (for example "Floaters, Mondays 4:00 PM, Sep 21 to Dec 27"). Each dated meeting is a LessonSession. Swimmers enroll in the Lesson.
**Why:** Supports the week grid (recurring pattern) and the daily view (dated sessions), lets an admin cancel a single session (pool closed), and gives billing a real session count.

## 2026-09-23: Schedule templates
**Decision:** A template is a named set of weekly slots (day, time, stage, coach, capacity). Applying it to a date range creates one lesson per slot in a single all-or-nothing transaction.
**Why:** The frontend proposal's "reusable schedule templates that auto-populate lesson slots across a date range." Editing a template later does not change lessons already created from it.

## 2026-09-23: Coaches cannot be double-booked
**Decision:** Creating, editing or applying lessons fails with COACH_CONFLICT if the coach already teaches an active lesson on the same weekday with overlapping times and dates.

## 2026-09-23: Invoice = remaining sessions x rate effective on the enrollment date
**Decision:** Each stage has a price per session with an effective date (StagePrice history). Enrolling creates one invoice for the sessions left in the lesson, at the rate in effect that day. The rate and session count are copied onto the invoice.
**Why:** The backend proposal says invoices use "the rate effective on that date." Copying the rate means a later price change never rewrites an issued invoice. It also fixes the May prototype, which billed one session's price for a whole term.
**Supersedes:** 2026-05-09 Stage-default pricing with per-group override (per-lesson overrides dropped; price is per stage), 2026-05-09 Auto-generate invoice on enrollment (kept, but amount now covers all remaining sessions).

## 2026-09-23: Financial records are never deleted
**Decision:** Invoices are voided (no money on them) or refunded (money on them), never deleted. Users are deactivated, never deleted. Lessons with any enrollment history are cancelled, not deleted.
**Why:** Deleting invoices destroys the audit trail. The May prototype deleted a group's invoices when the group was deleted, which contradicted its own rule for deleted users.

## 2026-09-23: Cancellation rules
**Decision:** Cancelling an enrollment voids its invoice if nothing was paid. If money was paid, the invoice stays and an admin decides on a refund. Cancelling a lesson does the same for every enrollment in it and reports how many invoices need a refund.

## 2026-09-23: Capacity enforced with a row lock
**Decision:** Enrollment runs in one database transaction that locks the lesson row (`SELECT ... FOR UPDATE`), re-checks capacity and duplicates, then creates the enrollment and invoice together.
**Why:** The backend proposal requires preventing over-enrollment "even under concurrent requests." The test suite fires 8 simultaneous requests at a 3-seat lesson and checks exactly 3 succeed.
**Supersedes:** 2026-05-09 Cap enforcement at the data layer (same idea, now in the database).

## 2026-09-23: Stage placement is set by staff
**Decision:** Families can suggest a stage when adding a swimmer, but only an admin or the swimmer's coach can change it afterwards. The enroll screen warns (does not block) when a swimmer's stage doesn't match the class.

## 2026-09-23: Payments
**Decision:** Admins record desk payments (cash, check, card) including partial payments. Families pay the full balance online through a simulated card checkout validated on the server (Luhn check, expiry). Card numbers are not stored, only the last four digits as the reference. Stripe sandbox remains the stretch goal; only `backend/src/lib/cards.js` would change.
**Supersedes:** 2026-05-09 Simulated payment with Luhn validation (moved from the browser to the server).

## 2026-09-23: Reports use two date bases
**Decision:** In financial summaries, invoiced and outstanding amounts are grouped by invoice issue date; collected and refunded amounts by the date money moved.
**Why:** That is the difference between billing (accrual) and cash received, and it keeps totals consistent whether grouped by stage or by month.

---

## 2026-05-09 — Browser-only architecture
**Superseded** by 2026-09-23 "Real backend replaces browser-only storage."
**Decision:** Build the entire app as a static frontend with localStorage as the persistence layer. No backend server, no database server.
**Why:** Capstone demo runs everywhere with zero setup. No CORS, no API contract drift, no deploy story. We can show every feature end-to-end on a USB stick if needed.
**Tradeoff:** Data lives in one browser. Multi-user concurrency is simulated. A real production version would need a backend; the data layer (`store.js`) is structured so its function shapes (`Users.byId`, `Groups.create`, etc.) map cleanly to REST endpoints later.

## 2026-05-09 — Password hashing in-browser via SubtleCrypto
**Superseded:** passwords are now hashed server-side with bcrypt.
**Decision:** SHA-256 with per-user random salt, hashed before localStorage write.
**Why:** Honest enough for a demo without storing plaintext. Web Crypto is built in, no library.
**Tradeoff:** SHA-256 is fast (bad for password hashing). For a real app we'd use bcrypt or argon2 server-side.

## 2026-05-09 — Five-stage system, color-coded
**Still in effect.** Same colors are used in the React app.
**Decision:** Stages 1–5, each with a distinct color in the calendar grid and on tags.
**Why:** Mirrors how most learn-to-swim programs (Red Cross, YMCA Swim America) actually structure curricula.

## 2026-05-09 — Cap enforcement at the data layer
**Superseded** by 2026-09-23 "Capacity enforced with a row lock."
**Decision:** `Enrollments.enroll()` returns `{ ok: false, code: 'GROUP_FULL' }` if cap is exceeded. UI cannot bypass it.
**Why:** Visual disabling alone is bypassable; the rule has to live where the writes happen.

## 2026-05-09 — Simulated payment with Luhn validation
**Superseded** by 2026-09-23 "Payments."
**Decision:** Fake card form, real Luhn checksum, 900ms latency to feel real.
**Why:** Looks credible in a demo without needing Stripe API keys or a payment processor account. Reuses the `Invoices.markPaid` shape we'd use for a real integration.

## 2026-05-09 — Auto-generate invoice on enrollment
**Superseded** by 2026-09-23 "Invoice = remaining sessions x rate effective on the enrollment date."
**Decision:** Every successful enrollment immediately creates an `unpaid` invoice using the group's `price_cents`.
**Why:** Models how real swim schools bill (per session, per swimmer). Cleanly separates "you're enrolled" from "you've paid."

## 2026-05-09 — Stage-default pricing with per-group override
**Superseded** by 2026-09-23 "Invoice = remaining sessions x rate effective on the enrollment date."
**Decision:** Admin sets default cents-per-session per stage; new groups inherit, but admin can override on a per-group basis.
**Why:** Most groups in a stage cost the same, but premium offerings (small caps, senior coach) should be priceable individually.

## 2026-05-09 — Project name: Current (confirmed)
**Still in effect.**
**Modules:** Current Schedule, Current Pay, Current Admin.

## 2026-05-09 — Three roles: admin, coach, swimmer
**Superseded** by 2026-09-23 "Four roles, with parents linked to children."
**Decision:** "Swimmer" covers parent-of-swimmer accounts. Will revisit if we need to model parent ↔ child as a 1:N relationship.

---

## Template for new entries

```
## YYYY-MM-DD: Short title
**Decision:** What we decided.
**Why:** One or two sentences.
**Tradeoff:** What we gave up (optional).
**Supersedes:** Earlier entry, if any (optional).
```
