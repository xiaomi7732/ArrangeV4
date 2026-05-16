import { Client } from '@microsoft/microsoft-graph-client';

/**
 * Low-level Microsoft Graph utilities.
 *
 * After the storage abstraction landed, this file is intentionally minimal:
 * just an authenticated client factory used by the calendar store. All
 * calendar CRUD lives in `lib/store/calendar/`. User info is sourced from
 * the active AuthClient (`auth.getUser()`) instead of `/me`.
 */

export function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}
