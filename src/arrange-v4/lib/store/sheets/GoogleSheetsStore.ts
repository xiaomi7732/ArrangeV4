import type {
  Book,
  CreateBookOptions,
  ItemUpdate,
  ListItemsOptions,
  StoreOperationOptions,
  StoreOptions,
  TodoItem,
  TodoItemWithId,
  TodoStore,
} from '../types';
import { isNonTerminalStatus, makeBookId, parseBookId } from '../types';
import { TokenAcquisitionCoordinator } from '../tokenAcquisition';
import { InteractiveAuthenticationRequiredError } from '../../auth/errors';
import {
  normalizeHeaders,
  parseSheetRows,
  serializeSheetRow,
  TODO_HEADERS,
  TODO_SHEET_NAME,
  type SheetTodoRecord,
} from './schema';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4';
const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
const ARRANGE_PROPERTY_KEY = 'arrange';
const ARRANGE_PROPERTY_VALUE = 'v4';
const PENDING_CLEANUP_KEY = 'arrange_google_pending_cleanup';
const mutationQueues = new Map<string, Promise<void>>();

interface DriveFile {
  id?: string;
  name?: string;
  capabilities?: { canEdit?: boolean };
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

interface DriveFileList {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface SpreadsheetResponse {
  spreadsheetId?: string;
  properties?: { title?: string };
}

interface ValuesResponse {
  values?: unknown[][];
}

interface LoadedSheet {
  headers: string[];
  records: SheetTodoRecord[];
}

function nativeSheetId(bookId: string): string {
  const parsed = parseBookId(bookId);
  if (!parsed || parsed.backend !== 'google') {
    throw new Error(`Expected a Google Sheets book ID, received "${bookId}".`);
  }
  return parsed.nativeId;
}

function displayBookName(name: string | undefined): string {
  return name?.replace(/ by arrange$/i, '') || 'Untitled';
}

function driveFileToBook(file: DriveFile): Book | null {
  if (!file.id) return null;
  const owner = file.owners?.[0];
  return {
    id: makeBookId('google', file.id),
    name: displayBookName(file.name),
    backend: 'google',
    owner: owner ? { name: owner.displayName, address: owner.emailAddress } : undefined,
    canEdit: file.capabilities?.canEdit,
  };
}

function readPendingCleanup(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_CLEANUP_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writePendingCleanup(ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (ids.length > 0) {
      sessionStorage.setItem(PENDING_CLEANUP_KEY, JSON.stringify(ids));
    } else {
      sessionStorage.removeItem(PENDING_CLEANUP_KEY);
    }
  } catch {
    // Best-effort cleanup tracking is unavailable in storage-restricted contexts.
  }
}

function itemOverlapsWindow(item: TodoItem, fromDate: string, toDate: string): boolean {
  const from = Date.parse(fromDate);
  const to = Date.parse(toDate);
  const start = Date.parse(item.etsDateTime || '');
  const end = Date.parse(item.etaDateTime || item.etsDateTime || '');
  return Number.isFinite(start)
    && Number.isFinite(end)
    && start < to
    && end > from;
}

function dateFallsInWindow(dateTime: string | null | undefined, fromDate: string, toDate: string) {
  const value = Date.parse(dateTime || '');
  const from = Date.parse(fromDate);
  const to = Date.parse(toDate);
  return Number.isFinite(value) && value >= from && value < to;
}

async function isRetryableGoogleQuotaResponse(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  try {
    const body = await response.clone().json() as {
      error?: { errors?: Array<{ reason?: string }> };
    };
    const retryableReasons = new Set([
      'rateLimitExceeded',
      'userRateLimitExceeded',
      'sharingRateLimitExceeded',
    ]);
    return body.error?.errors?.some(
      error => !!error.reason && retryableReasons.has(error.reason),
    ) === true;
  } catch {
    return false;
  }
}

export class GoogleSheetsStore implements TodoStore {
  private readonly tokenAcquisition: TokenAcquisitionCoordinator;
  private readonly invalidateToken: () => void;

  constructor(opts: StoreOptions) {
    this.tokenAcquisition = new TokenAcquisitionCoordinator(opts.acquireToken);
    this.invalidateToken = opts.invalidateToken;
  }

