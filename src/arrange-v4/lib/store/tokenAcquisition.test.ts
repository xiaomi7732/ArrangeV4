import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AcquireToken, StoreOperationOptions } from './types';
import { TokenAcquisitionCoordinator } from './tokenAcquisition';

interface TokenCall {
  options?: Parameters<AcquireToken>[0];
}

function recordingAcquirer(
  implementation: (options?: Parameters<AcquireToken>[0]) => Promise<string>,
): { acquireToken: AcquireToken; calls: TokenCall[] } {
  const calls: TokenCall[] = [];
  return {
    calls,
    acquireToken: (options) => {
      calls.push({ options });
      return implementation(options);
    },
  };
}

describe('TokenAcquisitionCoordinator', () => {
  it('forwards silent-only policy without an interactive fallback', async () => {
    const failure = new Error('interaction required');
    const { acquireToken, calls } = recordingAcquirer(async () => {
      throw failure;
    });
    const coordinator = new TokenAcquisitionCoordinator(acquireToken);

    await assert.rejects(
      coordinator.getToken({ interaction: 'silent-only' }),
      failure,
    );
    assert.deepEqual(calls, [{ options: { silentOnly: true } }]);
  });

  it('retains default silent-then-interactive acquisition behavior', async () => {
    const { acquireToken, calls } = recordingAcquirer(async () => 'token');
    const coordinator = new TokenAcquisitionCoordinator(acquireToken);

    assert.equal(await coordinator.getToken(), 'token');
    assert.deepEqual(calls, [{ options: undefined }]);
  });

  it('deduplicates concurrent calls with the same policy', async () => {
    let resolveToken: ((token: string) => void) | undefined;
    const pendingToken = new Promise<string>(resolve => {
      resolveToken = resolve;
    });
    const { acquireToken, calls } = recordingAcquirer(() => pendingToken);
    const coordinator = new TokenAcquisitionCoordinator(acquireToken);
    const options: StoreOperationOptions = { interaction: 'silent-only' };

    const first = coordinator.getToken(options);
    const second = coordinator.getToken(options);

    assert.equal(calls.length, 1);
    resolveToken?.('shared-token');
    assert.deepEqual(await Promise.all([first, second]), ['shared-token', 'shared-token']);
  });

  it('acquires a fresh token after an in-flight request settles', async () => {
    let tokenNumber = 0;
    const { acquireToken, calls } = recordingAcquirer(async () => `token-${++tokenNumber}`);
    const coordinator = new TokenAcquisitionCoordinator(acquireToken);

    assert.equal(await coordinator.getToken(), 'token-1');
    assert.equal(await coordinator.getToken(), 'token-2');
    assert.equal(calls.length, 2);
  });

  it('isolates silent-only calls from popup-capable acquisition', async () => {
    const pending = new Map<string, (token: string) => void>();
    const { acquireToken, calls } = recordingAcquirer(options => new Promise(resolve => {
      pending.set(options?.silentOnly ? 'silent' : 'interactive', resolve);
    }));
    const coordinator = new TokenAcquisitionCoordinator(acquireToken);

    const interactive = coordinator.getToken();
    const silent = coordinator.getToken({ interaction: 'silent-only' });

    assert.deepEqual(calls, [
      { options: undefined },
      { options: { silentOnly: true } },
    ]);
    pending.get('interactive')?.('interactive-token');
    pending.get('silent')?.('silent-token');
    assert.deepEqual(
      await Promise.all([interactive, silent]),
      ['interactive-token', 'silent-token'],
    );
  });
});
