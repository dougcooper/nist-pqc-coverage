---
title: Explorer
---

# Explorer

Every row of the flattened coverage dataset. Filter, search, and sort; links go
to the NIST source page for each record.

```js
import {num, families, sourceLabel} from "./components/common.js";
```

```js
const coverage = FileAttachment("data/pqc_coverage.csv").csv();
const sourceFile = FileAttachment("data/pqc_coverage.csv");
```

```js
const source = view(
  Inputs.select(["All sources", ...Array.from(new Set(coverage.map((d) => d.source))).sort()], {
    label: "Source",
    value: "All sources",
    format: (v) => sourceLabel(v)
  })
);
const family = view(Inputs.select(["All algorithms", ...families], {label: "Family", value: "All algorithms"}));
const upstreams = [
  "All upstream libraries",
  ...Array.from(new Set(coverage.map((d) => d.upstream).filter(Boolean))).sort()
];
const upstream = view(Inputs.select(upstreams, {label: "Upstream", value: upstreams[0]}));
const osFamily = view(
  Inputs.select(["All OS families", ...Array.from(new Set(coverage.map((d) => d.os_family))).sort()], {
    label: "OS family",
    value: "All OS families"
  })
);
const arch = view(
  Inputs.select(["All architectures", ...Array.from(new Set(coverage.map((d) => d.arch))).sort()], {
    label: "Architecture",
    value: "All architectures"
  })
);
const search = view(Inputs.text({label: "Search", placeholder: "vendor, product, OS, CPU\u2026"}));
```

```js
const rows = coverage
  .filter(
    (d) =>
      (source === "All sources" || d.source === source) &&
      (family === "All algorithms" || d.pqc_family === family) &&
      (upstream === "All upstream libraries" || d.upstream === upstream) &&
      (osFamily === "All OS families" || d.os_family === osFamily) &&
      (arch === "All architectures" || d.arch === arch)
  )
  .filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${d.vendor} ${d.product} ${d.upstream} ${d.os_name} ${d.cpu} ${d.pqc_algorithm}`.toLowerCase().includes(q);
  })
  .map((d) => ({
    source: sourceLabel(d.source),
    vendor: d.vendor,
    product: d.product,
    module_type: d.module_type,
    upstream: d.upstream,
    status: d.status,
    algorithm: d.pqc_algorithm,
    parameter_sets: d.parameter_sets,
    os_family: d.os_family,
    os_name: d.os_name,
    os_version: d.os_version,
    arch: d.arch,
    cpu: d.cpu,
    target: d.target,
    evidence: d.evidence,
    validated: d.validated,
    url: d.url
  }));
```

```js
html`<div class="small">
  ${num.format(rows.length)} of ${num.format(coverage.length)} rows ·
  <a href="${sourceFile.href}" download="${sourceFile.name}">download pqc_coverage.csv</a>
</div>`
```

```js
Inputs.table(rows, {
  columns: [
    "source", "vendor", "product", "module_type", "upstream", "status", "algorithm",
    "parameter_sets", "os_family", "os_name", "os_version", "arch", "cpu",
    "target", "evidence", "validated", "url"
  ],
  header: {
    source: "Source",
    vendor: "Vendor",
    product: "Product",
    module_type: "Type",
    upstream: "Upstream",
    status: "Status",
    algorithm: "Algorithm",
    parameter_sets: "Parameter sets",
    os_family: "OS family",
    os_name: "OS",
    os_version: "Version",
    arch: "Arch",
    cpu: "CPU",
    target: "Target",
    evidence: "Evidence",
    validated: "Validated",
    url: "NIST"
  },
  rows: 25,
  width: {product: 280, parameter_sets: 220, target: 220}
})
```

## Download the data

The same CSVs that drive these pages are committed in `data/`:

```js
const downloads = [
  [FileAttachment("data/pqc_coverage.csv"), "pqc_coverage.csv", "flat analysis table (source, product, OE, target, algorithm)"],
  [FileAttachment("data/operating_environments.csv"), "operating_environments.csv", "CAVP operating environments with normalized OS/CPU fields"],
  [FileAttachment("data/coverage_targets.csv"), "coverage_targets.csv", "targets ranked by product/vendor coverage, both scopes"],
  [FileAttachment("data/coverage_greedy.csv"), "coverage_greedy.csv", "greedy set cover: products covering the most targets"],
  [FileAttachment("data/cavp_validations.csv"), "cavp_validations.csv", "CAVP validations that include a PQC algorithm"],
  [FileAttachment("data/cavp_oe_algorithms.csv"), "cavp_oe_algorithms.csv", "operating environment × algorithm capability rows"],
  [FileAttachment("data/cmvp_certs.csv"), "cmvp_certs.csv", "active CMVP certificates with PQC algorithms"],
  [FileAttachment("data/cmvp_cavp_links.csv"), "cmvp_cavp_links.csv", "CMVP certificate → CAVP A-number links"],
  [FileAttachment("data/cmvp_in_process.csv"), "cmvp_in_process.csv", "modules in process / IUT with inferred PQC evidence"],
  [FileAttachment("data/cmvp_policy_sections.csv"), "cmvp_policy_sections.csv", "tested and vendor-affirmed OE sections from security policies"]
].map(([file, name, description]) =>
  html`<li><a href="${file.href}" download="${name}">${name}</a> — ${description}</li>`
);

display(html`<ul class="small">${downloads}</ul>`);
```
