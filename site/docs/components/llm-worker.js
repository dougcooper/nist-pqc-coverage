// Web Worker that hosts the WebLLM engine, so token generation never blocks
// the page. The main thread talks to it with simple request/response messages
// (see components/ask.js) instead of bundling WebLLM into the page.
import {
  CreateMLCEngine,
  deleteModelAllInfoInCache,
  prebuiltAppConfig
} from "@mlc-ai/web-llm";

let engine = null;
let loadedModel = null;
let lastModel = null;

// The default 32k context allocates a KV cache big enough to exhaust shared GPU
// memory on laptops, which shows up as a lost WebGPU device on the first long
// prompt. A few thousand tokens is plenty for this task.
const ENGINE_SETTINGS = {context_window_size: 2048, prefill_chunk_size: 1024};

// Errors that mean "the engine or its device is gone", not "the SQL is wrong".
const RECOVERABLE =
  /device|GPUBuffer|mapAsync|unmapped|GPU|not loaded|reload|pipeline|uninitialized/i;

const models = prebuiltAppConfig.model_list
  .filter((model) => /Qwen/.test(model.model_id))
  .map((model) => model.model_id);

function send(message) {
  self.postMessage(message);
}

function describe(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function progressReporter(id) {
  return ({progress, text, timeElapsed}) => send({id, type: "progress", progress, text, timeElapsed});
}

async function load(id, model) {
  const fresh = await CreateMLCEngine(model, {initProgressCallback: progressReporter(id)}, ENGINE_SETTINGS);
  engine = fresh;
  loadedModel = model;
  lastModel = model;
  return fresh;
}

async function drop() {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      // A device that is already lost cannot unload cleanly; forget it anyway.
    }
  }
  engine = null;
  loadedModel = null;
}

async function init({id, model}) {
  lastModel = model;
  if (engine && loadedModel === model) {
    send({id, type: "status", status: "ready", model, models});
    return;
  }
  await drop();
  await load(id, model);
  send({id, type: "status", status: "ready", model, models});
}

async function chat({id, messages, schema, maxTokens = 400, temperature = 0}) {
  const model = loadedModel ?? lastModel;
  if (!model) throw new Error("No model is selected. Choose one and download it first.");
  const request = () =>
    engine.chat.completions.create({
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(schema
        ? {response_format: {type: "json_object", schema: JSON.stringify(schema)}}
        : {})
    });

  let reply;
  try {
    // The engine can be present but have no model loaded (for example after an
    // interrupted reload), so check for that as well as for a null engine.
    if (!engine) {
      send({id, type: "progress", progress: 0, text: "Loading the model\u2026"});
      await load(id, model);
    }
    await engine.resetChat();
    reply = await request();
  } catch (error) {
    if (!RECOVERABLE.test(describe(error))) throw error;
    // Shared-memory GPUs occasionally drop the WebGPU device mid-generation.
    // A fresh engine fixes it, so reload once and retry before giving up.
    send({id, type: "progress", progress: 0, text: "Graphics hiccup \u2014 reloading the model\u2026"});
    await drop();
    try {
      await load(id, model);
      await engine.resetChat();
      reply = await request();
    } catch (again) {
      await drop();
      throw new Error(
        `The model could not be reloaded after a graphics error: ${describe(again)}. Reload the page to start fresh.`
      );
    }
  }
  const text = reply.choices?.[0]?.message?.content ?? "";
  send({id, type: "done", text, usage: reply.usage ?? null});
}

self.onmessage = async (event) => {
  const message = event.data ?? {};
  const {id, type} = message;
  try {
    switch (type) {
      case "ping":
        send({id, type: "pong", models});
        break;
      case "init":
        await init(message);
        break;
      case "chat":
        await chat(message);
        break;
      case "abort":
        engine?.interruptGenerate();
        send({id, type: "status", status: "aborted"});
        break;
      case "unload":
        await drop();
        send({id, type: "status", status: "unloaded"});
        break;
      case "delete":
        await drop();
        await deleteModelAllInfoInCache(message.model);
        send({id, type: "status", status: "deleted"});
        break;
      default:
        throw new Error(`Unknown request: ${type}`);
    }
  } catch (error) {
    send({id, type: "error", error: describe(error)});
  }
};
