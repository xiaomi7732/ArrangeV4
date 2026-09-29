export type AuthRecoveryState = 'busy' | 'signed-out';

export interface AuthRecoveryContent {
  state: AuthRecoveryState;
  title: string;
  message: string;
}

export function getAuthRecoveryContent(busy: boolean): AuthRecoveryContent {
  if (busy) {
    return {
      state: 'busy',
      title: 'Updating your session...',
      message: 'Please wait while the sign-in process finishes.',
    };
  }

  return {
    state: 'signed-out',
    title: 'Sign in to continue',
    message: 'Your session may have expired. Your TODO data is safe; sign in again to reload this page.',
  };
}