  private async request<T>(
    url: string,
    init: RequestInit = {},
    options?: StoreOperationOptions,
    accessToken?: string,
  ): Promise<T> {
    const token = accessToken ?? await this.tokenAcquisition.getToken(options);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(url, { ...init, headers });
      const retryableQuotaError = await isRetryableGoogleQuotaResponse(response);
      if (!retryableQuotaError || attempt === 2) break;
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 500 * (2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (!response) throw new Error('Google API request did not return a response.');
    if (!response.ok) {
      if (response.status === 401) {
        this.invalidateToken();
        if (options?.interaction === 'silent-only') {
          throw new InteractiveAuthenticationRequiredError(
            new Error('Google rejected the cached access token.'),
          );
        }
      }
      let detail = '';
      try {
        const body = await response.json() as { error?: { message?: string } };
        detail = body.error?.message || '';
      } catch {
        detail = await response.text().catch(() => '');
      }
      throw new Error(
        `Google API request failed (${response.status})${detail ? `: ${detail}` : ''}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async listBooks(options?: StoreOperationOptions): Promise<Book[]> {
    const token = await this.tokenAcquisition.getToken(options);
    await this.cleanupPendingSpreadsheets(token, options);
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const query = [
        `mimeType='${SPREADSHEET_MIME_TYPE}'`,
        `appProperties has { key='${ARRANGE_PROPERTY_KEY}' and value='${ARRANGE_PROPERTY_VALUE}' }`,
        'trashed=false',
      ].join(' and ');
      const params = new URLSearchParams({
        q: query,
        spaces: 'drive',
        pageSize: '100',
        fields: 'nextPageToken,files(id,name,capabilities(canEdit),owners(displayName,emailAddress))',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const response = await this.request<DriveFileList>(
        `${DRIVE_API}/files?${params}`,
        {},
        options,
        token,
      );
      files.push(...(response.files || []));
      pageToken = response.nextPageToken;
    } while (pageToken);

    return files.map(driveFileToBook).filter((book): book is Book => book !== null);
  }

  async createBook(name: string, opts: CreateBookOptions): Promise<Book> {
    if (opts.backend !== 'google') {
      throw new Error(`GoogleSheetsStore cannot create a book with backend '${opts.backend}'.`);
    }
    const token = await this.tokenAcquisition.getToken();
    const title = displayBookName(name.trim());
    const spreadsheet = await this.request<SpreadsheetResponse>(
      `${SHEETS_API}/spreadsheets`,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: { title },
          sheets: [{ properties: { title: TODO_SHEET_NAME } }],
        }),
      },
      undefined,
      token,
    );
    const spreadsheetId = spreadsheet.spreadsheetId;
    if (!spreadsheetId) throw new Error('Google Sheets creation returned no spreadsheet ID.');

    try {
      await this.writeValues(
        spreadsheetId,
        `${TODO_SHEET_NAME}!A1:${columnName(TODO_HEADERS.length)}1`,
        [Array.from(TODO_HEADERS)],
        undefined,
        token,
      );
      await this.request(
        `${DRIVE_API}/files/${encodeURIComponent(spreadsheetId)}?fields=id,name,capabilities(canEdit),owners(displayName,emailAddress)`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            appProperties: { [ARRANGE_PROPERTY_KEY]: ARRANGE_PROPERTY_VALUE },
          }),
        },
        undefined,
        token,
      );
    } catch (error) {
      writePendingCleanup([...new Set([...readPendingCleanup(), spreadsheetId])]);
      await this.request(
        `${DRIVE_API}/files/${encodeURIComponent(spreadsheetId)}`,
        { method: 'DELETE' },
        undefined,
        token,
      ).then(() => {
        writePendingCleanup(readPendingCleanup().filter(id => id !== spreadsheetId));
      }, cleanupError => {
        console.error('Failed to remove partially-created Arrange spreadsheet:', cleanupError);
      });
      throw error;
    }

    return {
      id: makeBookId('google', spreadsheetId),
      name: title,
      backend: 'google',
      canEdit: true,
    };
  }

  async deleteBook(bookId: string): Promise<void> {
    const spreadsheetId = nativeSheetId(bookId);
    const token = await this.tokenAcquisition.getToken();
    await this.request(
      `${DRIVE_API}/files/${encodeURIComponent(spreadsheetId)}`,
      { method: 'DELETE' },
      undefined,
      token,
    );
  }

  async listItems(bookId: string, opts: ListItemsOptions): Promise<TodoItemWithId[]> {
    const spreadsheetId = nativeSheetId(bookId);
    const token = await this.tokenAcquisition.getToken(opts);
    const loaded = await this.loadSheet(spreadsheetId, opts, token);
    const items = loaded.records.map(record => record.item);
    if (opts.range === 'all') return items;
    if (!opts.fromDate || !opts.toDate) {
      throw new Error("listItems with range='window' requires fromDate and toDate.");
    }
    const from = Date.parse(opts.fromDate);
    const to = Date.parse(opts.toDate);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error('listItems requires a valid date window with fromDate before toDate.');
    }
    return items.filter(item => (
      isNonTerminalStatus(item.status)
      || itemOverlapsWindow(item, opts.fromDate!, opts.toDate!)
      || dateFallsInWindow(item.finishDateTime, opts.fromDate!, opts.toDate!)
    ));
  }

  async createItem(bookId: string, item: TodoItem): Promise<TodoItemWithId> {
    const spreadsheetId = nativeSheetId(bookId);
    return this.enqueueMutation(spreadsheetId, async () => {
      const token = await this.tokenAcquisition.getToken();
      const loaded = await this.loadSheet(spreadsheetId, undefined, token, true);
      const now = new Date().toISOString();
      const etsDateTime = item.etsDateTime
        || new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const etaDateTime = item.etaDateTime
        || new Date(new Date(etsDateTime).getTime() + 30 * 60 * 1000).toISOString();
      const status = item.status || 'new';
      const lifecycleNow = new Date().toISOString();
      const created: TodoItemWithId = {
        ...item,
        id: crypto.randomUUID(),
        etsDateTime,
        etaDateTime,
        status,
        urgent: item.urgent || false,
        important: item.important || false,
        startDateTime: item.startDateTime
          ?? (status === 'inProgress' || status === 'finished' ? lifecycleNow : null),
        finishDateTime: item.finishDateTime
          ?? (status === 'finished' ? lifecycleNow : null),
        originalEtsDateTime: item.originalEtsDateTime ?? null,
        originalEtaDateTime: item.originalEtaDateTime ?? null,
      };
      const row = serializeSheetRow(loaded.headers, created, now, now);
      await this.request(
        `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${TODO_SHEET_NAME}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
        },
        undefined,
        token,
      );
      return created;
    });
  }

