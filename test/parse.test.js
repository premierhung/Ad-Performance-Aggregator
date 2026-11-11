import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INVALID, parseCents, parseUnsignedInt } from '../src/parse.js';

const parseWhole = (parser, text) => {
  const bytes = Buffer.from(text);
  return parser(bytes, 0, bytes.length);
};

describe('parseUnsignedInt', () => {
  it('parses non-negative integers', () => {
    assert.equal(parseWhole(parseUnsignedInt, '0'), 0);
    assert.equal(parseWhole(parseUnsignedInt, '007'), 7);
    assert.equal(parseWhole(parseUnsignedInt, '12000'), 12000);
    assert.equal(parseWhole(parseUnsignedInt, '999999999999999'), 999999999999999);
  });

  it('reads only the requested byte range', () => {
    const bytes = Buffer.from('CMP001,340,48.20');
    assert.equal(parseUnsignedInt(bytes, 7, 10), 340);
  });

  it('rejects anything that is not a plain run of digits', () => {
    for (const text of ['', '-1', '+1', '1.5', '12a', 'abc', ' 12', '12 ', '1e3']) {
      assert.equal(parseWhole(parseUnsignedInt, text), INVALID, `"${text}"`);
    }
  });

  it('rejects integers too long to be represented exactly', () => {
    assert.equal(parseWhole(parseUnsignedInt, '1234567890123456'), INVALID);
  });
});

describe('parseCents', () => {
  it('parses amounts with zero, one or two decimals into cents', () => {
    assert.equal(parseWhole(parseCents, '45'), 4500);
    assert.equal(parseWhole(parseCents, '45.5'), 4550);
    assert.equal(parseWhole(parseCents, '45.50'), 4550);
    assert.equal(parseWhole(parseCents, '0.07'), 7);
    assert.equal(parseWhole(parseCents, '1394.62'), 139462);
  });

  it('is exact where float arithmetic is not', () => {
    // 0.1 + 0.2 !== 0.3 as floats; as cents the sum is exact.
    assert.equal(parseWhole(parseCents, '0.1') + parseWhole(parseCents, '0.2'), 30);
  });

  it('reads only the requested byte range', () => {
    const bytes = Buffer.from('CMP001,340,48.20,15');
    assert.equal(parseCents(bytes, 11, 16), 4820);
  });

  it('rejects malformed amounts', () => {
    for (const text of ['', '.', '.5', '5.', '-1.00', '1.2.3', '1,5', 'abc', '4x.10', '4.x0', '4.1x']) {
      assert.equal(parseWhole(parseCents, text), INVALID, `"${text}"`);
    }
  });

  it('rejects sub-cent precision instead of rounding it', () => {
    assert.equal(parseWhole(parseCents, '1.234'), INVALID);
  });

  it('rejects amounts too large to be represented exactly in cents', () => {
    assert.equal(parseWhole(parseCents, '12345678901234.00'), INVALID);
  });
});
