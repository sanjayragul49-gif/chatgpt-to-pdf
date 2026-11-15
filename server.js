
const express = require("express");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Validate URL
function validateURL(value) {
    const url = new URL(value);

    if (
        url.protocol !== "https:" ||
        !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname) ||
        !url.pathname.startsWith("/share/")
    ) {
        throw new Error("Invalid public ChatGPT share URL.");
    }

    return url.href;
}

// Extract messages using multiple DOM strategies
async function extractMessages(page) {
    return await page.evaluate(() => {

        const results = [];
        const seen = new Set();

        const selectors = [
            '[data-message-author-role="user"]',
            '[data-message-author-role="assistant"]',
            '[data-testid^="conversation-turn-"]',
            'main article'
        ];

        function clean(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
            }

            if (node.nodeType !== Node.ELEMENT_NODE) {
                return "";
            }

            const tag = node.tagName;

            if ([
                "SCRIPT", "STYLE", "IFRAME",
                "SVG", "BUTTON", "INPUT",
                "TEXTAREA", "VIDEO", "AUDIO"
            ].includes(tag)) {
                return "";
            }

            if (tag === "IMG") {
                const src = node.currentSrc || node.src;

                if (src && /^https?:\/\//i.test(src)) {
                    return `<img src="${src}" alt="">`;
                }

                return "";
            }

            const allowed = [
                "P", "BR", "STRONG", "B", "EM", "I",
                "U", "UL", "OL", "LI", "PRE", "CODE",
                "BLOCKQUOTE", "H1", "H2", "H3", "H4",
                "TABLE", "THEAD", "TBODY", "TR", "TH",
                "TD", "A", "HR", "DEL", "S"
            ];

            const children = Array.from(node.childNodes)
                .map(clean)
                .join("");

            if (!allowed.includes(tag)) {
                return children;
            }

            if (tag === "A") {
                const href = node.href || "";
                if (/^https?:\/\//i.test(href)) {
                    return `<a href="${href}">${children}</a>`;
                }
                return children;
            }

            if (tag === "BR" || tag === "HR") {
                return `<${tag.toLowerCase()}>`;
            }

            return `<${tag.toLowerCase()}>${children}</${tag.toLowerCase()}>`;
        }

        // Strategy 1: Explicit message roles
        const roleElements = Array.from(
            document.querySelectorAll(
                '[data-message-author-role="user"],' +
                '[data-message-author-role="assistant"]'
            )
        );

        for (const element of roleElements) {
            const role = element.getAttribute(
                "data-message-author-role"
            );

            const content =
                element.querySelector(".markdown") ||
                element.querySelector(".whitespace-pre-wrap") ||
                element;

            const html = Array.from(content.childNodes)
                .map(clean)
                .join("");

            const text = content.innerText?.trim() || "";

            if (text && !seen.has(role + text)) {
                seen.add(role + text);
                results.push({ role, html, text });
            }
        }

        if (results.length > 0) {
            return {
                method: "message-role",
                messages: results
            };
        }

        // Strategy 2: Conversation turn containers
        const turns = Array.from(
            document.querySelectorAll(
                '[data-testid^="conversation-turn-"]'
            )
        );

        for (const turn of turns) {
            const user = turn.querySelector(
                '[data-message-author-role="user"]'
            );

            const assistant = turn.querySelector(
                '[data-message-author-role="assistant"]'
            );

            const element = user || assistant;

            if (!element) continue;

            const role = user ? "user" : "assistant";

            const content =
                element.querySelector(".markdown") || element;

            const html = Array.from(content.childNodes)
                .map(clean)
                .join("");

            const text = content.innerText?.trim() || "";

            if (text && !seen.has(role + text)) {
                seen.add(role + text);
                results.push({ role, html, text });
            }
        }

        if (results.length > 0) {
            return {
                method: "conversation-turn",
                messages: results
            };
        }

        // Strategy 3: Main content diagnostics.
        // Do not guess which blocks are questions or answers.
        const main = document.querySelector("main");

        return {
            method: "no-supported-message-selector",
            messages: [],
            diagnostics: {
                title: document.title,
                url: location.href,
                mainExists: !!main,
                mainText: main?.innerText?.slice(0, 5000) || "",
                bodyText: document.body?.innerText?.slice(0, 5000) || "",
                articleCount: document.querySelectorAll("article").length,
                turnCount: turns.length,
                roleCount: roleElements.length
            }
        };
    });
}

