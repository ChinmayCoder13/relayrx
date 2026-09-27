# RelayRx

A working B2B refill-coordination prototype with Minecraft-inspired comparator logic. Built for practice staff, clinicians, and their pharmacy partners.

**Runs immediately with synthetic demo data. Ready to push to GitHub and import into Vercel.** Optional Supabase authentication and persistence are included as a separate connected sandbox mode. This is not a production clinical system and must not contain real patient information.

## Start locally

Install Node.js 22.12+ or 24, then extract the ZIP and open PowerShell inside the `relayrx` folder (the folder containing `package.json`):

```powershell
npm ci
npm run dev
```

Open `http://localhost:4173`. The refill workflow and timer run without a key or account. To enable the three Gemini copilots, follow [GEMINI-SETUP.md](GEMINI-SETUP.md). Do not open `index.html` directly from the file manager; it is a Vite application.

```powershell
npm test
npm run build
npm run preview
```

The local development server also runs `/api/copilot` and `/api/workspace`. `npm run preview` previews only the built frontend; use `npm run dev` or a complete Vercel deployment to test Gemini.

## Update an existing RelayRx repository

Replace the matching source files from this ZIP in your existing repository, including `api/`, the new `server/` folder, configuration, and lockfile. Preserve your own `.env.local`, Git history, and project settings. No database schema replacement is needed for this update: `waitingSince` is stored in the existing case JSON payload.

Run `npm ci`, `npm test`, and `npm run build`, then commit and push using your usual Git workflow. See [docs/UPDATE-NOTES.md](docs/UPDATE-NOTES.md).

## Push to a new GitHub repository

Create a **new empty repository** named `relayrx` on GitHub. Do not initialize that new remote with a README, license, or `.gitignore`. In PowerShell, inside the extracted `relayrx` folder:

