---
title: Operating environments
---

# Operating environments

Every normalized OS / CPU target that a PQC-validated product runs on. Use the
filters to see where vendor coverage is concentrated, and which targets are
still thin.

```js
import {num, familyColors, families, isValidated, productKey, osLabel, splitList} from "./components/common.js";
```

```js
const coverage = FileAttachment("data/pqc_coverage.csv").csv();
```

```js
const includePipeline = view(Inputs.toggle({label: "Include in-process (MIP/IUT)", value: false}));
const family = view(Inputs.select(["All algorithms", ...families], {label: "PQC family", value: "All algorithms"}));
const osFamilyOptions = ["All OS families", ...Array.from(new Set(coverage.map((d) => d.os_family))).sort()];
const osFamily = view(Inputs.select(osFamilyOptions, {label: "OS family", value: "All OS families"}));
const moduleType = view(Inputs.select(["All module types", "SOFTWARE", "HARDWARE", "FIRMWARE"], {label: "Module type", value: "All module types"}));
```

```js
const rows = coverage.filter(
  (d) =>
    (includePipeline || isValidated(d)) &&
    (family === "All algorithms" || d.pqc_family === family) &&
    (osFamily === "All OS families" || d.os_family === osFamily) &&
    (moduleType === "All module types" || d.module_type === moduleType)
);

const products = new Set(rows.map(productKey));
const targets = new Set(rows.map((d) => `${osLabel(d)}|${d.arch}`));
const vendors = new Set(rows.map((d) => d.vendor));
const unknown = rows.filter((d) => d.os_family === "unknown");
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(products.size)}</div>
    <div class="label">products</div>
    <div class="hint">in the current filter</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(targets.size)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">distinct normalized environments</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(vendors.size)}</div>
    <div class="label">vendors</div>
    <div class="hint">supporting at least one target</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(unknown.length)}</div>
    <div class="label">unparsed OS rows</div>
    <div class="hint">free-text environments to tune</div>
  </div>
</div>`
```

## OS family by architecture

```js
const osFamilies = [...new Set(rows.map((d) => d.os_family))].sort();
const archOrder = ["x86_64", "arm64", "arm32", "ppc64", "s390x", "riscv64", "mips", "x86", "unknown"].filter(
  (arch) => rows.some((d) => d.arch === arch)
);
const cells = d3.cross(osFamilies, archOrder).map(([os_family, arch]) => {
  const subset = rows.filter((d) => d.os_family === os_family && d.arch === arch);
  return {
    os_family,
    arch,
    products: new Set(subset.map(productKey)).size,
    vendors: new Set(subset.map((d) => d.vendor)).size
  };
});
```

```js
Plot.plot({
  marginLeft: 90,
  marginBottom: 45,
  x: {label: "architecture", domain: archOrder},
  y: {label: null, domain: osFamilies},
  color: {scheme: "YlGnBu", legend: true, label: "products", tickFormat: "d"},
  marks: [
    Plot.cell(cells, {x: "arch", y: "os_family", fill: "products", tip: true}),
    Plot.text(cells.filter((d) => d.products > 0), {
      x: "arch",
      y: "os_family",
      text: (d) => d.products,
      fill: "white",
      fontWeight: 600
    })
  ]
})
```

<div class="small">
  Cells show distinct products; hover for vendor counts. Empty cells mean no
  validated PQC product reports that combination.
</div>

## Most-covered OS versions

```js
const osRows = d3
  .rollups(
    rows,
    (subset) => ({
      products: new Set(subset.map(productKey)).size,
      vendors: new Set(subset.map((d) => d.vendor)).size,
      arch: [...new Set(subset.map((d) => d.arch))].sort().join(", ")
    }),
    (d) => osLabel(d)
  )
  .map(([os, value]) => ({os, ...value}))
  .sort((a, b) => d3.descending(a.products, b.products))
  .slice(0, 20);
```

```js
Plot.plot({
  height: 480,
  marginLeft: 210,
  x: {label: "distinct products", grid: true},
  y: {label: null},
  marks: [
    Plot.barX(osRows, {x: "products", y: "os", fill: "#4e79a7", tip: true}),
    Plot.text(osRows, {
      x: "products",
      y: "os",
      text: (d) => d.products,
      dx: 5,
      textAnchor: "start",
      fill: "currentColor"
    }),
    Plot.ruleX([0])
  ]
})
```

## CPUs and SoCs

```js
const cpuRows = d3
  .rollups(
    rows,
    (subset) => ({
      products: new Set(subset.map(productKey)).size,
      vendors: new Set(subset.map((d) => d.vendor)).size
    }),
    (d) => d.cpu || d.cpu_series || "(unspecified)"
  )
  .map(([cpu, value]) => ({cpu, ...value}))
  .sort((a, b) => d3.descending(a.products, b.products))
  .slice(0, 20);
```

```js
Plot.plot({
  height: 480,
  marginLeft: 210,
  x: {label: "distinct products", grid: true},
  y: {label: null},
  marks: [
    Plot.barX(cpuRows, {x: "products", y: "cpu", fill: "#59a14f", tip: true}),
    Plot.text(cpuRows, {
      x: "products",
      y: "cpu",
      text: (d) => d.products,
      dx: 5,
      textAnchor: "start",
      fill: "currentColor"
    }),
    Plot.ruleX([0])
  ]
})
```

## Target table

```js
const envRows = d3
  .rollups(
    rows,
    (subset) => ({
      products: new Set(subset.map(productKey)).size,
      vendors: new Set(subset.map((d) => d.vendor)).size,
      families: [...new Set(subset.map((d) => d.pqc_family))].sort().join(", "),
      cpuVendor: [...new Set(subset.map((d) => d.cpu_vendor))].filter(Boolean).sort().join(", "),
      moduleTypes: [...new Set(subset.map((d) => d.module_type))].filter(Boolean).sort().join(", ")
    }),
    (d) => `${osLabel(d)}|${d.arch}|${d.cpu || d.cpu_series || ""}`
  )
  .map(([key, value]) => {
    const [os, arch, cpu] = key.split("|");
    return {os, arch, cpu, ...value};
  })
  .sort((a, b) => d3.descending(a.products, b.products));
```

```js
Inputs.table(envRows, {
  columns: ["os", "arch", "cpu", "products", "vendors", "families", "cpuVendor", "moduleTypes"],
  header: {
    os: "OS",
    arch: "Arch",
    cpu: "CPU / SoC",
    products: "Products",
    vendors: "Vendors",
    families: "Families",
    cpuVendor: "CPU vendor",
    moduleTypes: "Module types"
  },
  sort: "products",
  reverse: true,
  rows: 40,
  width: {os: 220, cpu: 220}
})
```

## Environments that need tuning

```js
const unknownRows = d3
  .rollups(
    unknown,
    (subset) => ({
      products: new Set(subset.map(productKey)).size,
      vendors: [...new Set(subset.map((d) => d.vendor))].sort().join("; ")
    }),
    (d) => d.oe_name
  )
  .map(([oe, value]) => ({oe, ...value}))
  .sort((a, b) => d3.descending(a.products, b.products));
```

```js
unknownRows.length
  ? Inputs.table(unknownRows, {
      columns: ["oe", "products", "vendors"],
      header: {oe: "CAVP operating environment text", products: "Products", vendors: "Vendors"},
      sort: "products",
      reverse: true,
      rows: 25
    })
  : html`<div class="note">Every environment in this filter was parsed into an OS family.</div>`
```
