import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { markdownToSearchText, safeMarkdownUrl } from './markdown';

describe('safeMarkdownUrl', () => {
  it('allows the protocols a note legitimately links to', () => {
    assert.equal(safeMarkdownUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeMarkdownUrl('http://example.com'), 'http://example.com');
    assert.equal(safeMarkdownUrl('mailto:someone@example.com'), 'mailto:someone@example.com');
  });

  it('rejects script-bearing and payload-bearing URLs', () => {
    assert.equal(safeMarkdownUrl('javascript:alert(1)'), null);
    assert.equal(safeMarkdownUrl('  javascript:alert(1)  '), null);
    assert.equal(safeMarkdownUrl('JavaScript:alert(1)'), null);
    assert.equal(safeMarkdownUrl('data:text/html;base64,PHNjcmlwdD4='), null);
    assert.equal(safeMarkdownUrl('vbscript:msgbox(1)'), null);
    assert.equal(safeMarkdownUrl('file:///C:/Windows/System32'), null);
  });

  it('rejects anything that is not an absolute URL', () => {
    assert.equal(safeMarkdownUrl('/books'), null);
    assert.equal(safeMarkdownUrl('#section'), null);
    assert.equal(safeMarkdownUrl('example.com'), null);
    assert.equal(safeMarkdownUrl(''), null);
    assert.equal(safeMarkdownUrl('   '), null);
    assert.equal(safeMarkdownUrl(null), null);
    assert.equal(safeMarkdownUrl(undefined), null);
  });

  it('trims surrounding whitespace from an accepted URL', () => {
    assert.equal(safeMarkdownUrl('  https://example.com  '), 'https://example.com');
  });
});

describe('markdownToSearchText', () => {
  it('keeps link labels and their targets', () => {
    // Before remarks were Markdown they were indexed verbatim, so searching
    // for a hostname found the task; that recall is preserved.
    assert.equal(
      markdownToSearchText('see [the design doc](https://example.com/spec) first'),
      'see the design doc https://example.com/spec first',
    );
  });

  it('keeps image alt text and the image URL', () => {
    assert.equal(
      markdownToSearchText('![burndown chart](https://x/y.png)'),
      'burndown chart https://x/y.png',
    );
  });

  it('keeps autolink targets, which are the only text shown', () => {
    assert.equal(
      markdownToSearchText('ping <https://example.com/status>'),
      'ping https://example.com/status',
    );
  });

  it('strips heading, quote and list markers', () => {
    assert.equal(markdownToSearchText('## Plan'), 'Plan');
    assert.equal(markdownToSearchText('> quoted note'), 'quoted note');
    assert.equal(markdownToSearchText('- first\n* second\n1. third'), 'first\nsecond\nthird');
  });

  it('strips emphasis, strikethrough and code markers but keeps the words', () => {
    assert.equal(markdownToSearchText('**bold** _italic_ ~~gone~~ `code`'), 'bold italic gone code');
  });

  it('keeps markers that are part of a word, so identifiers stay searchable', () => {
    // Stripping them everywhere indexed `snake_case` as `snakecase`, which a
    // user searching for the term they typed would never match.
    assert.equal(markdownToSearchText('rename snake_case to camelCase'), 'rename snake_case to camelCase');
    assert.equal(markdownToSearchText('use `snake_case` here'), 'use snake_case here');
    assert.equal(markdownToSearchText('**fix snake_case**'), 'fix snake_case');
  });

  it('applies the word rule to non-ASCII words too', () => {
    assert.equal(markdownToSearchText('fix café_bar handling'), 'fix café_bar handling');
    assert.equal(markdownToSearchText('**日本語** notes'), '日本語 notes');
  });

  it('leaves an intra-word underscore run alone but not an asterisk run', () => {
    // CommonMark emphasises `*` inside a word but not `_`, so the flattened
    // text matches what the reader actually sees in both cases.
    assert.equal(markdownToSearchText('x_y_z'), 'x_y_z');
    assert.equal(markdownToSearchText('foo**bar**baz'), 'foobarbaz');
    assert.equal(markdownToSearchText('a**b**c'), 'abc');
  });

  it('indexes a code span literally', () => {
    // Markdown inside a code span is text, not syntax: react-markdown renders
    // `__init__` and `~/src` as typed, so searching for them must match.
    assert.equal(markdownToSearchText('see `__init__` first'), 'see __init__ first');
    assert.equal(markdownToSearchText('cd `~/src`'), 'cd ~/src');
    assert.equal(markdownToSearchText('`a_b` and `c_d`'), 'a_b and c_d');
    assert.equal(markdownToSearchText('**bold** then `*literal*`'), 'bold then *literal*');
  });

  it('indexes fenced code literally and respects the fence length', () => {
    const quoted = '````\nuse ```js in a remark\n````';
    assert.equal(markdownToSearchText(quoted), 'use ```js in a remark');
    const inner = '```\nconsole.log("```")\n```';
    assert.equal(markdownToSearchText(inner), 'console.log("```")');
    assert.equal(markdownToSearchText('```py\n__init__ = 1\n```'), '__init__ = 1');
    // The closing fence, not the first line end, terminates the block.
    assert.equal(
      markdownToSearchText('```py\nfirst = 1\n__init__ = 2\n```'),
      'first = 1\n__init__ = 2',
    );
    assert.equal(markdownToSearchText('```py\nfirst = 1\n__init__ = 2'), 'first = 1\n__init__ = 2');
  });

  it('keeps the contents of a fenced code block', () => {
    const text = markdownToSearchText('```ts\nconst answer = 42;\n```');
    assert.ok(text.includes('const answer = 42;'), text);
    assert.ok(!text.includes('```'), text);
  });

  it('keeps table cell text', () => {
    assert.equal(markdownToSearchText('| name | owner |'), 'name owner');
  });

  it('leaves plain prose untouched apart from trimming', () => {
    assert.equal(markdownToSearchText('  just a normal note  '), 'just a normal note');
  });
});
