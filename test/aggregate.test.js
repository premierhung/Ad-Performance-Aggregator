import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InputError, aggregateCampaigns } from '../src/aggregate.js';

const HEADER = 'campaign_id,date,impressions,clicks,spend,conversions';

// The example data from the challenge brief.
const SAMPLE_ROWS = [
  'CMP001,2025-01-01,12000,300,45.50,12',
  'CMP002,2025-01-01,8000,120,28.00,4',
  'CMP001,2025-01-02,14000,340,48.20,15',
  'CMP003,2025-01-01,5000,60,15.00,3',
  'CMP002,2025-01-02,8500,150,31.00,5',
];
const SAMPLE_TOTALS = {
  CMP001: { impressions: 26000, clicks: 640, spendCents: 9370, conversions: 27 },
  CMP002: { impressions: 16500, clicks: 270, spendCents: 5900, conversions: 9 },
  CMP003: { impressions: 5000, clicks: 60, spendCents: 1500, conversions: 3 },
};

const csv = (lines, lineEnding = '\n') => lines.join(lineEnding) + lineEnding;
const aggregateText = (text) => aggregateCampaigns([Buffer.from(text)]);
const totalsOf = (result) => Object.fromEntries(result.campaigns);

describe('aggregateCampaigns', () => {
  it('sums impressions, clicks, spend and conversions per campaign', async () => {
    const result = await aggregateText(csv([HEADER, ...SAMPLE_ROWS]));

    assert.deepEqual(totalsOf(result), SAMPLE_TOTALS);
    assert.equal(result.rowCount, 5);
    assert.equal(result.skippedRowCount, 0);
    assert.deepEqual(result.skippedLineNumbers, []);
  });

  it('gives the same result wherever the input is split into chunks', async () => {
    const bytes = Buffer.from(csv([HEADER, ...SAMPLE_ROWS], '\r\n'));

    for (let split = 1; split < bytes.length; split++) {
      const result = await aggregateCampaigns([bytes.subarray(0, split), bytes.subarray(split)]);
      assert.deepEqual(totalsOf(result), SAMPLE_TOTALS, `split at byte ${split}`);
      assert.equal(result.rowCount, 5, `split at byte ${split}`);
    }
  });

  it('handles chunks far smaller than a line', async () => {
    const bytes = Buffer.from(csv([HEADER, ...SAMPLE_ROWS]));
    const singleBytes = Array.from(bytes, (_, i) => bytes.subarray(i, i + 1));

    assert.deepEqual(totalsOf(await aggregateCampaigns(singleBytes)), SAMPLE_TOTALS);
  });

  it('does not depend on a chunk after the next one is requested', async () => {
    const bytes = Buffer.from(csv([HEADER, ...SAMPLE_ROWS]));
    function* chunksInReusedBuffer(chunkBytes) {
      const buffer = Buffer.alloc(chunkBytes);
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const copied = bytes.copy(buffer, 0, offset, offset + chunkBytes);
        yield buffer.subarray(0, copied);
        buffer.fill(0);
      }
    }

    assert.deepEqual(totalsOf(await aggregateCampaigns(chunksInReusedBuffer(16))), SAMPLE_TOTALS);
  });

  it('accepts CRLF line endings', async () => {
    const result = await aggregateText(csv([HEADER, ...SAMPLE_ROWS], '\r\n'));

    assert.deepEqual(totalsOf(result), SAMPLE_TOTALS);
  });

  it('accepts a final line without a trailing newline', async () => {
    const result = await aggregateText([HEADER, ...SAMPLE_ROWS].join('\n'));

    assert.deepEqual(totalsOf(result), SAMPLE_TOTALS);
  });

  it('ignores a UTF-8 byte order mark', async () => {
    const result = await aggregateText(`﻿${csv([HEADER, ...SAMPLE_ROWS])}`);

    assert.deepEqual(totalsOf(result), SAMPLE_TOTALS);
  });

  it('ignores blank lines without counting them as malformed', async () => {
    const result = await aggregateText(csv([HEADER, '', ...SAMPLE_ROWS, '', '']));

    assert.deepEqual(totalsOf(result), SAMPLE_TOTALS);
    assert.equal(result.skippedRowCount, 0);
  });

  it('finds columns by header name, in any order and with extra columns', async () => {
    const result = await aggregateText(
      csv([
        'spend, clicks ,region,campaign_id,conversions,impressions',
        '45.50,300,EU,CMP001,12,12000',
        '48.20,340,US,CMP001,15,14000',
      ]),
    );

    assert.deepEqual(totalsOf(result), { CMP001: SAMPLE_TOTALS.CMP001 });
  });

  it('returns no campaigns for a header-only file', async () => {
    const result = await aggregateText(csv([HEADER]));

    assert.equal(result.campaigns.size, 0);
    assert.equal(result.rowCount, 0);
  });

  it('skips malformed rows and reports their line numbers', async () => {
    const result = await aggregateText(
      csv([
        HEADER,
        'CMP001,2025-01-01,12000,300,45.50,12',
        'CMP001,2025-01-02,many,300,45.50,12',
        'CMP001,2025-01-03,12000,-300,45.50,12',
        'CMP001,2025-01-04,12000,300,45.505,12',
        'CMP001,2025-01-05,12000,300,45.50,',
        'CMP001,2025-01-06,12000,300,45.50',
        'CMP001,2025-01-07,12000,300,45.50,12,extra',
        ',2025-01-08,12000,300,45.50,12',
        '"CMP001",2025-01-09,12000,300,45.50,12',
        'CMP001,2025-01-10,14000,340,48.20,15',
      ]),
    );

    assert.deepEqual(totalsOf(result), { CMP001: SAMPLE_TOTALS.CMP001 });
    assert.equal(result.rowCount, 2);
    assert.equal(result.skippedRowCount, 8);
    assert.deepEqual(result.skippedLineNumbers, [3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('counts every skipped row but reports only the first line numbers', async () => {
    const badRows = Array.from({ length: 25 }, () => 'CMP001,2025-01-01,bad,1,1.00,1');
    const result = await aggregateText(csv([HEADER, ...badRows]));

    assert.equal(result.skippedRowCount, 25);
    assert.deepEqual(result.skippedLineNumbers, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('rejects empty input', async () => {
    await assert.rejects(aggregateCampaigns([]), InputError);
    await assert.rejects(aggregateText(''), InputError);
  });

  it('rejects a header without the required columns', async () => {
    await assert.rejects(
      aggregateText(csv(['campaign_id,date,impressions,clicks', 'CMP001,x,1,1'])),
      (error) => {
        assert.ok(error instanceof InputError);
        assert.equal(error.message, 'CSV header is missing required column(s): spend, conversions.');
        return true;
      },
    );
  });

  it('rejects input that is not line-oriented text', async () => {
    const withoutNewlines = Buffer.alloc(600 * 1024, 'x');

    await assert.rejects(
      aggregateCampaigns([Buffer.from(`${HEADER}\n`), withoutNewlines, withoutNewlines]),
      /Line 2 is longer than/,
    );
  });
});

describe('aggregateCampaigns against a naive reference', () => {
  /** Small deterministic PRNG (mulberry32), so a failure is reproducible. */
  const createRandom = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const referenceTotals = (rows) => {
    const totals = {};
    for (const row of rows) {
      const [campaignId, , impressions, clicks, spend, conversions] = row.split(',');
      totals[campaignId] ??= { impressions: 0, clicks: 0, spendCents: 0, conversions: 0 };
      totals[campaignId].impressions += Number(impressions);
      totals[campaignId].clicks += Number(clicks);
      totals[campaignId].spendCents += Math.round(Number(spend) * 100);
      totals[campaignId].conversions += Number(conversions);
    }
    return totals;
  };

  it('matches on 20,000 random rows read in random-sized chunks', async () => {
    const random = createRandom(20250101);
    const integerBelow = (limit) => Math.floor(random() * limit);

    const rows = Array.from({ length: 20_000 }, () => {
      const campaignId = `CMP${String(integerBelow(60)).padStart(3, '0')}`;
      const date = `2025-01-${String(1 + integerBelow(28)).padStart(2, '0')}`;
      const cents = integerBelow(250_000);
      // Mix "12", "12.3" and "12.34" spellings, as in the real data.
      const spend = String(cents / 100);
      return [campaignId, date, integerBelow(50_000), integerBelow(2_000), spend, integerBelow(80)].join(',');
    });
    const bytes = Buffer.from(csv([HEADER, ...rows], '\r\n'));

    const chunks = [];
    for (let offset = 0; offset < bytes.length; ) {
      const size = 1 + integerBelow(4096);
      chunks.push(bytes.subarray(offset, offset + size));
      offset += size;
    }
    const result = await aggregateCampaigns(chunks);

    assert.deepEqual(totalsOf(result), referenceTotals(rows));
    assert.equal(result.rowCount, rows.length);
    assert.equal(result.skippedRowCount, 0);
  });
});
