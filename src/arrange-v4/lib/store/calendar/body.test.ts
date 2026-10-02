import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ARRANGE_DATA_END_MARKER,
  ARRANGE_DATA_START_MARKER,
  parseArrangeBody,
  serializeArrangeBody,
} from './body';

interface Payload {
  status: string;
  remarks: { type: string; content: string } | null;
  checklist?: string[];
}

/**
 * Mimics what the browser does on read: decode HTML entities and take the
 * text content. The real path uses a detached DOM node; this covers the
 * entity handling that matters for the round-trip.
 */
function decodeBody(html: string): string {
  return html
    .replace(/<\/?pre>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function roundTrip(payload: Payload) {
  return parseArrangeBody<Payload>(decodeBody(serializeArrangeBody(payload)));
}

const base: Payload = { status: 'new', remarks: null };

describe('arrange event body codec', () => {
  it('round-trips a payload unchanged', () => {
    const payload: Payload = {
      status: 'inProgress',
      remarks: { type: 'markdown', content: 'hello' },
      checklist: ['-[x] done', '-[] todo'],
    };
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('round-trips content with HTML metacharacters', () => {
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'text', content: `<script>alert("x & y")</script> 'quoted'` },
    };
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('survives content that contains the end marker', () => {
    // Regression: indexOf() stopped at the mention, truncating the JSON and
    // making a readable item look corrupt — which then reset it to defaults.
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'text', content: `see ${ARRANGE_DATA_END_MARKER} for details` },
    };
    const body = serializeArrangeBody(payload);
    assert.ok(
      !decodeBody(body).slice(ARRANGE_DATA_START_MARKER.length + 5).includes(
        `${ARRANGE_DATA_END_MARKER} for details`,
      ),
      'the marker inside the payload should be escaped before fencing',
    );
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('survives content that contains the start marker', () => {
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'text', content: ARRANGE_DATA_START_MARKER },
    };
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('does not emit indentation runs that invite nbsp rewriting', () => {
    const body = serializeArrangeBody({ status: 'new', remarks: null, checklist: [] });
    assert.ok(!/\n {2}/.test(body), 'payload should not be pretty-printed');
  });

  it('recovers a legacy payload whose structural spaces were rewritten as nbsp', () => {
    // Outlook normalises space runs to &nbsp;, which decodes to U+00A0 —
    // not legal JSON whitespace, so the whole item used to fail to parse.
    const pretty = JSON.stringify(base, null, 2).replace(/ {2}/g, '\u00A0\u00A0');
    const text = `${ARRANGE_DATA_START_MARKER}\n${pretty}\n${ARRANGE_DATA_END_MARKER}`;
    assert.deepEqual(parseArrangeBody<Payload>(text), { status: 'ok', data: base });
  });

  it('leaves no space run for Outlook to rewrite as nbsp', () => {
    // Space runs are the only thing HTML normalisation rewrites here, so a
    // payload written by this version cannot come back damaged at all.
    const body = serializeArrangeBody({
      status: 'new',
      remarks: { type: 'markdown', content: 'intro\n\n    const x = 1;\n' },
    });
    assert.ok(!/ {2}/.test(body), 'serialised body should contain no space runs');
  });

  it('round-trips whitespace-significant content exactly', () => {
    const content = 'intro\n\n    const x = 1;\n';
    const payload: Payload = { status: 'new', remarks: { type: 'markdown', content } };
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('repairs nbsp damage in a legacy payload that will not parse', () => {
    const content = 'intro\n\n    const x = 1;\n';
    const json = JSON.stringify({ status: 'new', remarks: { type: 'markdown', content } });
    // Legacy bodies were pretty-printed, so Outlook rewrote structural
    // indentation too and the payload stopped parsing outright.
    const damaged = `{\u00A0${json.slice(1)}`.replace(/ {2,}/g, m => '\u00A0'.repeat(m.length));
    const text = `${ARRANGE_DATA_START_MARKER}\n${damaged}\n${ARRANGE_DATA_END_MARKER}`;
    const result = parseArrangeBody<Payload>(text);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    const line = result.data.remarks!.content.split('\n')[2];
    assert.ok(/^ {4}/.test(line), 'markdown code-block indentation must be repaired');
  });

  it('keeps a nonbreaking space that the content legitimately contains', () => {
    // "10 kg" written with U+00A0 parses fine, so nothing should rewrite it.
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'text', content: '10\u00A0kg of coffee' },
    };
    const text = `${ARRANGE_DATA_START_MARKER}\n${JSON.stringify(payload)}\n${ARRANGE_DATA_END_MARKER}`;
    assert.deepEqual(parseArrangeBody<Payload>(text), { status: 'ok', data: payload });
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('strips zero-width characters that break the payload', () => {
    const text = `${ARRANGE_DATA_START_MARKER}\n{"status":"new",\uFEFF"remarks":null}\n${ARRANGE_DATA_END_MARKER}`;
    assert.deepEqual(parseArrangeBody<Payload>(text), { status: 'ok', data: base });
  });

  it('preserves zero-width joiners that belong to the content', () => {
    // Stripping U+200D unconditionally split emoji sequences, so a saved
    // "woman technologist" came back as two unrelated glyphs.
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'markdown', content: 'ship it \u{1F469}\u200D\u{1F4BB}\u200B' },
    };
    assert.deepEqual(roundTrip(payload), { status: 'ok', data: payload });
  });

  it('preserves zero-width joiners in a legacy payload that escaped nothing', () => {
    // Events written before the escaping existed carry the joiner literally;
    // stripping it on read altered content that was perfectly readable.
    const payload: Payload = {
      status: 'new',
      remarks: { type: 'markdown', content: '\u{1F469}\u200D\u{1F4BB} pairing' },
    };
    const text = `${ARRANGE_DATA_START_MARKER}\n${JSON.stringify(payload)}\n${ARRANGE_DATA_END_MARKER}`;
    assert.deepEqual(parseArrangeBody<Payload>(text), { status: 'ok', data: payload });
  });

  it('still strips zero-width characters when they break the JSON', () => {
    const text = `${ARRANGE_DATA_START_MARKER}\n{\u200B"status":"new",\u200B"remarks":null}\n${ARRANGE_DATA_END_MARKER}`;
    assert.deepEqual(parseArrangeBody<Payload>(text), { status: 'ok', data: base });
  });

  it('treats a lone closing marker as corrupt, not absent', () => {
    // The payload was written and its opening marker was damaged; reporting
    // "absent" would let the next write replace what is still in there.
    const result = parseArrangeBody<Payload>(`==ArrangeDataStart==\n{}\n${ARRANGE_DATA_END_MARKER}`);
    assert.equal(result.status, 'corrupt');
  });

  it('still reads legacy pretty-printed payloads', () => {
    const text = `<pre>${ARRANGE_DATA_START_MARKER}\n${JSON.stringify(base, null, 2)}\n${ARRANGE_DATA_END_MARKER}</pre>`;
    assert.deepEqual(parseArrangeBody<Payload>(decodeBody(text)), { status: 'ok', data: base });
  });

  it('reports an absent payload for a body with no markers', () => {
    assert.deepEqual(
      parseArrangeBody('Lunch with the team'),
      { status: 'absent' },
    );
  });

  it('reports corruption rather than emptiness for unreadable payloads', () => {
    const truncated = `${ARRANGE_DATA_START_MARKER}\n{"status":"new"\n${ARRANGE_DATA_END_MARKER}`;
    const result = parseArrangeBody(truncated);
    assert.equal(result.status, 'corrupt');

    assert.equal(
      parseArrangeBody(`${ARRANGE_DATA_START_MARKER}\n\n${ARRANGE_DATA_END_MARKER}`).status,
      'corrupt',
    );
    assert.equal(
      parseArrangeBody(`${ARRANGE_DATA_START_MARKER}\n{"a":1}`).status,
      'corrupt',
    );
    assert.equal(
      parseArrangeBody(`${ARRANGE_DATA_START_MARKER}\n[1,2]\n${ARRANGE_DATA_END_MARKER}`).status,
      'corrupt',
    );
  });
});
