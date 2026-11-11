import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const HEADER_LINE = 'campaign_id,total_impressions,total_clicks,total_spend,total_conversions,CTR,CPA';

const execFileAsync = promisify(execFile);

/** Runs the CLI and resolves with its exit code and output, whatever the outcome. */
async function runCli(...args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args]);
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

describe('cli', () => {
  let workDirectory;

  const writeInput = async (name, content) => {
    const inputPath = path.join(workDirectory, name);
    await writeFile(inputPath, content);
    return inputPath;
  };
  const readOutput = (outputDirectory, name) => readFile(path.join(outputDirectory, name), 'utf8');

  before(async () => {
    workDirectory = await mkdtemp(path.join(tmpdir(), 'ad-aggregator-test-'));
  });
  after(async () => {
    await rm(workDirectory, { recursive: true, force: true });
  });

  it('writes both reports for the example in the challenge brief', async () => {
    const inputPath = await writeInput(
      'sample.csv',
      [
        'campaign_id,date,impressions,clicks,spend,conversions',
        'CMP001,2025-01-01,12000,300,45.50,12',
        'CMP002,2025-01-01,8000,120,28.00,4',
        'CMP001,2025-01-02,14000,340,48.20,15',
        'CMP003,2025-01-01,5000,60,15.00,3',
        'CMP002,2025-01-02,8500,150,31.00,5',
        '',
      ].join('\n'),
    );
    const outputDirectory = path.join(workDirectory, 'nested', 'results');

    const { exitCode, stdout, stderr } = await runCli('--input', inputPath, '--output', outputDirectory);

    assert.equal(exitCode, 0);
    assert.equal(stderr, '');
    assert.match(stdout, /Aggregated 5 row\(s\) into 3 campaign\(s\)/);
    assert.equal(
      await readOutput(outputDirectory, 'top10_ctr.csv'),
      [
        HEADER_LINE,
        'CMP001,26000,640,93.70,27,0.0246,3.47',
        'CMP002,16500,270,59.00,9,0.0164,6.56',
        'CMP003,5000,60,15.00,3,0.0120,5.00',
        '',
      ].join('\n'),
    );
    assert.equal(
      await readOutput(outputDirectory, 'top10_cpa.csv'),
      [
        HEADER_LINE,
        'CMP001,26000,640,93.70,27,0.0246,3.47',
        'CMP003,5000,60,15.00,3,0.0120,5.00',
        'CMP002,16500,270,59.00,9,0.0164,6.56',
        '',
      ].join('\n'),
    );
  });

  it('limits each report to ten campaigns and leaves zero-conversion campaigns out of the CPA report', async () => {
    const rows = ['campaign_id,date,impressions,clicks,spend,conversions'];
    for (let i = 1; i <= 12; i++) {
      const conversions = i === 12 ? 0 : 10;
      rows.push(`CMP${String(i).padStart(3, '0')},2025-01-01,1000,${i * 10},${i}.00,${conversions}`);
    }
    const inputPath = await writeInput('twelve.csv', `${rows.join('\n')}\n`);
    const outputDirectory = path.join(workDirectory, 'twelve');

    const { exitCode } = await runCli('-i', inputPath, '-o', outputDirectory);

    assert.equal(exitCode, 0);
    const ctrLines = (await readOutput(outputDirectory, 'top10_ctr.csv')).trimEnd().split('\n');
    assert.equal(ctrLines.length, 11);
    assert.equal(ctrLines[1], 'CMP012,1000,120,12.00,0,0.1200,');
    assert.equal(ctrLines[10], 'CMP003,1000,30,3.00,10,0.0300,0.30');

    const cpaLines = (await readOutput(outputDirectory, 'top10_cpa.csv')).trimEnd().split('\n');
    assert.equal(cpaLines.length, 11);
    assert.equal(cpaLines[1], 'CMP001,1000,10,1.00,10,0.0100,0.10');
    assert.equal(cpaLines[10], 'CMP010,1000,100,10.00,10,0.1000,1.00');
    assert.ok(!cpaLines.some((line) => line.startsWith('CMP012')));
  });

  it('warns about malformed rows and still succeeds', async () => {
    const inputPath = await writeInput(
      'malformed.csv',
      [
        'campaign_id,date,impressions,clicks,spend,conversions',
        'CMP001,2025-01-01,1000,10,5.00,1',
        'CMP001,2025-01-02,not-a-number,10,5.00,1',
        'CMP001,2025-01-03',
        '',
      ].join('\n'),
    );
    const outputDirectory = path.join(workDirectory, 'malformed');

    const { exitCode, stdout, stderr } = await runCli('--input', inputPath, '--output', outputDirectory);

    assert.equal(exitCode, 0);
    assert.match(stdout, /Aggregated 1 row\(s\) into 1 campaign\(s\)/);
    assert.match(stderr, /Warning: skipped 2 malformed row\(s\) at line\(s\) 3, 4\./);
    assert.equal(
      await readOutput(outputDirectory, 'top10_ctr.csv'),
      `${HEADER_LINE}\nCMP001,1000,10,5.00,1,0.0100,5.00\n`,
    );
  });

  it('fails with a clear message when the input file does not exist', async () => {
    const missingPath = path.join(workDirectory, 'missing.csv');

    const { exitCode, stderr } = await runCli('--input', missingPath);

    assert.equal(exitCode, 1);
    assert.equal(stderr.trim(), `Error: Input file not found: ${missingPath}`);
  });

  it('fails with a clear message when the input is a directory', async () => {
    const { exitCode, stderr } = await runCli('--input', workDirectory);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Error: Input path is a directory, not a file/);
  });

  it('fails with a clear message when a required column is missing', async () => {
    const inputPath = await writeInput('no-spend.csv', 'campaign_id,date,impressions,clicks,conversions\n');

    const { exitCode, stderr } = await runCli('--input', inputPath, '--output', path.join(workDirectory, 'unused'));

    assert.equal(exitCode, 1);
    assert.equal(stderr.trim(), 'Error: CSV header is missing required column(s): spend.');
  });

  it('fails with a clear message when the input is empty', async () => {
    const inputPath = await writeInput('empty.csv', '');

    const { exitCode, stderr } = await runCli('--input', inputPath, '--output', path.join(workDirectory, 'unused'));

    assert.equal(exitCode, 1);
    assert.match(stderr, /Error: Input is empty/);
  });

  it('prints usage and exits with code 2 when --input is missing', async () => {
    const { exitCode, stderr } = await runCli();

    assert.equal(exitCode, 2);
    assert.match(stderr, /Error: --input is required\./);
    assert.match(stderr, /Usage:/);
  });

  it('prints usage and exits with code 2 for an unknown option', async () => {
    const { exitCode, stderr } = await runCli('--input', 'x.csv', '--verbose');

    assert.equal(exitCode, 2);
    assert.match(stderr, /Unknown option '--verbose'/);
    assert.match(stderr, /Usage:/);
  });

  it('prints usage for --help', async () => {
    const { exitCode, stdout } = await runCli('--help');

    assert.equal(exitCode, 0);
    assert.match(stdout, /Usage: node src\/cli\.js --input/);
  });
});
