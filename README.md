# NIST PQC validation coverage

Scrapes the NIST CAVP and CMVP websites for post-quantum algorithm validations
(ML-KEM, ML-DSA, SLH-DSA, LMS), normalizes the operating environments (OS,
CPU, architecture), and builds a dataset plus a static dashboard for coverage
analysis.

## Quick start

```bash
uv sync
uv run nist-pqc scrape          # first run: 1-2 hours, 1 request/second
make site                       # build the static dashboard
make dev                        # serve it locally at http://localhost:3000
```

Use `--workers 4 --delay 0.4` for a faster first run once you are comfortable
with the request rate; the default stays at one request per second. Cached pages
are reused (`--refresh` refetches them).

The dashboard is built with [Observable Framework](https://observablehq.com/framework/).
The pages query the data through DuckDB-WASM, so the committed CSVs are first
converted to Parquet (`uv run nist-pqc parquet`, also part of `make sync-data`).
`make site` builds for the GitHub Pages path (`/nist-pqc-coverage/`); use
`make site BASE=/` for a root-path build.

Outputs land in `data/`:

| File | One row per |
| --- | --- |
| `cavp_validations.csv` | CAVP validation (A-number) |
| `cavp_oe_algorithms.csv` | (operating environment, algorithm) pair |
| `operating_environments.csv` | CAVP operating environment with normalized OS/CPU fields |
| `cmvp_certs.csv` | CMVP certificate that includes a PQC algorithm |
| `cmvp_cavp_links.csv` | CMVP certificate -> CAVP A-number link |
| `cmvp_in_process.csv` | Modules-in-process or IUT row with inferred PQC evidence |
| `cmvp_policy_sections.csv` | Tested / vendor-affirmed OE section from each security policy PDF |
| `pqc_coverage.csv` | Flat analysis table: source, product, OE, target, algorithm |
| `coverage_targets.csv` | OS/CPU target ranked by vendor/product coverage and cumulative curve |
| `coverage_greedy.csv` | Greedy set cover: which products cover the most targets |
| `metadata.json` | Run timestamp, counts, data-as-of date |

`module_type` is kept as NIST publishes it (`SOFTWARE`, `Software`, `SW Hybrid`,
`Firmware-hybrid`, …). The normalized `module_kind` column maps those spellings to
`software`, `software_hybrid`, `firmware`, `firmware_hybrid` or `hardware`; the
software scopes include software-hybrid modules and exclude firmware-hybrid ones.
Modules in process have no published type, so their `module_kind` is empty.

## Data caveats

- CMVP certificate pages do not publish tested operating environments. The
  authoritative list is in the non-proprietary security policy PDF; those
  sections are extracted (best effort) and also inherited from the linked CAVP
  validations. Vendor-affirmed OEs, which CAVP does not show, are only in the
  PDFs. Requires `pdftotext` (poppler-utils).
- The policy `os_candidates` / `cpu_candidates` columns are regex hints. The
  `section_text` column is the source of truth for a compliance claim.
- The Modules-in-Process and IUT lists do not publish algorithms. PQC relevance
  is inferred by vendor + module-name matching against PQC CAVP validations
  (`pqc_evidence`: `cavp_name_match`, `name_keyword`, `cavp_vendor_only`,
  `none`). Treat non-`cavp_name_match` rows as leads, not facts.
- OS family/product/version and CPU architecture are heuristic normalizations
  of free-text OE names and dependency data. Rows that fail to match keep
  `os_family=unknown` and are reported at the end of each scrape.
- `--include-historical` adds non-active CMVP certificates (excluded by default).

## Dashboard

`site/` is an [Observable Framework](https://observablehq.com/framework/) project.
`make sync-data` converts `data/*.csv` to Parquet in `site/docs/data/` and copies
the CSVs and `metadata.json` beside them. Each page opens DuckDB-WASM once and
queries shared views (`coverage`, `validated`, `validated_software`,
`with_in_process`, `targets`) defined in `site/docs/components/db.js`; filters
become SQL parameters.

- **Overview** — validated products by family, source, and quarter; top vendors.
- **Operating environments** — OS-family × architecture heatmap, most-covered OS
  versions and CPUs, and the full target table, with filters for source,
  algorithm family, OS family, and module type.
- **Coverage** — targets ranked by product/vendor count, cumulative coverage
  curve, greedy product selection, and per-target drill-down.
- **Pipeline** — modules in process / IUT with their inferred PQC evidence, and
  validated CAVP implementations without an active CMVP certificate.
- **Tested configurations** — tested and vendor-affirmed operating environments
  quoted from each certificate's non-proprietary security policy, one collapsible
  card per certificate with a Simple/Expanded switch for the policy text.
- **SQL console** — a simple builder (view, what to group by, a measure,
  filters) and a full read-only editor behind two tabs; the SQL the builder runs
  is shown above the results, and **Open in SQL** hands it to the editor. Both
  share the column dictionary, schema browser, table/chart view, and CSV download.
- **Explorer** — the full `pqc_coverage.csv` table with search and filters.

Charts are [ECharts](https://echarts.apache.org/) styled like Evidence (quiet
axes, rounded bars, theme-aware); tables are a shared component with sorting,
search, pagination, CSV download, and a card layout below 640 px.

### Ask the data (experimental)

A floating **Ask** button in the corner of every data page opens a chat that turns
a question into SQL with a small language model running entirely in your browser
([WebLLM](https://github.com/mlc-ai/web-llm)). The default is Qwen2.5-Coder 0.5B
(about 0.4 GB), which runs on integrated GPUs; the model menu also offers
Qwen2.5-Coder 1.5B (about 1 GB) for machines with a stronger GPU, which writes
better SQL. The agent runs the query against the same data and shows the table or
chart in the conversation. On the SQL console the answer can be sent to the editor
with **Open in console**. Nothing is sent to a server; the model is fetched from
Hugging Face once and cached in the browser (Storage → Cache Storage), with a
**Delete model** button to reclaim the space.

If the graphics adapter cannot hold the selected model, the chat offers to switch
to the 0.4 GB one, and the site remembers the choice.

It only appears on a desktop-sized window with a WebGPU adapter that has at least
1 GiB of buffer size, and it never downloads anything until you ask for it. On
integrated GPUs the browser can lose the WebGPU device during generation
(`mapAsync` / device-lost errors); the agent reloads the model and retries once,
and the SQL stays in the chat, so a failed answer costs a few seconds rather than
the page. The site works without it.

## Data for agents

The site publishes the dataset at stable URLs, so an agent or a notebook can use
it without running the dashboard's JavaScript:

- <https://dougcooper.github.io/nist-pqc-coverage/llms.txt> — what the data is,
  the three programs, the `validated` set, caveats, and example DuckDB queries.
  Every page links to it from `<head>` and the footer, and `robots.txt` points
  at it.
- <https://dougcooper.github.io/nist-pqc-coverage/downloads/> — every CSV and
  Parquet file under a name that never changes, plus `schema.json` (columns,
  types and one-line meanings, generated from the CSV headers) and
  `summary.json` (counts and top targets, small enough to read first).

`site/scripts/publish-data.mjs` runs after `observable build` and produces those
files; Framework itself only serves content-hashed copies such as
`_file/data/pqc_coverage.<hash>.csv`.

## Publishing

The site is static and deploys to GitHub Pages. `.github/workflows/pages.yml`
builds it from the committed CSVs on every push to `main`;
`.github/workflows/scrape.yml` refreshes the data weekly and commits any changes.
If you rename the repository, update `SITE_BASE` in `pages.yml` (and `BASE` in
the `Makefile`) to match.

## Development

```bash
uv run pytest
```

Fixtures in `tests/fixtures/` are saved NIST pages used by the parser tests.
