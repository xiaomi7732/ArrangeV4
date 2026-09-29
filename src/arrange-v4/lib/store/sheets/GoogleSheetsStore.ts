import type {
  Book,
  CreateBookOptions,
  ListItemsOptions,
  StoreOperationOptions,
  StoreOptions,
  TodoItem,
  TodoItemWithId,
  TodoStore,
} from '../types';
import { makeBookId, parseBookId } from '../types';
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
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
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

export class GoogleSheetsStore implements TodoStore {
  private readonly tokenAcquisition: TokenAcquisitionCoordinator;
  private readonly invalidateToken: () => void;
  private readonly sheetIdCache = new Map<string, number>();

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
    const response = await fetch(url, { ...init, headers });
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

    const sheetId = spreadsheet.sheets?.[0]?.properties?.sheetId;
    if (sheetId !== undefined) this.sheetIdCache.set(spreadsheetId, sheetId);

    try {
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
      await this.writeValues(
        spreadsheetId,
        `${TODO_SHEET_NAME}!A1:R1`,
        [Array.from(TODO_HEADERS)],
        undefined,
        token,
      );
    } catch (error) {
      await this.request(
        `${DRIVE_API}/files/${encodeURIComponent(spreadsheetId)}`,
        { method: 'DELETE' },
        undefined,
        token,
      ).catch(cleanupError => {
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
    this.sheetIdCache.delete(spreadsheetId);
  }

  async listItems(bookId: string, opts: ListItemsOptions): Promise<TodoItemWithId[]> {
    const spreadsheetId = nativeSheetId(bookId);
    const token = await this.tokenAcquisition.getToken(opts);
    const loaded = await this.loadSheet(spreadsheetId, opts, token);
    return loaded.records.map(record => record.item);
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
      const created: TodoItemWithId = {
        ...item,
        id: crypto.randomUUID(),
        etsDateTime,
        etaDateTime,
        status,
        urgent: item.urgent || false,
        important: item.important || false,
        startDateTime: item.startDateTime
          ?? (status === 'inProgress' ? now : null),
        finishDateTime: item.finishDateTime ?? null,
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
    const spreadsheetId = nativeSheetId(bookId);
    return this.enqueueMutation(spreadsheetId, async () => {
      const token = await this.tokenAcquisition.getToken(options);
      const loaded = await this.loadSheet(spreadsheetId, options, token, true);
      const existing = loaded.records.find(record => record.item.id === itemId);
      if (!existing) throw new Error(`TODO item "${itemId}" no longer exists.`);
      const updated: TodoItemWithId = { ...existing.item, ...updates, id: itemId };
      const updatedAt = new Date().toISOString();
      await this.writeValues(
        spreadsheetId,
        `${TODO_SHEET_NAME}!A${existing.rowNumber}:${columnName(loaded.headers.length)}${existing.rowNumber}`,
        [serializeSheetRow(loaded.headers, updated, existing.createdAt || updatedAt, updatedAt)],
        options,
        token,
      );
      return updated;
    });
  }

  async deleteItem(bookId: string, itemId: string): Promise<void> {
    const spreadsheetId = nativeSheetId(bookId);
    await this.enqueueMutation(spreadsheetId, async () => {
      const token = await this.tokenAcquisition.getToken();
      const loaded = await this.loadSheet(spreadsheetId, undefined, token);
      const existing = loaded.records.find(record => record.item.id === itemId);
      if (!existing) return;
      const sheetId = await this.getSheetId(spreadsheetId, token);
      await this.request(
        `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({
            requests: [{
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS',
                  startIndex: existing.rowNumber - 1,
                  endIndex: existing.rowNumber,
                },
              },
            }],
          }),
        },
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
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${TODO_SHEET_NAME}!A:Z`)}?majorDimension=ROWS`,
      {},
      options,
      accessToken,
    );
    const values = response.values || [];
    const headers = normalizeHeaders(values[0] || []);
    if (ensureSchema && (
      values.length === 0
      || headers.length !== (values[0] || []).length
      || headers.some((header, index) => header !== String((values[0] || [])[index] || '').trim())
    )) {
      await this.writeValues(
        spreadsheetId,
        `${TODO_SHEET_NAME}!A1:${columnName(headers.length)}1`,
        [headers],
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

  private async getSheetId(spreadsheetId: string, accessToken: string): Promise<number> {
    const cached = this.sheetIdCache.get(spreadsheetId);
    if (cached !== undefined) return cached;
    const response = await this.request<SpreadsheetResponse>(
      `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`,
      {},
      undefined,
      accessToken,
    );
    const sheet = response.sheets?.find(entry => entry.properties?.title === TODO_SHEET_NAME);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined) {
      throw new Error(`Spreadsheet does not contain the required "${TODO_SHEET_NAME}" sheet.`);
    }
    this.sheetIdCache.set(spreadsheetId, sheetId);
    return sheetId;
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
