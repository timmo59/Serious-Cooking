const WEBLLM_URL = "https:" + "//esm.run/@mlc-ai/web-llm";
const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

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

let webllm = null;
let engine = null;
let enginePromise = null;
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

async function loadWebLLM() {
    if (webllm) {
        return webllm;
    }

    updateStatus("Loading AI runtime…");

    webllm = await import(WEBLLM_URL);

    return webllm;
}

async function ensureModelLoaded() {
    if (engine) {
        return engine;
    }

    if (enginePromise) {
        return enginePromise;
    }

    if (!("gpu" in navigator)) {
        throw new Error(
            "WebGPU is not available in this browser. Use a current Chrome or Edge browser with WebGPU support."
        );
    }

    enginePromise = (async () => {
        const runtime = await loadWebLLM();

        updateStatus("Loading local AI model…");

        const localEngine = await runtime.CreateMLCEngine(
            MODEL_ID,
            {
                initProgressCallback: (report) => {
                    console.log("WebLLM:", report);

                    if (report && report.text) {
                        updateStatus(report.text);

                        const thinking = document.querySelector(".msg.thinking");

                        if (thinking) {
                            thinking.textContent = report.text;
                        }
                    }
                },
                logLevel: "INFO"
            }
        );

        engine = localEngine;
        updateStatus("Local AI ready");

        return engine;
    })();

    try {
        return await enginePromise;
    } catch (error) {
        console.error("Model load failed:", error);

        enginePromise = null;
        engine = null;

        updateStatus("AI model failed to load");

        throw error;
    }
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
        engine ? "…thinking" : "…loading local AI model"
    );

    try {
        const localEngine = await ensureModelLoaded();

        if (thinking) {
            thinking.textContent = "…thinking";
        }

        const messages = [
            {
                role: "system",
                content: SYSTEM_PROMPT
            },
            ...chatHistory
        ];

        const response = await localEngine.chat.completions.create({
            messages,
            temperature: 0.6,
            top_p: 0.9,
            max_tokens: 700
        });

        const reply =
            response &&
            response.choices &&
            response.choices[0] &&
            response.choices[0].message &&
            response.choices[0].message.content
                ? response.choices[0].message.content.trim()
                : "No response generated.";

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
            "Local AI error: " + detail +
            " If you are using Firefox, try the latest Chrome or Edge because WebGPU/WebLLM support is more reliable there."
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

    const container = document.getElementById("chat-messages");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="msg assistant">Ready. What are you working on?</div>';
}

function initializeChat() {
    const sendBtn = document.getElementById("chat-send");
    const input = document.getElementById("chat-input");

    if (!sendBtn || !input) {
        console.error("Chat UI elements were not found.");
        return;
    }

    sendBtn.addEventListener("click", sendChat);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendChat();
        }
    });

    if (!("gpu" in navigator)) {
        updateStatus("WebGPU unavailable");
    } else {
        updateStatus("Local AI — loads on first question");
    }
}

window.prefillChat = prefillChat;
window.clearChat = clearChat;

initializeChat();
