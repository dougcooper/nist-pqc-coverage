---
title: Overview
---

# NIST post-quantum validation coverage

Validated post-quantum implementations and the operating environments they run
on, drawn from the NIST CAVP and CMVP databases. Use the other pages to see
targets, coverage curves, and the validation pipeline.

```js
import {num, familyColors, families, splitList, isValidated, productKey, targetKey, quarterOf, sourceLabel} from "./components/common.js";
```

```js
const coverage = FileAttachment("data/pqc_coverage.csv").csv();
const cavp = FileAttachment("data/cavp_validations.csv").csv();
const pipeline = FileAttachment("data/cmvp_in_process.csv").csv();
const meta = FileAttachment("data/metadata.json").json();
```

```js
const validated = coverage.filter(isValidated);
const products = new Set(validated.map(productKey));
const targets = new Set(
  validated.filter((d) => d.arch && d.arch !== "unknown").map(targetKey)
);
const vendors = new Set(validated.map((d) => d.vendor));
const software = new Set(
  validated
    .filter((d) => (d.module_type || "").toUpperCase().startsWith("SOFTWARE"))
    .map(productKey)
);
const matched = pipeline.filter((d) => d.pqc_evidence === "cavp_name_match");
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(products.size)}</div>
    <div class="label">validated products</div>
    <div class="hint">CAVP validations plus active CMVP certificates</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(targets.size)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">normalized operating environments</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(vendors.size)}</div>
    <div class="label">vendors</div>
    <div class="hint">with at least one validated PQC product</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(software.size)}</div>
    <div class="label">software products</div>
    <div class="hint">excludes hardware and firmware modules</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(matched.length)}</div>
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
const familyRows = d3
  .rollups(
    validated,
    (rows) => new Set(rows.map(productKey)).size,
    (d) => d.pqc_family
  )
  .map(([family, count]) => ({family, count}))
  .sort((a, b) => d3.descending(a.count, b.count));
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
const sourceRows = d3
  .rollups(
    coverage.filter(
      (d) => d.source !== "CAVP" || d.status === "none_yet"
    ),
    (rows) => new Set(rows.map(productKey)).size,
    (d) => d.source
  )
  .map(([source, count]) => ({source: sourceLabel(source), count}))
  .sort((a, b) => d3.descending(a.count, b.count));
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
const timelineRows = cavp.flatMap((d) =>
  splitList(d.pqc_families).map((family) => ({
    quarter: quarterOf(d.first_validated),
    family
  }))
).filter((d) => d.quarter);

const timeline = d3
  .rollups(
    timelineRows,
    (rows) => rows.length,
    (d) => d.quarter,
    (d) => d.family
  )
  .flatMap(([quarter, byFamily]) =>
    byFamily.map(([family, count]) => ({quarter, family, count}))
  );
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
const vendorRows = d3
  .rollups(
    validated,
    (rows) => ({
      products: new Set(rows.map(productKey)).size,
      targets: new Set(rows.map(targetKey)).size,
      families: [...new Set(rows.map((d) => d.pqc_family))].sort().join(", ")
    }),
    (d) => d.vendor
  )
  .map(([vendor, value]) => ({vendor, ...value}))
  .sort((a, b) => d3.descending(a.products, b.products));
```

```js
Inputs.table(vendorRows.slice(0, 25), {
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
const upstreamRows = d3
  .rollups(
    validated.filter((d) => d.upstream),
    (rows) => ({
      products: new Set(rows.map(productKey)).size,
      targets: new Set(rows.map(targetKey)).size
    }),
    (d) => d.upstream
  )
  .map(([upstream, value]) => ({upstream, ...value}))
  .sort((a, b) => d3.descending(a.products, b.products));
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
