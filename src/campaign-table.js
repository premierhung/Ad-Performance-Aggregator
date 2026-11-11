const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * @typedef {object} CampaignTotals
 * @property {number} impressions
 * @property {number} clicks
 * @property {number} spendCents
 * @property {number} conversions
 */

/**
 * Running totals per campaign, looked up by the raw bytes of the campaign ID.
 *
 * A plain Map<string, totals> needs a new string for every row just to do the
 * lookup, and that dominated the run time (see README). Hashing the ID bytes
 * in place avoids the allocation: the hash selects a chain of entries and a
 * byte comparison confirms the match, so hash collisions stay correct.
 */
export class CampaignTable {
  /** First entry of each chain, keyed by ID hash. */
  #chains = new Map();

  /**
   * Returns the totals of the campaign whose ID is bytes [start, end),
   * starting them at zero the first time the campaign is seen.
   *
   * @param {Uint8Array} bytes
   * @param {number} start inclusive
   * @param {number} end exclusive
   * @returns {CampaignTotals}
   */
  totalsFor(bytes, start, end) {
    let hash = FNV_OFFSET_BASIS;
    for (let i = start; i < end; i++) {
      hash = Math.imul(hash ^ bytes[i], FNV_PRIME);
    }

    const firstInChain = this.#chains.get(hash);
    for (let entry = firstInChain; entry !== undefined; entry = entry.next) {
      if (hasId(entry, bytes, start, end)) return entry.totals;
    }

    const entry = {
      idBytes: Buffer.from(bytes.subarray(start, end)),
      totals: { impressions: 0, clicks: 0, spendCents: 0, conversions: 0 },
      next: firstInChain,
    };
    this.#chains.set(hash, entry);
    return entry.totals;
  }

  /**
   * @returns {Map<string, CampaignTotals>} totals keyed by campaign ID
   */
  toMap() {
    const campaigns = new Map();
    for (const firstInChain of this.#chains.values()) {
      for (let entry = firstInChain; entry !== undefined; entry = entry.next) {
        campaigns.set(entry.idBytes.toString('utf8'), entry.totals);
      }
    }
    return campaigns;
  }
}

function hasId(entry, bytes, start, end) {
  const { idBytes } = entry;
  if (idBytes.length !== end - start) return false;
  for (let i = 0; i < idBytes.length; i++) {
    if (idBytes[i] !== bytes[start + i]) return false;
  }
  return true;
}
