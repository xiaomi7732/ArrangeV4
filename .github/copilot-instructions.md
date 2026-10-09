# Copilot Instructions — Arrange V4

## Build & Run

```bash
cd src/arrange-v4
npm ci          # install (use ci, not install, for reproducible builds)
npm run dev     # dev server at http://localhost:3000
npm run build   # static export to src/arrange-v4/out
npm run lint    # ESLint (Next.js Core Web Vitals + TypeScript presets)
npm test        # type-check tsconfig.test.json, then run the compiled tests
```

### Tests

Tests use **Node's built-in test runner** (`node:test` + `node:assert/strict`) — there is no Jest/Vitest. `npm test` compiles the files listed in `tsconfig.test.json` to `.test-dist/` (CommonJS) and runs the explicit file list in the `test` script.

Run a single test file by compiling first, then pointing `node --test` at the compiled output:

```bash
cd src/arrange-v4
npx tsc --project tsconfig.test.json
node --test .test-dist/lib/search/taskQuery.test.js
node --test --test-name-pattern "toggle" .test-dist/lib/checklist.test.js
```

**Adding a test file requires three edits**, or it silently never runs:

1. Create `lib/<area>/<name>.test.ts` next to the code it covers.
2. Add both the source file and the test file to the `include` array in `tsconfig.test.json`.
3. Add `.test-dist/lib/<area>/<name>.test.js` to the `test` script in `package.json`.

Only pure, DOM-free logic is tested. Hooks are tested by driving their exported pure helpers or by stubbing globals — React components and the `app/` pages have no tests. Backend stores are tested against a stubbed `fetch`/token acquirer rather than live Graph or Google APIs.

## Architecture

Arrange is a **fully client-side** Next.js 16 app (App Router, `output: "export"`) with **no backend**. The browser authenticates with the user's own identity provider and talks directly to that provider's API. There is no middleware, no API routes, and no Arrange-owned data store. The user's own cloud account *is* the database.

### The two abstractions everything hangs off

Two parallel interfaces decouple the UI from the provider. Feature code must go through them and must not import MSAL, Graph, or Google SDKs directly.

| Abstraction | Interface | Implementations | Entry point for UI |
|---|---|---|---|
| Auth | `lib/auth/types.ts` → `AuthClient` | `auth/microsoft/MicrosoftAuthClient.ts`, `auth/google/GoogleAuthClient.ts` | `useAuthClient()` / `useAuthProvider()` |
| Storage | `lib/store/types.ts` → `TodoStore` | `store/calendar/CalendarStore.ts`, `store/sheets/GoogleSheetsStore.ts` | `useStore()` |

`lib/store/multiStore.ts` (`MultiBackendStore`) is the only thing a page touches. It routes each call to a backend and **throws if the book's backend is not the active backend**, so a signed-in Google user can never write into a calendar book.

### Book IDs are prefixed; item IDs are not

`BackendKind` is `'calendar' | 'google'`, with ID prefixes `cal:` and `sheet:`. Routing is done purely off that prefix.

- Build IDs with `makeBookId(backend, nativeId)`; never concatenate by hand.
- Parse with `parseBookId()`, which returns `null` for an unknown prefix.
- Normalize **every** externally-sourced ID (URL params, `localStorage`) with `normalizeBookId()` at the boundary.
- An unprefixed ID is deliberately treated as a legacy *calendar* ID, so old URLs and stored values keep working. Do not "clean this up".
- Item IDs are bare backend IDs, because they only have meaning inside a book.

### Data model per backend

**Calendar (Microsoft Graph).** Books are Outlook calendars whose names end with `" by arrange"` (see `store/calendar/utils.ts`); items are events in them. `subject` → title, `start`/`end` → ETS/ETA, `categories` → tags, and `body.content` holds a `<pre>` block of JSON between `====ArrangeDataStart====` / `====ArrangeDataEnd====` markers carrying `status`, `urgent`, `important`, `checklist`, `remarks`, order fields, and timestamps. Encode/decode only via `store/calendar/body.ts`, which escapes marker-lookalikes in user text and tolerates the zero-width/NBSP junk Outlook injects.

