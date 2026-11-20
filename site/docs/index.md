---
title: Overview
---

# NIST post-quantum validation coverage

Validated post-quantum implementations and the operating environments they run
on, drawn from the NIST CAVP and CMVP databases. Use the other pages to see
targets, coverage curves, and the validation pipeline.

```js
import {num, familyColors} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {barChart, palette} from "./components/echarts.js";
import {dataTable} from "./components/table.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  cavp: FileAttachment("data/cavp_validations.parquet"),
  in_process: FileAttachment("data/cmvp_in_process.parquet")
});
const meta = FileAttachment("data/metadata.json").json();
```

```js
const [stats] = await query(db, `
  SELECT
    (SELECT count(*) FROM cavp) AS cavp,
    count(DISTINCT CASE WHEN source = 'CMVP' THEN record_id END) AS cmvp,
    count(DISTINCT CASE WHEN source = 'CMVP' AND upper(module_type) LIKE 'SOFTWARE%'
                        THEN record_id END) AS cmvp_software,
    (SELECT count(*) FROM in_process) AS in_progress,
    (SELECT count(DISTINCT module || '|' || vendor) FROM in_process) AS in_progress_modules,
    count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
    count(DISTINCT vendor) AS vendors
  FROM coverage`);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(stats.cavp)}</div>
    <div class="label">CAVP</div>
    <div class="hint">PQC algorithm validations</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.cmvp)}</div>
    <div class="label">CMVP</div>
    <div class="hint">active certificates, ${num.format(stats.cmvp_software)} of them software</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.in_progress)}</div>
    <div class="label">CMVP in progress</div>
    <div class="hint">${num.format(stats.in_progress_modules)} modules in MIP and IUT</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.targets)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">including CMVP in progress</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.vendors)}</div>
    <div class="label">vendors</div>
    <div class="hint">across the three programs</div>
  </div>
</div>`
```

```js
html`<div class="note">
  Data as of <strong>${meta.data_as_of}</strong>, generated ${meta.generated_at.slice(0, 10)}.
  PQC scope: ${meta.pqc_algorithms.join(", ")}.
</div>`
```

## Coverage by algorithm family

```js
const familyRows = await query(db, `
  SELECT pqc_family AS family, count(DISTINCT product_key) AS count
  FROM validated
  GROUP BY 1
  ORDER BY 2 DESC`);
```

```js
display(
  barChart(familyRows, {
    x: "family",
    y: "count",
    horizontal: true,
    labels: true,
    colorBy: "family",
    colors: (family) => familyColors.get(family) ?? palette[0],
    height: 200
  })
);
```

<div class="small">
  Distinct modules per family. A CAVP validation already covered by a CMVP
  certificate is not counted twice.
</div>

## Targets by program

How many normalized OS / CPU targets each program covers.

```js
const programRows = await query(db, `
  SELECT program, count(DISTINCT target_key) AS count
  FROM coverage
  WHERE arch NOT IN ('', 'unknown')
  GROUP BY 1
  ORDER BY 2 DESC`);
```

```js
display(
  barChart(programRows, {
    x: "program",
    y: "count",
    horizontal: true,
    labels: true,
    colors: [palette[0]],
    height: 160
  })
);
```

<div class="small">
  A target is an OS version and architecture pair after normalization. The same
  target can appear under more than one program.
</div>

## Validations over time

```js
const timeline = await query(db, `
  SELECT strftime(first_validated, '%Y') || ' Q' ||
           CAST(1 + (month(first_validated) - 1) / 3 AS INTEGER) AS quarter,
         trim(f.family) AS family,
         count(*) AS count
  FROM cavp, unnest(string_split(pqc_families, ';')) AS f(family)
  WHERE first_validated IS NOT NULL AND trim(f.family) <> ''
  GROUP BY 1, 2
  ORDER BY 1`);
```

```js
display(
  barChart(timeline, {
    x: "quarter",
    y: "count",
    series: "family",
    stack: true,
    colors: (family) => familyColors.get(family) ?? palette[0],
    height: 300,
    rotate: -45
  })
);
```

## Top vendors

```js
const vendorRows = await query(db, `
  SELECT vendor,
         count(DISTINCT product_key) AS products,
         count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
         string_agg(DISTINCT pqc_family, ', ' ORDER BY pqc_family) AS families
  FROM validated
  GROUP BY vendor
  ORDER BY products DESC
  LIMIT 25`);
```

```js
display(
  dataTable(vendorRows, {
    columns: [
      {key: "vendor", label: "Vendor"},
      {key: "products", label: "Products"},
      {key: "targets", label: "Targets"},
      {key: "families", label: "Families"}
    ],
    sort: "products",
    reverse: true,
    pageSize: 10,
    csv: "vendors.csv"
  })
);
```

## Upstream libraries

```js
const upstreamRows = await query(db, `
  SELECT upstream,
         count(DISTINCT product_key) AS products,
         count(DISTINCT target_key) AS targets
  FROM validated
  WHERE coalesce(upstream, '') <> ''
  GROUP BY upstream
  ORDER BY products DESC
  LIMIT 20`);
```

```js
display(
  dataTable(upstreamRows, {
    columns: [
      {key: "upstream", label: "Library"},
      {key: "products", label: "Products"},
      {key: "targets", label: "Targets"}
    ],
    sort: "products",
    reverse: true,
    pageSize: 10,
    csv: "upstream-libraries.csv"
  })
);
```

<div class="small">
  Matched by keyword on vendor, module, and description text. Certificates that
  do not name a known library are omitted; the mapping is a hint, not an audit.
</div>

```js
import {mountAgent} from "./components/ask.js";
```

```js
await mountAgent({db, source: FileAttachment("data/llm-worker.worker")});
```
