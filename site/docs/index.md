---
title: Overview
---

# NIST post-quantum validation coverage

Validated post-quantum implementations and the operating environments they run
on, drawn from the NIST CAVP and CMVP databases. Use the other pages to see
targets, coverage curves, and the validation pipeline.

```js
import {num, familyColors, families, sourceLabel} from "./components/common.js";
import {openDb, query} from "./components/db.js";
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
    count(DISTINCT product_key) AS products,
    count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
    count(DISTINCT vendor) AS vendors,
    count(DISTINCT CASE WHEN upper(module_type) LIKE 'SOFTWARE%' THEN product_key END) AS software
  FROM validated`);
```

```js
const [matched] = await query(db, `
  SELECT count(*) AS n FROM in_process WHERE pqc_evidence = 'cavp_name_match'`);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(stats.products)}</div>
    <div class="label">validated products</div>
    <div class="hint">CAVP validations plus active CMVP certificates</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.targets)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">normalized operating environments</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.vendors)}</div>
    <div class="label">vendors</div>
    <div class="hint">with at least one validated PQC product</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.software)}</div>
    <div class="label">software products</div>
    <div class="hint">excludes hardware and firmware modules</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(matched.n)}</div>
    <div class="label">in-process modules</div>
    <div class="hint">matched to a PQC CAVP validation</div>
  </div>
</div>`
```

```js
html`<div class="note">
  Data as of <strong>${meta.data_as_of}</strong>, generated ${meta.generated_at.slice(0, 10)}.
  PQC scope: ${meta.pqc_algorithms.join(", ")}.
</div>`
```

## Validated products by algorithm family

```js
const familyRows = await query(db, `
  SELECT pqc_family AS family, count(DISTINCT product_key) AS count
  FROM validated
  GROUP BY 1
  ORDER BY 2 DESC`);
```

```js
Plot.plot({
  height: 260,
  marginLeft: 80,
  marginRight: 40,
  x: {label: "distinct products", grid: true},
  y: {label: null},
  color: {domain: families, range: families.map((f) => familyColors.get(f))},
  marks: [
    Plot.barX(familyRows, {x: "count", y: "family", fill: "family", tip: true}),
    Plot.text(familyRows, {
      x: "count",
      y: "family",
      text: (d) => d.count,
      dx: 6,
      textAnchor: "start",
      fill: "currentColor"
    }),
    Plot.ruleX([0])
  ]
})
```

## Where the coverage comes from

```js
const sourceRows = (await query(db, `
  SELECT source, count(DISTINCT product_key) AS count
  FROM coverage
  WHERE source <> 'CAVP' OR status = 'none_yet'
  GROUP BY 1
  ORDER BY 2 DESC`)).map((d) => ({source: sourceLabel(d.source), count: d.count}));
```

```js
Plot.plot({
  height: 200,
  marginLeft: 150,
  x: {label: "distinct products", grid: true},
  y: {label: null},
  marks: [
    Plot.barX(sourceRows, {x: "count", y: "source", fill: "#4e79a7", tip: true}),
    Plot.text(sourceRows, {
      x: "count",
      y: "source",
      text: (d) => d.count,
      dx: 6,
      textAnchor: "start"
    }),
    Plot.ruleX([0])
  ]
})
```

<div class="small">
  CAVP rows already covered by an active CMVP certificate are omitted here to
  avoid counting the same product twice; they still appear in the explorer.
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
Plot.plot({
  height: 300,
  marginLeft: 50,
  marginBottom: 70,
  x: {label: "quarter first validated", tickRotate: -45},
  y: {label: "CAVP validations", grid: true},
  color: {domain: families, range: families.map((f) => familyColors.get(f)), legend: true},
  marks: [
    Plot.barY(timeline, {x: "quarter", y: "count", fill: "family", tip: true}),
    Plot.ruleY([0])
  ]
})
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
Inputs.table(vendorRows, {
  columns: ["vendor", "products", "targets", "families"],
  header: {
    vendor: "Vendor",
    products: "Products",
    targets: "Targets",
    families: "Families"
  },
  sort: "products",
  reverse: true,
  rows: 25
})
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
Inputs.table(upstreamRows, {
  columns: ["upstream", "products", "targets"],
  header: {upstream: "Library", products: "Products", targets: "Targets"},
  sort: "products",
  reverse: true,
  rows: 20
})
```

<div class="small">
  Matched by keyword on vendor, module, and description text. Certificates that
  do not name a known library are omitted; the mapping is a hint, not an audit.
</div>
