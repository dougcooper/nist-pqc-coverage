// Simple query builder: pick a view, a measure, what to group by, and some
// filters; it writes one SELECT and runs it. Every identifier comes from the
// catalog below and every value is quoted, so the form cannot produce a
// statement the console would refuse. "Open in SQL" hands the query over.
import {query} from "./db.js";
import {runStatement} from "./sql.js";
import {createResultView} from "./result.js";

const VIEWS = [
  ["validated", "Validated", "Active CMVP certificates plus CAVP validations with no CMVP certificate"],
  ["validated_software", "Validated, software only", "The same, restricted to software modules"],
  ["with_in_process", "Validated + in process", "Adds modules in process (MIP/IUT) at CMVP"]
];

const DIMENSIONS = [
  ["os_family", "OS family"],
  ["arch", "Architecture"],
  ["vendor", "Vendor"],
  ["product", "Product"],
  ["pqc_family", "PQC family"],
  ["source", "Source"],
  ["module_kind", "Module kind"],
  ["status", "CMVP status"],
  ["os_name", "OS version"],
  ["cpu", "CPU"],
  ["upstream", "Upstream library"],
  ["impl_language_label", "Implementation language"],
  ["parameter_sets", "Parameter sets"]
];

const MEASURES = [
  ["products", "distinct products", "count(DISTINCT product_key) AS products"],
  ["vendors", "distinct vendors", "count(DISTINCT vendor) AS vendors"],
  ["records", "distinct validations", "count(DISTINCT record_id) AS validations"],
  ["rows", "rows", "count(*) AS row_count"]
];

const OPERATORS = [
  ["eq", "is"],
  ["neq", "is not"],
  ["contains", "contains"],
  ["starts", "starts with"],
  ["empty", "is empty"],
  ["full", "is not empty"]
];

const MAX_DIMS = 3;
const LIMIT = 500;

