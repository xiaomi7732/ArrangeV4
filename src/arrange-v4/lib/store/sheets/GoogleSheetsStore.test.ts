import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GoogleSheetsStore } from './GoogleSheetsStore';
import { TODO_HEADERS } from './schema';
import { isInteractiveAuthenticationRequiredError } from '../../auth/errors';
import type { AcquireTokenOptions } from '@/lib/auth/types';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetchMock(
  handlers: Array<(request: CapturedRequest) => Response | Promise<Response>>,
): { requests: CapturedRequest[]; restore(): void } {
  const original = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const request = { url: String(input), init };
    requests.push(request);
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected fetch: ${request.url}`);
    return handler(request);
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function createStore(acquireToken?: (options?: AcquireTokenOptions) => Promise<string>) {
  return new GoogleSheetsStore({
    activeBackend: 'google',
    acquireToken: acquireToken || (async () => 'google-token'),
    invalidateToken: () => undefined,
  });
}

describe('GoogleSheetsStore', () => {
  it('lists only app-owned spreadsheets and forwards silent token policy', async () => {
    const tokenCalls: Array<AcquireTokenOptions | undefined> = [];
    const mock = installFetchMock([
      () => jsonResponse({
        files: [{
          id: 'sheet-1',
          name: 'Roadmap',
          capabilities: { canEdit: true },
          owners: [{ displayName: 'Ada', emailAddress: 'ada@example.com' }],
        }],
        nextPageToken: 'next',
      }),
      () => jsonResponse({
        files: [{ id: 'sheet-2', name: 'Personal' }],
      }),
    ]);
    try {
      const store = createStore(async options => {
        tokenCalls.push(options);
        return 'google-token';
      });
      const books = await store.listBooks({ interaction: 'silent-only' });

      assert.deepEqual(books.map(book => [book.id, book.name, book.backend]), [
        ['sheet:sheet-1', 'Roadmap', 'google'],
        ['sheet:sheet-2', 'Personal', 'google'],
      ]);
      assert.deepEqual(tokenCalls, [{ silentOnly: true }]);
      assert.match(mock.requests[0].url, /appProperties/);
      assert.match(mock.requests[1].url, /pageToken=next/);
      assert.equal(new Headers(mock.requests[0].init.headers).get('Authorization'), 'Bearer google-token');
    } finally {
      mock.restore();
    }
  });

  it('creates and tags a spreadsheet before initializing its TODO header', async () => {
    const mock = installFetchMock([
      request => {
        assert.equal(request.init.method, 'POST');
        return jsonResponse({
          spreadsheetId: 'created-sheet',
          sheets: [{ properties: { sheetId: 42, title: 'TODOs' } }],
        });
      },
      request => {
        assert.equal(request.init.method, 'PATCH');
        assert.match(String(request.init.body), /"arrange":"v4"/);
        return jsonResponse({ id: 'created-sheet' });
      },
      request => {
        assert.equal(request.init.method, 'PUT');
        const body = JSON.parse(String(request.init.body)) as { values: unknown[][] };
        assert.deepEqual(body.values[0], Array.from(TODO_HEADERS));
        return jsonResponse({ updatedRows: 1 });
      },
    ]);
    try {
      const store = createStore();
      const book = await store.createBook('Launch Plan by arrange', { backend: 'google' });

      assert.deepEqual(book, {
        id: 'sheet:created-sheet',
        name: 'Launch Plan',
        backend: 'google',
        canEdit: true,
      });
    } finally {
      mock.restore();
    }
  });

  it('updates a row by stable UUID while preserving untouched fields', async () => {
    const existingRow = [
      'todo-1',
      'Existing subject',
      '',
      '',
      'new',
      false,
      true,
      '["tag"]',
      '',
      '',
      '',
      '',
      '',
      '',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '',
      '',
    ];
    const mock = installFetchMock([
      () => jsonResponse({ values: [Array.from(TODO_HEADERS), existingRow] }),
      request => {
        assert.equal(request.init.method, 'PUT');
        const body = JSON.parse(String(request.init.body)) as { values: unknown[][] };
        assert.equal(body.values[0][TODO_HEADERS.indexOf('subject')], 'Existing subject');
        assert.equal(body.values[0][TODO_HEADERS.indexOf('urgent')], true);
        return jsonResponse({ updatedRows: 1 });
      },
    ]);
    try {
      const store = createStore();
      const updated = await store.updateItem('sheet:sheet-1', 'todo-1', { urgent: true });

      assert.equal(updated.subject, 'Existing subject');
      assert.equal(updated.urgent, true);
      assert.deepEqual(updated.categories, ['tag']);
    } finally {
      mock.restore();
    }
  });

  it('normalizes new item defaults and acquires one token for the transaction', async () => {
    let tokenCalls = 0;
    const mock = installFetchMock([
      () => jsonResponse({ values: [Array.from(TODO_HEADERS)] }),
      request => {
        assert.equal(request.init.method, 'POST');
        return jsonResponse({ updates: { updatedRows: 1 } });
      },
    ]);
    try {
      const store = createStore(async () => {
        tokenCalls += 1;
        return 'google-token';
      });
      const created = await store.createItem('sheet:sheet-1', {
        subject: 'Started task',
        status: 'inProgress',
      });

      assert.match(created.id, /^[0-9a-f-]{36}$/i);
      assert.equal(created.urgent, false);
      assert.equal(created.important, false);
      assert.equal(created.status, 'inProgress');
      assert.ok(created.etsDateTime);
      assert.ok(created.etaDateTime);
      assert.ok(created.startDateTime);
      assert.equal(tokenCalls, 1);
    } finally {
      mock.restore();
    }
  });

  it('deletes the matching sheet row with a structural batch update', async () => {
    const row = [
      'todo-1',
      'Delete me',
      '',
      '',
      'cancelled',
      false,
      false,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    const mock = installFetchMock([
      () => jsonResponse({ values: [Array.from(TODO_HEADERS), row] }),
      () => jsonResponse({
        sheets: [{ properties: { sheetId: 9, title: 'TODOs' } }],
      }),
      request => {
        assert.equal(request.init.method, 'POST');
        const body = JSON.parse(String(request.init.body)) as {
          requests: Array<{
            deleteDimension: {
              range: { sheetId: number; startIndex: number; endIndex: number };
            };
          }>;
        };
        assert.deepEqual(body.requests[0].deleteDimension.range, {
          sheetId: 9,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: 2,
        });
        return jsonResponse({});
      },
    ]);
    try {
      const store = createStore();
      await store.deleteItem('sheet:sheet-1', 'todo-1');
    } finally {
      mock.restore();
    }
  });

  it('invalidates rejected cached tokens and requests explicit recovery', async () => {
    let invalidations = 0;
    const mock = installFetchMock([
      () => jsonResponse({ error: { message: 'Invalid credentials' } }, 401),
    ]);
    try {
      const store = new GoogleSheetsStore({
        activeBackend: 'google',
        acquireToken: async () => 'rejected-token',
        invalidateToken: () => {
          invalidations += 1;
        },
      });

      await assert.rejects(
        store.listBooks({ interaction: 'silent-only' }),
        isInteractiveAuthenticationRequiredError,
      );
      assert.equal(invalidations, 1);
    } finally {
      mock.restore();
    }
  });

  it('serializes row-deleting mutations within one spreadsheet', async () => {
    const firstRow = [
      'todo-1', 'First', '', '', 'cancelled', false, false,
      '', '', '', '', '', '', '', '', '', '', '',
    ];
    const secondRow = [
      'todo-2', 'Second', '', '', 'cancelled', false, false,
      '', '', '', '', '', '', '', '', '', '', '',
    ];
    let releaseFirstDelete!: () => void;
    const firstDeleteStarted = new Promise<void>(resolve => {
      releaseFirstDelete = resolve;
    });
    let finishFirstDelete!: (response: Response) => void;
    const firstDeleteResponse = new Promise<Response>(resolve => {
      finishFirstDelete = resolve;
    });
    const mock = installFetchMock([
      () => jsonResponse({ values: [Array.from(TODO_HEADERS), firstRow, secondRow] }),
      () => jsonResponse({
        sheets: [{ properties: { sheetId: 9, title: 'TODOs' } }],
      }),
      () => {
        releaseFirstDelete();
        return firstDeleteResponse;
      },
      () => jsonResponse({ values: [Array.from(TODO_HEADERS), secondRow] }),
      request => {
        const body = JSON.parse(String(request.init.body)) as {
          requests: Array<{ deleteDimension: { range: { startIndex: number } } }>;
        };
        assert.equal(body.requests[0].deleteDimension.range.startIndex, 1);
        return jsonResponse({});
      },
    ]);
    try {
      const store = createStore();
      const firstDelete = store.deleteItem('sheet:sheet-queue', 'todo-1');
      const secondDelete = store.deleteItem('sheet:sheet-queue', 'todo-2');

      await firstDeleteStarted;
      assert.equal(mock.requests.length, 3);
      finishFirstDelete(jsonResponse({}));
      await Promise.all([firstDelete, secondDelete]);
      assert.equal(mock.requests.length, 5);
    } finally {
      mock.restore();
    }
  });
});
