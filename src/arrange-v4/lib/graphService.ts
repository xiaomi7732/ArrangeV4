import { Client } from '@microsoft/microsoft-graph-client';

/**
 * Low-level Microsoft Graph utilities.
 *
 * After the storage abstraction landed, this file is intentionally minimal:
 * just an authenticated client factory plus the one user-info endpoint that
 * the Books page calls directly. All calendar CRUD lives in `lib/store/calendar/`.
 */

export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

export interface UserInfo {
  displayName?: string;
  userPrincipalName?: string;
}

export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  const client = createGraphClient(accessToken);
  return client.api('/me').get();
}
