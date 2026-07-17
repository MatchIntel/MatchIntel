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

    document.title = `${config.siteName || "MatchIntel"} — Fortnite Tournament Intelligence`;
    document.getElementById("trialDays").textContent = String(config.freeTrialDays || 3);
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
    const health = await fetch("/health", { cache: "no-store" });
    if (health.ok) document.getElementById("serviceStatus").textContent = "SYSTEMS ONLINE";
  } catch {
    document.getElementById("serviceStatus").textContent = "WEBSITE ONLINE";
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
