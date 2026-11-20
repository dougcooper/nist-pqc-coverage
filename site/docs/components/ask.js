// "Ask" panel: a small model in a Web Worker turns a question into SQL, which
// the console then runs. Everything stays in the browser; nothing is uploaded.
//
// The panel only appears on desktop machines that have a usable WebGPU adapter.
// The model is a ~1 GB download, so nothing is fetched until the reader asks.
import {query} from "./db.js";
import {validateStatement} from "./sql.js";

export const MODELS = [
  {
    id: "Qwen2.5-Coder-1.5B-Instruct",
    label: "Qwen2.5-Coder 1.5B",
    size: "~1.0 GB",
    note: "default: fast, writes plain SQL"
  },
  {
    id: "Qwen3.5-2B",
    label: "Qwen3.5 2B",
    size: "~1.4 GB",
    note: "experimental: reasons better"
  }
];

export function modelId(model, shaderF16) {
  return `${model.id}-${shaderF16 ? "q4f16_1" : "q4f32_1"}-MLC`;
}

/** Decide whether this browser can run the panel, and with which weights. */
export async function capability() {
  const desktop = matchMedia("(pointer: fine)").matches && window.innerWidth >= 1024;
  if (!desktop) return {ok: false, reason: "The model needs a desktop-sized window; the console below works everywhere."};
  if (!navigator.gpu) return {ok: false, reason: "This browser has no WebGPU, so the local model cannot run here."};
  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (error) {
    return {ok: false, reason: `WebGPU is present but the adapter failed: ${error?.message ?? error}`};
  }
  if (!adapter) return {ok: false, reason: "WebGPU is present but no graphics adapter was available."};
  const oneGiB = 1024 * 1024 * 1024;
  if (adapter.limits?.maxBufferSize < oneGiB) {
    return {ok: false, reason: "The graphics adapter cannot allocate the memory the model needs."};
  }
  return {ok: true, shaderF16: adapter.features.has("shader-f16"), adapter};
}

/** Is a model already in the browser cache? */
export async function isModelCached(id) {
  try {
    const cache = await caches.open("webllm/model");
    const requests = await cache.keys();
    return requests.some((request) => decodeURIComponent(request.url).includes(id));
  } catch {
    return false;
  }
}

export async function storageInfo() {
  if (!navigator.storage?.estimate) return null;
  const {usage = 0, quota = 0} = await navigator.storage.estimate();
  const gb = (value) => `${(value / 1024 ** 3).toFixed(2)} GB`;
  return {usage, quota, label: `${gb(usage)} of ${gb(quota)} used by this site`};
}

const VIEW_NOTES = `Tables (DuckDB, read-only):
coverage: one row per source, record, environment and algorithm. Columns: source, record_id, vendor, product, module_type, os_name, os_family, arch, cpu, cpu_series, pqc_algorithm, pqc_family, parameter_sets, status, first_validated, upstream, os_label, product_key, target_key.
validated: coverage rows for CMVP certificates plus CAVP validations with no CMVP certificate.
validated_software: validated where module_type starts with SOFTWARE.
with_in_process: validated plus modules in process at CMVP.
targets: one row per (os_name, arch) over validated: target, os_family, vendors, products, certs.
cavp: one row per CAVP validation: cert, vendor, implementation, cmvp_status.
in_process: one row per CMVP in-process module: module, vendor, list, status, status_date, pqc_evidence.
Rules: one SELECT, no semicolon; use validated (not coverage) for validated products; count products with count(DISTINCT product_key); ILIKE for names.`;

