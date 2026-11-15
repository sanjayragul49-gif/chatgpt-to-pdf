# ChatGPT to PDF website

A small Node.js website that accepts a **public** ChatGPT share URL and prints the rendered shared page to an A4 PDF. It uses Playwright (Chromium) so images and page layout can be included as rendered by the browser.

## Requirements
- Node.js 18 or newer
- Internet access on the server to open public ChatGPT share pages

## Run locally

```bash
npm install
npx playwright install chromium
npm start
```

Open http://localhost:3000

## Important limitations
- Only public `https://chatgpt.com/share/...` links are accepted.
- It cannot access private chats, account history, or content hidden behind login/permissions.
- It exports what the public share page renders. Some lazy-loaded, blocked, or unavailable images may not appear.
- ChatGPT may change its page structure or access rules, which can affect export reliability.
- For public deployment, add rate limiting, request timeouts, authentication, and abuse protection. Do not expose an unrestricted browser-rendering endpoint to the internet.


## Deploy online with Render (phone-friendly route)

1. Create a GitHub account and a new **public or private** repository.
2. Upload all project files from this folder to that repository (keep `Dockerfile` at the repository root).
3. Sign in to Render and choose **New → Web Service**.
4. Connect the GitHub repository. Render should detect the Dockerfile.
5. Choose an appropriate paid instance for browser/PDF workloads, then deploy.
6. After deployment, open the `onrender.com` URL on your phone.

The app uses a headless Chromium browser to render a shared ChatGPT page. Free/small instances may run out of memory or have cold starts; check the host's current limits and pricing before publishing. Do not share secrets in a public repository.
