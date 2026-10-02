(() => {
  const connectButton = document.querySelector("#connect");
  const disconnectButton = document.querySelector("#disconnect");
  const watchButton = document.querySelector("#watch");
  const retryConnectionButton = document.querySelector("#retry-connection");
  const status = document.querySelector("#status");
  const login = document.querySelector("#login");
  const appShell = document.querySelector("#app-shell");
  const gameFrame = document.querySelector("#game");
  const walletLabel = document.querySelector("#wallet-label");
  const gameWalletLabel = document.querySelector("#game-wallet-label");
  const mintSetupLink = document.querySelector("#mint-setup-link");
  const appMessage = document.querySelector("#app-message");
  const nav = document.querySelector("#app-nav");

  const homeEquipped = document.querySelector("#home-equipped");
  const homeToys = document.querySelector("#home-toys");
  const homeBuildTitle = document.querySelector("#home-build-title");
  const homeBuildCount = document.querySelector("#home-build-count");
  const homeBuildProgress = document.querySelector("#home-build-progress");
  const homeBuildDetail = document.querySelector("#home-build-detail");
  const homePlay = document.querySelector("#home-play");
  const homeWorkshop = document.querySelector("#home-workshop");
  const fundingBalance = document.querySelector("#funding-balance");
  const fundingStatus = document.querySelector("#funding-status");
  const fundingRefresh = document.querySelector("#funding-refresh");
  const depositAmount = document.querySelector("#deposit-amount");
  const depositButton = document.querySelector("#deposit-button");
  const withdrawAmount = document.querySelector("#withdraw-amount");
  const withdrawButton = document.querySelector("#withdraw-button");

  const workshopBuildTitle = document.querySelector("#workshop-build-title");
  const workshopBuildCount = document.querySelector("#workshop-build-count");
  const workshopBuildProgress = document.querySelector("#workshop-build-progress");
  const workshopBuildDetail = document.querySelector("#workshop-build-detail");
  const rarityLegend = document.querySelector("#rarity-legend");
  const workshopList = document.querySelector("#workshop-list");
  const skinList = document.querySelector("#skin-list");

  const reconnectDelaysMs = [1000, 2000, 5000, 10000, 15000];

  let config = null;
  let activeWallet = "";
  let sessionToken = "";
  let playerState = null;
  let reconnectTimer = null;
  let connectionWatchdog = null;
  let reconnectAttempt = 0;
  let socketOpen = false;
  let activeLaunchId = "";
  let spectatorMode = false;
  let gameLoaded = false;
  let activeView = "home";
  let stateRefreshGeneration = 0;

  connectButton.addEventListener("click", connectWallet);
  watchButton?.addEventListener("click", watchSharedMachine);
  disconnectButton.addEventListener("click", resetPlayer);
  retryConnectionButton?.addEventListener("click", retryConnectionNow);
  homePlay?.addEventListener("click", () => switchView("play"));
  homeWorkshop?.addEventListener("click", () => switchView("workshop"));
  fundingRefresh?.addEventListener("click", () => refreshPlayerState({ announce: false }));
  depositButton?.addEventListener("click", () => performFunding("deposit", depositButton, depositAmount));
  withdrawButton?.addEventListener("click", () => performFunding("withdrawal", withdrawButton, withdrawAmount));
  nav?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    switchView(button.dataset.view);
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== gameFrame.contentWindow) return;

    if (event.data?.type === "yes-pusher-ready") {
      updateGameWalletLabel("connecting to shared machine");
      startConnectionWatchdog();
      return;
    }

    if (event.data?.type !== "yes-pusher-socket-state") return;
    if (String(event.data.launch || "") !== activeLaunchId) return;

    const state = String(event.data.state || "");
    if (state === "connecting") {
      socketOpen = false;
      setConnectionButton("CONNECTING…", true);
      updateGameWalletLabel("connecting to shared machine");
      startConnectionWatchdog();
      return;
    }

    if (state === "open") {
      socketOpen = true;
      reconnectAttempt = 0;
      clearReconnectTimer();
      clearConnectionWatchdog();
      setConnectionButton("CONNECTED", true);
      updateGameWalletLabel("shared machine connected");
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
    if (gameLoaded && (activeWallet || spectatorMode) && !socketOpen) retryConnectionNow();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && gameLoaded && (activeWallet || spectatorMode) && !socketOpen && !reconnectTimer) {
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

  async function connectWallet() {
    spectatorMode = false;
    setBusy(true, "Opening your wallet…");
    try {
      if (!window.ethereum) throw new Error("Install or enable an EVM browser wallet such as MetaMask or Coinbase Wallet.");
      config = await getJson("/config");
      if (mintSetupLink) mintSetupLink.hidden = !config.instantMintSigner;
      if (!config.gameReady) throw new Error("The Godot web client has not been exported yet. Run PREPARE-WEB-PLAYER.ps1 first.");

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
      sessionToken = verified.sessionToken;
      reconnectAttempt = 0;
      socketOpen = false;
      gameLoaded = false;
      login.hidden = true;
      appShell.hidden = false;
      walletLabel.textContent = shortWallet(activeWallet);
      setBusy(false, "");
      await switchView("home");
    } catch (error) {
      if (activeWallet && sessionToken && !appShell.hidden) {
        setAppMessage(error?.message || "Rainbow's End collection state could not be loaded yet.", "error");
      } else {
        setBusy(false, error?.message || "Wallet login failed.");
      }
    }
  }

  async function watchSharedMachine() {
    try {
      config = await getJson("/config");
      if (!config.gameReady) throw new Error("The Godot web client has not been exported yet.");
      activeWallet = "";
      sessionToken = "";
      playerState = null;
      spectatorMode = true;
      reconnectAttempt = 0;
      socketOpen = false;
      gameLoaded = false;
      login.hidden = true;
      appShell.hidden = false;
      walletLabel.textContent = "Spectator";
      setAppMessage("", "");
      switchView("play");
    } catch (error) {
      setBusy(false, error?.message || "Shared machine could not be opened.");
    }
  }

  async function switchView(view) {
    const next = ["home", "play", "workshop", "skins"].includes(view) ? view : "home";
    if (spectatorMode && next !== "play") return;
    activeView = next;

    for (const section of document.querySelectorAll(".app-view")) {
      section.hidden = section.id !== `view-${next}`;
    }
    for (const button of document.querySelectorAll(".nav-button")) {
      button.classList.toggle("active", button.dataset.view === next);
      button.hidden = spectatorMode && button.dataset.view !== "play";
    }

    if (next === "play") {
      await ensureGameLoaded();
      return;
    }
    if (!spectatorMode && ["home", "workshop", "skins"].includes(next)) {
      await refreshPlayerState({ announce: false }).catch((error) => {
        setAppMessage(error?.message || "Rainbow's End state could not be refreshed.", "error");
      });
    }
  }

  async function refreshPlayerState({ announce = false } = {}) {
    if (!activeWallet || !sessionToken) return null;
    const generation = ++stateRefreshGeneration;
    const state = await appGet("/app/state");
    if (generation !== stateRefreshGeneration) return playerState;
    playerState = state;
    renderPlayerState();
    updateBootstrap();
    if (announce) setAppMessage("Collection refreshed from Yokefellow.", "success");
    return state;
  }

  function renderPlayerState() {
    if (!playerState) return;
    renderEquipped();
    renderFunding();
    renderToySummary();
    renderCommunity();
    renderWorkshop();
    renderSkins();
  }

  function renderEquipped() {
    const equipped = playerState?.equippedSkin || "";
    const skin = (playerState?.skins || []).find((item) => item.family === equipped);
    if (!skin) {
      homeEquipped.innerHTML = `
        <div class="equipped-row">
          <div>
            <strong>Default YES Coin</strong>
            <span>No Coin Skin equipped</span>
          </div>
        </div>`;
      return;
    }
    homeEquipped.innerHTML = `
      <div class="equipped-row">
        ${skin.imageUrl ? `<img src="${escapeAttribute(skin.imageUrl)}" alt="">` : ""}
        <div>
          <strong>${escapeHtml(skin.label)} Coin Skin</strong>
          <span>Rarity ${skin.rarity} · equipped</span>
        </div>
      </div>`;
  }

  function renderFunding() {
    if (!fundingBalance || !fundingStatus) return;
    const funding = playerState?.funding;
    const ready = Boolean(funding?.ready && funding?.credit);

    if (!ready) {
      fundingBalance.textContent = "Unavailable";
      fundingStatus.textContent = "Unavailable";
      if (depositAmount) depositAmount.disabled = true;
      if (withdrawAmount) withdrawAmount.disabled = true;
      if (depositButton) depositButton.disabled = true;
      if (withdrawButton) withdrawButton.disabled = true;
      if (fundingRefresh) fundingRefresh.disabled = false;
      return;
    }

    const participantRaw = funding.credit?.participantBackedRaw
      ?? funding.credit?.withdrawableRaw
      ?? "0";
    const withdrawableRaw = funding.credit?.withdrawableRaw ?? "0";
    fundingBalance.textContent = `${formatYesRaw(participantRaw)} YES`;
    fundingStatus.textContent = `Withdrawable: ${formatYesRaw(withdrawableRaw)} YES`;

    if (depositAmount) depositAmount.disabled = false;
    if (withdrawAmount) withdrawAmount.disabled = false;
    if (depositButton) depositButton.disabled = false;
    if (withdrawButton) withdrawButton.disabled = BigInt(withdrawableRaw || "0") <= 0n;
    if (fundingRefresh) fundingRefresh.disabled = false;
  }

  function renderToySummary() {
    const toys = Array.isArray(playerState?.toys) ? playerState.toys : [];
    homeToys.innerHTML = toys.map((toy) => `
      <div class="toy-summary">
        <strong>${escapeHtml(toy.label)}</strong>
        <span>Small ${safeQuantity(toy.tiers?.small?.quantity)} · Medium ${safeQuantity(toy.tiers?.medium?.quantity)} · Large ${safeQuantity(toy.tiers?.large?.quantity)}</span>
      </div>
    `).join("");
  }

  function renderCommunity() {
    const community = playerState?.community;
    if (!community) return;
    const progress = community.target > 0 ? Math.min(100, (community.progressPoints / community.target) * 100) : 0;
    const title = `Machine #${community.nextMachineNumber}`;
    const count = `${community.progressPoints} / ${community.target}`;
    const exact = community.justUnlockedAtExactTarget;
    const detail = exact
      ? `Machine #${community.unlockedMachines} reached its build target. Contributions now build Machine #${community.nextMachineNumber}.`
      : `${community.remainingPoints} more build point${community.remainingPoints === 1 ? "" : "s"} to unlock Machine #${community.nextMachineNumber}. ${community.unlockedMachines} machine${community.unlockedMachines === 1 ? "" : "s"} funded so far.`;

    homeBuildTitle.textContent = title;
    homeBuildCount.textContent = count;
    homeBuildProgress.style.width = `${progress}%`;
    homeBuildDetail.textContent = detail;

    workshopBuildTitle.textContent = title;
    workshopBuildCount.textContent = `${count} points`;
    workshopBuildProgress.style.width = `${progress}%`;
    workshopBuildDetail.textContent = detail;

    const families = config?.workshop?.families || [];
    rarityLegend.innerHTML = families.map((item) =>
      `<span class="rarity-pill">${escapeHtml(item.label)} · R${item.rarity} · +${item.points} point${item.points === 1 ? "" : "s"}</span>`
    ).join("");
  }

  function renderWorkshop() {
    const toys = Array.isArray(playerState?.toys) ? playerState.toys : [];
    workshopList.innerHTML = toys.map((toy) => {
      const small = safeQuantity(toy.tiers?.small?.quantity);
      const medium = safeQuantity(toy.tiers?.medium?.quantity);
      const large = safeQuantity(toy.tiers?.large?.quantity);
      const image = toy.tiers?.large?.imageUrl || toy.tiers?.medium?.imageUrl || toy.tiers?.small?.imageUrl || "";
      const mediumReady = small >= 3 && Boolean(toy.craft?.medium);
      const largeReady = medium >= 3 && Boolean(toy.craft?.large);
      const contributeReady = large >= 1 && Boolean(playerState?.contributionReady);
      return `
        <article class="family-card" data-family="${escapeAttribute(toy.family)}">
          <div class="family-identity">
            ${image ? `<img class="family-image" src="${escapeAttribute(image)}" alt="">` : ""}
            <div>
              <strong>${escapeHtml(toy.label)}</strong>
              <div class="rarity-line">RARITY ${toy.rarity} · LARGE = +${toy.buildPoints} BUILD POINT${toy.buildPoints === 1 ? "" : "S"}</div>
            </div>
          </div>
          <div class="tier-grid">
            <div class="tier-box"><span>Small</span><strong>×${small}</strong></div>
            <div class="tier-box"><span>Medium</span><strong>×${medium}</strong></div>
            <div class="tier-box"><span>Large</span><strong>×${large}</strong></div>
          </div>
          <div class="family-actions">
            <button class="craft-button" data-action="craft" data-family="${escapeAttribute(toy.family)}" data-tier="small" ${mediumReady ? "" : "disabled"}>3 SMALL → 1 MEDIUM</button>
            <button class="craft-button" data-action="craft" data-family="${escapeAttribute(toy.family)}" data-tier="medium" ${largeReady ? "" : "disabled"}>3 MEDIUM → 1 LARGE</button>
            <button class="contribute-button" data-action="contribute" data-family="${escapeAttribute(toy.family)}" ${contributeReady ? "" : "disabled"}>CONTRIBUTE LARGE · +${toy.buildPoints}</button>
            <div class="action-note">${craftReadinessNote(toy, small, medium, large)}</div>
          </div>
        </article>`;
    }).join("");

    for (const button of workshopList.querySelectorAll('[data-action="craft"]')) {
      button.addEventListener("click", () => performCraft(button));
    }
    for (const button of workshopList.querySelectorAll('[data-action="contribute"]')) {
      button.addEventListener("click", () => performContribution(button));
    }
  }

  function craftReadinessNote(toy, small, medium, large) {
    if (!playerState?.craftCatalogReady) return "Craft Paths are waiting for the Yokefellow craft catalog.";
    if (!toy.craft?.medium || !toy.craft?.large) return "One or more craft Paths for this family are not live yet.";
    if (large > 0 && !playerState?.contributionReady) return "Large contribution signer is not configured yet.";
    if (small < 3 && medium < 3 && large < 1) return "Earn more Toys to unlock Workshop actions.";
    return "Crafting permanently consumes the three input Toys. Contribution permanently consumes one Large Toy.";
  }

  function renderSkins() {
    const skins = Array.isArray(playerState?.skins) ? playerState.skins : [];
    const equipped = playerState?.equippedSkin || "";
    const defaultCard = `
      <article class="skin-card ${equipped ? "" : "equipped"}">
        <div class="skin-meta">STARTER COIN · NOT AN NFT</div>
        <strong>Default YES Coin</strong>
        <p class="skin-meta">Always available.</p>
        <button class="skin-button" data-skin="" ${equipped ? "" : "disabled"}>${equipped ? "EQUIP" : "EQUIPPED"}</button>
      </article>`;
    skinList.innerHTML = defaultCard + skins.map((skin) => `
      <article class="skin-card ${equipped === skin.family ? "equipped" : ""}">
        ${skin.imageUrl ? `<img src="${escapeAttribute(skin.imageUrl)}" alt="">` : ""}
        <strong>${escapeHtml(skin.label)}</strong>
        <p class="skin-meta">Rarity ${skin.rarity} · owned ×${skin.quantity}</p>
        <button class="skin-button" data-skin="${escapeAttribute(skin.family)}" ${equipped === skin.family ? "disabled" : ""}>${equipped === skin.family ? "EQUIPPED" : "EQUIP COIN"}</button>
      </article>
    `).join("");

    for (const button of skinList.querySelectorAll("[data-skin]")) {
      button.addEventListener("click", () => equipSkin(button.dataset.skin || "", button));
    }
  }

  async function performFunding(operation, button, input) {
    if (!playerState?.funding?.ready) {
      setAppMessage("Unavailable", "");
      return;
    }
    const amountRaw = parseYesRaw(input?.value || "");
    if (!amountRaw || BigInt(amountRaw) <= 0n) {
      setAppMessage("Enter a YES amount greater than zero.", "error");
      return;
    }

    const prefix = operation === "deposit" ? "deposit" : "withdraw";
    const operationKey = `${prefix}:${activeWallet}`;
    const referenceId = operationReference(operationKey, prefix);
    setActionBusy(button, true, operation === "deposit" ? "DEPOSITING…" : "WITHDRAWING…");

    try {
      await ensureChain(config.chainId);
      const preparedResult = await appPost("/app/funding/prepare", {
        operation,
        amountYesRaw: amountRaw,
        referenceId,
      });
      const prepared = preparedResult.operation;
      if (!prepared) throw new Error("Unavailable");

      if (prepared.status === "already_applied") {
        clearOperationReference(operationKey);
        await refreshPlayerState();
        setAppMessage(operation === "deposit" ? "Deposit confirmed." : "Withdrawal confirmed.", "success");
        return;
      }

      if (prepared.approval) {
        await sendPreparedWalletTransaction(prepared.approval);
      }
      if (!prepared.transaction) throw new Error("Unavailable");
      await sendPreparedWalletTransaction(prepared.transaction);

      const confirmed = await waitForFundingStatus(operation, referenceId);
      if (!confirmed) throw new Error("Transaction sent. Refresh in a moment.");

      clearOperationReference(operationKey);
      await refreshPlayerState();
      setAppMessage(operation === "deposit" ? "Deposit confirmed." : "Withdrawal confirmed.", "success");
    } catch (error) {
      const message = error?.message || "Unavailable";
      setAppMessage(message.includes("registered with Yokefellow Network") ? "Unavailable" : message, "error");
    } finally {
      setActionBusy(button, false);
    }
  }

  async function sendPreparedWalletTransaction(transaction) {
    const tx = {
      from: activeWallet,
      to: transaction.to,
      data: transaction.data || "0x",
      value: hexQuantity(transaction.value || "0"),
    };
    const hash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [tx],
    });
    await waitForWalletReceipt(hash);
    return hash;
  }

  async function waitForWalletReceipt(hash) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      });
      if (receipt) {
        if (receipt.status && String(receipt.status).toLowerCase() === "0x0") {
          throw new Error("Transaction failed.");
        }
        return receipt;
      }
      await wait(1500);
    }
    throw new Error("Transaction is still pending.");
  }

  async function waitForFundingStatus(operation, referenceId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await appPost("/app/funding/status", { operation, referenceId });
      if (result.operation?.status === "confirmed") return true;
      await wait(1500);
    }
    return false;
  }

  async function equipSkin(family, button) {
    setActionBusy(button, true, "EQUIPPING…");
    try {
      const result = await appPost("/app/equip-skin", { family });
      await refreshPlayerState();
      updateBootstrap();
      setAppMessage(result.equippedSkin
        ? `${familyLabel(result.equippedSkin)} Coin Skin equipped.`
        : "Default YES Coin equipped.", "success");
      if (gameLoaded) reloadGameForLoadout();
    } catch (error) {
      setAppMessage(error?.message || "Coin Skin could not be equipped.", "error");
    } finally {
      setActionBusy(button, false);
    }
  }

  async function performCraft(button) {
    const family = button.dataset.family || "";
    const fromTier = button.dataset.tier || "";
    const targetTier = fromTier === "small" ? "medium" : "large";
    const before = toyCounts(playerState, family);
    const operationKey = `craft:${activeWallet}:${family}:${fromTier}`;
    const referenceId = operationReference(operationKey, "craft");
    setActionBusy(button, true, "CRAFTING…");
    setAppMessage(`Crafting ${targetTier.toUpperCase()} ${familyLabel(family)}. The three input Toys will be permanently consumed.`, "");
    try {
      await appPost("/app/craft", { family, fromTier, referenceId });
      clearOperationReference(operationKey);
      const indexed = await waitForOwnershipChange((state) => {
        const after = toyCounts(state, family);
        return after[fromTier] <= Math.max(0, before[fromTier] - 3)
          && after[targetTier] >= before[targetTier] + 1;
      });
      setAppMessage(
        indexed
          ? `${targetTier.toUpperCase()} ${familyLabel(family)} crafted. Three ${fromTier.toUpperCase()} Toys were consumed and Yokefellow now shows the new Toy.`
          : `Craft confirmed. Yokefellow ownership indexing is still catching up; the Workshop will refresh again when reopened.`,
        indexed ? "success" : "",
      );
    } catch (error) {
      setAppMessage(`${error?.message || "Craft failed."} Retry uses the same craft reference.`, "error");
    } finally {
      setActionBusy(button, false);
    }
  }

  async function performContribution(button) {
    const family = button.dataset.family || "";
    const toy = playerState?.toys?.find((item) => item.family === family);
    const points = toy?.buildPoints || 0;
    const before = toyCounts(playerState, family);
    if (!window.confirm(`Permanently consume one Large ${familyLabel(family)} Toy for +${points} community build point${points === 1 ? "" : "s"}? This cannot be undone.`)) return;

    const operationKey = `contribute:${activeWallet}:${family}`;
    const referenceId = operationReference(operationKey, "build");
    setActionBusy(button, true, "CONTRIBUTING…");
    setAppMessage(`Contributing Large ${familyLabel(family)} for +${points} build point${points === 1 ? "" : "s"}…`, "");
    try {
      const result = await appPost("/app/contribute", { family, referenceId });
      clearOperationReference(operationKey);
      const indexed = await waitForOwnershipChange((state) => {
        const after = toyCounts(state, family);
        return after.large <= Math.max(0, before.large - 1);
      });
      const community = result.community;
      setAppMessage(
        `Large ${familyLabel(family)} contributed for +${points}. Community build is ${community.progressPoints} / ${community.target} toward Machine #${community.nextMachineNumber}.${indexed ? " Yokefellow ownership now reflects the burn." : " Ownership indexing is still catching up."}`,
        "success",
      );
    } catch (error) {
      setAppMessage(`${error?.message || "Contribution failed."} Retry uses the exact same contribution reference/transaction.`, "error");
    } finally {
      setActionBusy(button, false);
    }
  }

  async function waitForOwnershipChange(predicate) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await wait(attempt === 0 ? 900 : 2000);
      try {
        const state = await refreshPlayerState();
        if (state && predicate(state)) return true;
      } catch {
        // Keep polling: the onchain action may be confirmed before the ownership index catches up.
      }
    }
    await refreshPlayerState().catch(() => null);
    return false;
  }

  function toyCounts(state, family) {
    const toy = state?.toys?.find((item) => item.family === family);
    return {
      small: safeQuantity(toy?.tiers?.small?.quantity),
      medium: safeQuantity(toy?.tiers?.medium?.quantity),
      large: safeQuantity(toy?.tiers?.large?.quantity),
    };
  }

  async function ensureGameLoaded() {
    if (gameLoaded && gameFrame.src && !gameFrame.src.endsWith("about:blank")) return;
    if (!config) config = await getJson("/config");
    updateBootstrap();
    loadGameFrame("loading shared machine");
  }

  function updateBootstrap() {
    if (!config) return;
    window.YES_PUSHER_BOOTSTRAP = Object.freeze({
      wallet: spectatorMode ? "" : activeWallet,
      sessionToken: spectatorMode ? "" : sessionToken,
      serverUrl: config.gameServerUrl,
      skinFamily: spectatorMode ? "" : (playerState?.equippedSkin || ""),
    });
  }

  function reloadGameForLoadout() {
    if (!gameLoaded) return;
    updateBootstrap();
    reconnectAttempt = 0;
    loadGameFrame("applying equipped Coin Skin");
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
    gameLoaded = true;
    setConnectionButton("CONNECTING…", true);
    updateGameWalletLabel(stateText);
    activeLaunchId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    gameFrame.src = `/game/index.html?launch=${encodeURIComponent(activeLaunchId)}&retry=${reconnectAttempt}`;
    startConnectionWatchdog();
  }

  function scheduleGameReconnect(reason) {
    if (!gameLoaded || (!activeWallet && !spectatorMode) || appShell.hidden || reconnectTimer) return;

    clearConnectionWatchdog();
    const delay = reconnectDelaysMs[Math.min(reconnectAttempt, reconnectDelaysMs.length - 1)];
    reconnectAttempt += 1;
    const seconds = Math.ceil(delay / 1000);

    setConnectionButton("RETRY NOW", false);
    updateGameWalletLabel(`reconnecting in ${seconds}s`);

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

  function updateGameWalletLabel(stateText) {
    if (!gameWalletLabel) return;
    gameWalletLabel.textContent = `${viewerLabel()} · ${stateText}`;
  }

  function resetPlayer() {
    clearReconnectTimer();
    clearConnectionWatchdog();
    reconnectAttempt = 0;
    socketOpen = false;
    activeWallet = "";
    sessionToken = "";
    activeLaunchId = "";
    spectatorMode = false;
    gameLoaded = false;
    playerState = null;
    window.YES_PUSHER_BOOTSTRAP = null;
    gameFrame.src = "about:blank";
    appShell.hidden = true;
    login.hidden = false;
    for (const button of document.querySelectorAll(".nav-button")) button.hidden = false;
    setAppMessage("", "");
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

  async function appGet(url) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${sessionToken}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(errorMessage(body, `Request failed with HTTP ${response.status}.`));
    return body;
  }

  async function appPost(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) throw new Error(errorMessage(result, `Request failed with HTTP ${response.status}.`));
    return result;
  }

  function operationReference(key, prefix) {
    const storageKey = `yes-drop:${key}`;
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const reference = `${prefix}:${random}`;
    sessionStorage.setItem(storageKey, reference);
    return reference;
  }

  function clearOperationReference(key) {
    sessionStorage.removeItem(`yes-drop:${key}`);
  }

  function setActionBusy(button, busy, label = "") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label || "WORKING…";
      button.disabled = true;
      return;
    }
    const original = button.dataset.originalText;
    if (original) button.textContent = original;
    delete button.dataset.originalText;
    if (playerState) renderPlayerState();
  }

  function setAppMessage(message, tone = "") {
    if (!appMessage) return;
    appMessage.textContent = message || "";
    appMessage.hidden = !message;
    appMessage.className = `app-message${tone ? ` ${tone}` : ""}`;
  }

  function errorMessage(body, fallback) {
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.error?.message === "string") return body.error.message;
    return fallback;
  }

  function setBusy(busy, message) {
    connectButton.disabled = busy;
    connectButton.textContent = busy ? "CONNECTING…" : "CONNECT WALLET";
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

  function safeQuantity(value) {
    const parsed = Number.parseInt(String(value ?? "0"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function parseYesRaw(value) {
    const text = String(value || "").trim();
    if (!/^\d+(?:\.\d{0,18})?$/.test(text)) return "";
    const [whole, fraction = ""] = text.split(".");
    return (BigInt(whole || "0") * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18))).toString();
  }

  function formatYesRaw(value) {
    try {
      const raw = BigInt(String(value || "0"));
      const whole = raw / 10n ** 18n;
      const fraction = (raw % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
      return fraction ? `${whole}.${fraction.slice(0, 4)}` : whole.toString();
    } catch {
      return "0";
    }
  }

  function hexQuantity(value) {
    try {
      return `0x${BigInt(String(value || "0")).toString(16)}`;
    } catch {
      return "0x0";
    }
  }

  function familyLabel(family) {
    const configured = config?.workshop?.families?.find((item) => item.key === family);
    return configured?.label || String(family || "").replaceAll("_", " ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
})();