```powershell
git init
git add .
git commit -m "Build RelayRx refill coordination prototype"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/relayrx.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username. If Git asks for an author identity, configure your own Git name and email and run the commit again. Use an existing repository's normal pull/merge process if that repository already has commits.

For later updates:

```powershell
git add .
git commit -m "Update RelayRx"
git push
```

## Deploy on Vercel through Git

1. In Vercel, choose **Add New → Project** and import your GitHub `relayrx` repository.
2. Select the folder containing `package.json` as the **Root Directory**. If the repository contains the project files directly, leave this as the repository root. If you uploaded an outer folder, select `relayrx`.
3. Use these settings:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | `GEMINI_API_KEY` for the three AI copilots; workflow alone needs none |

4. Deploy. The included `vercel.json` sets the build/output values, browser security headers, and refresh-safe routes for all six app pages. The `/api/workspace` and `/api/copilot` paths remain server functions. Set `GEMINI_API_KEY` in Vercel Project Settings → Environment Variables before deployment, or redeploy after adding it.
5. Future pushes to the connected production branch trigger deployments through Vercel's Git integration.

**A 404 usually means the wrong root or output directory.** Confirm that Vercel builds the folder containing this `package.json`, and that the output is `dist`. Upload the whole project, not only the HTML file. No deployment was created as part of this package.

Official deployment references: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Git integration](https://vercel.com/docs/git), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

## What's included

- **Refill workspace:** synthetic intake, queue search/filter, role views, next action, evidence capture, and audit history.
- **Waiting timer:** each pending action has a persisted 3-minute clock, equivalent to 30 simulated hours. Expiry updates the existing Needs Attention count/filter while preserving the actual workflow status.
- **Three Gemini copilots:** a round movable launcher opens Practice Staff, Clinician, or Pharmacy assistance using live case context. Explanations and drafts are read-only; authorization and fulfillment stay human-controlled.
- **Refill circuit:** five mandatory inputs, 0–15 readiness, fixed comparator threshold, and an independent clinician hold.
- **Circuit lab:** interactive comparison/subtraction, signal sliders, requirement toggles, and hold override.
- **Patient updates:** human-reviewed, state-derived message previews. No messages are sent.
- **Insights:** metrics calculated from the current sample records; CSV export contains aggregate synthetic metrics only.
- **Growth playbook:** customer segment, buyer/user map, eight stages with advancement signals, proposed pricing, and an adjustable ROI estimate.
- **System & trust:** implemented boundaries, optional database mode, failure simulation, and production gaps.

## How the redstone logic works

| Concept | Implemented behavior |
|---|---|
| Signal strength | Each of five verified inputs adds 3 units; maximum 15 |
| Compare mode | `output = rear >= side ? rear : 0` |
| Subtract mode | `output = max(rear - side, 0)`; educational lab only |
| Refill comparator | Side input is fixed at 15; all five requirements are also checked individually |
| Safety gate | A clinical hold or decline blocks routing regardless of signal |
| Repeater analogy | Up to three handoff attempts, followed by human escalation |
| Signal-loss analogy | A 3-minute pending-action wait flags Needs Attention; no evidence decay, auto-resolution, or clinical urgency inference |
| Output lamp | Handoff readiness, not prescribing eligibility or confirmation of dispensing |

The inputs are **identity, prescription details, visit/review requirement, coverage/administration, and clinician authorization**. The +3 encoding is our workflow design, not a literal recreation of Minecraft wiring. Readiness is neither a clinical risk score nor an AI confidence score. Unknown or conflicting data must be verified by a human.

The [official comparator guide](https://www.minecraft.net/en-us/article/taking-inventory--redstone-comparator) explains the game's comparison, subtraction, and 0–15 container readings. RelayRx has no affiliation with Minecraft, Mojang, or Microsoft and includes no game artwork.

## Connected sandbox: Supabase + Vercel API

This mode adds real sign-in and durable shared **synthetic** records. It does not make the system suitable for real healthcare use. Hosting services may have costs; review their terms and pricing before creating resources.

1. Create a separate Supabase sandbox project.
2. Run `supabase/schema.sql` once in that project's SQL editor. It creates four tables, read policies, restricted grants, and the atomic `rr_commit` function. Use a fresh database; this is an initial migration, not an idempotent upgrade script.
3. Create three synthetic test users in Supabase Authentication. Configure passwords in Supabase, not in source code. Use appropriate confirmed test accounts.
4. Adapt and run the commented example in `supabase/provision.sql`, replacing the three Auth UUIDs. Each user has exactly one membership: `staff`, `clinician`, or `pharmacy`. Role and workspace come from this table, never from the browser.
5. Add the following environment variables to the Vercel project, then redeploy:

| Variable | Value / location |
|---|---|
| `VITE_DATA_MODE` | `supabase` |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key for Auth |
| `SUPABASE_URL` | Same project URL, server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role credential |

Never prefix the service-role key with `VITE_`, commit it, or put it into client code. All `VITE_` variables are public build-time values. Changing them requires a new build. `.env` files are ignored by Git.

6. Sign in as staff and create a synthetic refill. The connected workspace starts empty; it does not import local demo data. Sign in as the other provisioned roles to exercise their actions. The workspace refreshes every five seconds and on focus to see another user's changes; the Refresh button is also available.

For local API development, copy `.env.example` to `.env.local`, fill it privately, and run `npm run dev`. The included development middleware runs both API handlers. Restart after changing server environment variables.

Connected sessions are kept in memory (`persistSession: false`); reloading the page requires signing in again. Cases are kept in React memory, not browser local storage. This prototype has a 200-case working-set cap and one tenant membership per user. It has no realtime subscription, automatic SMS, background retry worker, or live e-prescribing connector.

The backend validates the session with Supabase `getUser`, resolves membership, checks the role through the shared workflow engine, and commits state plus audit atomically. RLS restricts tenant reads. Browser roles cannot write tables or execute the mutation function directly. Application administrators and the service role remain privileged.

Official references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

## Demo the three-minute waiting threshold

Follow [docs/DEMO.md](docs/DEMO.md). For architecture, API shape, state transitions, limitations, and the 24-hour build plan, see [docs/PRODUCT-AND-ARCHITECTURE.md](docs/PRODUCT-AND-ARCHITECTURE.md).

## Verification

The update passes 31 automated tests and the production TypeScript/Vite build. Coverage includes exact timer boundaries, completing actions just before expiry, attention recovery, stale deadlines, closed/declined exclusions, retry behavior, all three copilot contexts, server-only key handling, stale Gemini responses, tenant/role checks, and the original workflow/database tests.

Gemini API behavior is tested with mocked upstream responses. A real response requires your key and enabled model. Supabase Auth and a real Vercel deployment require verification with your configured services. The browser demonstration checks real elapsed time, the attention count/filter, pharmacy continuation, pickup resolution, role-specific panels, key-setup feedback, and dragging the launcher. This is not a completed accessibility or device certification.

## Scope and security

This is a hackathon MVP and test sandbox. Seed evidence is fictional. Demo role selection is **not authentication** and local history is editable through browser storage. No clinical prescribing decision, insurance determination, or live message delivery is automated. Full clinical validation, professional identity verification, case-level sharing across organizations, infrastructure hardening, agreements, integration validation, monitoring, and legal/privacy review are prerequisites for a real patient-data deployment. No compliance certification is claimed.
