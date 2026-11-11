import { writeFile } from 'node:fs/promises';

const HEADER = [
  'campaign_id',
  'total_impressions',
  'total_clicks',
  'total_spend',
  'total_conversions',
  'CTR',
  'CPA',
];

const CTR_DECIMALS = 4;
const CPA_DECIMALS = 2;

/**
 * Renders campaign summaries as CSV text. A metric that does not exist
 * (CPA without conversions, CTR without impressions) is an empty field.
 *
 * @param {import('./rank.js').CampaignSummary[]} summaries
 * @returns {string}
 */
export function formatReport(summaries) {
  const lines = [HEADER.join(',')];
  for (const summary of summaries) {
    lines.push(
      [
        summary.campaignId,
        summary.impressions,
        summary.clicks,
        formatCents(summary.spendCents),
        summary.conversions,
        summary.ctr === null ? '' : summary.ctr.toFixed(CTR_DECIMALS),
        summary.cpa === null ? '' : summary.cpa.toFixed(CPA_DECIMALS),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string} filePath
 * @param {import('./rank.js').CampaignSummary[]} summaries
 */
export async function writeReport(filePath, summaries) {
  await writeFile(filePath, formatReport(summaries), 'utf8');
}

/** Formats integer cents as dollars without going through a float. */
function formatCents(cents) {
  const dollars = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, '0');
  return `${dollars}.${remainder}`;
}