  async updateItem(
    bookId: string,
    itemId: string,
    updates: Partial<TodoItem>,
    options?: StoreOperationOptions,
  ): Promise<TodoItemWithId> {
    const [updated] = await this.updateItems(
      bookId,
      [{ itemId, updates }],
      options,
    );
    return updated;
  }

  async updateItems(
    bookId: string,
    updates: ItemUpdate[],
    options?: StoreOperationOptions,
  ): Promise<TodoItemWithId[]> {
    if (updates.length === 0) return [];
    const spreadsheetId = nativeSheetId(bookId);
    return this.enqueueMutation(spreadsheetId, async () => {
      const token = await this.tokenAcquisition.getToken(options);
      const loaded = await this.loadSheet(spreadsheetId, options, token, true);
      const updatedAt = new Date().toISOString();
      const recordsById = new Map(
        loaded.records.map(record => [record.item.id, record]),
      );
      const prepared = updates.map(update => {
        const existing = recordsById.get(update.itemId);
        if (!existing) {
          throw new Error(`TODO item "${update.itemId}" no longer exists.`);
        }
        return this.prepareItemUpdate(
          loaded.headers,
          existing,
          update.updates,
          updatedAt,
        );
      });
      await this.appendValues(
        spreadsheetId,
        prepared.map(item => item.row),
        options,
        token,
      );
      return prepared.map(item => item.updated);
    });
  }

  async deleteItem(bookId: string, itemId: string): Promise<void> {
    await this.deleteItems(bookId, [itemId]);
  }

  async deleteItems(bookId: string, itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const spreadsheetId = nativeSheetId(bookId);
    await this.enqueueMutation(spreadsheetId, async () => {
      const token = await this.tokenAcquisition.getToken();
      const loaded = await this.loadSheet(spreadsheetId, undefined, token);
      const updatedAt = new Date().toISOString();
      const recordsById = new Map(
        loaded.records.map(record => [record.item.id, record]),
      );
      const tombstones = itemIds.flatMap(itemId => {
        const existing = recordsById.get(itemId);
        if (!existing) return [];
        return [serializeSheetRow(
          loaded.headers,
          existing.item,
          existing.createdAt || updatedAt,
          updatedAt,
          { deleted: true },
        )];
      });
      if (tombstones.length === 0) return;
      await this.appendValues(
        spreadsheetId,
        tombstones,
        undefined,
        token,
      );
    });
  }