const label = (key) => DIMENSIONS.find(([id]) => id === key)?.[1] ?? key;

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createBuilder({db, onOpenConsole}) {
  const el = document.createElement("div");
  el.className = "builder";
  el.innerHTML = `
    <div class="b-controls">
      <div class="b-row">
        <label class="small b-field">View
          <select class="b-view"></select>
        </label>
        <label class="small b-field">Measure
          <select class="b-measure"></select>
        </label>
      </div>
      <div class="b-group">
        <span class="small b-label">Group by</span>
        <div class="b-dims"></div>
        <button type="button" class="b-add-dim b-link small">+ Group</button>
      </div>
      <div class="b-group">
        <span class="small b-label">Filters</span>
        <div class="b-filters"></div>
        <button type="button" class="b-add-filter b-link small">+ Filter</button>
      </div>
    </div>
    <div class="b-sql-row">
      <pre class="b-sql"></pre>
      <div class="b-sql-actions">
        <button type="button" class="b-copy b-link small">Copy SQL</button>
        <button type="button" class="b-open b-link small">Open in SQL</button>
      </div>
    </div>
    <div class="b-message" hidden></div>
    <div class="b-result"></div>
  `;

  const viewSelect = el.querySelector(".b-view");
  const measureSelect = el.querySelector(".b-measure");
  const dimsBox = el.querySelector(".b-dims");
  const addDim = el.querySelector(".b-add-dim");
  const filtersBox = el.querySelector(".b-filters");
  const addFilter = el.querySelector(".b-add-filter");
  const sqlPreview = el.querySelector(".b-sql");
  const message = el.querySelector(".b-message");
  const resultSlot = el.querySelector(".b-result");
  const results = createResultView({csvName: "query.csv"});
  resultSlot.append(results.el);

  const state = {view: VIEWS[0][0], measure: MEASURES[0][0], dims: ["os_family"], filters: []};
  const valueCache = new Map();
  let runId = 0;
  let timer = null;

  for (const [id, text, note] of VIEWS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text;
    option.title = note;
    viewSelect.append(option);
  }
  for (const [id, text] of MEASURES) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text;
    measureSelect.append(option);
  }

  function option(value, text) {
    const node = document.createElement("option");
    node.value = value;
    node.textContent = text;
    return node;
  }

  async function valuesFor(column) {
    const key = `${state.view}|${column}`;
    if (!valueCache.has(key)) {
      valueCache.set(
        key,
        query(
          db,
          `SELECT DISTINCT ${column} AS value FROM ${state.view}
           WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY 1 LIMIT 200`
        ).then((rows) => rows.map((row) => row.value))
      );
    }
    return valueCache.get(key);
  }

  function dimRow(index) {
    const row = document.createElement("div");
    row.className = "b-dim";
    const select = document.createElement("select");
    select.className = "b-dim-select";
    select.append(option("", "(none)"));
    for (const [id, text] of DIMENSIONS) select.append(option(id, text));
    select.value = state.dims[index] ?? "";
    select.addEventListener("change", () => {
      state.dims[index] = select.value;
      schedule();
    });
    row.append(select);
    if (state.dims.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "b-remove";
      remove.textContent = "\u00d7";
      remove.setAttribute("aria-label", `Remove group ${index + 1}`);
      remove.addEventListener("click", () => {
        state.dims.splice(index, 1);
        renderDims();
        schedule();
      });
      row.append(remove);
    }
    return row;
  }

  function renderDims() {
    dimsBox.replaceChildren(...state.dims.map((_, index) => dimRow(index)));
    addDim.hidden = state.dims.length >= MAX_DIMS;
  }

  function filterRow(index) {
    const filter = state.filters[index];
    const row = document.createElement("div");
    row.className = "b-filter";

    const column = document.createElement("select");
    column.className = "b-f-column";
    column.append(option("", "Choose a column"));
    for (const [id, text] of DIMENSIONS) column.append(option(id, text));
    column.value = filter.column;
    column.addEventListener("change", () => {
      filter.column = column.value;
      filter.value = "";
      renderFilters();
      schedule();
    });

    const op = document.createElement("select");
    op.className = "b-f-op";
    for (const [id, text] of OPERATORS) op.append(option(id, text));
    op.value = filter.op;

    const listId = `b-values-${index}-${Math.random().toString(36).slice(2, 7)}`;
    const value = document.createElement("input");
    value.className = "b-f-value";
    value.type = "text";
    value.placeholder = "value";
    value.setAttribute("list", listId);
    value.value = filter.value;
    value.disabled = filter.op === "empty" || filter.op === "full";
    const datalist = document.createElement("datalist");
    datalist.id = listId;

    const syncValue = () => {
      filter.op = op.value;
      value.disabled = filter.op === "empty" || filter.op === "full";
    };
    op.addEventListener("change", () => {
      syncValue();
      schedule();
    });
    value.addEventListener("input", () => {
      filter.value = value.value;
      schedule();
    });

    if (filter.column) {
      valuesFor(filter.column)
        .then((values) => datalist.replaceChildren(...values.map((item) => option(item, item))))
        .catch(() => {});
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "b-remove";
    remove.textContent = "\u00d7";
    remove.setAttribute("aria-label", "Remove filter");
    remove.addEventListener("click", () => {
      state.filters.splice(index, 1);
      renderFilters();
      schedule();
    });

    row.append(column, op, value, datalist, remove);
    return row;
  }

  function renderFilters() {
    if (!state.filters.length) {
      const hint = document.createElement("span");
      hint.className = "small muted";
      hint.textContent = "No filters.";
      filtersBox.replaceChildren(hint);
      return;
    }
    filtersBox.replaceChildren(...state.filters.map((_, index) => filterRow(index)));
  }

  function sql() {
    const dims = state.dims.filter(Boolean);
    const measure = MEASURES.find(([id]) => id === state.measure) ?? MEASURES[0];
    const select = [...dims, measure[2]];
    const conditions = [];
    for (const filter of state.filters) {
      if (!filter.column) continue;
      if (filter.op === "empty") {
        conditions.push(`(${filter.column} IS NULL OR ${filter.column} = '')`);
      } else if (filter.op === "full") {
        conditions.push(`(${filter.column} IS NOT NULL AND ${filter.column} <> '')`);
      } else if (String(filter.value ?? "").length) {
        if (filter.op === "eq") conditions.push(`${filter.column} = ${quote(filter.value)}`);
        else if (filter.op === "neq") conditions.push(`(${filter.column} IS NULL OR ${filter.column} <> ${quote(filter.value)})`);
        else if (filter.op === "contains") conditions.push(`${filter.column} ILIKE ${quote(`%${filter.value}%`)}`);
        else if (filter.op === "starts") conditions.push(`${filter.column} ILIKE ${quote(`${filter.value}%`)}`);
      }
    }
    const alias = measure[2].split(" AS ").pop();
    const lines = [`SELECT ${select.join(", ")}`, `FROM ${state.view}`];
    if (conditions.length) lines.push(`WHERE ${conditions.join("\n  AND ")}`);
    if (dims.length) lines.push("GROUP BY ALL", `ORDER BY ${alias} DESC`);
    lines.push(`LIMIT ${LIMIT}`);
    return lines.join("\n");
  }

  async function run() {
    const statement = sql();
    sqlPreview.textContent = statement;
    const id = ++runId;
    message.hidden = true;
    const out = await runStatement(db, statement);
    if (id !== runId) return; // a newer change already ran
    if (out.error) {
      message.hidden = false;
      message.className = "b-message error";
      message.textContent = out.error;
      results.clear();
      return;
    }
    results.render(out);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  viewSelect.addEventListener("change", () => {
    state.view = viewSelect.value;
    valueCache.clear();
    renderFilters();
    schedule();
  });
  measureSelect.addEventListener("change", () => {
    state.measure = measureSelect.value;
    schedule();
  });
  addDim.addEventListener("click", () => {
    if (state.dims.length >= MAX_DIMS) return;
    state.dims.push("");
    renderDims();
    schedule();
  });
  addFilter.addEventListener("click", () => {
    state.filters.push({column: "", op: "eq", value: ""});
    renderFilters();
    filtersBox.querySelector(".b-f-column")?.focus();
  });
  el.querySelector(".b-copy").addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(sqlPreview.textContent);
      event.currentTarget.textContent = "Copied";
      setTimeout(() => (event.currentTarget.textContent = "Copy SQL"), 1500);
    } catch {
      event.currentTarget.textContent = "Copy failed";
    }
  });
  el.querySelector(".b-open").addEventListener("click", () => {
    onOpenConsole?.(sqlPreview.textContent);
  });

  renderDims();
  renderFilters();
  run();

  return {el, run, getSql: () => sqlPreview.textContent};
}
