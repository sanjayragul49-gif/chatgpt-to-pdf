
const express = require("express");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Validate public ChatGPT share URL
function validateURL(value) {
    try {
        const url = new URL(value);

        if (
            url.protocol !== "https:" ||
            !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname) ||
            !url.pathname.startsWith("/share/")
        ) {
            throw new Error("Invalid ChatGPT public share URL.");
        }

        return url.href;
    } catch (error) {
        throw new Error(error.message || "Invalid URL.");
    }
}

// Retry evaluation if ChatGPT navigates during execution
async function safeEvaluate(page, callback, attempts = 6) {
    let lastError;

    for (let i = 0; i < attempts; i++) {
        try {
            if (page.isClosed()) {
                throw new Error("Browser page was closed.");
            }

            return await page.evaluate(callback);

        } catch (error) {
            lastError = error;

            const message = String(error.message || "");

            const navigationError =
                message.includes("Execution context was destroyed") ||
                message.includes("Cannot find context") ||
                message.includes("Target closed") ||
                message.includes("Frame was detached");

            if (!navigationError) {
                throw error;
            }

            console.log(
                `Page navigation detected. Retrying ${i + 1}/${attempts}`
            );

            await page.waitForTimeout(1500);
        }
    }

    throw lastError;
}

// Extract conversation messages
async function extractConversation(page) {
    return await safeEvaluate(page, () => {

        const roles = [
            "user",
            "assistant"
        ];

        const elements = Array.from(
            document.querySelectorAll(
                '[data-message-author-role="user"], ' +
                '[data-message-author-role="assistant"]'
            )
        );

        const allowedTags = new Set([
            "P", "BR", "STRONG", "B", "EM", "I",
            "U", "S", "DEL", "UL", "OL", "LI",
            "PRE", "CODE", "BLOCKQUOTE",
            "H1", "H2", "H3", "H4", "H5",
            "TABLE", "THEAD", "TBODY", "TR",
            "TH", "TD", "IMG", "A", "HR",
            "SUP", "SUB"
        ]);

        function cleanNode(node) {

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
                const src =
                    node.currentSrc ||
                    node.getAttribute("src");

                if (!src || !/^https?:\/\//i.test(src)) {
                    return "";
                }

                return `<img src="${src}" alt="">`;
            }

            const children = Array.from(node.childNodes)
                .map(cleanNode)
                .join("");

            if (!allowedTags.has(tag)) {
                return children;
            }

            if (tag === "A") {
                const href = node.href || "";

                if (/^https?:\/\//i.test(href)) {
                    return `<a href="${href}">${children}</a>`;
                }

                return children;
            }

            return `<${tag.toLowerCase()}>${children}</${tag.toLowerCase()}>`;
        }

        return elements.map(element => {

            const role = element.getAttribute(
                "data-message-author-role"
            );

            if (!roles.includes(role)) return null;

            // Prefer the actual message content container
            const content =
                element.querySelector(".markdown") ||
                element.querySelector(".whitespace-pre-wrap") ||
                element;

            const html = Array.from(content.childNodes)
                .map(cleanNode)
                .join("");

            const text = content.innerText?.trim() || "";

            if (!text && !html.trim()) return null;

            return {
                role,
                html,
                text
            };

        }).filter(Boolean);
    });
}

