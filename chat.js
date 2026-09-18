import {
    pipeline,
    env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

const MODEL_ID = "onnx-community/gemma-3-270m-it-ONNX";

const SYSTEM_PROMPT = `
You are a culinary reference assistant for an experienced cook with a deep
understanding of cooking science.

Do not assume the user is a beginner.

Be precise, technical, and direct.
Use professional kitchen terminology.
Reference food science when relevant.

You can assist with:
- cooking techniques
- food science
- sauces and stocks
- ingredient substitutions
- recipe development
- troubleshooting
- charcuterie
- curing
- fermentation
- temperatures
- ratios
- timing

Answer concisely but completely.
`.trim();

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let generator = null;
let generatorPromise = null;
let activeDevice = null;
let chatHistory = [];

function addMsg(type, text) {
    const container = document.getElementById("chat-messages");

    if (!container) {
        console.error("chat-messages container not found");
        return null;
    }

    const div = document.createElement("div");
    div.className = "msg " + type;
    div.textContent = text;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    return div;
}

function updateStatus(text) {
    const status = document.getElementById("ai-model-status");

    if (status) {
        status.textContent = text;
    }
}

function updateThinking(text) {
    const thinking = document.querySelector(".msg.thinking");

    if (thinking) {
        thinking.textContent = text;
    }
}

function humanBytes(bytes) {
    if (!Number.isFinite(bytes)) {
        return "";
    }

    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function progressCallback(info) {
    console.log("Transformers.js:", info);

    if (!info) {
        return;
    }

    let message = "Loading local AI model…";

    if (info.status === "initiate" && info.file) {
        message = `Preparing ${info.file}…`;
    }

    if (info.status === "download" && info.file) {
        message = `Downloading ${info.file}…`;
    }

    if (info.status === "progress") {
        const pct =
            Number.isFinite(info.progress)
                ? `${Math.round(info.progress)}%`
                : "";

        const loaded =
            Number.isFinite(info.loaded)
                ? humanBytes(info.loaded)
                : "";

        const total =
            Number.isFinite(info.total)
                ? humanBytes(info.total)
                : "";

        if (loaded && total) {
            message =
                `Loading model ${pct} — ${loaded} / ${total}`;
        } else if (pct) {
            message = `Loading model ${pct}`;
        }
    }

    if (info.status === "done" && info.file) {
        message = `Loaded ${info.file}`;
    }

    if (info.status === "ready") {
        message = "Model files ready";
    }

    updateStatus(message);
    updateThinking(message);
}

async function tryWebGPU() {
    if (!("gpu" in navigator)) {
        return null;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();

        if (!adapter) {
            return null;
        }

        updateStatus("WebGPU detected — loading accelerated AI…");
        updateThinking("WebGPU detected — loading accelerated AI…");

        const pipe = await pipeline(
            "text-generation",
            MODEL_ID,
            {
                device: "webgpu",
                dtype: "q4",
                progress_callback: progressCallback
            }
        );

        activeDevice = "WebGPU";

        return pipe;

    } catch (error) {
        console.warn(
            "WebGPU initialization failed; falling back to WASM.",
            error
        );

        return null;
    }
}

async function loadWasm() {
    updateStatus("Loading CPU-compatible AI…");
    updateThinking("Loading CPU-compatible AI…");

    const pipe = await pipeline(
        "text-generation",
        MODEL_ID,
        {
            device: "wasm",
            dtype: "q4",
            progress_callback: progressCallback
        }
    );

    activeDevice = "CPU / WebAssembly";

    return pipe;
}

async function ensureModelLoaded() {
    if (generator) {
        return generator;
    }

    if (generatorPromise) {
        return generatorPromise;
    }

    generatorPromise = (async () => {
        let pipe = await tryWebGPU();

        if (!pipe) {
            pipe = await loadWasm();
        }

        generator = pipe;

        updateStatus(`Local AI ready — ${activeDevice}`);
        updateThinking(`Local AI ready — ${activeDevice}`);

        return generator;
    })();

    try {
        return await generatorPromise;

    } catch (error) {
        console.error("Model load failed:", error);

        generator = null;
        generatorPromise = null;
        activeDevice = null;

        updateStatus("AI model failed to load");

        throw error;
    }
}

function buildMessages() {
    return [
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        ...chatHistory
    ];
}

function extractAssistantText(output) {
    if (!Array.isArray(output) || !output.length) {
        return "";
    }

    const first = output[0];

    if (
        Array.isArray(first.generated_text) &&
        first.generated_text.length
    ) {
        const last =
            first.generated_text[first.generated_text.length - 1];

        if (
            last &&
            typeof last === "object" &&
            typeof last.content === "string"
        ) {
            return last.content.trim();
        }
    }

    if (typeof first.generated_text === "string") {
        return first.generated_text.trim();
    }

    return "";
}

async function sendChat() {
    const input = document.getElementById("chat-input");
    const sendBtn = document.getElementById("chat-send");

    if (!input || !sendBtn) {
        console.error("Chat input or send button not found");
        return;
    }

    const message = input.value.trim();

    if (!message) {
        return;
    }

    sendBtn.disabled = true;
    input.value = "";

    addMsg("user", message);

    chatHistory.push({
        role: "user",
        content: message
    });

    const thinking = addMsg(
        "thinking",
        generator
            ? "…thinking"
            : "…loading local AI model"
    );

    try {
        const localGenerator = await ensureModelLoaded();

        if (thinking) {
            thinking.textContent =
                `…thinking on ${activeDevice}`;
        }

        const output = await localGenerator(
            buildMessages(),
            {
                max_new_tokens: 300,
                do_sample: false,
                return_full_text: true
            }
        );

        const reply =
            extractAssistantText(output) ||
            "No response generated.";

        if (thinking) {
            thinking.remove();
        }

        addMsg("assistant", reply);

        chatHistory.push({
            role: "assistant",
            content: reply
        });

    } catch (error) {
        console.error("Local AI error:", error);

        if (thinking) {
            thinking.remove();
        }

        const detail =
            error && error.message
                ? error.message
                : "Unable to load or run the model.";

        addMsg(
            "assistant",
            "Local AI error: " + detail
        );

    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

function prefillChat(text) {
    const input = document.getElementById("chat-input");

    if (!input) {
        return;
    }

    input.value = text;
    input.focus();
}

function clearChat() {
    chatHistory = [];

    const container =
        document.getElementById("chat-messages");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="msg assistant">Ready. What are you working on?</div>';
}

function initializeChat() {
    const sendBtn =
        document.getElementById("chat-send");

    const input =
        document.getElementById("chat-input");

    if (!sendBtn || !input) {
        console.error("Chat UI elements were not found.");
        return;
    }

    sendBtn.addEventListener(
        "click",
        sendChat
    );

    input.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {
                event.preventDefault();
                sendChat();
            }
        }
    );

    if ("gpu" in navigator) {
        updateStatus(
            "Local AI — WebGPU preferred, CPU fallback available"
        );
    } else {
        updateStatus(
            "Local AI — CPU-compatible mode"
        );
    }
}

window.prefillChat = prefillChat;
window.clearChat = clearChat;

initializeChat();
