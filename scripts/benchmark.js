import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Runs the CLI several times, each in a fresh process, and prints the time and
 * peak memory it reports together with the machine it ran on.
 *
 * Usage: node scripts/benchmark.js [--input ad_data.csv] [--runs 5]
 */

const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const BYTES_PER_GIB = 1024 ** 3;

const { values: options } = parseArgs({
  options: {
    input: { type: 'string', short: 'i', default: 'ad_data.csv' },
    runs: { type: 'string', short: 'n', default: '5' },
  },
});

const inputBytes = statSync(options.input).size;
console.log(`Date:   ${new Date().toISOString()}`);
console.log(`Node:   ${process.version}`);
console.log(`OS:     ${os.type()} ${os.release()} (${os.arch()})`);
console.log(`CPU:    ${os.cpus()[0].model.trim()} (${os.cpus().length} logical cores)`);
console.log(`Memory: ${(os.totalmem() / BYTES_PER_GIB).toFixed(1)} GiB`);
console.log(`Input:  ${options.input} (${inputBytes.toLocaleString('en-US')} bytes)`);
console.log();

const outputDirectory = mkdtempSync(path.join(os.tmpdir(), 'ad-aggregator-benchmark-'));
try {
  for (let run = 1; run <= Number(options.runs); run++) {
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      [CLI_PATH, '--input', options.input, '--output', outputDirectory],
      { encoding: 'utf8' },
    );
    if (status !== 0) {
      console.error(stderr);
      process.exitCode = 1;
      break;
    }
    console.log(`Run ${run}: ${stdout.split('\n')[0]}`);
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
