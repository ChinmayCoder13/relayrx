# RelayRx update notes

## 1.1.1 — Vercel runtime and sidebar fixes

- Fix the `ERR_MODULE_NOT_FOUND` crash by using explicit `.js` extensions throughout both API entry points and their server dependency graph.
- Add a native Node ESM check to the production build. It compiles and calls both handlers without Vite or a TypeScript loader, verifies controlled missing-configuration responses, and makes no provider requests.
- Display Jordan Ellis / JE for Practice Staff, Dr. Alex Morgan / AM for Clinician, and Sam Lee / SL for Pharmacy in demo mode. Both role selectors update the same profile; connected sandbox names still come from authenticated membership.
- Fit the sidebar to the available viewport, scroll its navigation when necessary, and reduce decorative content on shorter screens.
- Add “Done by Chinmay Deepak Chandavar” below the sidebar profile, with a footer credit in compact layouts.

Deploy the updated commit through the existing Vercel project. Keep `GEMINI_API_KEY` in Vercel's server environment; no key belongs in the repository. This import fix does not change workflow transitions, the waiting threshold, or Gemini's read-only role.

## 1.1 — waiting attention and Gemini copilots

This is an update to the existing six-view RelayRx application. The redstone comparator, workflow gates, role permissions, patient update previews, audit trail, failure simulation, optional Supabase mode, and growth playbook are preserved.

## Changes

- Persist a per-case `waitingSince` timestamp for the current required action.
- Derive Needs Attention after 180 seconds while an action remains pending. Three minutes = 30 simulated hours.
- Update the existing metric/filter, queue rows, detail banner, Insights, and read-only inspection context.
- Reset the wait when the current step advances. Stop it for confirmed pickup or decline. Drafts, viewing, failed retries, and escalation do not dismiss an unresolved wait.
- Keep attention separate from workflow status, readiness, evidence, and completion. No timer changes workflow records.
- Add a round draggable chatbot with separate Practice Staff, Clinician, and Pharmacy Gemini contexts and conversation threads.
- Send actual case state, attention, owner, next action, and verified/missing information. Hide stale guidance and reject responses if the snapshot changes.
- Keep Gemini server-side and read-only. The API never writes case state or invokes clinical/workflow actions.
- Run both API handlers locally through the existing Vite development command; keep Vercel/Git deployment settings.

The earlier delivered source did not include a Gemini endpoint. This update adds the shared Gemini integration in place; it does not replace an existing provider or rebuild the app.

## Existing data

Browser-local cases retain their evidence and history. On first upgrade, old cases without a waiting timestamp receive one fresh, persisted demo waiting period. Resolved and declined cases have no active timer. Reloading again does not restart that period.

Connected cases use the existing JSON payload column, so no database schema migration is required. Legacy cases derive their waiting start from their last progress event or creation time; the next action stores the new field. Connected roles are derived from verified membership, with tenant-scoped case reads and a latest-state check after model completion.

## Validation

- 31 tests pass, including the original workflow, comparator, API, and embedded PostgreSQL tests.
- Production TypeScript/Vite build passes.
- Real three-minute browser check verifies that the attention count rises while a 15/15 routed case stays Awaiting Pharmacy.
- Browser checks cover the attention filter, role panels, continued pharmacy workflow, actual pickup confirmation, stopped timer, and movable launcher.
- Gemini requests are tested using mocks. A live Gemini answer, real Supabase Auth, and a hosted Vercel deployment require your configured services.

## Configure

See [GEMINI-SETUP.md](../GEMINI-SETUP.md). Add `GEMINI_API_KEY` to `.env.local` for local use, or Vercel Project Settings → Environment Variables for deployment, then restart or redeploy. Never use a `VITE_` prefix for the key and never commit it to Git.