const EXAMPLES = `Examples:
Q: Which software modules cover Windows on arm64?
A: {"title":"Software on Windows arm64","sql":"SELECT vendor, product FROM validated_software WHERE os_family = 'windows' AND arch = 'arm64' ORDER BY vendor","chart":"none"}
Q: How many validated products are there per PQC family?
A: {"title":"Products per PQC family","sql":"SELECT pqc_family, count(DISTINCT product_key) AS products FROM validated GROUP BY 1 ORDER BY 2 DESC","chart":"bar","x":"pqc_family","y":"products"}
Q: Which targets have the most validated products?
A: {"title":"Top targets","sql":"SELECT target, products, vendors FROM targets ORDER BY products DESC LIMIT 25","chart":"bar","x":"target","y":"products"}
Q: Which CAVP validations have no CMVP certificate yet?
A: {"title":"CAVP validations without a CMVP certificate","sql":"SELECT cert, vendor, implementation FROM cavp WHERE cmvp_status = 'none_yet' ORDER BY vendor","chart":"none"}`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: {type: "string"},
    sql: {type: "string"},
    chart: {type: "string", enum: ["bar", "line", "none"]},
    x: {type: "string"},
    y: {type: "string"}
  },
  required: ["title", "sql", "chart"]
};

/** The prompt: view notes, the live schema, and the real values that matter. */
export function buildPrompt(schemaText) {
  return `You translate questions about NIST post-quantum cryptography validation data into DuckDB SQL.
${VIEW_NOTES}

Live schema (column types from the browser database):
${schemaText}

${EXAMPLES}

Answer with JSON only: {"title": short title, "sql": one SELECT, "chart": "bar"|"line"|"none", "x": category column, "y": numeric column}.`;
}

