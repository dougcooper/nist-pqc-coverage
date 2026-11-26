# Tasks for the NIST PQC coverage dataset and dashboard.
#
# `BASE` sets the site build path. Override it on the command line or in the
# environment: `just BASE=/ site`.
BASE := env_var_or_default("BASE", "/nist-pqc-coverage/")

# List available recipes.
default:
    @just --list

# Install Python dependencies.
install:
    uv sync

# Scrape NIST CAVP/CMVP and write data/*.csv.
scrape:
    uv run nist-pqc scrape

# Convert data/*.csv to Parquet for the dashboard.
parquet:
    uv run nist-pqc parquet

# Convert the CSVs to Parquet and copy them into the site.
sync-data: parquet
    cd site && node scripts/sync-data.mjs

# Build the static dashboard.
site: sync-data
    cd site && SITE_BASE={{BASE}} npm run build

# Serve the dashboard locally at http://localhost:3000.
dev: sync-data
    cd site && npm run dev

# Run the tests.
test:
    uv run pytest