// PDF styling and document layout
function buildPDF(messages) {

    const conversation = messages.map(message => {

        const isQuestion = message.role === "user";

        const label = isQuestion ? "Q." : "A.";

        return `
            <section class="message">

                <div class="label">${label}</div>

                <div class="content">
                    ${message.html}
                </div>

            </section>
        `;

    }).join("");

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<title>Question and Answer Notes</title>

<style>

@page {
    size: A4;
    margin: 18mm 17mm 20mm 17mm;
}

* {
    box-sizing: border-box;
}

body {
    font-family: Arial, Helvetica, sans-serif;
    color: #222;
    font-size: 11pt;
    line-height: 1.6;
    background: white;
}

.document-title {
    text-align: center;
    font-size: 19pt;
    font-weight: bold;
    color: black;
    margin-bottom: 28px;
    padding-bottom: 12px;
    border-bottom: 2px solid #222;
}

.message {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 22px;
}

.label {
    width: 25px;
    min-width: 25px;
    color: #000;
    font-weight: bold;
    font-size: 14pt;
}

.content {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

.content p {
    margin: 0 0 10px;
}

.content h1,
.content h2,
.content h3,
.content h4 {
    color: #111;
    margin: 13px 0 8px;
    line-height: 1.35;
}

.content h1 { font-size: 17pt; }
.content h2 { font-size: 15pt; }
.content h3 { font-size: 13pt; }

.content ul,
.content ol {
    padding-left: 25px;
}

.content li {
    margin-bottom: 5px;
}

.content img {
    max-width: 100%;
    height: auto;
    max-height: 500px;
    display: block;
    margin: 12px 0;
    object-fit: contain;
}

.content pre {
    background: #f3f3f3;
    border: 1px solid #ddd;
    padding: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 9pt;
}

.content code {
    background: #f3f3f3;
    font-family: Consolas, monospace;
    padding: 2px 4px;
}

.content table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 9pt;
}

.content th,
.content td {
    border: 1px solid #aaa;
    padding: 7px;
    text-align: left;
}

.content th {
    background: #eee;
}

.content blockquote {
    border-left: 3px solid #888;
    padding-left: 12px;
    margin-left: 0;
    color: #444;
}

.content a {
    color: #222;
    text-decoration: underline;
}

.content hr {
    border: 0;
    border-top: 1px solid #ccc;
}

@media print {
    .message {
        break-inside: auto;
    }

    img {
        break-inside: avoid;
    }
}

</style>
</head>

<body>

<div class="document-title">
    QUESTION &amp; ANSWER NOTES
</div>

${conversation}

</body>
</html>
`;
}

// PDF generation route
app.post("/api/export", async (req, res) => {

    let browser;

    try {

        const shareURL = validateURL(
            String(req.body?.url || "").trim()
        );

        console.log("================================");
        console.log("PDF GENERATION STARTED");
        console.log("================================");

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

        const sourcePage = await context.newPage();

        sourcePage.setDefaultTimeout(15000);

        // Monitor navigation events
        sourcePage.on("framenavigated", frame => {
            if (frame === sourcePage.mainFrame()) {
                console.log("Main page navigated:", frame.url());
            }
        });

        sourcePage.on("pageerror", error => {
            console.log("PAGE ERROR:", error.message);
        });

        console.log("Opening shared conversation...");

        try {
            await sourcePage.goto(shareURL, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
        } catch (error) {
            console.log("Initial navigation warning:", error.message);
        }

        // Allow redirects and client-side rendering to finish.
        await sourcePage.waitForTimeout(5000);

        // Wait until navigation has stopped changing.
        let previousURL = "";

        for (let i = 0; i < 5; i++) {

            if (sourcePage.isClosed()) {
                throw new Error("ChatGPT page was closed.");
            }

            const currentURL = sourcePage.url();

            if (currentURL === previousURL) {
                break;
            }

            previousURL = currentURL;

            await sourcePage.waitForTimeout(1500);
        }

        // Log page information
        let pageInfo;

        try {
            pageInfo = await safeEvaluate(sourcePage, () => ({
                title: document.title,
                url: location.href,
                text: document.body?.innerText?.slice(0, 1500) || "",
                roleCount: document.querySelectorAll(
                    "[data-message-author-role]"
                ).length
            }));
        } catch (error) {
            throw new Error(
                "Could not inspect ChatGPT page: " + error.message
            );
        }

        console.log("PAGE INFO:", JSON.stringify(pageInfo));

        // Check if this is an access or loading page.
        const pageText = pageInfo.text.toLowerCase();

        if (
            pageText.includes("access denied") ||
            pageText.includes("verify you are human") ||
            pageText.includes("unusual activity")
        ) {
            throw new Error(
                "ChatGPT blocked automated page access. " +
                "The public conversation could not be opened."
            );
        }

        console.log("Extracting conversation...");

        let messages = [];

        // Retry extraction if page is still rendering.
        for (let attempt = 1; attempt <= 8; attempt++) {

            console.log("Extraction attempt:", attempt);

            try {
                messages = await extractConversation(sourcePage);
            } catch (error) {
                console.log(
                    "Extraction retry:",
                    error.message
                );
            }

            if (messages.length > 0) {
                break;
            }

            await sourcePage.waitForTimeout(2000);
        }

        if (messages.length === 0) {
            throw new Error(
                "No conversation messages detected. " +
                "Check the PAGE INFO in Render logs. " +
                "ChatGPT may have changed its HTML structure."
            );
        }

        const questionCount = messages.filter(
            m => m.role === "user"
        ).length;

        const answerCount = messages.filter(
            m => m.role === "assistant"
        ).length;

        console.log("Questions:", questionCount);
        console.log("Answers:", answerCount);

        if (answerCount === 0) {
            throw new Error(
                "Assistant answers were not found."
            );
        }

        // Build a separate PDF page.
        const pdfPage = await context.newPage();

        console.log("Creating normal Q&A layout...");

        await pdfPage.setContent(
            buildPDF(messages),
            {
                waitUntil: "domcontentloaded",
                timeout: 60000
            }
        );

        // Load images in the PDF page.
        await pdfPage.evaluate(async () => {

            const images = Array.from(document.images);

            await Promise.all(images.map(img => {

                img.loading = "eager";

                if (img.complete) {
                    return Promise.resolve();
                }

                return new Promise(resolve => {

                    img.addEventListener("load", resolve, {
                        once: true
                    });

                    img.addEventListener("error", resolve, {
                        once: true
                    });

                    setTimeout(resolve, 12000);
                });
            }));
        });

        console.log("Generating A4 PDF...");

        const pdfBuffer = await pdfPage.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,

            margin: {
                top: "18mm",
                bottom: "20mm",
                left: "17mm",
                right: "17mm"
            },

            headerTemplate: "<div></div>",

            footerTemplate: `
                <div style="
                    width:100%;
                    text-align:center;
                    font-size:9px;
                    font-family:Arial;
                    color:#777;
                ">
                    Page
                    <span class="pageNumber"></span>
                    of
                    <span class="totalPages"></span>
                </div>
            `
        });

        console.log("PDF generated:", pdfBuffer.length, "bytes");

        await browser.close();
        browser = null;

        res.setHeader(
            "Content-Type",
            "application/pdf"
        );

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="ChatGPT_Notes.pdf"'
        );

        res.setHeader(
            "Content-Length",
            pdfBuffer.length
        );

        return res.send(pdfBuffer);

    } catch (error) {

        console.error("PDF ERROR:", error);

        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error("Browser close error:", closeError);
            }
        }

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
});

// Unknown routes
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Express error handler
app.use((err, req, res, next) => {

    console.error("SERVER ERROR:", err);

    if (!res.headersSent) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
});

// Start
app.listen(PORT, "0.0.0.0", () => {
    console.log("================================");
    console.log("CHATGPT TO PDF SERVER RUNNING");
    console.log("PORT:", PORT);
    console.log("================================");
});
