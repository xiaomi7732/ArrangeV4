# Google Sign-In Setup

This guide enables Google sign-in for the production site at
`https://arrange.codewithsaar.com` and for local development.

## 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select the project menu at the top.
3. Click **New Project**.
4. Name the project **Arrange** and click **Create**.
5. Ensure the new project remains selected.

## 2. Enable the required APIs

1. Open **APIs & Services > Library**.
2. Search for **Google Drive API**, open it, and click **Enable**.
3. Return to the API library.
4. Search for **Google Sheets API**, open it, and click **Enable**.

See [Enable Google Workspace APIs](https://developers.google.com/workspace/guides/enable-apis)
for Google's official instructions.

## 3. Configure the OAuth consent screen

1. Open **Google Auth Platform > Branding**.
2. If prompted, click **Get Started**.
3. Enter:
   - **App name:** `Arrange`
   - **User support email:** an address where users can contact you
4. Under **Audience**, choose **External** so personal Google accounts can use
   the app.
5. Enter the developer contact email.
6. Review and accept the Google API Services User Data Policy.
7. Finish creating the app configuration.
8. Open **Audience > Test users**.
9. Click **Add users** and add every Google account that should be able to test
   the app.

Keep the app in **Testing** while validating the integration. Only listed test
users can authorize an external app in testing mode.

## 4. Register the requested scopes

Open **Google Auth Platform > Data Access > Add or Remove Scopes** and add:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/drive.file
```

Do not add the broad `spreadsheets` or full Drive scope. Arrange intentionally
uses `drive.file`, which limits access to files that Arrange creates or the user
explicitly opens with Arrange.

See [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent)
for Google's official instructions.

## 5. Create the browser OAuth client

1. Open **Google Auth Platform > Clients**.
2. Click **Create Client**.
3. Select **Web application**.
4. Name the client `Arrange Web`.
5. Under **Authorized JavaScript origins**, add:

   ```text
   https://arrange.codewithsaar.com
   http://localhost:3000
   ```

6. If local testing also uses `127.0.0.1`, add:

   ```text
   http://127.0.0.1:3000
   ```

7. Leave **Authorized redirect URIs** empty. Arrange uses the Google Identity
   Services browser token model and has no OAuth redirect endpoint.
8. Click **Create**.
9. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`.
10. Do not use or commit the client secret. This browser application does not
    need it.

See [Use the OAuth 2.0 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
for Google's official description of this flow.

## 6. Configure the GitHub Pages deployment

1. Open the repository's
   [Actions variables](https://github.com/xiaomi7732/ArrangeV4/settings/variables/actions).
2. Select **Variables** under **Secrets and variables > Actions**.
3. Click **New repository variable**.
4. Add:
   - **Name:** `GOOGLE_CLIENT_ID`
   - **Value:** the copied `.apps.googleusercontent.com` Client ID
5. Save the variable.
6. Optionally add:
   - **Name:** `ENABLE_GOOGLE_PROVIDER`
   - **Value:** `true`

Use an Actions variable, not a secret. The deployment workflow reads
`vars.GOOGLE_CLIENT_ID`. The client ID is public browser configuration, not a
credential secret.

## 7. Deploy

Push or merge the configured application into `main`, then wait for the
**Deploy to GitHub Pages** workflow to complete.

If the variable was added after the latest deployment:

1. Open the
   [Deploy to GitHub Pages workflow](https://github.com/xiaomi7732/ArrangeV4/actions/workflows/deploy.yml).
2. Click **Run workflow**.
3. Select `main`.
4. Start the workflow and wait for both jobs to pass.

The Google client ID is embedded during the static build, so changing the
repository variable always requires a new deployment.

## 8. Test production sign-in

1. Open `https://arrange.codewithsaar.com/` in a private browser window.
2. Hard-refresh the page.
3. Verify that the home page shows:
   - **Continue with Microsoft**
   - **Continue with Google**
4. Click **Continue with Google**.
5. Choose a Google account listed under **Audience > Test users**.
6. Review and approve the requested access.

## Local testing

Create `src\arrange-v4\.env.local`:

```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
NEXT_PUBLIC_ENABLE_GOOGLE_PROVIDER=true
```

Then start the app:

```powershell
Set-Location src\arrange-v4
npm ci
npm run dev
```

Open `http://localhost:3000` and select **Continue with Google**.

Do not commit `.env.local`.

## Troubleshooting

### Google button is missing

- Confirm `GOOGLE_CLIENT_ID` is an Actions repository variable with the exact
  name shown above.
- Rerun the GitHub Pages workflow after setting the variable.
- Hard-refresh the deployed page after deployment.

### Error 400: `origin_mismatch`

Add the browser's exact origin under **Authorized JavaScript origins**. Use only
the scheme, host, and port. Do not include a path or trailing slash.

### Access blocked or error 403

While the OAuth app is in testing mode, add the affected Google account under
**Google Auth Platform > Audience > Test users**.

### Sign-in popup does not open

Allow popups for the site and try the Google button again.

### The button says "Retry Google sign-in"

Confirm that browser privacy extensions or network filtering are not blocking:

```text
https://accounts.google.com/gsi/client
```
