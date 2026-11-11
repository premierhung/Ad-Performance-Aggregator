import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatReport } from '../src/report.js';

const HEADER_LINE = 'campaign_id,total_impressions,total_clicks,total_spend,total_conversions,CTR,CPA';

const summary = (overrides) => ({
  campaignId: 'CMP042',
  impressions: 125000,
  clicks: 6250,
  spendCents: 1250050,
  conversions: 625,
  ctr: 0.05,
  cpa: 20.0008,
  ...overrides,
});

describe('formatReport', () => {
  it('writes the header and one line per campaign, in the given order', () => {
    const report = formatReport([summary(), summary({ campaignId: 'CMP015' })]);

    assert.equal(
      report,
      `${HEADER_LINE}\nCMP042,125000,6250,12500.50,625,0.0500,20.00\nCMP015,125000,6250,12500.50,625,0.0500,20.00\n`,
    );
  });

  it('writes only the header when there are no campaigns', () => {
    assert.equal(formatReport([]), `${HEADER_LINE}\n`);
  });

  it('rounds CTR to four decimals and CPA to two', () => {
    const [, line] = formatReport([summary({ ctr: 0.0246153, cpa: 3.4703703 })]).split('\n');

    assert.equal(line, 'CMP042,125000,6250,12500.50,625,0.0246,3.47');
  });

  it('always shows spend with two decimals', () => {
    const spendOf = (spendCents) => formatReport([summary({ spendCents })]).split('\n')[1].split(',')[3];

    assert.equal(spendOf(0), '0.00');
    assert.equal(spendOf(5), '0.05');
    assert.equal(spendOf(4550), '45.50');
    assert.equal(spendOf(39478033396), '394780333.96');
  });

  it('leaves a missing CPA or CTR empty', () => {
    const [, line] = formatReport([summary({ conversions: 0, cpa: null, ctr: null })]).split('\n');

    assert.equal(line, 'CMP042,125000,6250,12500.50,0,,');
  });
});
