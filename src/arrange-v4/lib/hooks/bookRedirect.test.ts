import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveBookRedirect, type BookRedirectInput } from './bookRedirect';

const GOOGLE_BOOK = 'sheet:11MudQPWQED7pMWnIXuqtA37aKMb8KU5QNo6H57NlVfs';
const CALENDAR_BOOK = 'cal:AAMkAGI2THVSAAA=';

function input(overrides: Partial<BookRedirectInput> = {}): BookRedirectInput {
  return {
    hydrated: true,
    rawBookId: null,
    normalizedBookId: null,
    savedBookId: null,
    provider: 'google',
    routePrefix: '/matrix',
    ...overrides,
  };
}

describe('resolveBookRedirect', () => {
  it('stays put until the client has hydrated', () => {
    // Regression: `provider` is read from localStorage, so the pre-rendered
    // HTML reports the build-time placeholder. Acting on it bounced every
    // Google-backed board to /books on reload and on deep links.
    assert.deepEqual(
      resolveBookRedirect(input({
        hydrated: false,
        rawBookId: GOOGLE_BOOK,
        normalizedBookId: GOOGLE_BOOK,
        provider: 'microsoft',
      })),
      { kind: 'none' },
    );
  });

  it('keeps a deep link whose backend matches the active provider', () => {
    assert.deepEqual(
      resolveBookRedirect(input({
        rawBookId: GOOGLE_BOOK,
        normalizedBookId: GOOGLE_BOOK,
        provider: 'google',
      })),
      { kind: 'none' },
    );
    assert.deepEqual(
      resolveBookRedirect(input({
        rawBookId: CALENDAR_BOOK,
        normalizedBookId: CALENDAR_BOOK,
        provider: 'microsoft',
      })),
      { kind: 'none' },
    );
  });

  it('sends a mismatched backend to the book list once hydrated', () => {
    assert.deepEqual(
      resolveBookRedirect(input({
        hydrated: true,
        rawBookId: GOOGLE_BOOK,
        normalizedBookId: GOOGLE_BOOK,
        provider: 'microsoft',
      })),
      { kind: 'replace', href: '/books' },
    );
  });

  it('sends an unusable bookId to the book list instead of opening another book', () => {
    assert.deepEqual(
      resolveBookRedirect(input({
        rawBookId: 'nonsense:',
        normalizedBookId: null,
        savedBookId: GOOGLE_BOOK,
      })),
      { kind: 'replace', href: '/books' },
    );
  });

  it('falls back to the remembered book only when no bookId was supplied', () => {
    assert.deepEqual(
      resolveBookRedirect(input({ savedBookId: GOOGLE_BOOK, provider: 'google' })),
      { kind: 'replace', href: `/matrix?bookId=${encodeURIComponent(GOOGLE_BOOK)}` },
    );
  });

  it('ignores a remembered book belonging to a different provider', () => {
    assert.deepEqual(
      resolveBookRedirect(input({ savedBookId: GOOGLE_BOOK, provider: 'microsoft' })),
      { kind: 'none' },
    );
  });

  it('does not redirect when there is no bookId and nothing remembered', () => {
    assert.deepEqual(resolveBookRedirect(input()), { kind: 'none' });
  });

  it('honours the calling page route prefix', () => {
    assert.deepEqual(
      resolveBookRedirect(input({
        savedBookId: GOOGLE_BOOK,
        provider: 'google',
        routePrefix: '/cancelled',
      })),
      { kind: 'replace', href: `/cancelled?bookId=${encodeURIComponent(GOOGLE_BOOK)}` },
    );
  });
});
