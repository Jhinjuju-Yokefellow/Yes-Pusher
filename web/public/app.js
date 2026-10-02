(() => {
  const connectButton = document.querySelector("#connect");
  const disconnectButton = document.querySelector("#disconnect");
  const watchButton = document.querySelector("#watch");
  const retryConnectionButton = document.querySelector("#retry-connection");
  const status = document.querySelector("#status");
  const login = document.querySelector("#login");
  const gameShell = document.querySelector("#game-shell");
  const gameFrame = document.querySelector("#game");
  const walletLabel = document.querySelector("#wallet-label");
  const mintSetupLink = document.querySelector("#mint-setup-link");

  const reconnectDelaysMs = [1000, 2000, 5000, 10000, 15000];

  let config = null;
  let activeWallet = "";
  let reconnectTimer = null;
  let connectionWatchdog = null;
  let reconnectAttempt = 0;
  let socketOpen = false;
  let activeLaunchId = "";
  let spectatorMode = false;

  connectButton.addEventListener("click", connectAndPlay);
  watchButton?.addEventListener("click", watchSharedMachine);
  disconnectButton.addEventListener("click", resetPlayer);
  retryConnectionButton?.addEventListener("click", retryConnectionNow);

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== gameFrame.contentWindow) return;

    if (event.data?.type === "yes-pusher-ready") {
      walletLabel.textContent = `${viewerLabel()} · connecting to shared machine`;
      startConnectionWatchdog();
      return;
    }

    if (event.data?.type !== "yes-pusher-socket-state") return;
    if (String(event.data.launch || "") !== activeLaunchId) return;

    const state = String(event.data.state || "");
    if (state === "connecting") {
      socketOpen = false;
      setConnectionButton("CONNECTING…", true);
      walletLabel.textContent = `${viewerLabel()} · connecting to shared machine`;
      startConnectionWatchdog();
      return;
    }

    if (state === "open") {
      socketOpen = true;
      reconnectAttempt = 0;
      clearReconnectTimer();
      clearConnectionWatchdog();
      setConnectionButton("CONNECTED", true);
      walletLabel.textContent = `${viewerLabel()} · shared machine connected`;
      return;
    }

    if (state === "error" || state === "closed") {
      socketOpen = false;
      scheduleGameReconnect(
        state === "closed"
          ? "Shared machine connection closed."
          : "Shared machine connection failed.",
      );
    }
  });

  window.addEventListener("online", () => {
    if ((activeWallet || spectatorMode) && !socketOpen) retryConnectionNow();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (activeWallet || spectatorMode) && !socketOpen && !reconnectTimer) {
      retryConnectionNow();
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
    spectatorMode = false;
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
      reconnectAttempt = 0;
      socketOpen = false;
      login.hidden = true;
      gameShell.hidden = false;
      loadGameFrame("loading shared machine");
    } catch (error) {
      setBusy(false, error?.message || "Wallet login failed.");
    }
  }

  async function watchSharedMachine() {
    try {
      config = await getJson("/config");
      if (!config.gameReady) throw new Error("The Godot web client has not been exported yet.");
      activeWallet = "";
      spectatorMode = true;
      window.YES_PUSHER_BOOTSTRAP = Object.freeze({
        wallet: "",
        sessionToken: "",
        serverUrl: config.gameServerUrl,
      });
      reconnectAttempt = 0;
      socketOpen = false;
      login.hidden = true;
      gameShell.hidden = false;
      loadGameFrame("loading shared machine");
    } catch (error) {
      setBusy(false, error?.message || "Shared machine could not be opened.");
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

  function loadGameFrame(stateText) {
    if (!activeWallet && !spectatorMode) return;
    clearReconnectTimer();
    clearConnectionWatchdog();
    socketOpen = false;
    setConnectionButton("CONNECTING…", true);
    walletLabel.textContent = `${viewerLabel()} · ${stateText}`;
    activeLaunchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    gameFrame.src = `/game/index.html?launch=${encodeURIComponent(activeLaunchId)}&retry=${reconnectAttempt}`;
    startConnectionWatchdog();
  }

  function scheduleGameReconnect(reason) {
    if ((!activeWallet && !spectatorMode) || gameShell.hidden || reconnectTimer) return;

    clearConnectionWatchdog();
    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    reconnectAttempt += 1;
    const seconds = Math.ceil(delay / 1000);

    setConnectionButton("RETRY NOW", false);
    walletLabel.textContent = `${viewerLabel()} · reconnecting in ${seconds}s`;

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      loadGameFrame("retrying shared machine");
    }, delay);

    console.warn(`${reason} Retrying in ${seconds} second${seconds === 1 ? "" : "s"}.`);
  }

  function retryConnectionNow() {
    if (!activeWallet && !spectatorMode) return;
    clearReconnectTimer();
    reconnectAttempt = 0;
    loadGameFrame("retrying shared machine");
  }

  function startConnectionWatchdog() {
    clearConnectionWatchdog();
    connectionWatchdog = window.setTimeout(() => {
      connectionWatchdog = null;
      if (!socketOpen) scheduleGameReconnect("Shared machine connection timed out.");
    }, 15000);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearConnectionWatchdog() {
    if (connectionWatchdog !== null) {
      window.clearTimeout(connectionWatchdog);
      connectionWatchdog = null;
    }
  }

  function setConnectionButton(label, disabled) {
    if (!retryConnectionButton) return;
    retryConnectionButton.textContent = label;
    retryConnectionButton.disabled = disabled;
  }

  function resetPlayer() {
    clearReconnectTimer();
    clearConnectionWatchdog();
    reconnectAttempt = 0;
    socketOpen = false;
    activeWallet = "";
    activeLaunchId = "";
    spectatorMode = false;
    window.YES_PUSHER_BOOTSTRAP = null;
    gameFrame.src = "about:blank";
    gameShell.hidden = true;
    login.hidden = false;
    setConnectionButton("RETRY CONNECTION", false);
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

  function viewerLabel() {
    return spectatorMode ? "Spectator" : shortWallet(activeWallet);
  }
})();