**Google Sheets.** Books are Drive spreadsheets tagged with the `arrange=v4` app property; items are rows in the `TODOs` sheet, with the column schema in `store/sheets/schema.ts`. **The sheet is append-only**: an update appends a row patching only the changed fields, and a delete appends a tombstone. Current state is rebuilt by resolving per-field parent operations recorded in the `__arrange_metadata` column. Never rewrite history rows in place.

### `dataUnreadable` — a hard write barrier

When a backend cannot parse an item's stored payload, it returns the item with defaults and `dataUnreadable: true`. Stores **refuse writes** to such items rather than overwriting data they could not read. Callers must not queue background writes against them: use `dropUnwritableUpdates()` for batch reorders and `partitionWritableItems()` + `describeSkippedUnwritable()` for bulk edits (`lib/optimisticUpdate.ts`), so one damaged item does not fail an entire batch.

### Window anchor vs planned dates (calendar backend only)

Non-terminal items (`new`, `inProgress`, `blocked`) are fetched via a ±30-day `calendarView` window, so an item whose dates age out would silently vanish from the boards. To prevent that **without touching the user's plan**, the two concerns are separated:

- The event's `start`/`end` is only a **window anchor** — a placeholder that keeps the event inside the fetch window.
- The task's real ETS/ETA live in the stored JSON payload (`etsDateTime`/`etaDateTime` in `store/calendar/storedFields.ts`), which is authoritative on read.

`store/calendar/windowAnchor.ts` rolls a stale anchor forward to today (same UTC time-of-day, same duration); `store/calendar/itemDates.ts` resolves what to show and what to patch, emitting an anchor patch only when it actually moves. Sweeping (`sweepStaleItems`) keys off `item.windowAnchorDateTime`, never the task's ETS — a task may legitimately keep a long-past ETS forever. Anchoring is invisible: no badge, no date change, no edit timestamp. A terminal item is never anchored and is never moved back either: a task finished today but planned months ago would drop straight out of the window and out of the Finished lane.

Two consequences to respect when touching this area:

