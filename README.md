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

`site/` is an [Observable Framework](https://observablehq.com/framework/) project
that reads the CSVs copied into `site/docs/data/`:

- **Overview** — validated products by family, source, and quarter; top vendors.
- **Operating environments** — OS-family × architecture heatmap, most-covered OS
  versions and CPUs, and the full target table, with filters for source,
  algorithm family, OS family, and module type.
- **Coverage** — targets ranked by product/vendor count, cumulative coverage
  curve, greedy product selection, and per-target drill-down.
- **Pipeline** — modules in process / IUT with their inferred PQC evidence, and
  validated CAVP implementations without an active CMVP certificate.
- **Explorer** — the full `pqc_coverage.csv` table with search and filters.

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
