# Ad Performance Aggregator

A Node.js CLI that streams a large ad-performance CSV, aggregates it by `campaign_id`, and writes the top 10 campaigns by CTR and by CPA.

On the 1 GB challenge file (26.8 million rows) it runs in about **3.3 seconds** with a peak memory of about **50 MB**, and has no dependencies.

## Setup

Requires Node.js 20 or newer. There is nothing to install.

```bash
git clone https://github.com/premierhung/Ad-Performance-Aggregator.git
cd Ad-Performance-Aggregator
```

The input dataset is not in the repository (about 1 GB). Put `ad_data.csv` in the project folder or pass its path.

## Usage

```bash
node src/cli.js --input ad_data.csv --output results/
```

| Option | Description |
|---|---|
| `-i`, `--input` | Path to the input CSV (required) |
| `-o`, `--output` | Directory for the result files, created if missing (default: `results`) |
| `-h`, `--help` | Show usage |

The run writes `top10_ctr.csv` and `top10_cpa.csv` to the output directory and prints a summary:

```
Aggregated 26,843,544 row(s) into 50 campaign(s) in 3.25 s (peak memory 46.3 MB RSS).
Wrote results/top10_ctr.csv
Wrote results/top10_cpa.csv
```

Exit codes: `0` success, `1` input or file-system error, `2` invalid arguments.

### Docker

```bash
docker build -t ad-aggregator .
docker run --rm -v "$PWD:/data" ad-aggregator --input /data/ad_data.csv --output /data/results
```

## Output

Both files share one format. `total_spend` and `CPA` have 2 decimals, `CTR` has 4.

```
campaign_id,total_impressions,total_clicks,total_spend,total_conversions,CTR,CPA
CMP005,13648608306,375627610,394780333.96,20403485,0.0275,19.35
```

- `top10_ctr.csv`: highest `CTR = total_clicks / total_impressions` first.
- `top10_cpa.csv`: lowest `CPA = total_spend / total_conversions` first. Campaigns with zero conversions are excluded.

The results for the challenge file are in [results/](results/).

## Performance

Measured on the 1 GB file (1,043,304,870 bytes, 26,843,544 rows), 5 runs, each in a fresh process. Full log: [benchmarks/benchmark.log](benchmarks/benchmark.log).

| | |
|---|---|
| Processing time | 3.24 to 3.41 s (median 3.27 s) |
| Peak memory (RSS) | 48.9 to 49.9 MB |
| Machine | Intel Core i5-14600KF, 31.8 GiB RAM, Windows 11, Node v24.21.0 |

The time covers reading, aggregating and writing the reports, and excludes Node's startup (about 40 ms). An idle Node process on this machine already uses 32 MB, so the aggregation itself adds under 20 MB. Reproduce with `node scripts/benchmark.js --input ad_data.csv`.

## Design decisions

Each step below was measured on the same file and machine. Only the last row is the code in this repository.

| Approach | Time | Peak RSS |
|---|---|---|
| `readline`, `split(',')`, `Map` keyed by string | 16.0 s | 100 MB |
| Byte-level parser, `Map` keyed by string | 5.3 s | 107 MB |
| Byte-level parser, lookup by ID bytes | 3.1 s | 114 MB |
| The above with one reused read buffer (final) | 3.3 s | 49 MB |

**Byte-level parsing instead of `readline` or a CSV library.** The file is read in 1 MiB chunks and scanned as bytes. Numbers are parsed straight from the buffer, so no string is created per line or per field. A line cut off at the end of a chunk is carried into the next one ([src/aggregate.js](src/aggregate.js)).

**Campaign lookup by bytes, not by string.** After the first step, creating the campaign ID string for the `Map` lookup took about 40% of the remaining time. [src/campaign-table.js](src/campaign-table.js) hashes the ID bytes in place (FNV-1a) and confirms the match with a byte comparison, so colliding hashes stay correct. The collision path is tested with known colliding IDs.

**One reused read buffer.** `fs.createReadStream` allocates a new buffer per chunk, and those wait for garbage collection. Reading into a single buffer ([src/read-chunks.js](src/read-chunks.js)) costs about 0.2 s and saves about 65 MB. I chose the lower memory use because memory is the stated constraint.

**Spend is summed in integer cents.** Adding 26.8 million floats drifts: the naive float sum for `CMP005` is `394780333.96000457`, while the exact total is `394780333.96`. Integer cents are exact up to about $90 trillion per campaign. A spend with more than 2 decimals is treated as malformed instead of being rounded silently.

**Ranking uses exact ratios; rounding happens only on output.** The top 10 campaigns in this dataset all round to the same CTR (`0.0275`), so ranking on rounded values would give the wrong order. Ties are broken by `campaign_id` so the output is deterministic.

**Single-threaded.** Splitting the file across worker threads could cut the time further. At 3.3 s I judged the extra complexity not worth it.

## Input handling

| Case | Behaviour |
|---|---|
| Input file missing, or a directory | Error message, exit code 1 |
| Empty file, or header missing a required column | Error message naming the columns, exit code 1 |
| Malformed row | Skipped and counted; a warning lists the first 10 line numbers. The run still succeeds |
| Zero conversions | `CPA` is empty; the campaign is excluded from `top10_cpa.csv` |
| Zero impressions | `CTR` is empty; the campaign is excluded from `top10_ctr.csv` |
| Fewer than 10 campaigns | The report lists all of them |
| CRLF or LF, UTF-8 BOM, blank lines, no trailing newline | Accepted |
| Columns in a different order, or extra columns | Accepted; columns are found by header name |

A row is malformed when it has the wrong number of fields, an empty `campaign_id`, a count that is not a non-negative integer, a spend that is not a non-negative amount with at most 2 decimals, or a double quote.

Limitations:

- Quoted CSV fields are not supported, because the schema holds only IDs, dates and numbers. Rows containing a double quote are skipped as malformed.
- `date` is not validated, since no aggregate uses it.
- Memory grows with the number of distinct campaigns, not with the file size.

## Tests

```bash
npm test
```

60 tests on the built-in `node:test` runner cover the parsers, the campaign table (including hash collisions), aggregation (every possible chunk split, line endings, malformed rows), ranking, formatting, and the CLI end to end. One test compares the aggregator against a naive reference implementation on 20,000 random rows.

The results for the 1 GB file were also checked against an independent `awk` aggregation: all 50 campaign totals and both top-10 files matched exactly.

## Libraries

None at runtime or for tests. Only Node.js built-ins are used: `node:fs`, `node:path`, `node:util` (`parseArgs`), and `node:test`.

## Project structure

```
src/
  cli.js             argument parsing, orchestration, exit codes
  read-chunks.js     sequential file reader with one reused buffer
  aggregate.js       chunk and line handling, row validation
  parse.js           integer and money parsers over bytes
  campaign-table.js  per-campaign totals, looked up by ID bytes
  rank.js            CTR and CPA, top-N selection
  report.js          CSV output
test/                unit and end-to-end tests
scripts/benchmark.js repeated timed runs
results/             output for the challenge dataset
benchmarks/          benchmark log
```
