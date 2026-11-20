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
import {num, isValidated, productKey, osLabel, targetKey} from "./components/common.js";
```

```js
const coverage = FileAttachment("data/pqc_coverage.csv").csv();
const targetAll = FileAttachment("data/coverage_targets.csv").csv();
const greedyAll = FileAttachment("data/coverage_greedy.csv").csv();
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
const targets = targetAll
  .filter((d) => d.variant === variant)
  .map((d) => ({
    ...d,
    rank: +d.rank,
    vendors: +d.vendors,
    products: +d.products,
    certs: +d.certs,
    pct_products: +d.pct_products,
    cumulative_products: +d.cumulative_products,
    cumulative_pct_products: +d.cumulative_pct_products,
    cumulative_vendors: +d.cumulative_vendors,
    cumulative_pct_vendors: +d.cumulative_pct_vendors
  }));

const greedy = greedyAll
  .filter((d) => d.variant === variant)
  .map((d) => ({
    ...d,
    rank: +d.rank,
    targets_covered: +d.targets_covered,
    targets_total: +d.targets_total,
    cumulative_targets: +d.cumulative_targets,
    pct_targets: +d.pct_targets,
    universe_targets: +d.universe_targets
  }));

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
Plot.plot({
  height: 560,
  marginLeft: 260,
  marginRight: 170,
  x: {label: "distinct products", grid: true},
  y: {label: null},
  color: {scheme: "Blues"},
  marks: [
    Plot.barX(topTargets, {x: "products", y: "target", fill: "products", tip: true}),
    Plot.text(topTargets, {
      x: "products",
      y: "target",
      text: (d) => `${d.products} products / ${d.vendors} vendors`,
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
const scopeRows = coverage.filter((d) => {
  const base =
    isValidated(d) ||
    (variant === "with_in_process" || variant === "with_in_process_software") &&
    d.source.startsWith("CMVP-");
  if (!base) return false;
  if (softwareOnly) return (d.module_type || "").toUpperCase().startsWith("SOFTWARE");
  return true;
});

const csvTarget = (d) => (d.os_name ? `${d.os_name} / ${d.arch}` : d.arch);

const targetProducts = d3
  .rollups(
    scopeRows.filter((d) => csvTarget(d) === selected.target),
    (subset) => ({
      vendor: subset[0].vendor,
      product: subset[0].product,
      source: subset[0].source,
      status: subset[0].status,
      families: [...new Set(subset.map((d) => d.pqc_family))].sort().join(", "),
      algorithms: [...new Set(subset.map((d) => d.pqc_algorithm))].sort().join(", "),
      cpus: [...new Set(subset.map((d) => d.cpu))].filter(Boolean).sort().join("; "),
      url: subset[0].url
    }),
    (d) => productKey(d)
  )
  .map(([, value]) => value)
  .sort((a, b) => d3.ascending(a.vendor, b.vendor));
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
