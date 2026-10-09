(() => {
  const YOKEFELLOW_ORIGIN = "https://yokefellow1-web.vercel.app";
  const walletLabel = document.querySelector("#wallet-label");
  if (!walletLabel) return;

  let lastWallet = "";
  let requestGeneration = 0;

  function shortWallet(wallet) {
    return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function currentWallet() {
    if (!window.ethereum?.request) return "";
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      const wallet = String(accounts?.[0] || "").toLowerCase();
      return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : "";
    } catch {
      return "";
    }
  }

  function renderFallback(wallet) {
    walletLabel.textContent = wallet ? shortWallet(wallet) : "";
    walletLabel.removeAttribute("title");
  }

  function renderCard(wallet, card) {
    const displayName = String(card?.displayName || card?.handle || "").trim();
    const handle = String(card?.handle || "").trim().replace(/^@/, "");
    const avatarUrl = String(card?.avatarUrl || card?.profilePictureOutput?.imageUrl || "").trim();
    const profileUrl = String(card?.profileUrl || "").trim();
    const walletText = shortWallet(wallet);

    if (!displayName && !handle && !avatarUrl) {
      renderFallback(wallet);
      return;
    }

    const identity = [
      displayName ? `<strong style="color:#f9f4db;font-size:13px;">${escapeHtml(displayName)}</strong>` : "",
      handle ? `<span style="color:#a9b4ac;font-size:12px;">@${escapeHtml(handle)}</span>` : "",
      `<span style="color:#78837b;font-size:11px;">${escapeHtml(walletText)}</span>`,
    ].filter(Boolean).join("<span style=\"color:#4f5b52;\">·</span>");

    const avatar = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid #4e4928;background:#050805;">`
      : "";

    const content = `<span style="display:inline-flex;align-items:center;gap:7px;vertical-align:middle;">${avatar}<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;">${identity}</span></span>`;
    walletLabel.innerHTML = profileUrl
      ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit;">${content}</a>`
      : content;
    walletLabel.title = "Yokefellow Profile Card";
  }

  async function refreshProfileCard() {
    const wallet = await currentWallet();
    const shown = String(walletLabel.textContent || "").trim();
    if (!wallet || shown === "Spectator") return;
    if (wallet === lastWallet && walletLabel.dataset.yfProfileLoaded === "1") return;

    const generation = ++requestGeneration;
    lastWallet = wallet;
    renderFallback(wallet);

    try {
      const response = await fetch(`${YOKEFELLOW_ORIGIN}/api/profile/card?walletAddress=${encodeURIComponent(wallet)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (generation !== requestGeneration) return;
      if (response.status === 404) {
        walletLabel.dataset.yfProfileLoaded = "1";
        return;
      }
      if (!response.ok) throw new Error(`Profile Card returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (generation !== requestGeneration) return;
      if (payload?.card) renderCard(wallet, payload.card);
      walletLabel.dataset.yfProfileLoaded = "1";
    } catch {
      if (generation === requestGeneration) {
        renderFallback(wallet);
        walletLabel.dataset.yfProfileLoaded = "0";
      }
    }
  }

  const observer = new MutationObserver(() => {
    const text = String(walletLabel.textContent || "").trim();
    if (!text || text === "Spectator") return;
    refreshProfileCard();
  });
  observer.observe(walletLabel, { childList: true, subtree: true, characterData: true });

  window.addEventListener("focus", refreshProfileCard);
  window.ethereum?.on?.("accountsChanged", () => {
    lastWallet = "";
    walletLabel.dataset.yfProfileLoaded = "0";
    setTimeout(refreshProfileCard, 0);
  });

  refreshProfileCard();
})();
