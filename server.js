const express = require("express");
const { chromium } = require("playwright");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function validShareUrl(value) {
  try {
    const u = new URL(value);
    return (u.hostname === "chatgpt.com" || u.hostname === "www.chatgpt.com")
      && u.pathname.startsWith("/share/");
  } catch {
    return false;
  }
}

app.post("/api/export", async (req, res) => {
  const shareUrl = String(req.body?.url || "").trim();

  if (!validShareUrl(shareUrl)) {
    return res.status(400).json({
      error: "Please enter a valid public ChatGPT share link (https://chatgpt.com/share/...)."
    });
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1
    });

    await page.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    // Scroll gradually so images and other lazy-loaded content can appear.
    await page.evaluate(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      let previousHeight = 0;
      for (let i = 0; i < 35; i++) {
        const height = document.body.scrollHeight;
        window.scrollTo(0, height);
        await pause(450);
        if (height === previousHeight && i > 2) break;
        previousHeight = height;
      }
      window.scrollTo(0, 0);
      await pause(700);
    });

    await page.waitForFunction(() =>
      Array.from(document.images).every(img => img.complete || !img.src),
      { timeout: 15000 }
    ).catch(() => {});

    const title = await page.title().catch(() => "ChatGPT Conversation");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#777;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
    });

    const safeName = title.replace(/[^\w\- ]/g, "").trim().slice(0, 60) || "ChatGPT_Conversation";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Could not export this page. Check that the share link is public and try again."
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ChatGPT to PDF running at http://localhost:${PORT}`));
