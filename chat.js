import {
    pipeline,
    env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

const MODEL_ID = "onnx-community/gemma-3-270m-it-ONNX";

const NOT_FOUND_MESSAGE =
    "I can't answer that from the Serious Cooking page.";

const SYSTEM_PROMPT = `
You are the Serious Cooking page assistant.

CRITICAL RULES:

1. You may answer ONLY from the SOURCE EXCERPTS supplied with the user's question.
2. Do NOT use your general pretrained knowledge.
3. Do NOT add facts that are not explicitly supported by the supplied excerpts.
4. Do NOT browse the web.
5. Do NOT speculate.
6. Do NOT fill in missing details from memory.
7. If the supplied excerpts do not contain enough information to answer the question, respond exactly:

I can't answer that from the Serious Cooking page.

8. When you can answer, be concise, technical, and direct.
9. At the end of the answer, list the supporting excerpt numbers in this form:

Sources: [1], [3]

Every factual statement must be supported by one or more supplied excerpts.
`.trim();

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let generator = null;
let generatorPromise = null;
let activeDevice = null;
let chatHistory = [];

let pageChunks = [];

/*
 * Words that contribute little value to simple page retrieval.
 */
const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "should",
    "that",
    "the",
    "their",
    "then",
    "there",
    "these",
    "this",
    "to",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "will",
    "with",
    "would",
    "you",
    "your"
]);

