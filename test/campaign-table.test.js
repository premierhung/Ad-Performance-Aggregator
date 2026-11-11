import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CampaignTable } from '../src/campaign-table.js';

const addClicks = (table, id, clicks) => {
  const bytes = Buffer.from(id);
  table.totalsFor(bytes, 0, bytes.length).clicks += clicks;
};

describe('CampaignTable', () => {
  it('starts a campaign at zero and returns the same totals on later lookups', () => {
    const table = new CampaignTable();
    const bytes = Buffer.from('CMP001');

    const totals = table.totalsFor(bytes, 0, bytes.length);
    assert.deepEqual(totals, { impressions: 0, clicks: 0, spendCents: 0, conversions: 0 });
    assert.equal(table.totalsFor(bytes, 0, bytes.length), totals);
  });

  it('identifies a campaign by the given byte range only', () => {
    const table = new CampaignTable();
    const row = Buffer.from('CMP001,2025-01-01');
    table.totalsFor(row, 0, 6).clicks = 5;

    assert.deepEqual([...table.toMap().keys()], ['CMP001']);
  });

  it('keeps its own copy of the ID, so the source buffer can be reused', () => {
    const table = new CampaignTable();
    const buffer = Buffer.from('CMP001');
    table.totalsFor(buffer, 0, buffer.length).clicks = 1;
    buffer.write('CMP002');
    table.totalsFor(buffer, 0, buffer.length).clicks = 2;

    const campaigns = table.toMap();
    assert.equal(campaigns.get('CMP001').clicks, 1);
    assert.equal(campaigns.get('CMP002').clicks, 2);
  });

  it('keeps IDs apart when their hashes collide', () => {
    // Known 32-bit FNV-1a collisions.
    const collidingPairs = [
      ['costarring', 'liquid'],
      ['declinate', 'macallums'],
      ['altarage', 'zinke'],
    ];
    const table = new CampaignTable();
    for (const [first, second] of collidingPairs) {
      addClicks(table, first, 1);
      addClicks(table, second, 10);
      addClicks(table, first, 1);
      addClicks(table, second, 10);
    }

    const campaigns = table.toMap();
    assert.equal(campaigns.size, 6);
    for (const [first, second] of collidingPairs) {
      assert.equal(campaigns.get(first).clicks, 2);
      assert.equal(campaigns.get(second).clicks, 20);
    }
  });

  it('distinguishes IDs that share a prefix', () => {
    const table = new CampaignTable();
    addClicks(table, 'CMP1', 1);
    addClicks(table, 'CMP10', 2);

    const campaigns = table.toMap();
    assert.equal(campaigns.get('CMP1').clicks, 1);
    assert.equal(campaigns.get('CMP10').clicks, 2);
  });

  it('decodes non-ASCII IDs as UTF-8', () => {
    const table = new CampaignTable();
    addClicks(table, 'chiến-dịch-1', 3);

    assert.equal(table.toMap().get('chiến-dịch-1').clicks, 3);
  });
});
