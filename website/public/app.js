(async () => {
  "use strict";

  document.getElementById("year").textContent = String(new Date().getFullYear());

  const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        }
      }, { threshold: 0.12 })
    : null;

  for (const element of document.querySelectorAll(".reveal")) {
    if (revealObserver) revealObserver.observe(element);
    else element.classList.add("visible");
  }

  try {
    const response = await fetch("/api/site-config", { cache: "no-store" });
    if (!response.ok) throw new Error("Config unavailable");
    const config = await response.json();

    document.title = `${config.siteName || "MatchIntel"} — See the Whole Lobby`;
    document.getElementById("trialDays").textContent = String(config.freeTrialDays || 2);
    document.getElementById("lifetimePrice").textContent = config.lifetimePriceLabel || "Lifetime access";

    setLinks(".discord-link", config.discordInviteUrl, "#support");
    setLinks(".lifetime-link", config.lifetimeBuyUrl, "#support");
    setLinks(".download-link", config.downloadUrl, "#support");

    const supportUrl = config.supportUrl
      || (config.supportEmail ? `mailto:${config.supportEmail}` : "")
      || config.discordInviteUrl
      || "#support";
    setLinks(".support-link", supportUrl, "#support");
  } catch {
    document.getElementById("serviceStatus").textContent = "WEBSITE ONLINE";
  }

  try {
    const statusResponse = await fetch("/api/status", { cache: "no-store" });
    const status = statusResponse.ok ? await statusResponse.json() : null;
    document.getElementById("serviceStatus").textContent = status?.trials === "online"
      ? "TRIAL SYSTEM ONLINE"
      : "TRIALS TEMPORARILY OFFLINE";
  } catch {
    document.getElementById("serviceStatus").textContent = "WEBSITE ONLINE";
  }



  const evidenceDialog = document.getElementById("evidenceDialog");
  const evidenceDialogImage = document.getElementById("evidenceDialogImage");
  const evidenceDialogCaption = document.getElementById("evidenceDialogCaption");

  if (evidenceDialog && evidenceDialogImage && evidenceDialogCaption) {
    for (const trigger of document.querySelectorAll("[data-evidence-image]")) {
      trigger.addEventListener("click", () => {
        evidenceDialogImage.src = trigger.dataset.evidenceImage || "";
        evidenceDialogImage.alt = trigger.dataset.evidenceAlt || "Epic Games Support screenshot";
        evidenceDialogCaption.textContent = trigger.dataset.evidenceCaption || "Epic Games Support conversation";
        evidenceDialog.showModal();
      });
    }

    evidenceDialog.querySelector(".evidence-close")?.addEventListener("click", () => evidenceDialog.close());
    evidenceDialog.addEventListener("click", event => {
      if (event.target === evidenceDialog) evidenceDialog.close();
    });
    evidenceDialog.addEventListener("close", () => {
      evidenceDialogImage.removeAttribute("src");
    });
  }

  function setLinks(selector, url, fallback) {
    for (const element of document.querySelectorAll(selector)) {
      element.href = url || fallback;
      if (url?.startsWith("http")) {
        element.target = "_blank";
        element.rel = "noreferrer";
      }
    }
  }
})();