function normalizeText(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

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

/*
 * Split larger page sections into manageable retrieval chunks.
 */
function splitIntoChunks(text, maxLength = 1200, overlap = 150) {
    const normalized = normalizeText(text);

    if (!normalized) {
        return [];
    }

    if (normalized.length <= maxLength) {
        return [normalized];
    }

    const chunks = [];
    let start = 0;

    while (start < normalized.length) {
        let end = Math.min(
            start + maxLength,
            normalized.length
        );

        /*
         * Prefer ending on a sentence boundary.
         */
        if (end < normalized.length) {
            const sentenceEnd = normalized.lastIndexOf(
                ". ",
                end
            );

            if (
                sentenceEnd > start + Math.floor(maxLength * 0.60)
            ) {
                end = sentenceEnd + 1;
            }
        }

        const chunk = normalized
            .slice(start, end)
            .trim();

        if (chunk) {
            chunks.push(chunk);
        }

        if (end >= normalized.length) {
            break;
        }

        start = Math.max(
            end - overlap,
            start + 1
        );
    }

    return chunks;
}

/*
 * Build a searchable knowledge base from the Serious Cooking DOM.
 *
 * We intentionally do NOT index:
 * - chat messages
 * - scripts
 * - styles
 * - buttons
 * - input controls
 * - navigation
 *
 * The knowledge source is the Serious Cooking page itself.
 */
function buildPageKnowledgeBase() {
    const selectors = [
        ".section-hero",
        ".consult-hero",
        ".prose",
        ".accordion-item",
        ".callout",
        ".timeline-step",
        ".temp-cell",
        ".table-wrap",
        ".cure-calc",
        ".recipe-card"
    ];

    const seen = new Set();
    const chunks = [];

    for (const selector of selectors) {
        const elements =
            document.querySelectorAll(selector);

        for (const element of elements) {
            /*
             * Never allow the chat itself to become source material.
             */
            if (
                element.closest("#chat-panel") ||
                element.id === "chat-panel"
            ) {
                continue;
            }

            const clone = element.cloneNode(true);

            /*
             * Remove interactive/UI-only elements before indexing.
             */
            clone.querySelectorAll(
                [
                    "script",
                    "style",
                    "button",
                    "input",
                    "textarea",
                    "select",
                    "nav",
                    ".recipe-card-actions"
                ].join(",")
            ).forEach((node) => node.remove());

            const text =
                normalizeText(clone.textContent);

            if (text.length < 40) {
                continue;
            }

            for (const chunk of splitIntoChunks(text)) {
                const key = chunk.toLowerCase();

                if (seen.has(key)) {
                    continue;
                }

                seen.add(key);

                chunks.push({
                    id: chunks.length + 1,
                    text: chunk
                });
            }
        }
    }

    pageChunks = chunks;

    console.log(
        `Serious Cooking knowledge base: ${pageChunks.length} page chunks`
    );

    return pageChunks;
}

function tokenize(text) {
    return normalizeText(text)
        .toLowerCase()
        .replace(/[^a-z0-9À-ÿ'-]+/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => {
            return (
                token.length >= 3 &&
                !STOP_WORDS.has(token)
            );
        });
}

/*
 * Score a page chunk against the question.
 *
 * This is deliberately local and deterministic.
 * No external search engine or API is involved.
 */
function scoreChunk(question, chunk) {
    const questionText =
        normalizeText(question).toLowerCase();

    const chunkText =
        chunk.text.toLowerCase();

    const tokens =
        [...new Set(tokenize(question))];

    let score = 0;

    /*
     * Strong boost for an exact multi-word query.
     */
    if (
        questionText.length >= 5 &&
        chunkText.includes(questionText)
    ) {
        score += 25;
    }

    for (const token of tokens) {
        const escaped = token.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

        const matches =
            chunkText.match(
                new RegExp(`\\b${escaped}\\b`, "g")
            );

        if (matches) {
            score += Math.min(matches.length, 5) * 3;
        }

        /*
         * Partial-word match gets a smaller score.
         */
        if (
            !matches &&
            token.length >= 5 &&
            chunkText.includes(token)
        ) {
            score += 1;
        }
    }

    return score;
}

function retrievePageContext(question, limit = 6) {
    if (!pageChunks.length) {
        buildPageKnowledgeBase();
    }

    const scored = pageChunks
        .map((chunk) => ({
            ...chunk,
            score: scoreChunk(question, chunk)
        }))
        .filter((chunk) => chunk.score > 0)
        .sort((a, b) => b.score - a.score);

    if (!scored.length) {
        return [];
    }

    /*
     * Avoid feeding extremely weak matches to the model.
     */
    const bestScore = scored[0].score;

    if (bestScore < 3) {
        return [];
    }

    return scored.slice(0, limit);
}

function buildGroundedPrompt(question, sources) {
    const sourceText = sources
        .map((source, index) => {
            return (
                `[${index + 1}] ` +
                source.text
            );
        })
        .join("\n\n");

    return `
SOURCE EXCERPTS FROM THE SERIOUS COOKING PAGE:

${sourceText}

USER QUESTION:

${question}

Answer the USER QUESTION using ONLY the SOURCE EXCERPTS above.

Do not use outside knowledge.

If the excerpts do not contain enough information to answer, reply exactly:

${NOT_FOUND_MESSAGE}
`.trim();
}

async function tryWebGPU() {
    if (!("gpu" in navigator)) {
        return null;
    }

    try {
        const adapter =
            await navigator.gpu.requestAdapter();

        if (!adapter) {
            return null;
        }

        updateStatus(
            "WebGPU detected — loading local page assistant…"
        );

        updateThinking(
            "WebGPU detected — loading local page assistant…"
        );

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
            "WebGPU initialization failed; using WASM.",
            error
        );

        return null;
    }
}

async function loadWasm() {
    updateStatus(
        "Loading CPU page assistant…"
    );

    updateThinking(
        "Loading CPU page assistant…"
    );

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

        updateStatus(
            `Page-only AI ready — ${activeDevice}`
        );

        updateThinking(
            `Page-only AI ready — ${activeDevice}`
        );

        return generator;
    })();

    try {
        return await generatorPromise;

    } catch (error) {
        console.error(
            "Model load failed:",
            error
        );

        generator = null;
        generatorPromise = null;
        activeDevice = null;

        updateStatus(
            "AI model failed to load"
        );

        throw error;
    }
}

