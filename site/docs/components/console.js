// The SQL console: editor, examples, error box, and results as a table or a chart.
//
// It is a component rather than page markup so the Ask agent can put generated
// SQL into the same editor, and so the simple builder can share the results view.
import {EXAMPLES, runStatement} from "./sql.js";
import {createResultView} from "./result.js";

export {suggestChart} from "./result.js";

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
    <div class="sql-results"></div>
  `;

  const editor = el.querySelector(".sql-editor");
  const example = el.querySelector(".sql-example");
  const message = el.querySelector(".sql-message");
  const resultSlot = el.querySelector(".sql-results");
  const timing = el.querySelector(".sql-timing");
  const results = createResultView({csvName: "query.csv"});
  resultSlot.append(results.el);

  for (const [index, item] of examples.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = item.label;
    example.append(option);
  }

  let busy = false;
  let pending = null;

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
      results.clear();
      timing.textContent = "";
      return out;
    }

    timing.textContent = `${out.ms.toFixed(0)} ms`;
    const preference = pending ?? {};
    pending = null;
    results.render(out, preference);
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
    pending = {
      view: options.chart === "none" ? "table" : options.chart ? "chart" : undefined,
      chart: options.chart === "line" ? "line" : options.chart === "bar" ? "bar" : undefined,
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
