const CHAT_API =
    "https:" +
    "//serious-cooking-chat.serious-cooking-ai.workers.dev/chat";

const NOT_FOUND_MESSAGE =
    "I can't find enough information about that on the Serious Cooking page.";

const MAX_RESULTS = 6;

let knowledgeChunks = [];
let chatHistory = [];
let lastRetrievedSources = [];

const STOP_WORDS = new Set([
    "a",
    "about",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "because",
    "been",
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
    "them",
    "then",
    "there",
    "these",
    "they",
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

function normalizeToken(token) {
    let value = String(token || "")
        .toLowerCase()
        .replace(/[^a-z0-9À-ÿ'-]/g, "");

    if (value.length > 7 && value.endsWith("ing")) {
        value = value.slice(0, -3);
    } else if (value.length > 6 && value.endsWith("ed")) {
        value = value.slice(0, -2);
    } else if (value.length > 5 && value.endsWith("es")) {
        value = value.slice(0, -2);
    } else if (value.length > 4 && value.endsWith("s")) {
        value = value.slice(0, -1);
    }

    return value;
}

function tokenize(text) {
    return normalizeText(text)
        .toLowerCase()
        .split(/[^a-z0-9À-ÿ'-]+/)
        .map(normalizeToken)
        .filter((token) => {
            return (
                token.length >= 3 &&
                !STOP_WORDS.has(token)
            );
        });
}

function splitText(text, maxLength = 1500) {
    const normalized = normalizeText(text);

    if (!normalized) {
        return [];
    }

    if (normalized.length <= maxLength) {
        return [normalized];
    }

    const sentences = normalized.split(
        /(?<=[.!?])\s+/
    );

    const chunks = [];
    let current = "";

    for (const sentence of sentences) {
        if (
            current &&
            current.length + sentence.length + 1 > maxLength
        ) {
            chunks.push(current.trim());
            current = "";
        }

        current +=
            (current ? " " : "") +
            sentence;
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

function getHeading(element) {
    const ownHeading = element.querySelector(
        "h1, h2, h3, h4, .callout-label, .section-label"
    );

    if (ownHeading) {
        return normalizeText(
            ownHeading.textContent
        );
    }

    const section = element.closest(
        "section, .section"
    );

    if (section) {
        const sectionHeading = section.querySelector(
            "h1, h2, h3, h4"
        );

        if (sectionHeading) {
            return normalizeText(
                sectionHeading.textContent
            );
        }
    }

    let node = element.previousElementSibling;

    while (node) {
        if (/^H[1-4]$/.test(node.tagName)) {
            return normalizeText(
                node.textContent
            );
        }

        node = node.previousElementSibling;
    }

    return "Serious Cooking";
}

function buildKnowledgeBase() {
    const selectors = [
        ".section-hero",
        ".consult-hero",
        ".prose",
        ".accordion-item",
        ".accordion-body",
        ".callout",
        ".timeline-step",
        ".temp-cell",
        ".table-wrap",
        ".cure-calc",
        ".recipe-card",
        "article"
    ];

    const seen = new Set();
    const chunks = [];

    for (const selector of selectors) {
        const elements =
            document.querySelectorAll(selector);

        for (const element of elements) {
            if (
                element.closest("#chat-panel") ||
                element.id === "chat-panel"
            ) {
                continue;
            }

            const clone =
                element.cloneNode(true);

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

            const text = normalizeText(
                clone.textContent
            );

            if (text.length < 35) {
                continue;
            }

            const heading =
                getHeading(element);

            for (const piece of splitText(text)) {
                const fingerprint =
                    (
                        heading +
                        "|" +
                        piece
                    ).toLowerCase();

                if (seen.has(fingerprint)) {
                    continue;
                }

                seen.add(fingerprint);

                chunks.push({
                    id: chunks.length + 1,
                    heading,
                    text: piece,
                    normalizedText:
                        piece.toLowerCase(),
                    tokens:
                        new Set(tokenize(piece))
                });
            }
        }
    }

    knowledgeChunks = chunks;

    console.log(
        "Serious Cooking knowledge chunks:",
        knowledgeChunks.length
    );

    updateStatus(
        `AI ready — ${knowledgeChunks.length} page sections indexed`
    );
}

function scoreChunk(question, chunk) {
    const query =
        normalizeText(question).toLowerCase();

    const tokens =
        [...new Set(tokenize(question))];

    if (!tokens.length) {
        return 0;
    }

    let score = 0;

    if (
        query.length >= 5 &&
        chunk.normalizedText.includes(query)
    ) {
        score += 50;
    }

    const heading =
        chunk.heading.toLowerCase();

    for (const token of tokens) {
        if (heading.includes(token)) {
            score += 10;
        }

        if (chunk.tokens.has(token)) {
            score += 6;
        } else if (
            token.length >= 5 &&
            chunk.normalizedText.includes(token)
        ) {
            score += 2;
        }
    }

    let matched = 0;

    for (const token of tokens) {
        if (chunk.tokens.has(token)) {
            matched += 1;
        }
    }

    const coverage =
        matched / tokens.length;

    score += coverage * 25;

    for (
        let i = 0;
        i < tokens.length - 1;
        i += 1
    ) {
        const phrase =
            tokens[i] +
            " " +
            tokens[i + 1];

        if (
            chunk.normalizedText.includes(phrase)
        ) {
            score += 12;
        }
    }

    return score;
}

function looksLikeFollowUp(question) {
    const normalized =
        normalizeText(question).toLowerCase();

    const words =
        normalized.split(/\s+/);

    if (words.length <= 5) {
        return true;
    }

    return /\b(that|this|it|those|these|them|second|first|former|latter|why|how so|what about)\b/i
        .test(normalized);
}

function retrievalQuery(question) {
    if (!looksLikeFollowUp(question)) {
        return question;
    }

    const previousUser =
        [...chatHistory]
            .reverse()
            .find(
                (item) =>
                    item.role === "user"
            );

    if (!previousUser) {
        return question;
    }

    return (
        previousUser.content +
        " " +
        question
    );
}

function retrieveSources(question) {
    if (!knowledgeChunks.length) {
        buildKnowledgeBase();
    }

    const query =
        retrievalQuery(question);

    const results =
        knowledgeChunks
            .map((chunk) => ({
                ...chunk,
                score:
                    scoreChunk(
                        query,
                        chunk
                    )
            }))
            .filter(
                (chunk) =>
                    chunk.score > 0
            )
            .sort(
                (a, b) =>
                    b.score -
                    a.score
            );

    if (
        results.length &&
        results[0].score >= 8
    ) {
        const selected =
            results.slice(
                0,
                MAX_RESULTS
            );

        lastRetrievedSources =
            selected;

        return selected;
    }

    if (
        looksLikeFollowUp(question) &&
        lastRetrievedSources.length
    ) {
        return lastRetrievedSources;
    }

    return [];
}

function addMsg(type, text) {
    const container =
        document.getElementById(
            "chat-messages"
        );

    if (!container) {
        return null;
    }

    const div =
        document.createElement("div");

    div.className =
        "msg " + type;

    div.textContent =
        text;

    container.appendChild(div);

    container.scrollTop =
        container.scrollHeight;

    return div;
}

function updateStatus(text) {
    const status =
        document.getElementById(
            "ai-model-status"
        );

    if (status) {
        status.textContent = text;
    }
}

function sourcePayload(sources) {
    return sources.map(
        (source) => ({
            heading:
                source.heading,
            text:
                source.text
        })
    );
}

function historyPayload() {
    return chatHistory
        .slice(-6)
        .map((item) => ({
            role:
                item.role,
            content:
                item.content.slice(
                    0,
                    1200
                )
        }));
}

function parseSseEvent(eventText) {
    const lines =
        eventText.split(/\r?\n/);

    let data = "";

    for (const line of lines) {
        if (line.startsWith("data:")) {
            data +=
                line.slice(5).trim();
        }
    }

    return data;
}

function extractToken(payload) {
    if (
        payload &&
        typeof payload.response === "string" &&
        payload.response
    ) {
        return payload.response;
    }

    const choice =
        payload?.choices?.[0];

    if (
        typeof choice?.delta?.content === "string"
    ) {
        return choice.delta.content;
    }

    if (
        typeof choice?.text === "string"
    ) {
        return choice.text;
    }

    return "";
}

async function streamAnswer(
    question,
    sources,
    outputElement
) {
    const response =
        await fetch(
            CHAT_API,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        question,
                        context:
                            sourcePayload(
                                sources
                            ),
                        history:
                            historyPayload()
                    })
            }
        );

    if (!response.ok) {
        let detail =
            `HTTP ${response.status}`;

        try {
            const error =
                await response.json();

            if (
                error &&
                error.error
            ) {
                detail =
                    error.error;
            }
        } catch {
            // Keep HTTP status.
        }

        throw new Error(detail);
    }

    if (!response.body) {
        throw new Error(
            "Streaming response body is unavailable"
        );
    }

    const reader =
        response.body.getReader();

    const decoder =
        new TextDecoder();

    let buffer = "";
    let fullText = "";

    while (true) {
        const {
            value,
            done
        } =
            await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(
            value,
            {
                stream: true
            }
        );

        const events =
            buffer.split(
                /\r?\n\r?\n/
            );

        buffer =
            events.pop() || "";

        for (const eventText of events) {
            const data =
                parseSseEvent(
                    eventText
                );

            if (
                !data ||
                data === "[DONE]"
            ) {
                continue;
            }

            try {
                const payload =
                    JSON.parse(data);

                const token =
                    extractToken(
                        payload
                    );

                if (token) {
                    fullText += token;

                    outputElement.textContent =
                        fullText;

                    const container =
                        document.getElementById(
                            "chat-messages"
                        );

                    if (container) {
                        container.scrollTop =
                            container.scrollHeight;
                    }
                }

            } catch (error) {
                console.warn(
                    "Unable to parse AI stream event:",
                    data,
                    error
                );
            }
        }
    }

    return fullText.trim();
}


function getLocalConversationResponse(message) {
    const normalized = normalizeText(message).toLowerCase();

    if (
        /^(hi|hello|hey|hiya|howdy|good morning|good afternoon|good evening)[!. ]*$/.test(
            normalized
        )
    ) {
        return (
            "Hi! Ask me anything about the cooking material on Serious Cooking. " +
            "I can explain concepts, summarize sections, compare techniques, or help clarify what the page says."
        );
    }

    if (
        /^(thanks|thank you|thx|ty)[!. ]*$/.test(
            normalized
        )
    ) {
        return "You're welcome. What would you like to explore on Serious Cooking?";
    }

    if (
        normalized === "help" ||
        normalized.includes("what can you do") ||
        normalized.includes("how can you help")
    ) {
        return (
            "I can help you understand the material on Serious Cooking. " +
            "For example, ask me to explain a technique, summarize a section, compare two concepts, " +
            "clarify terminology, or walk through information found on the page."
        );
    }

    return null;
}

async function sendChat() {
    const input =
        document.getElementById(
            "chat-input"
        );

    const sendBtn =
        document.getElementById(
            "chat-send"
        );

    if (!input || !sendBtn) {
        return;
    }

    const question =
        input.value.trim();

    if (!question) {
        return;
    }

    sendBtn.disabled = true;
    input.value = "";

    addMsg(
        "user",
        question
    );

    /*
     * Greetings and conversational control messages do not
     * require source retrieval or an AI request.
     */
    const localResponse =
        getLocalConversationResponse(question);

    if (localResponse) {
        addMsg(
            "assistant",
            localResponse
        );

        chatHistory.push(
            {
                role: "user",
                content: question
            },
            {
                role: "assistant",
                content: localResponse
            }
        );

        sendBtn.disabled = false;
        input.focus();

        return;
    }

    const sources =
        retrieveSources(question);

    if (!sources.length) {
        addMsg(
            "assistant",
            NOT_FOUND_MESSAGE
        );

        chatHistory.push(
            {
                role: "user",
                content: question
            },
            {
                role: "assistant",
                content:
                    NOT_FOUND_MESSAGE
            }
        );

        sendBtn.disabled = false;
        input.focus();

        return;
    }

    console.log(
        "Serious Cooking sources:",
        sources
    );

    const outputElement =
        addMsg(
            "assistant",
            "…"
        );

    updateStatus(
        `Answering from ${sources.length} Serious Cooking sections…`
    );

    try {
        const answer =
            await streamAnswer(
                question,
                sources,
                outputElement
            );

        const finalAnswer =
            answer ||
            NOT_FOUND_MESSAGE;

        outputElement.textContent =
            finalAnswer;

        chatHistory.push(
            {
                role: "user",
                content: question
            },
            {
                role: "assistant",
                content: finalAnswer
            }
        );

        updateStatus(
            `AI ready — ${knowledgeChunks.length} page sections indexed`
        );

    } catch (error) {
        console.error(
            "Serious Cooking AI error:",
            error
        );

        outputElement.textContent =
            "AI service error: " +
            (
                error?.message ||
                "Unable to contact the Serious Cooking assistant."
            );

        updateStatus(
            "AI service unavailable"
        );

    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

function prefillChat(text) {
    const input =
        document.getElementById(
            "chat-input"
        );

    if (!input) {
        return;
    }

    input.value = text;
    input.focus();
}

function clearChat() {
    chatHistory = [];
    lastRetrievedSources = [];

    const container =
        document.getElementById(
            "chat-messages"
        );

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="msg assistant">' +
        'Ready. Ask me anything about the material on Serious Cooking.' +
        '</div>';
}

function initializeChat() {
    buildKnowledgeBase();

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
}

window.prefillChat =
    prefillChat;

window.clearChat =
    clearChat;

initializeChat();
