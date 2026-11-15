
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

function validateURL(value) {
    const url = new URL(value);

    if (
        url.protocol !== "https:" ||
        !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname) ||
        !url.pathname.startsWith("/share/")
    ) {
        throw new Error("Invalid ChatGPT share URL");
    }

    return url.href;
}

// Extract visible conversation from the current page structure
async function extractContent(page) {
    return await page.evaluate(() => {

        const main = document.querySelector("main");

        if (!main) {
            return {
                messages: [],
                fallback: "",
                error: "Main content not found"
            };
        }

        const messages = [];

        const selectors = [
            '[data-message-author-role="user"]',
            '[data-message-author-role="assistant"]',
            '[data-testid^="conversation-turn-"]',
            '[data-message-id]'
        ];

        const found = new Set();

        for (const selector of selectors) {
            main.querySelectorAll(selector).forEach(element => {
                if (found.has(element)) return;
                found.add(element);

                const role =
                    element.getAttribute("data-message-author-role") ||
                    element.getAttribute("data-author");

                if (role !== "user" && role !== "assistant") return;

                const content =
                    element.querySelector(".markdown") ||
                    element.querySelector(".prose") ||
                    element;

                const html = content.innerHTML;
                const text = content.innerText?.trim() || "";

                if (text) {
                    messages.push({
                        role,
                        text,
                        html
                    });
                }
            });
        }

        // If no message attributes exist, extract the actual main content.
        // Do not invent user/assistant roles.
        let fallback = "";

        if (messages.length === 0) {
            const clone = main.cloneNode(true);

            clone.querySelectorAll(
                "script,style,button,nav,svg,iframe,input,textarea"
            ).forEach(el => el.remove());

            // Remove suggested prompts and page navigation.
            clone.querySelectorAll(
                '[data-testid*="suggested"],' +
                '[data-testid*="composer"],' +
                '[data-testid*="prompt"]'
            ).forEach(el => el.remove());

            fallback = clone.innerHTML;
        }

        const images = Array.from(main.querySelectorAll("img"))
            .map(img => ({
                src: img.currentSrc || img.src,
                alt: img.alt || ""
            }))
            .filter(img => /^https?:\/\//i.test(img.src));

        return {
            messages,
            fallback,
            images,
            title: document.title,
            pageText: main.innerText || ""
        };
    });
}

// PDF document template
function makePDF(data) {

    let content = "";

    if (data.messages.length > 0) {

        content = data.messages.map(message => {

            const label = message.role === "user" ? "Q." : "A.";

            return `
                <section class="message">
                    <div class="label">${label}</div>
                    <div class="content">${message.html}</div>
                </section>
            `;
        }).join("");

    } else {

        content = `
            <section class="message">
                <div class="label">Content</div>
                <div class="content">${data.fallback}</div>
            </section>
        `;
    }

    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<style>
@page {
    size: A4;
    margin: 18mm 17mm 20mm;
}

* {
    box-sizing: border-box;
}

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
    padding-bottom: 12px;
    border-bottom: 2px solid #222;
    margin-bottom: 25px;
}

.message {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;
}

.label {
    width: 45px;
    min-width: 45px;
    font-size: 14pt;
    font-weight: bold;
    color: black;
}

.content {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
}

p {
    margin: 0 0 10px;
}

h1,h2,h3,h4 {
    color: #111;
    margin: 12px 0 8px;
}

ul,ol {
    padding-left: 25px;
}

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

td,th {
    border: 1px solid #aaa;
    padding: 7px;
    text-align: left;
}

th {
    background: #eee;
}

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
}

a {
    color: #222;
}
</style>
</head>

<body>
    <div class="title">QUESTION &amp; ANSWER NOTES</div>
    ${content}
</body>
</html>`;
}

// Export route
app.post("/api/export", async (req, res) => {

    let browser;

    try {

        const shareURL = validateURL(req.body?.url || "");

        console.log("Opening ChatGPT share page:", shareURL);

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

        const response = await page.goto(shareURL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        console.log(
            "HTTP Status:",
            response?.status()
        );

        // Wait for page rendering
        await page.waitForTimeout(7000);

        let data = null;

        for (let attempt = 1; attempt <= 5; attempt++) {

            console.log("Extraction attempt:", attempt);

            try {
                data = await extractContent(page);

                if (
                    data.messages.length > 0 ||
                    data.fallback.trim().length > 0
                ) {
                    break;
                }

            } catch (error) {
                console.log("Retry:", error.message);
            }

            await page.waitForTimeout(2000);
        }

        if (!data) {
            throw new Error("Could not read the ChatGPT page.");
        }

        console.log("Page title:", data.title);
        console.log("Messages found:", data.messages.length);
        console.log("Images found:", data.images.length);
        console.log("Fallback content:", data.fallback.length);

        if (
            data.messages.length === 0 &&
            !data.fallback.trim()
        ) {
            throw new Error("No visible conversation content found.");
        }

        if (data.messages.length > 0) {

            const questions = data.messages.filter(
                m => m.role === "user"
            ).length;

            const answers = data.messages.filter(
                m => m.role === "assistant"
            ).length;

            console.log("Questions:", questions);
            console.log("Answers:", answers);

            if (answers === 0) {
                console.log(
                    "WARNING: No assistant answers are present in the extracted page."
                );
            }
        }

        // Generate PDF
        const pdfPage = await context.newPage();

        await pdfPage.setContent(
            makePDF(data),
            {
                waitUntil: "domcontentloaded",
                timeout: 60000
            }
        );

        // Load images
        await pdfPage.evaluate(async () => {

            await Promise.all(
                Array.from(document.images).map(img => {

                    if (img.complete) {
                        return Promise.resolve();
                    }

                    return new Promise(resolve => {

                        img.onload = resolve;
                        img.onerror = resolve;

                        setTimeout(resolve, 12000);
                    });
                })
            );
        });

        const pdf = await pdfPage.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,

            headerTemplate: "<div></div>",

            footerTemplate: `
                <div style="
                    width:100%;
                    text-align:center;
                    font-size:9px;
                    color:#777;
                ">
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

        await browser.close();
        browser = null;

        res.setHeader("Content-Type", "application/pdf");

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="ChatGPT_Notes.pdf"'
        );

        res.setHeader("Content-Length", pdf.length);

        return res.send(pdf);

    } catch (error) {

        console.error("PDF ERROR:", error);

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

app.use((req, res) => {
    res.status(404).send("Page not found");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("ChatGPT PDF server running on port", PORT);
});
