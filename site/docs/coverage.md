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
import {barChart, lineChart, palette} from "./components/echarts.js";
import {dataTable} from "./components/table.js";
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
  validated: "CAVP + CMVP \u2014 all embodiments",
  validated_software: "CAVP + CMVP \u2014 software only",
  with_in_process: "CAVP + CMVP + in progress \u2014 all embodiments",
  with_in_process_software: "CAVP + CMVP + in progress \u2014 software only"
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
    <div class="hint">${softwareOnly ? "software modules" : (variant === "with_in_process" || variant === "with_in_process_software") ? "including CMVP in progress" : "distinct modules"}</div>
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
const vendorsByTarget = new Map(topTargets.map((d) => [d.target, d.vendors]));
display(
  barChart(topTargets, {
    x: "target",
    y: "products",
    horizontal: true,
    labels: true,
    labelFormat: (products, target) =>
      `${products} products / ${vendorsByTarget.get(target)} vendors`,
    truncate: compact ? 24 : 44,
    height: compact ? 520 : 560,
    colors: [palette[0]]
  })
);
```

## Cumulative coverage

```js
display(
  lineChart(targets, {
    x: "rank",
    xNumeric: true,
    series: [
      {key: "cumulative_pct_products", label: "products", color: palette[0]},
      {key: "cumulative_pct_vendors", label: "vendors", color: palette[1]}
    ],
    percent: true,
    rule: {value: 90, label: "90%"},
    height: 320
  })
);
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
display(
  dataTable(greedy, {
    columns: [
      {key: "rank", label: "#"},
      {key: "vendor", label: "Vendor"},
      {key: "product", label: "Product", width: 240},
      {key: "targets_covered", label: "New targets", hideOnCard: true},
      {key: "targets_total", label: "Targets"},
      {key: "cumulative_targets", label: "Cumulative"},
      {key: "pct_targets", label: "% covered", format: (value) => `${value}%`}
    ],
    sort: "rank",
    pageSize: 12,
    cardTitle: "product",
    csv: `greedy-cover-${variant}.csv`
  })
);
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
display(
  dataTable(targetProducts, {
    columns: [
      {key: "vendor", label: "Vendor"},
      {key: "product", label: "Product", width: 240},
      {key: "source", label: "Source"},
      {key: "status", label: "Status"},
      {key: "families", label: "Families"},
      {key: "algorithms", label: "Algorithms"},
      {key: "cpus", label: "CPUs", hideOnCard: true},
      {
        key: "url",
        label: "NIST",
        html: (row) =>
          row.url
            ? `<a href="${String(row.url).replace(/"/g, "&quot;")}" target="_blank" rel="noopener">certificate</a>`
            : ""
      }
    ],
    pageSize: 12,
    cardTitle: "product",
    csv: "target-products.csv"
  })
);
```

```js
import {mountAgent} from "./components/ask.js";
```

```js
await mountAgent({db, source: FileAttachment("data/llm-worker.worker")});
```
