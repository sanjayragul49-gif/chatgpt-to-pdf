
import express from "express";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let browserInstance;

async function getBrowser() {
    if (!browserInstance) {
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });
    }

    return browserInstance;
}

function validateURL(value) {
    const url = new URL(String(value || "").trim());

    if (
        url.protocol !== "https:" ||
        !["chatgpt.com", "chat.openai.com"].includes(url.hostname) ||
        !url.pathname.startsWith("/share/")
    ) {
        throw new Error("Please enter a valid public ChatGPT share link.");
    }

    return url.href;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function extractConversation(sharedURL) {
    const browser = await getBrowser();

    const page = await browser.newPage({
        viewport: { width: 1280, height: 1000 }
    });

    try {
        await page.goto(sharedURL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await page.waitForLoadState("networkidle", {
            timeout: 20000
        }).catch(() => {});

        await page.waitForSelector("main", {
            timeout: 25000
        }).catch(() => {});

        await wait(3000);

        // Scroll to trigger lazy-loaded conversation content
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });
            await wait(800);

            await page.evaluate(() => window.scrollTo(0, 0));
            await wait(300);
        }

        const data = await page.evaluate(() => {
            const clean = text =>
                (text || "")
                .replace(/\u00a0/g, " ")
                .trim();

            let elements = [
                ...document.querySelectorAll(
                    '[data-testid^="conversation-turn"]'
                )
            ];

            let messages = [];

            if (elements.length) {
                messages = elements.map(element => {
                    const roleElement =
                        element.querySelector(
                            "[data-message-author-role]"
                        ) ||
                        (element.matches("[data-message-author-role]")
                            ? element
                            : null);

                    return {
                        role: roleElement?.getAttribute(
                            "data-message-author-role"
                        ) || "assistant",

                        text: clean(
                            (roleElement || element).innerText
                        )
                    };
                });
            } else {
                elements = [
                    ...document.querySelectorAll(
                        "[data-message-author-role]"
                    )
                ];

                messages = elements.map(element => ({
                    role: element.getAttribute(
                        "data-message-author-role"
                    ),
                    text: clean(element.innerText)
                }));
            }

            const seen = new Set();

            messages = messages.filter(message => {
                if (!message.text) return false;

                const key = message.role + ":" + message.text;

                if (seen.has(key)) return false;

                seen.add(key);
                return true;
            });

            return {
                title: clean(document.title) ||
                    "ChatGPT Conversation",
                messages
            };
        });

        if (!data.messages.length) {
            throw new Error(
                "No conversation messages detected. Check the shared link."
            );
        }

        const answerCount = data.messages.filter(
            m => m.role === "assistant"
        ).length;

        if (!answerCount) {
            throw new Error(
                "No assistant answers detected on the shared page."
            );
        }

        return data;

    } finally {
        await page.close();
    }
}

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function createPDFHTML(data) {
    const content = data.messages.map((message, index) => {
        const question = message.role === "user";

        return `
            <section class="message">
                <div class="label">
                    ${question ? "QUESTION" : "ANSWER"}
                </div>

                <div class="${question ? "question" : "answer"}">
                    ${escapeHTML(message.text)}
                </div>
            </section>
        `;
    }).join("");

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">

        <style>
            @page {
                size: A4;
                margin: 18mm;
            }

            body {
                font-family: Arial, sans-serif;
                color: #111;
                font-size: 12px;
                line-height: 1.7;
            }

            h1 {
                font-size: 20px;
                margin-bottom: 25px;
            }

            .message {
                margin-bottom: 22px;
                padding-bottom: 15px;
                border-bottom: 1px solid #ddd;
            }

            .label {
                font-size: 10px;
                font-weight: bold;
                color: #555;
                margin-bottom: 8px;
            }

            .question {
                font-weight: bold;
            }

            .answer {
                font-weight: normal;
            }

            .question,
            .answer {
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }
        </style>
    </head>

    <body>
        <h1>${escapeHTML(data.title)}</h1>
        ${content}
    </body>
    </html>
    `;
}

// PREVIEW API
app.post("/api/preview", async (req, res) => {
    try {
        const url = validateURL(req.body.url);

        const data = await extractConversation(url);

        res.json({
            title: data.title,
            messages: data.messages.map((m, i) => ({
                id: i + 1,
                role: m.role,
                label: m.role === "user" ? "Question" : "Answer",
                text: m.text
            })),

            questionCount: data.messages.filter(
                m => m.role === "user"
            ).length,

            answerCount: data.messages.filter(
                m => m.role === "assistant"
            ).length
        });

    } catch (error) {
        res.status(400).json({
            error: error.message
        });
    }
});

// PDF EXPORT API
app.post("/api/export", async (req, res) => {
    try {
        const url = validateURL(req.body.url);

        const data = await extractConversation(url);

        const browser = await getBrowser();
        const page = await browser.newPage();

        try {
            await page.setContent(createPDFHTML(data), {
                waitUntil: "load"
            });

            const pdf = await page.pdf({
                format: "A4",
                printBackground: true,
                preferCSSPageSize: true
            });

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="ChatGPT_Conversation.pdf"'
            );

            res.send(pdf);

        } finally {
            await page.close();
        }

    } catch (error) {
        res.status(400).json({
            error: error.message
        });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "OK" });
});

app.listen(PORT, () => {
    console.log(
        `ChatGPT PDF Server running on port ${PORT}`
    );
});