/** Collect a compact schema and the distinct values the model needs. */
export async function describeData(db) {
  const columns = await query(
    db,
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_name = 'coverage'
     ORDER BY ordinal_position`
  );
  const schema = `coverage columns: ${columns
    .map((row) => `${row.column_name} ${row.data_type.toLowerCase()}`)
    .join(", ")}`;

  const values = await Promise.all(
    ["os_family", "arch", "source", "pqc_family"].map(async (column) => {
      const rows = await query(
        db,
        `SELECT DISTINCT ${column} AS value FROM coverage
         WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY 1`
      );
      return `${column}: ${rows.map((row) => row.value).join(", ")}`;
    })
  );
  return `${schema}\nDistinct values — ${values.join("; ")}`;
}

function parseAnswer(text) {
  const trimmed = String(text ?? "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  const answer = JSON.parse(candidate);
  if (typeof answer.sql !== "string") throw new Error("The model did not return SQL.");
  return {
    title: typeof answer.title === "string" ? answer.title : "Answer",
    sql: answer.sql,
    chart: ["bar", "line", "none"].includes(answer.chart) ? answer.chart : "none",
    x: typeof answer.x === "string" ? answer.x : "",
    y: typeof answer.y === "string" ? answer.y : ""
  };
}

/**
 * One-shot question for the evaluation page: load the model in a fresh worker,
 * ask, and shut the worker down again. Slower than the panel (each call starts
 * the engine) but stateless, so one bad answer cannot spoil the next.
 */
export async function askOnce({source, model, system, question, onProgress}) {
  const text = await source.text();
  const url = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
  const worker = new Worker(url, {type: "module"});
  let requestId = 0;
  const pending = new Map();
  worker.onmessage = (event) => {
    const data = event.data ?? {};
    if (data.type === "progress") return onProgress?.(data);
    const handler = pending.get(data.id);
    if (!handler) return;
    pending.delete(data.id);
    if (data.type === "error") handler.reject(new Error(data.error));
    else handler.resolve(data);
  };
  const send = (payload) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, {resolve, reject});
      worker.postMessage({...payload, id});
    });
  try {
    await send({type: "init", model: modelId(model, true)});
    const reply = await send({
      type: "chat",
      messages: [
        {role: "system", content: system},
        {role: "user", content: question}
      ],
      schema: RESPONSE_SCHEMA,
      maxTokens: 400,
      temperature: 0
    });
    return parseAnswer(reply.text);
  } finally {
    worker.terminate();
  }
}

export function createAskPanel({source, describe, onSql, models = MODELS, shaderF16 = true}) {
  const el = document.createElement("section");
  el.className = "ask-panel";
  el.innerHTML = `
    <div class="ask-head">
      <div>
        <h3>Ask a question</h3>
        <p class="small muted">Type a question in plain English. The model runs in
          this browser and writes the SQL; nothing is uploaded. The first question
          downloads about 1 GB.</p>
      </div>
      <span class="ask-badge" hidden></span>
    </div>
    <div class="ask-setup">
      <label class="small">Model
        <select class="ask-model"></select>
      </label>
      <button type="button" class="ask-load">Download model</button>
      <span class="ask-storage small muted"></span>
      <button type="button" class="ask-delete" hidden>Delete model</button>
      <div class="ask-progress" hidden>
        <div class="ask-progress-track"><div class="ask-progress-fill"></div></div>
        <span class="ask-progress-text small muted"></span>
      </div>
    </div>
    <div class="ask-input" hidden>
      <input class="ask-question" type="search" placeholder="Which software modules cover Windows on arm64?"
        aria-label="Ask a question about the data" />
      <button type="button" class="ask-go">Ask</button>
      <button type="button" class="ask-stop" hidden>Stop</button>
    </div>
    <div class="ask-message small" hidden></div>
  `;

  const modelSelect = el.querySelector(".ask-model");
  const loadButton = el.querySelector(".ask-load");
  const deleteButton = el.querySelector(".ask-delete");
  const storageLabel = el.querySelector(".ask-storage");
  const progress = el.querySelector(".ask-progress");
  const progressFill = el.querySelector(".ask-progress-fill");
  const progressText = el.querySelector(".ask-progress-text");
  const inputRow = el.querySelector(".ask-input");
  const question = el.querySelector(".ask-question");
  const goButton = el.querySelector(".ask-go");
  const stopButton = el.querySelector(".ask-stop");
  const message = el.querySelector(".ask-message");
  const badge = el.querySelector(".ask-badge");

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} (${model.size})`;
    modelSelect.append(option);
  }

  let worker = null;
  let requestId = 0;
  let pending = new Map();
  let ready = null; // model id that is loaded in the worker
  let schemaText = null;
  let generating = false;

  const say = (text, kind = "") => {
    message.hidden = !text;
    message.className = `ask-message small ${kind}`;
    message.textContent = text ?? "";
  };

  function send(payload) {
    if (!worker) throw new Error("The model worker is not running.");
    const id = ++requestId;
    payload.id = id;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject});
      worker.postMessage(payload);
    });
  }

  async function ensureWorker() {
    if (worker) return worker;
    const text = await source.text();
    const url = URL.createObjectURL(new Blob([text], {type: "text/javascript"}));
    worker = new Worker(url, {type: "module"});
    worker.onmessage = (event) => {
      const data = event.data ?? {};
      if (data.type === "progress") {
        progress.hidden = false;
        progressFill.style.width = `${Math.round((data.progress ?? 0) * 100)}%`;
        progressText.textContent = data.text ?? "";
        return;
      }
      const handler = pending.get(data.id);
      if (!handler) return;
      if (data.type === "error") {
        pending.delete(data.id);
        handler.reject(new Error(data.error));
      } else if (data.type === "done" || data.type === "status" || data.type === "pong") {
        pending.delete(data.id);
        handler.resolve(data);
      }
    };
    worker.onerror = (event) => {
      say(`The model worker failed: ${event.message ?? "unknown error"}`, "error");
      for (const handler of pending.values()) handler.reject(new Error(event.message));
      pending.clear();
    };
    return worker;
  }

  const selected = () => models.find((model) => model.id === modelSelect.value) ?? models[0];

  async function refresh() {
    const model = selected();
    const id = modelId(model, shaderF16);
    const cached = await isModelCached(id);
    badge.hidden = !cached;
    badge.textContent = cached ? "model cached" : "";
    loadButton.textContent = cached ? "Load model" : `Download model (${model.size})`;
    deleteButton.hidden = !cached;
    const info = await storageInfo();
    storageLabel.textContent = info?.label ?? "";
    if (!cached) {
      ready = null;
      inputRow.hidden = true;
    }
    return cached;
  }

  async function load() {
    const model = selected();
    const id = modelId(model, shaderF16);
    say("");
    loadButton.disabled = true;
    progress.hidden = false;
    progressFill.style.width = "0%";
    progressText.textContent = "Starting\u2026";
    try {
      await navigator.storage?.persist?.();
      await ensureWorker();
      await send({type: "init", model: id});
      ready = id;
      progress.hidden = true;
      inputRow.hidden = false;
      question.focus();
      await refresh();
    } catch (error) {
      progress.hidden = true;
      say(`Could not load the model: ${error?.message ?? error}`, "error");
    } finally {
      loadButton.disabled = false;
    }
  }

  async function remove() {
    const model = selected();
    const id = modelId(model, shaderF16);
    try {
      if (worker) await send({type: "delete", model: id});
      ready = null;
      inputRow.hidden = true;
      say("");
      await refresh();
    } catch (error) {
      say(`Could not delete the model: ${error?.message ?? error}`, "error");
    }
  }

  async function generate(messages) {
    const reply = await send({type: "chat", messages, schema: RESPONSE_SCHEMA, maxTokens: 400});
    return parseAnswer(reply.text);
  }

  async function ask() {
    if (generating) return;
    const text = question.value.trim();
    if (!text) return;
    generating = true;
    goButton.disabled = true;
    stopButton.hidden = false;
    say("Thinking\u2026");
    try {
      if (!ready) await load();
      if (!schemaText) schemaText = await describe();
      const system = buildPrompt(schemaText);
      const messages = [
        {role: "system", content: system},
        {role: "user", content: text}
      ];

      let answer = null;
      let out = null;
      let lastError = null;
      for (let attempt = 0; attempt < 2 && !out; attempt++) {
        try {
          answer = await generate(messages);
        } catch (error) {
          lastError = error;
          break;
        }
        const check = validateStatement(answer.sql);
        if (!check.ok) {
          lastError = new Error(check.reason);
          messages.push({role: "assistant", content: JSON.stringify(answer)});
          messages.push({
            role: "user",
            content: `That SQL cannot run: ${check.reason} Write one read-only SELECT query.`
          });
          continue;
        }
        say(`Running: ${answer.title}\u2026`);
        out = await onSql(answer.sql, answer);
        if (out?.error) {
          lastError = new Error(out.error);
          messages.push({role: "assistant", content: JSON.stringify(answer)});
          messages.push({
            role: "user",
            content: `DuckDB said: ${out.error}. Fix the query and return JSON again.`
          });
          out = null;
        }
      }

      if (!out && answer) {
        await onSql(answer.sql, {...answer, chart: "none", run: false});
        say(`That SQL did not run: ${lastError?.message ?? ""} You can edit it in the console below.`, "error");
      } else if (!out) {
        say(`The model could not answer: ${lastError?.message ?? "unknown error"}. Try again.`, "error");
      } else {
        say(`${answer.title} \u00b7 ${out.rows.length} rows \u00b7 ${out.ms.toFixed(0)} ms`);
      }
    } catch (error) {
      say(`${error?.message ?? error}`, "error");
    } finally {
      generating = false;
      goButton.disabled = false;
      stopButton.hidden = true;
    }
  }

  modelSelect.addEventListener("change", () => refresh());
  loadButton.addEventListener("click", load);
  deleteButton.addEventListener("click", remove);
  goButton.addEventListener("click", ask);
  question.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      ask();
    }
  });
  stopButton.addEventListener("click", () => {
    worker?.postMessage({id: ++requestId, type: "abort"});
    for (const handler of pending.values()) handler.reject(new Error("Stopped."));
    pending.clear();
    say("Stopped.");
  });

  return {el, refresh};
}
