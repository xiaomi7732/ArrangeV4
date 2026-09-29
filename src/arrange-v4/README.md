# Arrange V4

Arrange is a client-side task manager that stores books in either Microsoft
Calendar or Google Sheets.

## Getting started

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Google provider setup

Google support is enabled when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set and
`NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER` is not `false`.

1. Create a Google Cloud project.
2. Enable the Google Drive API and Google Sheets API.
3. Configure an OAuth consent screen.
4. Create a Web application OAuth client and add the local and deployed origins
   to **Authorized JavaScript origins**.
5. Grant the app the `drive.file`, `spreadsheets`, `openid`, `email`, and
   `profile` scopes.
6. Set:

   ```bash
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=<oauth-client-id>
   NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER=true
   ```

For GitHub Pages, set the repository variable `GOOGLE_CLIENT_ID`. The deployment
workflow passes it to the static build. `ENABLE_GOOGLE_PROVIDER` is optional and
defaults to `true`.

Google uses the browser-only OAuth token model. Tokens are kept in
`sessionStorage` with an in-memory fallback, are never sent to an Arrange
server, and require an explicit user action to renew after expiration.

Arrange-created spreadsheets use an append-only history keyed by stable item
IDs. Updates append field-level patches and deletes append terminal tombstones,
so edits from another tab or collaborator merge without positional row writes.
Per-field parent revisions make results independent of row sorting and client
clock differences. Arrange-managed patches leave user-defined columns
untouched.

## Validation

```bash
npm test
npm run lint
npm run build
```