function extractAssistantText(output) {
    if (
        !Array.isArray(output) ||
        !output.length
    ) {
        return "";
    }

    const first = output[0];

    if (
        Array.isArray(first.generated_text) &&
        first.generated_text.length
    ) {
        const last =
            first.generated_text[
                first.generated_text.length - 1
            ];

        if (
            last &&
            typeof last === "object" &&
            typeof last.content === "string"
        ) {
            return last.content.trim();
        }
    }

    if (
        typeof first.generated_text === "string"
    ) {
        return first.generated_text.trim();
    }

    return "";
}

async function sendChat() {
    const input =
        document.getElementById("chat-input");

    const sendBtn =
        document.getElementById("chat-send");

    if (!input || !sendBtn) {
        console.error(
            "Chat input or send button not found"
        );

        return;
    }

    const message =
        input.value.trim();

    if (!message) {
        return;
    }

    sendBtn.disabled = true;
    input.value = "";

    addMsg(
        "user",
        message
    );

    /*
     * Search ONLY Serious Cooking page content.
     */
    const sources =
        retrievePageContext(message);

    /*
     * If there is no relevant page material,
     * do not even invoke the language model.
     *
     * This is an important guardrail against
     * answering from pretrained knowledge.
     */
    if (!sources.length) {
        addMsg(
            "assistant",
            NOT_FOUND_MESSAGE
        );

        chatHistory.push({
            role: "user",
            content: message
        });

        chatHistory.push({
            role: "assistant",
            content: NOT_FOUND_MESSAGE
        });

        sendBtn.disabled = false;
        input.focus();

        return;
    }

    console.log(
        "Page sources selected:",
        sources
    );

    const thinking = addMsg(
        "thinking",
        generator
            ? "…searching Serious Cooking"
            : "…loading page-only AI"
    );

    try {
        const localGenerator =
            await ensureModelLoaded();

        if (thinking) {
            thinking.textContent =
                `…answering from ${sources.length} Serious Cooking excerpts`;
        }

        const groundedPrompt =
            buildGroundedPrompt(
                message,
                sources
            );

        const modelMessages = [
            {
                role: "system",
                content: SYSTEM_PROMPT
            },
            {
                role: "user",
                content: groundedPrompt
            }
        ];

        const output =
            await localGenerator(
                modelMessages,
                {
                    /*
                     * Keep generation short.
                     * This also helps CPU performance.
                     */
                    max_new_tokens: 160,
                    do_sample: false,
                    return_full_text: true
                }
            );

        let reply =
            extractAssistantText(output);

        if (!reply) {
            reply =
                NOT_FOUND_MESSAGE;
        }

        if (thinking) {
            thinking.remove();
        }

        addMsg(
            "assistant",
            reply
        );

        chatHistory.push({
            role: "user",
            content: message
        });

        chatHistory.push({
            role: "assistant",
            content: reply
        });

    } catch (error) {
        console.error(
            "Local AI error:",
            error
        );

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
    const input =
        document.getElementById("chat-input");

    if (!input) {
        return;
    }

    input.value = text;
    input.focus();
}

function clearChat() {
    chatHistory = [];

    const container =
        document.getElementById(
            "chat-messages"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="msg assistant">Ready. Ask me about information contained on Serious Cooking.</div>';
}

function initializeChat() {
    /*
     * Build the page-only knowledge index immediately.
     */
    buildPageKnowledgeBase();

    const sendBtn =
        document.getElementById(
            "chat-send"
        );

    const input =
        document.getElementById(
            "chat-input"
        );

    if (!sendBtn || !input) {
        console.error(
            "Chat UI elements were not found."
        );

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

    updateStatus(
        `Page-only AI — ${pageChunks.length} local knowledge chunks`
    );
}

window.prefillChat = prefillChat;
window.clearChat = clearChat;

initializeChat();