- **A window query must cover the anchor zone.** Graph matches on the event, so a task planned outside the requested period can be anchored inside it and vice versa. `CalendarStore.listItems` runs a `range: 'window'` query over `anchorZoneRanges` — one merged query when the period overlaps the anchor zone, two queries (deduped by event id) when it does not — and callers filter on the planned dates they get back (Timeline already does).
- **An event moved outside Arrange wins.** Each write records where it put the event in `anchorStartDateTime`/`anchorEndDateTime`. If the event no longer sits there (compared with a minute's tolerance, since Graph rounds), somebody rescheduled it in Outlook, and those dates become the task's ETS/ETA.

Legacy items bumped by the old scheme are migrated on read via `originalEtsDateTime`/`originalEtaDateTime`: those originals win over the stored dates, but only while the event still looks like the old scheme's bump of them (same UTC time-of-day and duration) — otherwise the event has been rescheduled since and that is the newer intent. A legacy pair that would run backwards — the old scheme cleared the two originals independently — is discarded whole in favour of the event. The legacy fields are cleared on the next write and are read-only migration input: never write new values to them.

Only backends that page through a window need this. `store.supportsWindowSweep` gates the Matrix sweep; the Sheets backend returns all non-terminal items and is never swept.

### Authentication

The active provider is held in `lib/auth/AuthContext.tsx`, persisted in `localStorage` under `arrange_auth_provider`, and published through `useSyncExternalStore` so provider switches propagate without a reload. Google is only offered when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set and `NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER !== 'false'`; otherwise the app is Microsoft-only.

MSAL authenticates against the `consumers` authority (personal Microsoft accounts), redirect URI `window.location.origin + NEXT_PUBLIC_BASE_PATH`, tokens cached in `sessionStorage`.

Token acquisition always runs through `store/tokenAcquisition.ts` (`TokenAcquisitionCoordinator`), which deduplicates concurrent requests per policy. Pass `interaction: 'silent-only'` (`StoreOperationOptions`) for anything triggered by an effect or background refresh — only user-initiated actions may fall back to an interactive popup. When silent acquisition fails under that policy the store throws `InteractiveAuthenticationRequiredError`, which pages surface via the shared `AuthRecoveryPanel`.

### State management

All state is React hooks (`useState`, `useMemo`) — no global state library. Persistent client-side state (last selected book, sweep tracking) uses `localStorage`/`sessionStorage` via `bookStorage.ts`. The book list itself is additionally mirrored in a module-level cache (`lib/books/bookListCache.ts`) so the top-bar book switcher renders from the last known list while a page re-fetches, instead of flashing out of existence on every navigation; pages that mutate books must keep it honest (`/books` clears it around create/delete, and it is cleared on sign-out).

Saved search/filter presets are persisted separately by `lib/search/filterPresets.ts` under `arrange_filterPresets_<backend>_<nativeId>_<scope>` keys, so they never leak across books or storage backends. A scope is a set of filter *controls*, and `SCOPE_CAPABILITIES` is the single source of truth for which criteria each scope supports — it drives both the hook's `supportsCategoryFilters`/`supportsPriorityFilters` flags and the stripping done by `sanitizeTaskQuery`, so a view can never hold criteria it cannot show. Scrum uses `board` (search, status, tags, priority); Matrix uses `matrix` (no priority — the quadrants already express it) and inherits the `board` presets once, priority stripped; the search-only Cancelled and Timeline views keep their own scopes. Everything read back from storage is sanitized before use.

### Unsaved-edit guard

Every dialog that holds edits (`AddTodoItem`, `ViewTodoItem` in edit mode, `CreateCalendar`) routes *all* of the close paths it offers — Cancel and Escape everywhere, plus the overlay click in `ViewTodoItem`, which is the only one of the three whose overlay dismisses it — through `useDiscardGuard` (`lib/hooks/useDiscardGuard.ts`), which shows the shared `ConfirmDiscardDialog` only when the form is genuinely dirty. Dirtiness is decided by `hasUnsavedChanges()` in `lib/unsavedChanges.ts` against a baseline captured when the dialog opened. A dialog that confirms when nothing changed is worse than no prompt at all, so the comparison is deliberately biased toward "clean" and mirrors what that form's save actually writes. The two hosts that use `useModalDialog` (`AddTodoItem`, `ViewTodoItem`) pass `{ paused: true }` while the prompt is up so the focus trap does not fight the nested prompt; `CreateCalendar` has no trap to pause.

### Optimistic UI

User actions immediately update local state, then sync to the backend in the background. On failure, state rolls back to a snapshot captured *before* the optimistic update, using `snapshotItems()` / `restoreSnapshot()` from `lib/optimisticUpdate.ts`. `restoreSnapshot` never resurrects a removed item and returns the original array when nothing changed, keeping state identity stable. This pattern covers drag-and-drop quadrant changes, status updates, field edits, and checklist toggles.

## Key modules (src/arrange-v4/lib/)

| Path | Responsibility |
|---|---|
| `store/types.ts` | `TodoStore` / `TodoItem` / `Book` contracts and the book-ID prefix helpers |
| `store/multiStore.ts` | Routes every call to the backend named by the book-ID prefix |
| `store/useStore.ts` | Hook returning a memoized `MultiBackendStore` bound to the current auth client |
| `store/calendar/CalendarStore.ts` | Graph calendars/events CRUD with `@odata.nextLink` pagination |
| `store/calendar/body.ts` | Encode/decode the marker-delimited JSON payload in an event body |
| `store/calendar/windowAnchor.ts` | Rolls a stale window anchor forward; planned dates are never touched |
| `store/calendar/itemDates.ts` | Resolves stored/legacy/event dates and the anchor patch to write |
| `store/sheets/GoogleSheetsStore.ts` | Drive/Sheets CRUD with the append-only mutation queue |
| `store/sheets/schema.ts` | `TODOs` column schema, row (de)serialization, operation-history resolution |
| `store/tokenAcquisition.ts` | Deduplicating token coordinator honoring the silent-only policy |
| `store/moveItem.ts` | Moves an item between books as copy-then-delete, since no backend has a move primitive |
| `hooks/useMoveTodo.ts` | Binds `moveItemToBook` to a page's store and state; used by all four task views |
| `modalOverlay.ts` | Decides when a backdrop press dismisses a dialog (both ends on the backdrop) |
| `auth/AuthContext.tsx` | Active-provider selection, persistence, and login/logout |
| `graphService.ts`, `msalConfig.ts` | Low-level Graph client and MSAL config used by the Microsoft auth client |
| `optimisticUpdate.ts` | Snapshot/rollback plus the `dataUnreadable` write-barrier helpers |
| `orderUtils.ts` | `matrixOrder` / `scrumOrder` sparse ordering for drag-and-drop |
| `search/taskQuery.ts` | Backend-neutral search/filter model and `filterTasks()`, shared by Matrix, Scrum, Cancelled |
| `search/filterPresets.ts` | `localStorage` CRUD for named filter presets plus the per-scope capability table |
| `search/useTaskQuery.ts` | Hook binding query state to preset storage for a page |
| `books/sortBooks.ts` | One name ordering for every book list; `MultiBackendStore.listBooks` applies it |
| `timeline/timelineWindow.ts` | Pure zoom/pan/bar/tick geometry behind the Timeline view |
| `timeline/timelineRows.ts` | Turns tasks into drawable bars; also the source of the Timeline's result counts |
| `timeline/timelineDrag.ts` | Pure snap/resize arithmetic for dragging a bar's start or end |
| `unsavedChanges.ts` | Dirty detection and close-intent resolution for the discard guard |
| `hooks/useDiscardGuard.ts` | Routes every dialog close path through one confirmation |
| `books/bookName.ts` | Book-name validation and `" by arrange"` suffix handling |
| `books/bookListCache.ts` | Module-level book list cache so the book switcher does not flash between views |
| `dateUtils.ts` | Local-calendar-date comparisons for Today filters and relative day labels |
| `checklist.ts` | Parse/format/toggle the stored `-[]` / `-[x]` checklist entries |
| `bookStorage.ts` | `localStorage`/`sessionStorage` helpers for last-book-id and sweep state |
| `hooks/useRefreshOnPageActivation.ts` | Refresh when a visible tab resumes or regains focus |

### Views

| Route | Purpose | Fetch range | Filter controls |
|---|---|---|---|
| `/matrix` | Eisenhower quadrants, drag-and-drop, keeps items in the fetch window | window, today ±30d | search, status, tags (`matrix` presets) |
| `/scrum` | Status columns, drag-and-drop | window, today ±30d | search, status, tags, priority (`board` presets) |
| `/timeline` | Gantt chart; zoom and pan the period, drag a bar's ends to reschedule | window derived from the visible period, padded | search only (`timeline` presets) |
| `/cancelled` | Review and bulk-delete cancelled tasks | all | search only (`cancelled` presets) |

Every one of them uses `useBookId`, `useTaskQuery`, `filterTasks`, `useRefreshOnPageActivation`, `useSetTopBarActions`, `AuthRecoveryPanel`, and `ErrorBanner`, and guards fetches with a `fetchSequenceRef` + `bookIdRef` pair so a stale or cross-book response can never land. New task views should follow the same shape, and must be added to `BASE_NAV_ITEMS` and `ViewSwitcherInner` in `components/HamburgerMenu.tsx`.

## Conventions

- **TypeScript strict mode** with `isolatedModules`. Nullability must be modeled explicitly (e.g., `useRef<T | null>(null)`).
- **Path alias**: `@/*` maps to the project root — use `@/lib/store/useStore` style imports. `tsconfig.test.json` mirrors this alias, so test files use it too.
- **CSS Modules**: Every component has a colocated `.module.css` file. No global CSS beyond `globals.css`. `ViewTodoItem` shares `AddTodoItem.module.css`, so a change there lands in both TODO dialogs. The dialog tab strip draws its active accent with an inset `box-shadow` rather than a border plus negative margin, so the underline takes no space, never provokes a vertical scrollbar, and stays visible while the strip scrolls horizontally.
- **Status colours are tokens**: the one palette lives in `globals.css` as `--status-<status>-{fg,border,bg,bg-strong}` and `--urgent-{fg,bg}` custom properties. Matrix badges, Scrum filters, and Timeline bars all reference them, so a status reads the same everywhere; never hard-code a status colour in a module.
- **Board pages fill the viewport**: `/matrix`, `/scrum`, and `/timeline` keep the page itself unscrolled (`container`/`inner`/`card` are `overflow: hidden` flex columns from the `md` breakpoint up) and scroll only their inner surface, so the toolbar and hint stay put.
- **Component files**: PascalCase (`AddTodoItem.tsx`). No barrel/index exports.
- **Client components**: Pages and components use `'use client'` since there is no server runtime.
- **basePath**: Configurable via `NEXT_PUBLIC_BASE_PATH` env var. Use Next.js `Link`/`useRouter` for navigation (never raw `<a href="/">`) to respect the base path.
- **Shared UI for shared behavior**: Matrix, Scrum, Cancelled, and Timeline deliberately share `AuthRecoveryPanel`, `TaskSearchBar`, `ViewTodoItem`, `ModalOverlay`, `useMoveTodo`, `useRefreshOnPageActivation`, and `useDiscardGuard`; `SortableTodo` (with its collision detection and keyboard coordinates) is shared by the two sortable boards, Matrix and Scrum, only. Extend the shared piece rather than forking a per-page variant.
- **Dialogs dismiss alike**: every modal backdrop is `ModalOverlay`, which dismisses only when a press both starts and ends on the backdrop, and routes that dismissal through the same discard guard as Escape and Cancel.
- **Moving an item between books** is a copy into the destination followed by a delete from the source (`store/moveItem.ts`). The copy goes first so a half-failed move leaves a visible duplicate rather than nothing; board positions are dropped and `dataUnreadable` items are refused. The copy is written with `createItem(..., { asCopy: true })` so the destination does not apply new-task defaults (an item finished without a recorded finish time keeps that gap), and a `PartialMoveError` blocks any further move of that item for as long as the page is open.
- **Saving an edit keeps the dialog open**: `ViewTodoItem` leaves edit mode and shows the freshly saved item read-only instead of closing, so a save is not also a dismissal. Each page derives the dialog's item from its current list by id (keeping the selection it was handed only as a fallback), so a refresh that lands while the dialog is open updates it. Because the prop can therefore move under an open editor, pressing Edit freezes an `editBaseline`: that one copy seeds the form, generates the save patch, and backs the discard guard, so a refresh is never mistaken for the user's own edit. For the same reason the optimistic view-mode checklist is dropped as soon as its write lands.
- **Rare controls stay collapsed**: the move-to-another-book control in `ViewTodoItem` is a plain text toggle that reveals the picker on demand, so the common read path is not crowded by a destructive action.
- **Truncated text exposes a native `title`**: any card title that clamps or ellipsises (Scrum cards, the Cancelled list) carries `title={todo.subject}` so the full text is reachable on hover without a custom tooltip.
- **The top bar's title is centred** in its own region: from the left it would shift the book selector every time the page name changed length.
- **Don't add a second affordance** for something an existing gesture already expresses — duplicate paths make the UI clunky.
- **Dates**: user-facing "today"/relative-day logic compares *local* calendar dates via `dateUtils.ts`, not UTC dates or elapsed 24-hour periods. (The calendar window anchor is the exception: it works in UTC against the Graph window.)
- **The user's plan is theirs**: no mechanism may silently rewrite an ETS/ETA the user chose. Storage-level workarounds (such as the calendar window anchor) must stay invisible to the task's own data.
- **Storage reads are untrusted**: everything read back from `localStorage`/`sessionStorage` is sanitized and normalized before use.
- **Version badge**: `NEXT_PUBLIC_APP_VERSION` defaults to `"local"` in dev; CI sets it to `YYYYMMDDHHmm-<short SHA>`.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_AZURE_CLIENT_ID` | Azure AD app registration client ID | Built-in dev ID |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth web client ID; empty hides the Google provider | `""` |
| `NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER` | Set to `false` to force Microsoft-only | `true` |
| `NEXT_PUBLIC_BASE_PATH` | Base path for hosted deployments | `""` |
| `NEXT_PUBLIC_APP_VERSION` | Version shown in UI | `"local"` |

Copy `src/arrange-v4/.env.example` to `.env.local` for local overrides. Google provider setup is documented in `src/arrange-v4/GOOGLE_SETUP.md`.

## CI/CD

The GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push to `main`:

1. `npm ci` → `npm run build` (with version stamp and Google client ID from repo variables) → uploads `src/arrange-v4/out` artifact.
2. Deploys static files to GitHub Pages.

The workflow does **not** run `npm test` or `npm run lint` — run both locally before pushing.

## Repository layout note

Only `src/arrange-v4/` is the live app. `prototype/` (a C# console proto and an earlier React proto) and `ArrangeV4.sln` are historical and are not built by CI; `devnotes/` holds background notes such as the TODO item spec.
