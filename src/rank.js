/**
 * @typedef {object} CampaignSummary
 * @property {string} campaignId
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} spendCents
 * @property {number} conversions
 * @property {number | null} ctr clicks / impressions; null without impressions
 * @property {number | null} cpa spend in dollars / conversions; null without conversions
 */

const DEFAULT_LIMIT = 10;

/**
 * Derives CTR and CPA for every campaign.
 *
 * @param {Map<string, import('./campaign-table.js').CampaignTotals>} campaigns
 * @returns {CampaignSummary[]}
 */
export function summarizeCampaigns(campaigns) {
  return Array.from(campaigns, ([campaignId, totals]) => ({
    campaignId,
    ...totals,
    ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
    cpa: totals.conversions > 0 ? totals.spendCents / 100 / totals.conversions : null,
  }));
}

/**
 * Campaigns with the highest CTR first. Campaigns without impressions have no
 * CTR and are left out.
 *
 * @param {CampaignSummary[]} summaries
 * @param {number} [limit]
 * @returns {CampaignSummary[]}
 */
export function topByCtr(summaries, limit = DEFAULT_LIMIT) {
  return summaries
    .filter((summary) => summary.ctr !== null)
    .sort((a, b) => b.ctr - a.ctr || compareIds(a, b))
    .slice(0, limit);
}

/**
 * Campaigns with the lowest CPA first. Campaigns without conversions have no
 * CPA and are left out.
 *
 * @param {CampaignSummary[]} summaries
 * @param {number} [limit]
 * @returns {CampaignSummary[]}
 */
export function topByCpa(summaries, limit = DEFAULT_LIMIT) {
  return summaries
    .filter((summary) => summary.cpa !== null)
    .sort((a, b) => a.cpa - b.cpa || compareIds(a, b))
    .slice(0, limit);
}

/** Tie-breaker that keeps the ranking deterministic. */
function compareIds(a, b) {
  if (a.campaignId === b.campaignId) return 0;
  return a.campaignId < b.campaignId ? -1 : 1;
}
