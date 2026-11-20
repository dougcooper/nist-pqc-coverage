// Sortable, searchable table that becomes a card list on phones.
//
// Columns: [{key, label, width?, format?, badge?, hideOnCard?}]. `format(value,
// row)` returns text or an html string; `badge(value, row)` returns a class name.

import {toCsv} from "./sql.js";

const number = new Intl.NumberFormat("en-US");

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
}

function valueOf(row, column) {
  const raw = row[column.key];
  if (raw === null || raw === undefined || raw === "") return null;
  if (column.format) return column.format(raw, row);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "number") return number.format(raw);
  return String(raw);
}

export function dataTable(rows, options = {}) {
  const {
    columns,
    search = true,
    pageSize = 15,
    sort,
    reverse = false,
    csv = "table.csv",
    cardTitle,
    empty = "No rows match."
  } = options;

  const state = {
    sortKey: sort ?? null,
    reverse: sort ? reverse : false,
    query: "",
    page: 0
  };

  const container = document.createElement("div");
  container.className = "data-table";

  const media = matchMedia("(max-width: 640px)");
  let compact = media.matches;

  const toolbar = document.createElement("div");
  toolbar.className = "dt-toolbar";

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "dt-search";
  searchInput.placeholder = `Search ${number.format(rows.length)} rows\u2026`;
  searchInput.setAttribute("aria-label", "Search table");
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim().toLowerCase();
    state.page = 0;
    renderBody();
  });

  const count = document.createElement("span");
  count.className = "dt-count small";

  const download = document.createElement("a");
  download.className = "dt-download small";
  download.textContent = "Download CSV";
  download.download = csv;
  download.href = URL.createObjectURL(
    new Blob([toCsv(rows, columns.map((column) => column.key))], {type: "text/csv"})
  );

  if (search) toolbar.append(searchInput);
  toolbar.append(count, download);

  const body = document.createElement("div");
  body.className = "dt-body";

  const footer = document.createElement("div");
  footer.className = "dt-footer small";

  container.append(toolbar, body, footer);

  function sortedRows() {
    let result = rows;
    if (state.query) {
      const keys = columns.map((column) => column.key);
      result = rows.filter((row) =>
        keys.some((key) => {
          const value = row[key];
          return value !== null && value !== undefined && String(value).toLowerCase().includes(state.query);
        })
      );
    }
    if (state.sortKey) {
      const key = state.sortKey;
      result = [...result].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return x < y ? -1 : 1;
      });
      if (state.reverse) result.reverse();
    }
    return result;
  }

  function cellHtml(row, column) {
    const value = valueOf(row, column);
    if (value === null) return "";
    if (column.badge) {
      const className = column.badge(row[column.key], row);
      return `<span class="badge ${escapeHtml(className)}">${escapeHtml(value)}</span>`;
    }
    if (column.html) return column.html(row);
    return escapeHtml(value);
  }

  function renderTable(result, start, end) {
    const head = columns
      .map((column) => {
        const active = state.sortKey === column.key;
        const marker = active ? (state.reverse ? " \u25b4" : " \u25be") : "";
        return `<th${column.width ? ` style="min-width:${column.width}px"` : ""}>
          <button type="button" class="dt-sort" data-key="${escapeHtml(column.key)}">${escapeHtml(
            column.label
          )}${marker}</button></th>`;
      })
      .join("");
    const bodyRows = result
      .slice(start, end)
      .map((row) => `<tr>${columns.map((column) => `<td>${cellHtml(row, column)}</td>`).join("")}</tr>`)
      .join("");

    body.innerHTML = `<div class="table-scroll"><table class="dt-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${columns.length}" class="muted">${escapeHtml(empty)}</td></tr>`}</tbody>
    </table></div>`;

    for (const button of body.querySelectorAll(".dt-sort")) {
      button.addEventListener("click", () => {
        const key = button.dataset.key;
        if (state.sortKey === key) state.reverse = !state.reverse;
        else {
          state.sortKey = key;
          state.reverse = false;
        }
        renderBody();
      });
    }
  }

  function renderCards(result, start, end) {
    const primary = columns.find((column) => column.key === cardTitle) ?? columns[0];
    const visible = columns.filter(
      (column) => column !== primary && column.hideOnCard !== true
    );
    const always = visible.slice(0, 4);
    const extra = visible.slice(4);
    const cards = result.slice(start, end).map((row) => {
      const title = valueOf(row, primary);
      const fields = (list) =>
        list
          .map((column) => {
            const value = cellHtml(row, column);
            return value ? `<div class="dt-field"><dt>${escapeHtml(column.label)}</dt><dd>${value}</dd></div>` : "";
          })
          .join("");
      return `<article class="dt-card">
        <h3>${title === null ? "" : escapeHtml(title)}</h3>
        <dl>${fields(always)}</dl>
        ${
          extra.length
            ? `<details><summary>More</summary><dl>${fields(extra)}</dl></details>`
            : ""
        }
      </article>`;
    });

    body.innerHTML = cards.length
      ? `<div class="dt-cards">${cards.join("")}</div>`
      : `<div class="note">${escapeHtml(empty)}</div>`;
  }

  function renderBody() {
    const result = sortedRows();
    const total = result.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * pageSize;
    const end = Math.min(start + pageSize, total);

    count.textContent = `${number.format(total)} row${total === 1 ? "" : "s"}`;

    if (compact) renderCards(result, start, end);
    else renderTable(result, start, end);

    footer.innerHTML = `<span>${total ? `${number.format(start + 1)}\u2013${number.format(end)} of ${number.format(
      total
    )}` : ""}</span>
      <span class="dt-pager">
        <button type="button" data-page="-1" ${state.page === 0 ? "disabled" : ""}>\u2190 Prev</button>
        <span>Page ${state.page + 1} / ${pages}</span>
        <button type="button" data-page="1" ${state.page >= pages - 1 ? "disabled" : ""}>Next \u2192</button>
      </span>`;

    for (const button of footer.querySelectorAll("[data-page]")) {
      button.addEventListener("click", () => {
        state.page += Number(button.dataset.page);
        renderBody();
      });
    }
  }

  media.addEventListener("change", (event) => {
    compact = event.matches;
    renderBody();
  });

  renderBody();
  return container;
}
