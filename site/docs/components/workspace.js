// The query workspace: a simple builder and the SQL console, with a tab switch.
// The builder's "Open in SQL" sends its statement straight to the console.
import {createConsole} from "./console.js";
import {createBuilder} from "./builder.js";

export function createWorkspace({db}) {
  const el = document.createElement("div");
  el.className = "query-workspace";
  el.innerHTML = `
    <div class="ws-tabs" role="tablist" aria-label="Query mode">
      <button type="button" class="ws-tab" data-mode="simple" role="tab" aria-selected="true">Simple</button>
      <button type="button" class="ws-tab" data-mode="advanced" role="tab" aria-selected="false" tabindex="-1">SQL</button>
    </div>
  `;

  const consoleView = createConsole({db});
  const builder = createBuilder({
    db,
    onOpenConsole: (sql) => {
      show("advanced");
      consoleView.setQuery(sql, {run: true});
    }
  });

  const body = document.createElement("div");
  body.className = "ws-body";
  body.append(builder.el, consoleView.el);
  el.append(body);

  function show(mode) {
    builder.el.hidden = mode !== "simple";
    consoleView.el.hidden = mode !== "advanced";
    for (const tab of el.querySelectorAll(".ws-tab")) {
      const active = tab.dataset.mode === mode;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
  }

  for (const tab of el.querySelectorAll(".ws-tab")) {
    tab.addEventListener("click", () => show(tab.dataset.mode));
  }

  show("simple");

  return {
    el,
    show,
    setQuery: (sql, options) => {
      show("advanced");
      return consoleView.setQuery(sql, options);
    }
  };
}
