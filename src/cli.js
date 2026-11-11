#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { InputError, aggregateCampaigns } from './aggregate.js';
import { summarizeCampaigns, topByCpa, topByCtr } from './rank.js';
import { readChunks } from './read-chunks.js';
import { writeReport } from './report.js';

const USAGE = `Usage: node src/cli.js --input <file.csv> [--output <directory>]

Aggregates ad-performance data by campaign and writes top10_ctr.csv and
top10_cpa.csv to the output directory.

Options:
  -i, --input   Path to the input CSV file (required)
  -o, --output  Directory for the result files (default: results)
  -h, --help    Show this help
`;

const DEFAULT_OUTPUT_DIRECTORY = 'results';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

function parseCliArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o', default: DEFAULT_OUTPUT_DIRECTORY },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return values;
}

async function readCampaigns(inputPath) {
  try {
    return await aggregateCampaigns(readChunks(inputPath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new InputError(`Input file not found: ${inputPath}`);
    }
    if (error.code === 'EISDIR') {
      throw new InputError(`Input path is a directory, not a file: ${inputPath}`);
    }
    throw error;
  }
}

function printSummary({ result, elapsedMs, reportPaths }) {
  const count = (value) => value.toLocaleString('en-US');
  const peakRssMb = process.resourceUsage().maxRSS / 1024;

  console.log(
    `Aggregated ${count(result.rowCount)} row(s) into ${count(result.campaigns.size)} campaign(s) ` +
      `in ${(elapsedMs / 1000).toFixed(2)} s (peak memory ${peakRssMb.toFixed(1)} MB RSS).`,
  );
  for (const reportPath of reportPaths) {
    console.log(`Wrote ${reportPath}`);
  }

  if (result.skippedRowCount > 0) {
    const shown = result.skippedLineNumbers.join(', ');
    const more = result.skippedRowCount > result.skippedLineNumbers.length ? ', ...' : '';
    console.error(
      `Warning: skipped ${count(result.skippedRowCount)} malformed row(s) at line(s) ${shown}${more}.`,
    );
  }
}

async function main() {
  let options;
  try {
    options = parseCliArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}\n\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.input) {
    console.error(`Error: --input is required.\n\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
    return;
  }

  const startedAt = performance.now();
  try {
    const result = await readCampaigns(options.input);
    const summaries = summarizeCampaigns(result.campaigns);

    await mkdir(options.output, { recursive: true });
    const ctrReportPath = path.join(options.output, 'top10_ctr.csv');
    const cpaReportPath = path.join(options.output, 'top10_cpa.csv');
    await writeReport(ctrReportPath, topByCtr(summaries));
    await writeReport(cpaReportPath, topByCpa(summaries));

    printSummary({
      result,
      elapsedMs: performance.now() - startedAt,
      reportPaths: [ctrReportPath, cpaReportPath],
    });
  } catch (error) {
    // Input and file-system problems get a one-line message; anything else is
    // a bug and keeps its stack trace.
    const isExpected = error instanceof InputError || typeof error.code === 'string';
    if (!isExpected) throw error;
    console.error(`Error: ${error.message}`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
