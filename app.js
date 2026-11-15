const form = document.getElementById("exportForm");
const input = document.getElementById("shareUrl");
const button = document.getElementById("exportBtn");
const statusBox = document.getElementById("status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = input.value.trim();

  button.disabled = true;
  button.innerHTML = "Preparing your PDF...";
  statusBox.className = "status";
  statusBox.textContent = "Opening the shared conversation and loading its content. Please wait.";

  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "PDF generation failed.");
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "ChatGPT_Conversation.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    statusBox.className = "status success";
    statusBox.textContent = "Your PDF is ready and the download has started.";
  } catch (error) {
    statusBox.className = "status error";
    statusBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>↓</span> Generate PDF";
  }
});