  private async loadSheet(
    spreadsheetId: string,
    options?: StoreOperationOptions,
    accessToken?: string,
    ensureSchema = false,
  ): Promise<LoadedSheet> {
    const response = await this.request<ValuesResponse>(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(TODO_SHEET_NAME)}?majorDimension=ROWS`,
      {},
      options,
      accessToken,
    );
    const values = response.values || [];
    const originalHeaders = values[0] || [];
    const headers = normalizeHeaders(originalHeaders, values.slice(1));
    if (ensureSchema && headers.length > originalHeaders.length) {
      const firstMissingColumn = originalHeaders.length + 1;
      await this.writeValues(
        spreadsheetId,
        `${TODO_SHEET_NAME}!${columnName(firstMissingColumn)}1:${columnName(headers.length)}1`,
        [headers.slice(originalHeaders.length)],
        options,
        accessToken,
      );
    }
    const normalizedValues = values.length > 0
      ? [headers, ...values.slice(1)]
      : [headers];
    return { headers, records: parseSheetRows(normalizedValues) };
  }

  private async writeValues(
    spreadsheetId: string,
    range: string,
    values: unknown[][],
    options?: StoreOperationOptions,
    accessToken?: string,
  ): Promise<void> {
    await this.request(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      },
      options,
      accessToken,
    );
  }

  private async appendValues(
    spreadsheetId: string,
    values: unknown[][],
    options?: StoreOperationOptions,
    accessToken?: string,
  ): Promise<void> {
    await this.request(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${TODO_SHEET_NAME}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ majorDimension: 'ROWS', values }),
      },
      options,
      accessToken,
    );
  }

  private prepareItemUpdate(
    headers: string[],
    existing: SheetTodoRecord,
    updates: Partial<TodoItem>,
    updatedAt: string,
  ): { updated: TodoItemWithId; row: unknown[] } {
    const updated: TodoItemWithId = {
      ...existing.item,
      ...updates,
      id: existing.item.id,
    };
    const changedFields = new Set<keyof TodoItem>(
      Object.keys(updates) as (keyof TodoItem)[],
    );
    if (updates.status !== undefined) {
      if (
        updates.status === 'inProgress'
        && !existing.item.startDateTime
        && updates.startDateTime === undefined
      ) {
        updated.startDateTime = updatedAt;
      }
      if (updates.status === 'new' && updates.startDateTime === undefined) {
        updated.startDateTime = null;
      }
      if (updates.status === 'finished') {
        if (!existing.item.startDateTime && updates.startDateTime === undefined) {
          updated.startDateTime = updatedAt;
        }
        if (!existing.item.finishDateTime && updates.finishDateTime === undefined) {
          updated.finishDateTime = updatedAt;
        }
      }
      if (updates.status !== 'finished' && updates.finishDateTime === undefined) {
        updated.finishDateTime = null;
      }
      changedFields.add('startDateTime');
      changedFields.add('finishDateTime');
    }
    const row = serializeSheetRow(
      headers,
      updated,
      existing.createdAt || updatedAt,
      updatedAt,
      {
        changedFields: [...changedFields],
        parentOperations: Object.fromEntries(
          [...changedFields].flatMap(field => {
            const operationId = existing.fieldOperations[field];
            return operationId ? [[field, operationId]] : [];
          }),
        ),
      },
    );
    return { updated, row };
  }

  private async cleanupPendingSpreadsheets(
    accessToken: string,
    options?: StoreOperationOptions,
  ): Promise<void> {
    const pending = readPendingCleanup();
    if (pending.length === 0) return;

    const remaining: string[] = [];
    for (const spreadsheetId of pending) {
      try {
        await this.request(
          `${DRIVE_API}/files/${encodeURIComponent(spreadsheetId)}`,
          { method: 'DELETE' },
          options,
          accessToken,
        );
      } catch (error) {
        remaining.push(spreadsheetId);
        console.error('Failed to remove partially-created Arrange spreadsheet:', error);
      }
    }
    writePendingCleanup(remaining);
  }

  private async enqueueMutation<T>(
    spreadsheetId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = mutationQueues.get(spreadsheetId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => gate, () => gate);
    mutationQueues.set(spreadsheetId, queued);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (mutationQueues.get(spreadsheetId) === queued) {
        mutationQueues.delete(spreadsheetId);
      }
    }
  }
}

function columnName(columnCount: number): string {
  let value = columnCount;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result || 'A';
}
