---
title: Operating environments
---

# Operating environments

Every normalized OS / CPU target that a PQC-validated product runs on. Use the
filters to see where vendor coverage is concentrated, and which targets are
still thin.

```js
import {num, familyColors, families} from "./components/common.js";
import {openDb, query} from "./components/db.js";
import {barChart, heatmap, palette} from "./components/echarts.js";
```

```js
const db = await openDb({coverage_raw: FileAttachment("data/pqc_coverage.parquet")});
const osFamilyOptions = (await query(db, `SELECT DISTINCT os_family FROM coverage ORDER BY 1`)).map((d) => d.os_family);
```

```js
const includePipeline = view(Inputs.toggle({label: "Include in-process (MIP/IUT)", value: false}));
const family = view(Inputs.select(["All algorithms", ...families], {label: "PQC family", value: "All algorithms"}));
const osFamily = view(Inputs.select(["All OS families", ...osFamilyOptions], {label: "OS family", value: "All OS families"}));
const moduleType = view(Inputs.select(["All module types", "SOFTWARE", "HARDWARE", "FIRMWARE"], {label: "Module type", value: "All module types"}));
```

```js
const where = (() => {
  const clauses = [];
  const params = [];
  if (!includePipeline) clauses.push("(source = 'CMVP' OR (source = 'CAVP' AND status = 'none_yet'))");
  if (family !== "All algorithms") { clauses.push("pqc_family = ?"); params.push(family); }
  if (osFamily !== "All OS families") { clauses.push("os_family = ?"); params.push(osFamily); }
  if (moduleType !== "All module types") { clauses.push("upper(module_type) = ?"); params.push(moduleType); }
  return {sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params};
})();
```

```js
const [stats] = await query(db, `
  SELECT
    count(DISTINCT product_key) AS products,
    count(DISTINCT CASE WHEN arch NOT IN ('', 'unknown') THEN target_key END) AS targets,
    count(DISTINCT vendor) AS vendors,
    count(*) FILTER (WHERE os_family = 'unknown') AS unknown
  FROM coverage ${where.sql}`, where.params);
```

```js
html`<div class="stats">
  <div class="stat">
    <div class="value">${num.format(stats.products)}</div>
    <div class="label">products</div>
    <div class="hint">in the current filter</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.targets)}</div>
    <div class="label">OS / CPU targets</div>
    <div class="hint">distinct normalized environments</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.vendors)}</div>
    <div class="label">vendors</div>
    <div class="hint">supporting at least one target</div>
  </div>
  <div class="stat">
    <div class="value">${num.format(stats.unknown)}</div>
    <div class="label">unparsed OS rows</div>
    <div class="hint">free-text environments to tune</div>
  </div>
</div>`
```

## OS family by architecture

```js
const cellCounts = await query(db, `
  SELECT os_family, arch,
         count(DISTINCT product_key) AS products,
         count(DISTINCT vendor) AS vendors
  FROM coverage ${where.sql}
  GROUP BY 1, 2`, where.params);

const osFamilies = [...new Set(cellCounts.map((d) => d.os_family))].sort();
const archOrder = ["x86_64", "arm64", "arm32", "ppc64", "s390x", "riscv64", "mips", "x86", "unknown"].filter(
  (arch) => cellCounts.some((d) => d.arch === arch)
);
const cells = d3.cross(osFamilies, archOrder).map(([os_family, arch]) => {
  const found = cellCounts.find((d) => d.os_family === os_family && d.arch === arch);
  return {os_family, arch, products: found?.products ?? 0, vendors: found?.vendors ?? 0};
});
```

```js
display(
  heatmap(cells, {
    x: "arch",
    y: "os_family",
    value: "products",
    height: Math.max(240, osFamilies.length * 26 + 70)
  })
);
```

<div class="small">
  Cells show distinct products; hover for vendor counts. Empty cells mean no
  validated PQC product reports that combination.
</div>

## Most-covered OS versions

```js
const osRows = await query(db, `
  SELECT os_label AS os,
         count(DISTINCT product_key) AS products,
         count(DISTINCT vendor) AS vendors,
         string_agg(DISTINCT arch, ', ' ORDER BY arch)
           FILTER (WHERE coalesce(arch, '') <> '') AS arch
  FROM coverage ${where.sql}
  GROUP BY 1
  ORDER BY products DESC
  LIMIT 20`, where.params);
```

```js
display(
  barChart(osRows, {
    x: "os",
    y: "products",
    horizontal: true,
    labels: true,
    truncate: window.innerWidth < 700 ? 20 : 40,
    height: 480,
    colors: [palette[0]]
  })
);
```

## CPUs and SoCs

```js
const cpuRows = await query(db, `
  SELECT coalesce(nullif(cpu, ''), nullif(cpu_series, ''), '(unspecified)') AS cpu,
         count(DISTINCT product_key) AS products,
         count(DISTINCT vendor) AS vendors
  FROM coverage ${where.sql}
  GROUP BY 1
  ORDER BY products DESC
  LIMIT 20`, where.params);
```

```js
display(
  barChart(cpuRows, {
    x: "cpu",
    y: "products",
    horizontal: true,
    labels: true,
    truncate: window.innerWidth < 700 ? 20 : 40,
    height: 480,
    colors: [palette[4]]
  })
);
```

## Target table

```js
const envRows = await query(db, `
  SELECT os_label AS os, arch,
         coalesce(nullif(cpu, ''), nullif(cpu_series, ''), '') AS cpu,
         count(DISTINCT product_key) AS products,
         count(DISTINCT vendor) AS vendors,
         string_agg(DISTINCT pqc_family, ', ' ORDER BY pqc_family) AS families,
         string_agg(DISTINCT cpu_vendor, ', ' ORDER BY cpu_vendor)
           FILTER (WHERE coalesce(cpu_vendor, '') <> '') AS "cpuVendor",
         string_agg(DISTINCT module_type, ', ' ORDER BY module_type)
           FILTER (WHERE coalesce(module_type, '') <> '') AS "moduleTypes"
  FROM coverage ${where.sql}
  GROUP BY 1, 2, 3
  ORDER BY products DESC`, where.params);
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
const unknownWhere = where.sql
  ? `${where.sql} AND os_family = 'unknown'`
  : "WHERE os_family = 'unknown'";
const unknownRows = await query(db, `
  SELECT oe_name AS oe,
         count(DISTINCT product_key) AS products,
         string_agg(DISTINCT vendor, '; ' ORDER BY vendor) AS vendors
  FROM coverage ${unknownWhere}
  GROUP BY 1
  ORDER BY products DESC
  LIMIT 25`, where.params);
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
