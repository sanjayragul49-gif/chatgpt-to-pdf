
let previewedURL = "";

async function previewConversation() {

    const url = document
        .getElementById("shareUrl")
        .value.trim();

    const status = document.getElementById("status");
    const previewBtn = document.getElementById("previewBtn");
    const pdfBtn = document.getElementById("pdfBtn");

    if (!url) {
        status.textContent = "Please paste a ChatGPT link.";
        return;
    }

    previewBtn.disabled = true;
    pdfBtn.disabled = true;

    previewedURL = "";

    status.textContent =
        "Loading questions and answers...";

    document.getElementById("previewSection").hidden = true;

    try {

        const response = await fetch("/api/preview", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error);
        }

        const messages = document.getElementById("messages");

        messages.replaceChildren();

        document.getElementById("conversationTitle")
            .textContent = data.title;

        document.getElementById("counts").textContent =
            `${data.questionCount} Questions | ${data.answerCount} Answers`;

        data.messages.forEach(message => {

            const card = document.createElement("div");

            card.className =
                message.role === "user"
                    ? "message question"
                    : "message answer";

            const heading = document.createElement("h4");

            heading.textContent =
                message.label + " " + message.id;

            const text = document.createElement("div");

            text.className = "message-content";
            text.textContent = message.text;

            card.append(heading, text);

            messages.appendChild(card);

        });

        const warning = document.getElementById("warning");

        warning.textContent =
            data.answerCount > 0
                ? "Answers detected. Check the preview before downloading."
                : "No answers detected.";

        document.getElementById("previewSection").hidden = false;

        previewedURL = url;

        pdfBtn.disabled = data.answerCount === 0;

        status.textContent =
            "Preview loaded successfully.";

        status.style.color = "green";

        document.getElementById("previewSection")
            .scrollIntoView({ behavior: "smooth" });

    } catch (error) {

        status.textContent = error.message;
        status.style.color = "red";

    } finally {

        previewBtn.disabled = false;

    }
}

async function downloadPDF() {

    const url = document
        .getElementById("shareUrl")
        .value.trim();

    const status = document.getElementById("status");
    const pdfBtn = document.getElementById("pdfBtn");

    if (!previewedURL || previewedURL !== url) {
        status.textContent =
            "Please preview this link again before downloading.";
        return;
    }

    pdfBtn.disabled = true;

    status.textContent = "Generating PDF...";

    try {

        const response = await fetch("/api/export", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({ url })

        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        const blob = await response.blob();

        const objectURL = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = objectURL;
        link.download = "ChatGPT_Conversation.pdf";

        document.body.appendChild(link);

        link.click();

        link.remove();

        URL.revokeObjectURL(objectURL);

        status.textContent = "PDF downloaded successfully!";
        status.style.color = "green";

    } catch (error) {

        status.textContent = error.message;
        status.style.color = "red";

    } finally {

        pdfBtn.disabled = false;

    }
}
