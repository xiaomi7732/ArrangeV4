import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describeStoredFieldDamage, hasAnyStoredField } from './storedFields';

test('a fully populated payload is undamaged', () => {
  assert.equal(describeStoredFieldDamage({
    status: 'inProgress',
    urgent: true,
    important: false,
    checklist: ['a', 'b'],
    remarks: { type: 'markdown', content: '# hi' },
    startDateTime: null,
    finishDateTime: '2024-01-01T00:00:00Z',
    originalEtsDateTime: null,
    originalEtaDateTime: null,
    matrixOrder: 1024,
    scrumOrder: 2048,
  }), null);
});

test('a payload holding only one valid field is undamaged', () => {
  assert.equal(describeStoredFieldDamage({ status: 'new' }), null);
});

test('a payload with no Arrange fields is damage', () => {
  assert.equal(describeStoredFieldDamage({}), 'payload has no Arrange fields');
  assert.equal(hasAnyStoredField({}), false);
});

test('an unrecognised status is damage rather than a silently lost task', () => {
  assert.equal(describeStoredFieldDamage({ status: 'bogus' }), 'status is not valid Arrange data');
});

test('a checklist that is not a list of strings is damage', () => {
  assert.equal(
    describeStoredFieldDamage({ checklist: {} as unknown as string[] }),
    'checklist is not valid Arrange data',
  );
  assert.equal(
    describeStoredFieldDamage({ checklist: ['ok', 3] as unknown as string[] }),
    'checklist is not valid Arrange data',
  );
});

test('flags are damage unless they are booleans', () => {
  assert.equal(
    describeStoredFieldDamage({ urgent: 'yes' as unknown as boolean }),
    'urgent is not valid Arrange data',
  );
  assert.equal(
    describeStoredFieldDamage({ important: 1 as unknown as boolean }),
    'important is not valid Arrange data',
  );
});

test('remarks must carry a known type and string content', () => {
  assert.equal(
    describeStoredFieldDamage({ remarks: { type: 'html', content: 'x' } as never }),
    'remarks is not valid Arrange data',
  );
  assert.equal(
    describeStoredFieldDamage({ remarks: { type: 'text' } as never }),
    'remarks is not valid Arrange data',
  );
  assert.equal(describeStoredFieldDamage({ remarks: null }), null);
});

test('dates must be strings or null', () => {
  assert.equal(
    describeStoredFieldDamage({ startDateTime: 17 as unknown as string }),
    'startDateTime is not valid Arrange data',
  );
  assert.equal(describeStoredFieldDamage({ finishDateTime: null }), null);
});

test('orders must be finite numbers', () => {
  assert.equal(
    describeStoredFieldDamage({ matrixOrder: Number.NaN }),
    'matrixOrder is not valid Arrange data',
  );
  assert.equal(
    describeStoredFieldDamage({ scrumOrder: '1024' as unknown as number }),
    'scrumOrder is not valid Arrange data',
  );
});

test('an explicitly undefined optional field is not damage on its own', () => {
  assert.equal(describeStoredFieldDamage({ status: 'new', matrixOrder: undefined }), null);
});
