import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAuthRecoveryContent } from './recoveryState';

describe('getAuthRecoveryContent', () => {
  it('shows a neutral progress state while authentication is busy', () => {
    assert.deepEqual(getAuthRecoveryContent(true), {
      state: 'busy',
      title: 'Updating your session...',
      message: 'Please wait while the sign-in process finishes.',
    });
  });

  it('shows a clear recovery action when signed out', () => {
    assert.deepEqual(getAuthRecoveryContent(false), {
      state: 'signed-out',
      title: 'Sign in to continue',
      message: 'Your session may have expired. Your TODO data is safe; sign in again to reload this page.',
    });
  });
});
