import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.urlencoded({ extended: false }));

const page_html = (error = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatGPT Link to PDF</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1a1d21;--muted:#6b7280;--accent:#10a37f;--err:#c0392b}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1d2026;--text:#eceef1;--muted:#9aa1ab;--err:#ff7b6b}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font-family:system-ui,sans-serif}
.card{background:var(--card);padding:28px;border-radius:16px;width:min(560px,92vw);box-shadow:0 8px 30px #0001}
h1{margin:0 0 6px;font-size:1.5rem}p{color:var(--muted);margin:0 0 18px}
input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #8884;border-radius:10px;font-size:1rem;background:transparent;color:var(--text)}
button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:1rem}
button:disabled{opacity:.6}.err{color:var(--err);margin-top:14px;word-break:break-word}
</style></head><body><div class="card">
<h1>ChatGPT Link → PDF</h1>
<p>Share link paste pannunga. Questions + answers + images PDF-a varum.</p>
<form method="post" action="/convert" onsubmit="b.disabled=true;b.textContent='PDF ready aagudhu... (30-90 sec) wait pannunga'">
<input name="url" placeholder="https://chatgpt.com/share/..." required>
<button id="b">Create PDF</button></form>
${error ? `<div class="err">${error}</div>` : ""}
<p style="margin:18px 0 0;font-size:12px">version v3</p>
</div></body></html>`;

// runs inside the browser: rebuild a clean page with ALL turns (questions + answers + images)
const REBUILD = () => {
  let turns = [...document.querySelectorAll('[data-testid^="conversation-turn"]')];
  if (!turns.length) turns = [...document.querySelectorAll("[data-message-author-role]")];
  if (!turns.length) turns = [...document.querySelectorAll("article")];
  if (!turns.length) {
    const main = document.querySelector("main");
    if (!main) return 0;
    turns = [main];
  }
  const wrap = document.createElement("div");
  wrap.id = "export";
  const h = document.createElement("h1");
  h.textContent = document.title.replace(/^ChatGPT\s*-\s*/, "");
  wrap.append(h);
  let n = 0;
  for (const t of turns) {
    const roleEl = t.matches("[data-message-author-role]") ? t : t.querySelector("[data-message-author-role]");
    const role = roleEl ? roleEl.getAttribute("data-message-author-role") : "assistant";
    const box = document.createElement("section");
    box.className = "msg " + role;
    const label = document.createElement("div");
    label.className = "role";
    label.textContent = role === "user" ? "You" : "ChatGPT";
    box.append(label, t);   // move node: loaded images stay loaded
    wrap.append(box);
    n++;
  }
  document.documentElement.className = "light";
  document.documentElement.style.cssText = "background:#fff;color-scheme:light";
  document.body.replaceChildren(wrap);
  document.body.style.cssText = "background:#fff;margin:0;height:auto;overflow:visible";
  const css = document.createElement("style");
  css.textContent = `
    #export{font:15px/1.6 system-ui,sans-serif;max-width:800px;margin:0 auto;padding:8px;color:#111}
    #export h1{font-size:22px;margin:0 0 14px}
    #export *{content-visibility:visible !important;opacity:1 !important;color:#111 !important;max-height:none !important;overflow:visible !important}
    #export button,#export svg{display:none !important}
    #export .msg{margin:0 0 14px;padding:10px 14px;border-radius:10px;break-inside:auto}
    #export .msg.user{background:#eef1f5}
    #export .role{font-weight:700;font-size:12px;text-transform:uppercase;color:#555 !important;margin-bottom:4px}
    #export img{max-width:100%;height:auto;break-inside:avoid}
    #export pre{background:#f3f4f6;padding:10px;border-radius:8px;white-space:pre-wrap !important;word-break:break-word}
    #export table{border-collapse:collapse}#export td,#export th{border:1px solid #ccc;padding:4px 8px}
  `;
  document.head.append(css);
  return n;
};

const EXPAND = () => {
  document.querySelectorAll("*").forEach((el) => {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20) {
      el.style.overflow = "visible"; el.style.height = "auto"; el.style.maxHeight = "none";
    }
    if (s.position === "fixed" || s.position === "sticky") el.style.position = "static";
  });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function makePdf(url) {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("[data-message-author-role]", { timeout: 25000 }).catch(() => {});
    // bring every message into view so lazy/virtualised answers + images render
    for (let round = 0; round < 2; round++) {
      const count = await page.evaluate(() => document.querySelectorAll("[data-message-author-role]").length);
      for (let i = 0; i < count; i++) {
        await page.evaluate((i) => document.querySelectorAll("[data-message-author-role]")[i]?.scrollIntoView({ block: "center" }), i);
        await sleep(250);
      }
    }
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")));
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 30000 }).catch(() => {});
    await sleep(800);
    const n = await page.evaluate(REBUILD);
    if (!n) await page.evaluate(EXPAND); // fallback: print page as-is
    await page.emulateMedia({ media: "screen" });
    return await page.pdf({
      format: "A4", printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
  } finally {
    await browser.close();
  }
}

app.get("/", (_req, res) => res.send(page_html()));

// /debug?url=https://chatgpt.com/share/xxxx  -> shows what the browser actually sees
app.get("/debug", async (req, res) => {
  const url = String(req.query.url || "").split("?")[0];
  if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/share\//.test(url)) return res.status(400).send("bad url");
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await sleep(3000);
    const info = await page.evaluate(() => ({
      title: document.title,
      turns: document.querySelectorAll('[data-testid^="conversation-turn"]').length,
      roles: [...document.querySelectorAll("[data-message-author-role]")].map((e) => e.getAttribute("data-message-author-role") + ":" + e.innerText.length),
      articles: document.querySelectorAll("article").length,
      images: document.images.length,
      textLength: document.body.innerText.length,
      textStart: document.body.innerText.slice(0, 600),
    }));
    res.json(info);
  } catch (e) {
    res.status(500).send(String(e.message).split("\n")[0]);
  } finally {
    await browser.close();
  }
});

app.post("/convert", async (req, res) => {
  let url = String(req.body.url || "").trim().split("?")[0].split("#")[0];
  if (url && !url.startsWith("http")) url = "https://" + url;
  if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/share\/(e\/)?[\w-]+\/?$/.test(url))
    return res.status(400).send(page_html("Valid ChatGPT share link venum (https://chatgpt.com/share/...)."));
  if (busy) return res.status(429).send(page_html("Innoru PDF ready aagudhu. 1 minute kalichu try pannunga."));
  busy = true;
  try {
    const pdf = await makePdf(url);
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="chatgpt-chat.pdf"' });
    res.send(pdf);
  } catch (e) {
    res.status(500).send(page_html("Failed: " + String(e.message).split("\n")[0]));
  } finally {
    busy = false;
  }
});

app.listen(process.env.PORT || 3000, () => console.log("running"));
