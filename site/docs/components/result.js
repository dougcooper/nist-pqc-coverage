// Results for a query: a row count, a table/chart toggle, chart column pickers,
// CSV download, and the table or chart itself. Shared by the SQL console and
// the simple query builder so both look and behave the same.
import {dataTable} from "./table.js";
import {barChart, lineChart} from "./echarts.js";
import {toCsv} from "./sql.js";

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
  // Prefer a category column with more than one value: after a filter, the
  // filtered column is constant and makes a useless axis.
  const distinct = (column) => new Set(sample.map((row) => row[column])).size;
  const ranked = text
    .map((column) => [column, distinct(column)])
    .sort((a, b) => b[1] - a[1]);
  const x = (ranked[0] && ranked[0][1] > 1 ? ranked[0][0] : text[0]) ?? columns[0] ?? null;
  const y = numeric.find((column) => column !== x) ?? null;
  const temporal = x && /date|year|quarter|month|week/i.test(x);
  return {x, y, type: temporal ? "line" : "bar"};
}

/**
 * `render(out, preference)` draws a result set. Preference is
 * `{view: "table"|"chart", chart: "bar"|"line"|"none", x, y}`; anything absent
 * keeps the reader's last choice.
 */
export function createResultView({csvName = "query.csv", height = 340} = {}) {
  const el = document.createElement("div");
  el.className = "sql-result";

  let view = "table";
  let chartX = null;
  let chartY = null;
  let chartType = "bar";
  let last = null;
  let csvUrl = null;

  function renderTable(out) {
    const columns = out.columns.map((column) => ({key: column, label: column}));
    return dataTable(out.rows, {
      columns,
      pageSize: 25,
      csv: csvName,
      empty: "No rows."
    });
  }

  function drawChart(body) {
    if (chartX && chartY && last.rows.length) {
      body.append(
        chartType === "line"
          ? lineChart(last.rows, {x: chartX, series: [{key: chartY, label: chartY}], height})
          : barChart(last.rows, {
              x: chartX,
              y: chartY,
              height,
              rotate: last.rows.length > 6 ? -35 : 0,
              truncate: 28
            })
      );
    } else {
      const note = document.createElement("p");
      note.className = "muted small";
      note.textContent = "This result has no numeric column to plot.";
      body.append(note);
    }
  }

  function drawBody() {
    const body = el.querySelector(".sql-body");
    if (!body || !last) return;
    body.replaceChildren();
    if (view === "chart") drawChart(body);
    else body.append(renderTable(last));
  }

  function controls(out, preference) {
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
      <a class="sql-download" download="${escapeHtml(csvName)}">Download CSV</a>
    `;

    const chartFields = bar.querySelectorAll(".sql-chart-field");
    const typeSelect = bar.querySelector(".sql-chart-type");
    const xSelect = bar.querySelector(".sql-chart-x");
    const ySelect = bar.querySelector(".sql-chart-y");

    chartX = preference?.x ?? suggestion.x;
    chartY = preference?.y ?? suggestion.y;
    chartType = preference?.chart === "line" ? "line" : preference?.chart === "bar" ? "bar" : suggestion.type;
    typeSelect.value = chartType === "line" ? "line" : "bar";
    if (chartX) xSelect.value = chartX;
    if (chartY) ySelect.value = chartY;

    const download = bar.querySelector(".sql-download");
    const syncFields = () => {
      for (const field of chartFields) field.hidden = view !== "chart";
      // The table carries its own CSV button; the bar's is for charts.
      download.hidden = view !== "chart";
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

  /** Draw `out`. Omit a preference field to keep the reader's current choice. */
  function render(out, preference = {}) {
    last = out;
    if (preference.view) view = preference.view;
    el.replaceChildren();
    el.append(controls(out, preference));
    const body = document.createElement("div");
    body.className = "sql-body";
    el.append(body);
    drawBody();
  }

  function clear() {
    last = null;
    el.replaceChildren();
  }

  return {el, render, clear};
}
