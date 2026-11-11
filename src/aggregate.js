import { CampaignTable } from './campaign-table.js';
import { INVALID, parseCents, parseUnsignedInt } from './parse.js';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const COMMA = 0x2c;
const DOUBLE_QUOTE = 0x22;
const BYTE_ORDER_MARK = '﻿';

const REQUIRED_COLUMNS = ['campaign_id', 'impressions', 'clicks', 'spend', 'conversions'];

// A line that never ends means the input is not line-oriented text. Failing
// fast keeps memory bounded instead of buffering the whole file.
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_REPORTED_SKIPPED_LINES = 10;

const EMPTY = Buffer.alloc(0);

/** An input problem the user can act on, as opposed to a bug. */
export class InputError extends Error {}

/**
 * @typedef {object} AggregationResult
 * @property {Map<string, import('./campaign-table.js').CampaignTotals>} campaigns totals keyed by campaign_id
 * @property {number} rowCount data rows aggregated
 * @property {number} skippedRowCount malformed data rows left out
 * @property {number[]} skippedLineNumbers 1-based line numbers of the first skipped rows
 */

/**
 * Consumes CSV bytes chunk by chunk and keeps one running total per campaign.
 * Memory use depends on the number of campaigns, not on the input size.
 */
class CampaignAggregator {
  /** Bytes of a line that was cut off at the end of the previous chunk. */
  #pendingLine = EMPTY;
  #lineNumber = 0;

  /** Positions of the required columns; null until the header is read. */
  #columns = null;
  #columnCount = 0;
  /** Start offset of each field of the current row, plus one closing entry. */
  #fieldStarts = new Int32Array(0);

  #campaigns = new CampaignTable();
  #rowCount = 0;
  #skippedRowCount = 0;
  #skippedLineNumbers = [];

  /** @param {Buffer} chunk */
  write(chunk) {
    let offset = 0;

    if (this.#pendingLine.length > 0) {
      const newline = chunk.indexOf(NEWLINE);
      if (newline === -1) {
        this.#keepPending(Buffer.concat([this.#pendingLine, chunk]));
        return;
      }
      const line = Buffer.concat([this.#pendingLine, chunk.subarray(0, newline)]);
      this.#pendingLine = EMPTY;
      this.#consumeLine(line, 0, line.length);
      offset = newline + 1;
    }

    for (;;) {
      const newline = chunk.indexOf(NEWLINE, offset);
      if (newline === -1) break;
      this.#consumeLine(chunk, offset, newline);
      offset = newline + 1;
    }

    if (offset < chunk.length) {
      // Copy the tail: the chunk's memory may be reused for the next read.
      this.#keepPending(Buffer.from(chunk.subarray(offset)));
    }
  }

  /** @returns {AggregationResult} */
  finish() {
    if (this.#pendingLine.length > 0) {
      const lastLine = this.#pendingLine;
      this.#pendingLine = EMPTY;
      this.#consumeLine(lastLine, 0, lastLine.length);
    }
    if (this.#columns === null) {
      throw new InputError('Input is empty: expected a CSV header row.');
    }
    return {
      campaigns: this.#campaigns.toMap(),
      rowCount: this.#rowCount,
      skippedRowCount: this.#skippedRowCount,
      skippedLineNumbers: this.#skippedLineNumbers,
    };
  }

  #keepPending(bytes) {
    if (bytes.length > MAX_LINE_BYTES) {
      throw new InputError(
        `Line ${this.#lineNumber + 1} is longer than ${MAX_LINE_BYTES} bytes; the input does not look like a CSV file.`,
      );
    }
    this.#pendingLine = bytes;
  }

  /** Handles the line in bytes [start, end), which excludes the newline. */
  #consumeLine(bytes, start, end) {
    this.#lineNumber++;
    if (end > start && bytes[end - 1] === CARRIAGE_RETURN) end--;

    if (this.#columns === null) {
      this.#readHeader(bytes.toString('utf8', start, end));
      return;
    }
    if (end === start) return;

    if (this.#addRow(bytes, start, end)) {
      this.#rowCount++;
    } else {
      this.#skippedRowCount++;
      if (this.#skippedLineNumbers.length < MAX_REPORTED_SKIPPED_LINES) {
        this.#skippedLineNumbers.push(this.#lineNumber);
      }
    }
  }

  #readHeader(line) {
    const header = line.startsWith(BYTE_ORDER_MARK) ? line.slice(1) : line;
    const names = header.split(',').map((name) => name.trim());

    const missing = REQUIRED_COLUMNS.filter((column) => !names.includes(column));
    if (missing.length > 0) {
      throw new InputError(`CSV header is missing required column(s): ${missing.join(', ')}.`);
    }

    this.#columns = {
      campaignId: names.indexOf('campaign_id'),
      impressions: names.indexOf('impressions'),
      clicks: names.indexOf('clicks'),
      spend: names.indexOf('spend'),
      conversions: names.indexOf('conversions'),
    };
    this.#columnCount = names.length;
    this.#fieldStarts = new Int32Array(names.length + 1);
  }

  /**
   * Adds one data row to its campaign's totals.
   *
   * @returns {boolean} false when the row is malformed and was left out
   */
  #addRow(bytes, start, end) {
    const fieldStarts = this.#fieldStarts;
    const lastField = this.#columnCount - 1;

    let field = 0;
    fieldStarts[0] = start;
    for (let i = start; i < end; i++) {
      const byte = bytes[i];
      if (byte === COMMA) {
        if (field === lastField) return false;
        fieldStarts[++field] = i + 1;
      } else if (byte === DOUBLE_QUOTE) {
        // Quoted fields are not supported; see README.
        return false;
      }
    }
    if (field !== lastField) return false;
    // Field n spans [fieldStarts[n], fieldStarts[n + 1] - 1): up to its comma.
    fieldStarts[lastField + 1] = end + 1;

    const columns = this.#columns;
    const idStart = fieldStarts[columns.campaignId];
    const idEnd = fieldStarts[columns.campaignId + 1] - 1;
    if (idStart === idEnd) return false;

    const impressions = parseUnsignedInt(
      bytes,
      fieldStarts[columns.impressions],
      fieldStarts[columns.impressions + 1] - 1,
    );
    const clicks = parseUnsignedInt(
      bytes,
      fieldStarts[columns.clicks],
      fieldStarts[columns.clicks + 1] - 1,
    );
    const spendCents = parseCents(
      bytes,
      fieldStarts[columns.spend],
      fieldStarts[columns.spend + 1] - 1,
    );
    const conversions = parseUnsignedInt(
      bytes,
      fieldStarts[columns.conversions],
      fieldStarts[columns.conversions + 1] - 1,
    );
    if (
      impressions === INVALID ||
      clicks === INVALID ||
      spendCents === INVALID ||
      conversions === INVALID
    ) {
      return false;
    }

    const totals = this.#campaigns.totalsFor(bytes, idStart, idEnd);
    totals.impressions += impressions;
    totals.clicks += clicks;
    totals.spendCents += spendCents;
    totals.conversions += conversions;
    return true;
  }
}

/**
 * Aggregates ad-performance CSV data by campaign.
 *
 * @param {AsyncIterable<Buffer> | Iterable<Buffer>} chunks the CSV bytes, split
 *   anywhere; a chunk is not read again once the next one is requested
 * @returns {Promise<AggregationResult>}
 * @throws {InputError} when the input has no usable header
 */
export async function aggregateCampaigns(chunks) {
  const aggregator = new CampaignAggregator();
  for await (const chunk of chunks) {
    aggregator.write(chunk);
  }
  return aggregator.finish();
}
