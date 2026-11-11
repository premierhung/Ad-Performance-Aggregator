import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { summarizeCampaigns, topByCpa, topByCtr } from '../src/rank.js';

const summarize = (totalsById) => summarizeCampaigns(new Map(Object.entries(totalsById)));
const ids = (summaries) => summaries.map((summary) => summary.campaignId);

describe('summarizeCampaigns', () => {
  it('derives CTR and CPA from the totals', () => {
    const [summary] = summarize({
      CMP001: { impressions: 26000, clicks: 640, spendCents: 9370, conversions: 27 },
    });

    assert.deepEqual(summary, {
      campaignId: 'CMP001',
      impressions: 26000,
      clicks: 640,
      spendCents: 9370,
      conversions: 27,
      ctr: 640 / 26000,
      cpa: 93.7 / 27,
    });
  });

  it('has no CPA without conversions and no CTR without impressions', () => {
    const [summary] = summarize({
      CMP001: { impressions: 0, clicks: 0, spendCents: 500, conversions: 0 },
    });

    assert.equal(summary.ctr, null);
    assert.equal(summary.cpa, null);
  });
});

describe('topByCtr', () => {
  it('orders campaigns by CTR, highest first', () => {
    const summaries = summarize({
      LOW: { impressions: 1000, clicks: 10, spendCents: 100, conversions: 1 },
      HIGH: { impressions: 1000, clicks: 50, spendCents: 100, conversions: 1 },
      MID: { impressions: 1000, clicks: 30, spendCents: 100, conversions: 1 },
    });

    assert.deepEqual(ids(topByCtr(summaries)), ['HIGH', 'MID', 'LOW']);
  });

  it('keeps campaigns without conversions and drops those without impressions', () => {
    const summaries = summarize({
      NO_CONVERSIONS: { impressions: 1000, clicks: 50, spendCents: 100, conversions: 0 },
      NO_IMPRESSIONS: { impressions: 0, clicks: 0, spendCents: 100, conversions: 0 },
    });

    assert.deepEqual(ids(topByCtr(summaries)), ['NO_CONVERSIONS']);
  });

  it('ranks by the exact ratio, not the rounded one', () => {
    // Both round to 0.0275.
    const summaries = summarize({
      A: { impressions: 1_000_000, clicks: 27_501, spendCents: 100, conversions: 1 },
      B: { impressions: 1_000_000, clicks: 27_502, spendCents: 100, conversions: 1 },
    });

    assert.deepEqual(ids(topByCtr(summaries)), ['B', 'A']);
  });

  it('breaks ties by campaign ID', () => {
    const summaries = summarize({
      CMP003: { impressions: 1000, clicks: 50, spendCents: 100, conversions: 1 },
      CMP001: { impressions: 2000, clicks: 100, spendCents: 100, conversions: 1 },
      CMP002: { impressions: 200, clicks: 10, spendCents: 100, conversions: 1 },
    });

    assert.deepEqual(ids(topByCtr(summaries)), ['CMP001', 'CMP002', 'CMP003']);
  });

  it('returns at most ten campaigns by default', () => {
    const totalsById = {};
    for (let i = 1; i <= 15; i++) {
      totalsById[`CMP${String(i).padStart(3, '0')}`] = {
        impressions: 1000,
        clicks: i,
        spendCents: 100,
        conversions: 1,
      };
    }

    const top = topByCtr(summarize(totalsById));
    assert.equal(top.length, 10);
    assert.equal(top[0].campaignId, 'CMP015');
    assert.equal(top[9].campaignId, 'CMP006');
  });

  it('returns every campaign when there are fewer than the limit', () => {
    const summaries = summarize({
      ONLY: { impressions: 1000, clicks: 10, spendCents: 100, conversions: 1 },
    });

    assert.deepEqual(ids(topByCtr(summaries)), ['ONLY']);
    assert.deepEqual(topByCtr([]), []);
  });

  it('does not reorder the summaries it was given', () => {
    const summaries = summarize({
      LOW: { impressions: 1000, clicks: 10, spendCents: 100, conversions: 1 },
      HIGH: { impressions: 1000, clicks: 50, spendCents: 100, conversions: 1 },
    });
    topByCtr(summaries);

    assert.deepEqual(ids(summaries), ['LOW', 'HIGH']);
  });
});

describe('topByCpa', () => {
  it('orders campaigns by CPA, lowest first', () => {
    const summaries = summarize({
      EXPENSIVE: { impressions: 1000, clicks: 10, spendCents: 5000, conversions: 10 },
      CHEAP: { impressions: 1000, clicks: 10, spendCents: 1000, conversions: 10 },
      MID: { impressions: 1000, clicks: 10, spendCents: 3000, conversions: 10 },
    });

    assert.deepEqual(ids(topByCpa(summaries)), ['CHEAP', 'MID', 'EXPENSIVE']);
  });

  it('excludes campaigns without conversions', () => {
    const summaries = summarize({
      FREE_BUT_NO_CONVERSIONS: { impressions: 1000, clicks: 10, spendCents: 0, conversions: 0 },
      CONVERTING: { impressions: 1000, clicks: 10, spendCents: 1000, conversions: 10 },
    });

    assert.deepEqual(ids(topByCpa(summaries)), ['CONVERTING']);
  });

  it('breaks ties by campaign ID', () => {
    const summaries = summarize({
      CMP002: { impressions: 1000, clicks: 10, spendCents: 2000, conversions: 20 },
      CMP001: { impressions: 1000, clicks: 10, spendCents: 1000, conversions: 10 },
    });

    assert.deepEqual(ids(topByCpa(summaries)), ['CMP001', 'CMP002']);
  });

  it('honours a custom limit', () => {
    const summaries = summarize({
      A: { impressions: 1000, clicks: 10, spendCents: 1000, conversions: 10 },
      B: { impressions: 1000, clicks: 10, spendCents: 2000, conversions: 10 },
      C: { impressions: 1000, clicks: 10, spendCents: 3000, conversions: 10 },
    });

    assert.deepEqual(ids(topByCpa(summaries, 2)), ['A', 'B']);
  });
});
