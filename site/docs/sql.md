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
import {EXAMPLES, runStatement, toCsv} from "./components/sql.js";
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

```js
const consoleEl = (() => {
  const el = document.createElement("div");
  el.className = "sql-console";
  el.innerHTML = `
    <div class="sql-toolbar">
      <label class="small">Example
        <select class="sql-example"></select>
      </label>
      <button type="button" class="sql-run">Run query</button>
      <span class="sql-timing small"></span>
    </div>
    <textarea class="sql-editor" rows="9" spellcheck="false"
      aria-label="SQL query"></textarea>
    <div class="sql-message" hidden></div>
    <div class="sql-result"></div>
  `;

  const editor = el.querySelector(".sql-editor");
  const example = el.querySelector(".sql-example");
  const message = el.querySelector(".sql-message");
  const resultCell = el.querySelector(".sql-result");
  const timing = el.querySelector(".sql-timing");

  for (const [index, item] of EXAMPLES.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.label;
    example.append(option);
  }

  const escape = (value) =>
    String(value).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
  const show = (value) =>
    value === null || value === undefined
      ? '<span class="muted">\u2014</span>'
      : escape(value instanceof Date ? value.toISOString().slice(0, 10) : value);

  let busy = false;
  let csvUrl = null;

  async function run() {
    if (busy) return;
    busy = true;
    message.hidden = true;
    timing.textContent = "running\u2026";
    const out = await runStatement(db, editor.value);
    busy = false;

    if (out.error) {
      message.hidden = false;
      message.className = "sql-message error";
      message.textContent = out.error;
      resultCell.replaceChildren();
      timing.textContent = "";
      return;
    }

    const shown = out.rows.slice(0, 300);
    const head = out.columns.map((c) => `<th>${escape(c)}</th>`).join("");
    const body = shown
      .map((row) => `<tr>${out.columns.map((c) => `<td>${show(row[c])}</td>`).join("")}</tr>`)
      .join("");
    const note =
      out.rows.length > shown.length
        ? ` <span class="muted">(showing the first ${shown.length}; download for all)</span>`
        : "";

    if (csvUrl) URL.revokeObjectURL(csvUrl);
    csvUrl = URL.createObjectURL(new Blob([toCsv(out.rows, out.columns)], {type: "text/csv"}));

    resultCell.innerHTML = `
      <div class="sql-actions small">
        <span>${out.rows.length} row${out.rows.length === 1 ? "" : "s"} \u00b7
          ${out.columns.length} column${out.columns.length === 1 ? "" : "s"}${note}</span>
        <a download="query.csv" href="${csvUrl}">Download CSV</a>
      </div>
      <div class="table-scroll">
        <table class="sql-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="${out.columns.length || 1}" class="muted">No rows.</td></tr>`}</tbody>
        </table>
      </div>
    `;
    timing.textContent = `${out.ms.toFixed(0)} ms`;
  }

  el.querySelector(".sql-run").addEventListener("click", run);
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  });
  example.addEventListener("change", () => {
    editor.value = EXAMPLES[Number(example.value)]?.sql ?? "";
    run();
  });

  editor.value = EXAMPLES[0].sql;
  run();
  return el;
})();

display(consoleEl);
```

Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (or <kbd>Cmd</kbd>+<kbd>Enter</kbd>) to run.
The console accepts one read-only `SELECT`/`WITH` statement; write, attach and
install are rejected, as are reads of remote files.

## Column dictionary

What is actually in the low-cardinality columns, with row counts:

```js
const dictionary = await Promise.all(
  ["source", "status", "os_family", "arch", "pqc_family", "module_type", "upstream"].map(
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
