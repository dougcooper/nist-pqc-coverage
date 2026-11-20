// The SQL console: editor, examples, error box, and results as a table or a chart.
//
// It is a component rather than page markup so the Ask panel (Phase 4) can put
// generated SQL into the same editor and reuse the same results view.
import {EXAMPLES, runStatement, toCsv} from "./sql.js";
import {dataTable} from "./table.js";
import {barChart, lineChart} from "./echarts.js";

const number = new Intl.NumberFormat("en-US");

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
}

/** Guess the category and value columns for a chart of `rows`. */
export function suggestChart(rows, columns) {
  const sample = rows.slice(0, 50);
  const numeric = columns.filter((column) =>
    sample.some((row) => typeof row[column] === "number" && Number.isFinite(row[column]))
  );
  const text = columns.filter((column) => !numeric.includes(column));
  const x = text[0] ?? columns[0] ?? null;
  const y = numeric.find((column) => column !== x) ?? null;
  const temporal = x && /date|year|quarter|month|week/i.test(x);
  return {x, y, type: temporal ? "line" : "bar"};
}

export function createConsole({db, examples = EXAMPLES}) {
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

  for (const [index, item] of examples.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.label;
    example.append(option);
  }

  let busy = false;
  let csvUrl = null;
  let view = "table";
  let chartX = null;
  let chartY = null;
  let chartType = "bar";
  let pending = null;
  let last = null;

  function renderTable(out) {
    const columns = out.columns.map((column) => ({key: column, label: column}));
    resultCell.append(
      dataTable(out.rows, {
        columns,
        pageSize: 25,
        csv: "query.csv",
        empty: "No rows."
      })
    );
  }

  function renderControls(out) {
    const suggestion = suggestChart(out.rows, out.columns);
    const numeric = out.columns.filter((column) =>
      out.rows.some((row) => typeof row[column] === "number" && Number.isFinite(row[column]))
    );
    const xOptions = out.columns.map(
      (column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`
    );
    const yOptions = (numeric.length ? numeric : out.columns).map(
      (column) => `<option value="${escapeHtml(column)}">${escapeHtml(column)}</option>`
    );

    const bar = document.createElement("div");
    bar.className = "sql-result-bar small";
    bar.innerHTML = `
      <span>${number.format(out.rows.length)} row${out.rows.length === 1 ? "" : "s"} \u00b7
        ${out.columns.length} column${out.columns.length === 1 ? "" : "s"}</span>
      <span class="sql-view-group">
        <button type="button" class="sql-view" data-view="table" aria-pressed="${view === "table"}">Table</button>
        <button type="button" class="sql-view" data-view="chart" aria-pressed="${view === "chart"}">Chart</button>
      </span>
      <label class="sql-chart-field" hidden>Chart
        <select class="sql-chart-type">
          <option value="bar">Bar</option>
          <option value="line">Line</option>
        </select>
      </label>
      <label class="sql-chart-field" hidden>x
        <select class="sql-chart-x">${xOptions.join("")}</select>
      </label>
      <label class="sql-chart-field" hidden>y
        <select class="sql-chart-y">${yOptions.join("")}</select>
      </label>
      <a class="sql-download" download="query.csv">Download CSV</a>
    `;

    const chartFields = bar.querySelectorAll(".sql-chart-field");
    const typeSelect = bar.querySelector(".sql-chart-type");
    const xSelect = bar.querySelector(".sql-chart-x");
    const ySelect = bar.querySelector(".sql-chart-y");

    chartX = pending?.x ?? suggestion.x;
    chartY = pending?.y ?? suggestion.y;
    chartType = pending?.type ?? suggestion.type;
    pending = null;
    typeSelect.value = chartType === "line" ? "line" : "bar";
    if (chartX) xSelect.value = chartX;
    if (chartY) ySelect.value = chartY;

    const syncFields = () => {
      for (const field of chartFields) field.hidden = view !== "chart";
      for (const button of bar.querySelectorAll(".sql-view")) {
        button.setAttribute("aria-pressed", String(button.dataset.view === view));
      }
    };

    for (const button of bar.querySelectorAll(".sql-view")) {
      button.addEventListener("click", () => {
        view = button.dataset.view;
        syncFields();
        drawBody();
      });
    }
    typeSelect.addEventListener("change", () => {
      chartType = typeSelect.value;
      drawBody();
    });
    xSelect.addEventListener("change", () => {
      chartX = xSelect.value;
      drawBody();
    });
    ySelect.addEventListener("change", () => {
      chartY = ySelect.value;
      drawBody();
    });
    syncFields();

    if (csvUrl) URL.revokeObjectURL(csvUrl);
    csvUrl = URL.createObjectURL(new Blob([toCsv(out.rows, out.columns)], {type: "text/csv"}));
    bar.querySelector(".sql-download").href = csvUrl;
    return bar;
  }

  function drawBody() {
    const body = resultCell.querySelector(".sql-body");
    if (!body || !last) return;
    body.replaceChildren();
    if (view === "chart" && chartX && chartY && last.rows.length) {
      const chartEl =
        chartType === "line"
          ? lineChart(last.rows, {
              x: chartX,
              series: [{key: chartY, label: chartY}],
              height: 340
            })
          : barChart(last.rows, {
              x: chartX,
              y: chartY,
              height: 340,
              rotate: last.rows.length > 6 ? -35 : 0,
              truncate: 28
            });
      body.append(chartEl);
    } else if (view === "chart") {
      const note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "This result has no numeric column to plot.";
      body.append(note);
    } else {
      renderTable(last);
    }
  }

  async function run() {
    if (busy) return null;
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
      return out;
    }

    last = out;
    timing.textContent = `${out.ms.toFixed(0)} ms`;
    resultCell.replaceChildren(renderControls(out));
    const body = document.createElement("div");
    body.className = "sql-body";
    resultCell.append(body);
    drawBody();
    return out;
  }

  el.querySelector(".sql-run").addEventListener("click", () => run());
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  });
  example.addEventListener("change", () => {
    editor.value = examples[Number(example.value)]?.sql ?? "";
    run();
  });

  /** Put a query in the editor and run it, optionally with a chart preference. */
  function setQuery(sql, options = {}) {
    editor.value = sql ?? "";
    if (options.chart && options.chart !== "none") {
      view = "chart";
    } else if (options.chart === "none") {
      view = "table";
    }
    pending = {
      type: options.chart === "line" ? "line" : options.chart === "bar" ? "bar" : undefined,
      x: options.x || undefined,
      y: options.y || undefined
    };
    if (options.run === false) return Promise.resolve(null);
    return run();
  }

  editor.value = examples[0].sql;
  run();

  return {el, setQuery, run, getQuery: () => editor.value};
}
