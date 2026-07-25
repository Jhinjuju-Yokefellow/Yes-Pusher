(() => {
  const connectButton = document.querySelector("#connect");
  const disconnectButton = document.querySelector("#disconnect");
  const status = document.querySelector("#status");
  const login = document.querySelector("#login");
  const gameShell = document.querySelector("#game-shell");
  const gameFrame = document.querySelector("#game");
  const walletLabel = document.querySelector("#wallet-label");
  const mintSetupLink = document.querySelector("#mint-setup-link");

  let config = null;
  let activeWallet = "";

  connectButton.addEventListener("click", connectAndPlay);
  disconnectButton.addEventListener("click", resetPlayer);

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "yes-pusher-ready") {
      walletLabel.textContent = `${shortWallet(activeWallet)} · verified`;
    }
  });

  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", (accounts) => {
      if (!activeWallet) return;
      const next = String(accounts?.[0] || "").toLowerCase();
      if (!next || next !== activeWallet.toLowerCase()) resetPlayer();
    });
    window.ethereum.on("chainChanged", () => {
      if (activeWallet) resetPlayer();
    });
  }

  async function connectAndPlay() {
    setBusy(true, "Opening your wallet…");
    try {
      if (!window.ethereum) throw new Error("Install or enable an EVM browser wallet such as MetaMask or Coinbase Wallet.");
      config = await getJson("/config");
      if (mintSetupLink) mintSetupLink.hidden = !config.instantMintSigner;
      if (!config.gameReady) throw new Error("The Godot web client has not been exported yet. Run BUILD-WEB-PLAYER.ps1 first.");

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const wallet = String(accounts?.[0] || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(wallet)) throw new Error("The wallet did not return a valid address.");

      await ensureChain(config.chainId);
      setStatus("Sign the login message in your wallet. This is not a transaction.");
      const challenge = await postJson("/auth/challenge", { wallet });
      const signature = await window.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, wallet],
      });
      const verified = await postJson("/auth/verify", {
        wallet,
        challengeId: challenge.challengeId,
        signature,
      });

      activeWallet = verified.wallet;
      window.YES_PUSHER_BOOTSTRAP = Object.freeze({
        wallet: verified.wallet,
        sessionToken: verified.sessionToken,
        serverUrl: config.gameServerUrl,
      });
      walletLabel.textContent = `${shortWallet(activeWallet)} · loading shared machine`;
      login.hidden = true;
      gameShell.hidden = false;
      gameFrame.src = `/game/index.html?launch=${Date.now()}`;
    } catch (error) {
      setBusy(false, error?.message || "Wallet login failed.");
    }
  }

  async function ensureChain(chainId) {
    const chainHex = `0x${Number(chainId).toString(16)}`;
    const current = await window.ethereum.request({ method: "eth_chainId" });
    if (String(current).toLowerCase() === chainHex.toLowerCase()) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainHex,
          chainName: "Base Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia-explorer.base.org"],
        }],
      });
    }
  }

  function resetPlayer() {
    activeWallet = "";
    window.YES_PUSHER_BOOTSTRAP = null;
    gameFrame.src = "about:blank";
    gameShell.hidden = true;
    login.hidden = false;
    setBusy(false, "Waiting for a wallet.");
  }

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(errorMessage(body, `Request failed with HTTP ${response.status}.`));
    return body;
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(errorMessage(result, `Request failed with HTTP ${response.status}.`));
    return result;
  }

  function errorMessage(body, fallback) {
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.error?.message === "string") return body.error.message;
    return fallback;
  }

  function setBusy(busy, message) {
    connectButton.disabled = busy;
    connectButton.textContent = busy ? "CONNECTING…" : "CONNECT WALLET & PLAY";
    setStatus(message);
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function shortWallet(wallet) {
    return wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";
  }
})();
