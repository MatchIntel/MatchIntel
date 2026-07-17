(() => {
  "use strict";
  const button = document.getElementById("copyKey");
  const key = document.getElementById("licenseKey");
  if (!button || !key) return;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(key.textContent.trim());
      button.textContent = "Copied to clipboard";
      setTimeout(() => { button.textContent = "Copy license key"; }, 1800);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(key);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "Key selected — press Copy";
    }
  });
})();
