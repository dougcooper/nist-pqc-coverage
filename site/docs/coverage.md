---
title: Coverage
---

# Coverage: which targets matter most

Targets are ranked by how many distinct products (and vendors) support PQC on
them. The cumulative curve answers "how many OS/CPU combinations do I need to
cover X% of the validated market?", and the greedy table picks the products that
cover the most targets with the fewest builds. For a software product, use the
software-only scope.

```js
import {num} from "./components/common.js";
import {openDb, query} from "./components/db.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  coverage_targets: FileAttachment("data/coverage_targets.parquet"),
  coverage_greedy: FileAttachment("data/coverage_greedy.parquet")
});
```

```js
const scopeLabels = {
  validated: "Validated \u2014 all embodiments",
  validated_software: "Validated \u2014 software only",
  with_in_process: "Validated + in process \u2014 all embodiments",
  with_in_process_software: "Validated + in process \u2014 software only"
};
const variant = view(
  Inputs.select(Object.keys(scopeLabels), {
    label: "Scope",
    value: "validated",
    format: (v) => scopeLabels[v]
  })
);
const softwareOnly =
  variant === "validated_software" || variant === "with_in_process_software";
```

```js
html`<div class="note small">
  Software-only drops hardware and firmware embodiments. In-process rows cannot
  appear in that scope because the NIST lists do not publish a module type for them.
</div>`
```

```js
const targets = await query(db, `
  SELECT * FROM coverage_targets WHERE variant = ? ORDER BY rank`, [variant]);

const greedy = await query(db, `
  SELECT * FROM coverage_greedy WHERE variant = ? ORDER BY rank`, [variant]);

const ninetieth = targets.find((d) => d.cumulative_pct_products >= 90);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(targets.length)}</div>
    <div class="label">targets in scope</div>
    <div class="hint">${softwareOnly ? "software products" : (variant === "with_in_process" || variant === "with_in_process_software") ? "including in-process modules" : "validated products"}</div>
  </div>
  <div class="stat">
    <div class="value">${targets.length ? num.format(targets[0].products) : 0}</div>
    <div class="label">best target</div>
    <div class="hint">${targets.length ? targets[0].target : ""}</div>
  </div>
  <div class="stat">
    <div class="value">${ninetieth ? ninetieth.rank : "\u2014"}</div>
    <div class="label">targets for 90%</div>
    <div class="hint">of distinct products in scope</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(greedy.length)}</div>
    <div class="label">products in greedy cover</div>
    <div class="hint">cover all ${num.format(greedy.length ? greedy[0].universe_targets : 0)} targets</div>
  </div>
</div>`
```

## Target ranking

```js
const topTargets = targets.slice(0, 20);
```

```js
const compact = window.innerWidth < 700;
```

```js
Plot.plot({
  height: compact ? 520 : 560,
  marginLeft: compact ? 140 : 260,
  marginRight: compact ? 50 : 170,
  x: {label: "distinct products", grid: true},
  y: {
    label: null,
    tickFormat: (d) => (compact && d.length > 24 ? `${d.slice(0, 23)}\u2026` : d)
  },
  color: {scheme: "Blues"},
  marks: [
    Plot.barX(topTargets, {x: "products", y: "target", fill: "products", tip: true}),
    Plot.text(topTargets, {
      x: "products",
      y: "target",
      text: (d) =>
        compact ? `${d.products}` : `${d.products} products / ${d.vendors} vendors`,
      dx: 5,
      textAnchor: "start",
      fill: "currentColor",
      fontSize: 11
    }),
    Plot.ruleX([0])
  ]
})
```

## Cumulative coverage

```js
const cumulative = targets.flatMap((d) => [
  {rank: d.rank, pct: d.cumulative_pct_products, series: "products"},
  {rank: d.rank, pct: d.cumulative_pct_vendors, series: "vendors"}
]);
```

```js
Plot.plot({
  height: 320,
  x: {label: "top N targets (ranked by vendor count)", grid: true},
  y: {label: "% of all validated products / vendors", domain: [0, 100], grid: true},
  color: {domain: ["products", "vendors"], range: ["#4e79a7", "#f28e2b"], legend: true},
  marks: [
    Plot.line(cumulative, {x: "rank", y: "pct", stroke: "series", strokeWidth: 2, tip: true}),
    Plot.ruleY([90], {stroke: "currentColor", strokeOpacity: 0.25, strokeDasharray: "4 4"}),
    Plot.text([{rank: targets.length, pct: 92}], {
      x: "rank",
      y: "pct",
      text: () => "90% line",
      textAnchor: "end",
      fill: "currentColor",
      fontSize: 11
    })
  ]
})
```

## Greedy product selection

```js
html`<div class="note">
  Greedy set cover over OS/CPU targets. The first row covers the most targets;
  each later row adds the most previously-uncovered targets. Result:
  <strong>${greedy.length}</strong> products cover all
  <strong>${num.format(greedy.length ? greedy[0].universe_targets : 0)}</strong> targets.
</div>`
```

```js
Inputs.table(greedy, {
  columns: ["rank", "vendor", "product", "targets_covered", "targets_total", "cumulative_targets", "pct_targets"],
  header: {
    rank: "#",
    vendor: "Vendor",
    product: "Product",
    targets_covered: "New targets",
    targets_total: "Targets",
    cumulative_targets: "Cumulative",
    pct_targets: "% covered"
  },
  sort: "rank",
  rows: 30,
  width: {product: 360}
})
```

## Drill into a target

```js
const selected = view(
  Inputs.select(targets, {
    label: "Target",
    value: targets.find((d) => d.products > 0) ?? targets[0],
    format: (d) => d.target,
    filter: (d) => d.products > 0
  })
);
```

```js
const scopeClause = variant === "with_in_process" || variant === "with_in_process_software"
  ? "source <> 'CAVP' OR status = 'none_yet'"
  : "(source = 'CMVP' OR (source = 'CAVP' AND status = 'none_yet'))";
const scopeWhere = softwareOnly
  ? `(${scopeClause}) AND upper(module_type) LIKE 'SOFTWARE%'`
  : `(${scopeClause})`;

const targetProducts = await query(db, `
  SELECT source, record_id, vendor, product,
         any_value(status) AS status,
         string_agg(DISTINCT pqc_family, ', ' ORDER BY pqc_family) AS families,
         string_agg(DISTINCT pqc_algorithm, ', ' ORDER BY pqc_algorithm) AS algorithms,
         string_agg(DISTINCT cpu, '; ' ORDER BY cpu)
           FILTER (WHERE coalesce(cpu, '') <> '') AS cpus,
         any_value(url) AS url
  FROM coverage
  WHERE ${scopeWhere}
    AND CASE WHEN coalesce(os_name, '') <> '' THEN os_name || ' / ' || arch
             ELSE arch END = ?
  GROUP BY source, record_id, vendor, product
  ORDER BY vendor`, [selected.target]);
```

```js
Inputs.table(targetProducts, {
  columns: ["vendor", "product", "source", "status", "families", "algorithms", "cpus", "url"],
  header: {
    vendor: "Vendor",
    product: "Product",
    source: "Source",
    status: "Status",
    families: "Families",
    algorithms: "Algorithms",
    cpus: "CPUs",
    url: "NIST"
  },
  rows: 40,
  width: {product: 320, algorithms: 240}
})
```
