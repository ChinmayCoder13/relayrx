# Add your Gemini key

All three copilots use one server-side Gemini integration. You never need to paste the key into React components or the chatbot.

## On Vercel

1. Import or update the existing RelayRx Git repository. Include the whole project, especially `api/copilot.ts` and `server/copilot.ts`.
2. Open your Vercel project → **Settings → Environment Variables**.
3. Add the name **`GEMINI_API_KEY`** and paste your key into its value.
4. Select the environments where you want to use it, then save.
5. **Redeploy** (or push a new commit) so the server function receives the key.

Optional: add `GEMINI_MODEL` if you want a different model enabled for your key. The default is `gemini-3.5-flash`. Set `DEMO_COPILOT_ENABLED=false` if you want to disable the unauthenticated demo endpoint; connected mode still requires valid Supabase membership.

Do not use `VITE_GEMINI_API_KEY`: `VITE_` variables are public browser values. Do not commit the key to Git. No key is included in this ZIP.

## On your computer

Inside the folder containing `package.json`, copy `.env.example` to `.env.local`. On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Edit `.env.local` and set:

```dotenv
GEMINI_API_KEY=PASTE_YOUR_KEY_HERE
GEMINI_MODEL=gemini-3.5-flash
VITE_DATA_MODE=demo
DEMO_COPILOT_ENABLED=true
```

Then run:

```powershell
npm ci
npm run dev
```

Open `http://localhost:4173`, select a case, and click the round **AI** button. Restart the development server whenever you change `.env.local`. This file is ignored by Git.

`npm run preview` serves only the built frontend. It does not start the API functions. Use `npm run dev` locally or deploy the complete project to Vercel for AI.

## Check all three copilots

- **Practice staff:** ask why the case is blocked and who owns the next action.
- **Clinician:** ask what information is verified or missing. The response should leave the clinical decision with the clinician.
- **Pharmacy:** ask what remains before pickup is confirmed. Routing alone is never fulfillment.

In demo mode, change roles using either the main selector or the copilot's role buttons. In connected mode, your authenticated membership chooses the role. Conversations are separate for each case and role and remain in memory only. When a workflow step or attention state changes, earlier guidance is hidden and new questions use the fresh state.

The green/orange live case card always works without Gemini and is labeled **Verified workflow state · not an AI response**. Generated answers are labeled **Gemini · review before using**. Drafts do not send messages or update cases.

## If you see an error

- **Not configured:** check the exact variable name, selected Vercel environment, and redeploy/restart.
- **Model unavailable:** set `GEMINI_MODEL` to a model available to your Google project, then redeploy/restart.
- **Quota/rate limit:** check your Gemini project quota or wait for the application's one-minute limit.
- **Case changed:** ask again using the refreshed case. This prevents guidance from an outdated snapshot.
- **API unavailable locally:** use `npm run dev`, not a static HTML server or `npm run preview`.

The provided tests use mock Gemini responses; your real key must be checked after configuration. The app remains a synthetic-data hackathon sandbox.

Official reference: https://ai.google.dev/gemini-api/docs/api-key
