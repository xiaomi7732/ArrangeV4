import type {
  AcquireToken,
  AuthInteraction,
  StoreOperationOptions,
} from './types';

/**
 * Keeps token acquisition policy and in-flight deduplication consistent.
 * Silent-only calls use a separate slot so they can never inherit an
 * interactive fallback from a concurrent user-initiated operation.
 */
export class TokenAcquisitionCoordinator {
  private readonly tokensInFlight = new Map<AuthInteraction, Promise<string>>();

  constructor(private readonly acquireToken: AcquireToken) {}

  getToken(options?: StoreOperationOptions): Promise<string> {
    const interaction = options?.interaction ?? 'allow-interactive';
    const inFlight = this.tokensInFlight.get(interaction);
    if (inFlight) return inFlight;

    const token = interaction === 'silent-only'
      ? this.acquireToken({ silentOnly: true })
      : this.acquireToken();
    this.tokensInFlight.set(interaction, token);

    const clear = () => {
      if (this.tokensInFlight.get(interaction) === token) {
        this.tokensInFlight.delete(interaction);
      }
    };
    token.then(clear, clear);
    return token;
  }
}
