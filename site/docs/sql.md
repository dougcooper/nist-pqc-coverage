---
title: SQL console
---

# SQL console

The dashboard runs [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview) in
your browser, and so can you. Queries run against the same Parquet files the
other pages use, in a read-only sandbox: nothing leaves the page.

The tables are the CSVs in `data/` converted to Parquet. On top of them,
`components/db.js` defines the views the pages share: `coverage` (every row),
`validated`, `validated_software`, `with_in_process`, `with_in_process_software`,
and `targets` (one row per OS/architecture with product and vendor counts).

```js
import {openDb, query} from "./components/db.js";
import {createWorkspace} from "./components/workspace.js";
import {mountAgent} from "./components/ask.js";
```

```js
const db = await openDb({
  coverage_raw: FileAttachment("data/pqc_coverage.parquet"),
  coverage_targets: FileAttachment("data/coverage_targets.parquet"),
  coverage_greedy: FileAttachment("data/coverage_greedy.parquet"),
  cavp: FileAttachment("data/cavp_validations.parquet"),
  in_process: FileAttachment("data/cmvp_in_process.parquet")
});
```

## Query

Pick a view, what to group by, a measure, and filters; the SQL it will run is
shown above the results, and **Open in SQL** moves it to the editor.

```js
const workspace = createWorkspace({db});
display(workspace.el);
```

```js
await mountAgent({
  db,
  source: FileAttachment("data/llm-worker.worker"),
  onSql: (sql, options) => workspace.setQuery(sql, options)
});
```

In the SQL tab, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (or <kbd>Cmd</kbd>+<kbd>Enter</kbd>)
runs a query. The console accepts one read-only `SELECT`/`WITH` statement; write,
attach and install are rejected, as are reads of remote files.

## Column dictionary

What is actually in the low-cardinality columns, with row counts:

```js
const dictionary = await Promise.all(
  ["source", "status", "os_family", "arch", "pqc_family", "module_type", "upstream", "impl_language_label"].map(
    async (column) => {
      const rows = await query(
        db,
        `SELECT ${column} AS value, count(*) AS n
         FROM coverage
         WHERE ${column} IS NOT NULL AND ${column} <> ''
         GROUP BY 1 ORDER BY n DESC LIMIT 12`
      );
      return {column, values: rows.map((row) => `${row.value} (${row.n})`).join(", ")};
    }
  )
);
display(
  html`<div class="table-scroll"><table class="sql-table">
    <thead><tr><th>Column</th><th>Values</th></tr></thead>
    <tbody>
      ${dictionary.map(
        (row) => html`<tr><td><code>${row.column}</code></td><td>${row.values}</td></tr>`
      )}
    </tbody>
  </table></div>`
);
```

## Schema

Every table and view available to the console, in load order:

```js
const schema = await query(
  db,
  `SELECT table_name, column_name, data_type
   FROM information_schema.columns
   ORDER BY table_name, ordinal_position`
);

const byTable = d3.group(schema, (row) => row.table_name);
display(
  html`<div class="schema-grid">
    ${Array.from(
      byTable,
      ([name, columns]) => html`<div class="schema-card">
        <h4>${name}</h4>
        <ul>
          ${columns.map(
            (column) => html`<li><code>${column.column_name}</code>
              <span class="muted">${column.data_type.toLowerCase()}</span></li>`
          )}
        </ul>
      </div>`
    )}
  </div>`
);
```

Rows are long-form: `pqc_coverage.csv` has one row per (source, record, operating
environment, algorithm), so counts of products need `count(DISTINCT product_key)`
rather than `count(*)`.
