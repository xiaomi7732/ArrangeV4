# Copilot Instructions — Arrange V4

## Build & Run

```bash
cd src/arrange-v4
npm ci          # install (use ci, not install, for reproducible builds)
npm run dev     # dev server at http://localhost:3000
npm run build   # static export to src/arrange-v4/out
npm run lint    # ESLint (Next.js Core Web Vitals + TypeScript presets)
```

There is no test framework configured — no test runner or test scripts exist.

## Architecture

Arrange is a **fully client-side** Next.js 16 app (App Router, `output: "export"`) with **no backend**. The browser authenticates via MSAL and talks directly to the Microsoft Graph API. There is no middleware, no API routes, and no server-side data store.

### Data model: Calendar-as-database

- **Books** = Outlook calendars whose names end with `" by arrange"`.
- **TODO items** = calendar events in those calendars.
  - `subject` → task title.
  - `start`/`end` → estimated start (ETS) and estimated time of accomplishment (ETA).
  - `categories` → tags.
  - `body.content` → HTML containing a `<pre>` block with structured JSON between `====ArrangeDataStart====` / `====ArrangeDataEnd====` markers. This JSON holds `status`, `urgent`, `important`, `checklist`, `remarks`, timestamps, and original pre-bump dates.

### Date-bump behavior

Non-terminal items (`new`, `inProgress`, `blocked`) are fetched via a ±30-day calendar view window. To prevent items from falling out of range, stale dates are bumped forward to today (preserving time-of-day and duration). Original dates are saved to `originalEtsDateTime`/`originalEtaDateTime` on first bump and never overwritten. Terminal items (`finished`, `cancelled`) are never bumped.

### Authentication

MSAL authenticates against the `consumers` authority (personal Microsoft accounts). The redirect URI is `window.location.origin + NEXT_PUBLIC_BASE_PATH`. Tokens are cached in `sessionStorage`. Token acquisition uses `acquireTokenSilent()` with a popup fallback.

### State management

All state is React hooks (`useState`, `useMemo`) — no global state library. Persistent client-side state (last selected book, sweep tracking) uses `localStorage`/`sessionStorage` via `bookStorage.ts`.

### Optimistic UI

User actions immediately update local state, then sync to Graph in the background. On failure, state rolls back to a snapshot captured before the optimistic update. This pattern is used for drag-and-drop quadrant changes, status updates, field edits, and checklist toggles.

## Key Services (src/arrange-v4/lib/)

| File | Responsibility |
|---|---|
| `graphService.ts` | Graph API CRUD for calendars and events, with `@odata.nextLink` pagination |
| `todoDataService.ts` | Domain logic: create/update/parse TODO items, serialize to/from marker-delimited JSON, sweep stale items |
| `msalConfig.ts` | MSAL instance configuration and Graph API scopes (`User.Read`, `Calendars.ReadWrite`) |
| `bookStorage.ts` | `localStorage`/`sessionStorage` helpers for last-book-id and sweep state |
| `calendarUtils.ts` | Filtering calendars by the `" by arrange"` suffix and extracting display names |

## Conventions

- **TypeScript strict mode** with `isolatedModules`. Nullability must be modeled explicitly (e.g., `useRef<T | null>(null)`).
- **Path alias**: `@/*` maps to the project root — use `@/lib/graphService` style imports.
- **CSS Modules**: Every component has a colocated `.module.css` file. No global CSS beyond `globals.css`.
- **Component files**: PascalCase (`AddTodoItem.tsx`). No barrel/index exports.
- **Client components**: Pages and components use `'use client'` since there is no server runtime.
- **basePath**: Configurable via `NEXT_PUBLIC_BASE_PATH` env var. Use Next.js `Link`/`useRouter` for navigation (never raw `<a href="/">`) to respect the base path.
- **Version badge**: `NEXT_PUBLIC_APP_VERSION` defaults to `"local"` in dev; CI sets it to `YYYYMMDDHHmm-<short SHA>`.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Azure AD app registration client ID | Built-in dev ID |
| `NEXT_PUBLIC_BASE_PATH` | Base path for hosted deployments | `""` |
| `NEXT_PUBLIC_APP_VERSION` | Version shown in UI | `"local"` |

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push to `main`:

1. `npm ci` → `npm run build` (with version stamp) → uploads `src/arrange-v4/out` artifact.
2. Deploys static files to GitHub Pages.
