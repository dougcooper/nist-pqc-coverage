BASE ?= /nist-pqc-coverage/

.PHONY: install scrape sync-data site dev test

install:
	uv sync

scrape:
	uv run nist-pqc scrape

sync-data:
	cd site && node scripts/sync-data.mjs

site: sync-data
	cd site && SITE_BASE=$(BASE) npm run build

dev: sync-data
	cd site && npm run dev

test:
	uv run pytest
