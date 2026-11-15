
const express = require("express");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "1mb" }));

// Website homepage
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Validate ChatGPT share URL
function isValidShareUrl(value) {
    try {
        const url = new URL(value);

        return (
            url.protocol === "https:" &&
            url.hostname === "chatgpt.com" &&
            url.pathname.startsWith("/share/")
        );
    } catch {
        return false;
    }
}

// PDF generation API
app.post("/api/export", async (req, res) => {

    const shareUrl = String(req.body?.url || "").trim();

    if (!isValidShareUrl(shareUrl)) {
        return res.status(400).json({
            error: "Enter a valid public ChatGPT share link."
        });
    }

    let browser;

    try {
        console.log("Opening ChatGPT conversation...");

        browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });

        const page = await browser.newPage({
            viewport: {
                width: 1440,
                height: 1000
            },
            deviceScaleFactor: 1
        });

        // Open shared conversation
        await page.goto(shareUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        console.log("Waiting for conversation...");

        // Wait for assistant answers
        await page.waitForFunction(() => {
            return document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            ).length > 0;
        }, { timeout: 45000 });

        // Wait for text to finish rendering
        await page.waitForTimeout(3000);

        // Scroll through the complete conversation
        await page.evaluate(async () => {

            const sleep = ms =>
                new Promise(resolve => setTimeout(resolve, ms));

            let previousHeight = 0;

            for (let i = 0; i < 40; i++) {

                window.scrollTo(
                    0,
                    document.body.scrollHeight
                );

                await sleep(500);

                const currentHeight =
                    document.body.scrollHeight;

                if (currentHeight === previousHeight) {
                    break;
                }

                previousHeight = currentHeight;
            }

            window.scrollTo(0, 0);
            await sleep(1000);
        });

        // Count user questions and assistant answers
        const counts = await page.evaluate(() => {

            const questions = document.querySelectorAll(
                '[data-message-author-role="user"]'
            ).length;

            const answers = document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            ).length;

            return { questions, answers };
        });

        console.log("Questions:", counts.questions);
        console.log("Answers:", counts.answers);

        if (counts.answers === 0) {
            throw new Error(
                "No assistant answers found. Check the public share page."
            );
        }

        // Wait for available images to load
        await page.evaluate(async () => {

            const images = Array.from(document.images);

            await Promise.all(
                images.map(img => {
                    if (img.complete) return Promise.resolve();

                    return new Promise(resolve => {
                        img.addEventListener("load", resolve, {
                            once: true
                        });

                        img.addEventListener("error", resolve, {
                            once: true
                        });
                    });
                })
            );
        });

        console.log("Generating PDF...");

        // Generate A4 PDF
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: false,
            displayHeaderFooter: true,

            margin: {
                top: "15mm",
                bottom: "15mm",
                left: "12mm",
                right: "12mm"
            },

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
            `
        });

        console.log("PDF generated successfully!");

        res.setHeader(
            "Content-Type",
            "application/pdf"
        );

        res.setHeader(
            "Content-Disposition",
            'attachment; filename="ChatGPT_Conversation.pdf"'
        );

        res.setHeader(
            "Content-Length",
            pdfBuffer.length
        );

        res.send(pdfBuffer);

    } catch (error) {

        console.error("PDF ERROR:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: error.message ||
                    "Unable to generate PDF."
            });
        }

    } finally {

        if (browser) {
            await browser.close().catch(console.error);
        }
    }
});

// Handle unknown routes
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Error handler
app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err);

    if (!res.headersSent) {
        res.status(400).json({
            error: "Invalid request."
        });
    }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