// Build normal Q&A PDF HTML
function buildPDF(messages) {

    const content = messages.map(message => {

        const label = message.role === "user" ? "Q." : "A.";

        return `
            <section class="message">
                <div class="label">${label}</div>
                <div class="content">${message.html}</div>
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
    margin: 18mm 17mm 20mm 17mm;
}

* { box-sizing: border-box; }

body {
    font-family: Arial, Helvetica, sans-serif;
    color: #222;
    font-size: 11pt;
    line-height: 1.6;
}

.title {
    text-align: center;
    font-size: 19pt;
    font-weight: bold;
    color: #000;
    margin-bottom: 28px;
    padding-bottom: 12px;
    border-bottom: 2px solid #222;
}

.message {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;
}

.label {
    width: 25px;
    min-width: 25px;
    font-weight: bold;
    font-size: 14pt;
    color: #000;
}

.content {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

p { margin: 0 0 10px; }

h1, h2, h3, h4 {
    color: #111;
    margin: 12px 0 8px;
}

ul, ol { padding-left: 25px; }

pre {
    background: #f3f3f3;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid #ddd;
}

code {
    background: #f3f3f3;
    padding: 2px 4px;
    font-family: Consolas, monospace;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
}

th, td {
    border: 1px solid #aaa;
    padding: 7px;
    text-align: left;
}

th { background: #eee; }

img {
    max-width: 100%;
    max-height: 500px;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 12px 0;
}

blockquote {
    border-left: 3px solid #888;
    padding-left: 12px;
    color: #444;
}

a { color: #222; }
</style>
</head>

<body>
<div class="title">QUESTION &amp; ANSWER NOTES</div>
${content}
</body>
</html>`;
}

// Export API
app.post("/api/export", async (req, res) => {

    let browser;

    try {
        const shareURL = validateURL(
            String(req.body?.url || "").trim()
        );

        console.log("Opening:", shareURL);

        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });

        const context = await browser.newContext({
            viewport: {
                width: 1280,
                height: 1000
            }
        });

        const page = await context.newPage();

        page.setDefaultNavigationTimeout(60000);

        // Log navigation without evaluating during navigation.
        page.on("framenavigated", frame => {
            if (frame === page.mainFrame()) {
                console.log("Navigation:", frame.url());
            }
        });

        page.on("pageerror", error => {
            console.log("Browser page error:", error.message);
        });

        // Open the shared conversation.
        const response = await page.goto(shareURL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        console.log(
            "HTTP status:",
            response ? response.status() : "unknown"
        );

        // Wait for client-side rendering.
        await page.waitForTimeout(8000);

        // Extract with retries.
        let extraction = null;

        for (let i = 1; i <= 5; i++) {

            console.log("Extraction attempt:", i);

            try {
                extraction = await extractMessages(page);

                if (extraction.messages.length > 0) {
                    break;
                }

            } catch (error) {
                console.log("Extraction error:", error.message);
            }

            await page.waitForTimeout(2000);
        }

        if (!extraction || extraction.messages.length === 0) {

            console.log(
                "PAGE DIAGNOSTICS:",
                JSON.stringify(
                    extraction?.diagnostics || {},
                    null,
                    2
                )
            );

            throw new Error(
                "No conversation messages detected. " +
                "Check PAGE DIAGNOSTICS in Render logs. " +
                "The share page may be blocked, incomplete, or using a new HTML structure."
            );
        }

        const messages = extraction.messages;

        const questions = messages.filter(
            m => m.role === "user"
        ).length;

        const answers = messages.filter(
            m => m.role === "assistant"
        ).length;

        console.log("Extraction method:", extraction.method);
        console.log("Questions:", questions);
        console.log("Answers:", answers);

        if (!questions || !answers) {
            throw new Error(
                `Incomplete conversation: ${questions} questions and ${answers} answers found.`
            );
        }

        // Create a separate PDF page.
        const pdfPage = await context.newPage();

        await pdfPage.setContent(buildPDF(messages), {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        // Wait for images.
        await pdfPage.evaluate(async () => {
            await Promise.all(
                Array.from(document.images).map(img => {

                    img.loading = "eager";

                    if (img.complete) {
                        return Promise.resolve();
                    }

                    return new Promise(resolve => {
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, 10000);
                    });
                })
            );
        });

        const pdfBuffer = await pdfPage.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: "<div></div>",
            footerTemplate: `
                <div style="
                    width:100%;
                    text-align:center;
                    font-family:Arial;
                    font-size:9px;
                    color:#777">
                    Page <span class="pageNumber"></span>
                    of <span class="totalPages"></span>
                </div>
            `,
            margin: {
                top: "18mm",
                bottom: "20mm",
                left: "17mm",
                right: "17mm"
            }
        });

        console.log("PDF ready:", pdfBuffer.length);

        await browser.close();
        browser = null;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="ChatGPT_Notes.pdf"'
        );
        res.setHeader("Content-Length", pdfBuffer.length);

        return res.send(pdfBuffer);

    } catch (error) {

        console.error("EXPORT ERROR:", error);

        if (browser) {
            await browser.close().catch(() => {});
        }

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
});

// Unknown route
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Error handling
app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err);

    if (!res.headersSent) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("ChatGPT to PDF server running on", PORT);
});
