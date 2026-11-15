
const express = require("express");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.sendFile(require("path").join(__dirname, "public", "index.html"));
});

// Check that the submitted URL is a public ChatGPT share link.
function validateShareUrl(value) {
    let parsed;

    try {
        parsed = new URL(value);
    } catch {
        throw new Error("Please enter a valid ChatGPT share URL.");
    }

    const allowedHosts = [
        "chatgpt.com",
        "www.chatgpt.com"
    ];

    if (
        !allowedHosts.includes(parsed.hostname) ||
        !parsed.pathname.startsWith("/share/")
    ) {
        throw new Error(
            "Only public ChatGPT share links are supported."
        );
    }

    return parsed.toString();
}

// Escape plain text before inserting it into the PDF.
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Extract only safe HTML elements from the shared page.
async function extractMessages(page) {
    return await page.evaluate(() => {
        const allowedTags = new Set([
            "P", "BR", "STRONG", "B", "EM", "I",
            "U", "S", "DEL", "UL", "OL", "LI",
            "PRE", "CODE", "BLOCKQUOTE",
            "H1", "H2", "H3", "H4", "H5", "H6",
            "TABLE", "THEAD", "TBODY", "TR",
            "TH", "TD", "IMG", "A", "HR"
        ]);

        function safeHTML(node) {
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

            // Ignore scripts, styles and embedded content.
            if (
                ["SCRIPT", "STYLE", "IFRAME", "OBJECT",
                 "SVG", "VIDEO", "AUDIO"].includes(tag)
            ) {
                return "";
            }

            const children = Array.from(node.childNodes)
                .map(child => safeHTML(child))
                .join("");

            if (!allowedTags.has(tag)) {
                return children;
            }

            if (tag === "IMG") {
                const src = node.src || node.getAttribute("src");

                if (!src || !/^https?:\/\//i.test(src)) {
                    return "";
                }

                const alt = (node.alt || "")
                    .replace(/&/g, "&amp;")
                    .replace(/"/g, "&quot;");

                return `<img src="${src}" alt="${alt}">`;
            }

            if (tag === "A") {
                const href = node.href || "";

                if (!/^https?:\/\//i.test(href)) {
                    return children;
                }

                return `<a href="${href}">${children}</a>`;
            }

            return `<${tag.toLowerCase()}>${children}</${tag.toLowerCase()}>`;
        }

        const messages = [];

        // Main supported ChatGPT message selectors.
        const roleElements = Array.from(
            document.querySelectorAll(
                '[data-message-author-role="user"], ' +
                '[data-message-author-role="assistant"]'
            )
        );

        for (const element of roleElements) {
            const role = element.getAttribute(
                "data-message-author-role"
            );

            if (role !== "user" && role !== "assistant") {
                continue;
            }

            const html = Array.from(element.childNodes)
                .map(child => safeHTML(child))
                .join("");

            const text = element.innerText?.trim() || "";

            if (text || html.trim()) {
                messages.push({
                    role,
                    text,
                    html
                });
            }
        }

        return messages;
    });
}

// Generate a clean, normal A4 PDF.
function createPdfHTML(messages) {
    const content = messages.map((message, index) => {
        const label = message.role === "user" ? "Q." : "A.";
        const safeContent = message.html ||
            `<p>${escapeHtml(message.text)}</p>`;

        return `
            <section class="message">
                <div class="label">${label}</div>
                <div class="content">${safeContent}</div>
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
        margin: 18mm 17mm 18mm 17mm;
    }

    * {
        box-sizing: border-box;
    }

    body {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11pt;
        line-height: 1.55;
        color: #222;
        background: #fff;
        margin: 0;
    }

    .message {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 20px;
        page-break-inside: avoid;
        break-inside: avoid;
    }

    .label {
        width: 24px;
        min-width: 24px;
        font-weight: bold;
        color: #000;
        font-size: 11pt;
    }

    .content {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    p {
        margin: 0 0 9px 0;
    }

    h1, h2, h3, h4 {
        color: #111;
        margin: 12px 0 8px;
        page-break-after: avoid;
    }

    ul, ol {
        padding-left: 24px;
        margin: 6px 0 12px;
    }

    li {
        margin-bottom: 4px;
    }

    pre {
        background: #f3f3f3;
        border: 1px solid #ddd;
        padding: 10px;
        border-radius: 4px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: Consolas, monospace;
        font-size: 9pt;
    }

    code {
        font-family: Consolas, monospace;
        background: #f3f3f3;
        padding: 2px 4px;
        overflow-wrap: anywhere;
    }

    pre code {
        padding: 0;
        background: transparent;
    }

    blockquote {
        border-left: 3px solid #aaa;
        margin: 8px 0;
        padding: 4px 12px;
        color: #444;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0;
        font-size: 9pt;
        page-break-inside: auto;
    }

    tr {
        page-break-inside: avoid;
    }

    th, td {
        border: 1px solid #ccc;
        padding: 6px;
        text-align: left;
    }

    th {
        background: #eee;
        font-weight: bold;
    }

    img {
        display: block;
        max-width: 100%;
        max-height: 500px;
        height: auto;
        object-fit: contain;
        margin: 8px 0;
    }

    a {
        color: #222;
        text-decoration: underline;
        overflow-wrap: anywhere;
    }

    hr {
        border: none;
        border-top: 1px solid #ddd;
        margin: 12px 0;
    }
</style>
</head>

<body>
    ${content}
</body>
</html>
`;
}

// Export endpoint.
app.post("/api/export", async (req, res) => {
    let browser;

    try {
        const shareUrl = validateShareUrl(req.body?.url || "");

        console.log("Starting PDF export...");
        console.log("Share URL:", shareUrl);

        browser = await chromium.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]
        });

        const sourcePage = await browser.newPage({
            viewport: {
                width: 1280,
                height: 900
            }
        });

        sourcePage.setDefaultNavigationTimeout(60000);

        // Open the public share page.
        const response = await sourcePage.goto(shareUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        console.log(
            "Share page HTTP status:",
            response ? response.status() : "No response"
        );

        // Allow the page time to render its conversation.
        await sourcePage.waitForTimeout(7000);

        // Diagnose the page before attempting extraction.
        const pageInfo = await sourcePage.evaluate(() => ({
            title: document.title,
            url: location.href,
            bodyText: document.body?.innerText?.slice(0, 2000) || "",
            roleCount: document.querySelectorAll(
                "[data-message-author-role]"
            ).length,
            turnCount: document.querySelectorAll(
                '[data-testid^="conversation-turn-"]'
            ).length,
            articleCount: document.querySelectorAll("main article").length
        }));

        console.log("PAGE INFO:", JSON.stringify(pageInfo, null, 2));

        // Wait briefly for message elements without a long blocking timeout.
        let messages = [];

        for (let attempt = 0; attempt < 10; attempt++) {
            messages = await extractMessages(sourcePage);

            if (messages.length > 0) {
                break;
            }

            await sourcePage.waitForTimeout(1000);
        }

        console.log("Extracted message count:", messages.length);

        if (messages.length === 0) {
            throw new Error(
                "No ChatGPT messages were detected. Check PAGE INFO in Render logs. " +
                "The share page may not have loaded, may require access, or its HTML structure may have changed."
            );
        }

        const questionCount = messages.filter(
            item => item.role === "user"
        ).length;

        const answerCount = messages.filter(
            item => item.role === "assistant"
        ).length;

        console.log("Questions:", questionCount);
        console.log("Answers:", answerCount);

        // Build the PDF in a separate page.
        const pdfPage = await browser.newPage();

        await pdfPage.setContent(createPdfHTML(messages), {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        // Give remote images a chance to load.
        await pdfPage.waitForTimeout(1500);

        const pdfBuffer = await pdfPage.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: "<div></div>",
            footerTemplate: `
                <div style="
                    width: 100%;
                    text-align: center;
                    font-family: Arial;
                    font-size: 8px;
                    color: #777;
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

        console.log("PDF generated successfully.");

        res.setHeader(
            "Content-Type",
            "application/pdf"
        );

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="chatgpt-conversation.pdf"'
        );

        res.setHeader(
            "Content-Length",
            pdfBuffer.length
        );

        return res.send(pdfBuffer);

    } catch (error) {
        console.error("PDF EXPORT ERROR:", error);

        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error("Browser close error:", closeError);
            }
        }

        return res.status(500).json({
            success: false,
            error: error.message || "PDF generation failed."
        });
    }
});

// Start server.
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
