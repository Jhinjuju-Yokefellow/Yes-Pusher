(() => {
  const SET_ISSUER_SELECTOR = "495289be";
  const OWNER_SELECTOR = "8da5cb5b";
  const APPROVED_ISSUERS_SELECTOR = "fb87b9e7";
  const signerLabel = document.querySelector("#signer");
  const balanceLabel = document.querySelector("#balance");
  const connectButton = document.querySelector("#connect-owner");
  const fundButton = document.querySelector("#fund");
  const status = document.querySelector("#setup-status");
  const collectionsRoot = document.querySelector("#collections");

  let config = null;
  let ownerWallet = "";

  connectButton.addEventListener("click", connectOwner);
  fundButton.addEventListener("click", fundMinter);
  loadConfig();

  async function loadConfig() {
    try {
      config = await getJson("/mint/config");
      signerLabel.textContent = config.signerAddress || "Not configured";
      if (!config.ready) throw new Error(config.setupError || "The instant mint signer is not configured yet. Run PREPARE-WEB-PLAYER.ps1 again.");
      await refreshBalance();
      renderCollections();
      setStatus("Connect the wallet that owns the Coin Skin collection.");
    } catch (error) {
      setStatus(error?.message || "Instant mint setup could not load.");
      connectButton.disabled = true;
    }
  }

  async function connectOwner() {
    try {
      if (!window.ethereum) throw new Error("Open this page in a browser with MetaMask or Coinbase Wallet enabled.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      ownerWallet = String(accounts?.[0] || "").toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(ownerWallet)) throw new Error("The wallet did not return a valid address.");
      await ensureChain(config.chainId);
      await refreshBalance();
      connectButton.textContent = `${ownerWallet.slice(0, 6)}…${ownerWallet.slice(-4)} CONNECTED`;
      fundButton.disabled = false;
      await refreshCollectionChecks();
    } catch (error) {
      setStatus(error?.message || "The collection owner wallet could not connect.");
    }
  }

  function renderCollections() {
    collectionsRoot.innerHTML = "";
    const collections = Array.isArray(config.collections) ? config.collections : [];
    if (!collections.length) {
      collectionsRoot.textContent = "No deployed Coin Skin collection was found in the bucket catalog.";
      return;
    }
    for (const collection of collections) {
      const card = document.createElement("div");
      card.className = "collection-card";
      card.dataset.address = collection.contractAddress;
      card.innerHTML = `
        <strong>${escapeHtml(collection.name)}</strong>
        <small>${escapeHtml(collection.standard.toUpperCase())} · ${escapeHtml(collection.contractAddress)}</small>
        <p class="collection-state">Connect the owner wallet to check issuer approval.</p>
        <button type="button" class="secondary approve" disabled>APPROVE APP MINTER</button>
      `;
      card.querySelector(".approve").addEventListener("click", () => approveCollection(collection, card));
      collectionsRoot.appendChild(card);
    }
  }

  async function refreshCollectionChecks() {
    let ownerMatches = 0;
    for (const card of collectionsRoot.querySelectorAll(".collection-card")) {
      const address = card.dataset.address;
      const state = card.querySelector(".collection-state");
      const button = card.querySelector(".approve");
      try {
        const ownerResult = await ethCall(address, `0x${OWNER_SELECTOR}`);
        const collectionOwner = decodeAddress(ownerResult);
        const approvedResult = await ethCall(address, `0x${APPROVED_ISSUERS_SELECTOR}${padAddress(config.signerAddress)}`);
        const approved = BigInt(approvedResult || "0x0") !== 0n;
        const isOwner = collectionOwner.toLowerCase() === ownerWallet;
        if (isOwner) ownerMatches += 1;
        if (approved) {
          state.textContent = "App minter approved. Instant minting is ready for this collection.";
          button.textContent = "APPROVED";
          button.disabled = true;
        } else if (!isOwner) {
          state.textContent = `This collection is owned by ${shortAddress(collectionOwner)}. Connect that wallet to approve.`;
          button.disabled = true;
        } else {
          state.textContent = "This wallet owns the collection. Approve the app minter once.";
          button.disabled = false;
        }
      } catch (error) {
        state.textContent = error?.message || "Collection status could not be checked.";
        button.disabled = true;
      }
    }
    setStatus(ownerMatches ? "Approve any collection that is not ready, then return to the game." : "The connected wallet does not own the listed collection.");
  }

  async function approveCollection(collection, card) {
    const button = card.querySelector(".approve");
    const state = card.querySelector(".collection-state");
    button.disabled = true;
    state.textContent = "Confirm issuer approval in the owner wallet…";
    try {
      const data = `0x${SET_ISSUER_SELECTOR}${padAddress(config.signerAddress)}${"1".padStart(64, "0")}`;
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: ownerWallet, to: collection.contractAddress, data }],
      });
      state.textContent = "Approval submitted. Waiting for Base Sepolia confirmation…";
      await waitForReceipt(txHash);
      await refreshCollectionChecks();
    } catch (error) {
      state.textContent = error?.message || "Issuer approval failed.";
      button.disabled = false;
    }
  }

  async function fundMinter() {
    fundButton.disabled = true;
    try {
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: ownerWallet,
          to: config.signerAddress,
          value: "0x71afd498d0000",
        }],
      });
      setStatus("Funding submitted. Waiting for Base Sepolia confirmation…");
      await waitForReceipt(txHash);
      await refreshBalance();
      setStatus("The app minter has Base Sepolia ETH for instant mint transactions.");
    } catch (error) {
      setStatus(error?.message || "Funding the app minter failed.");
    } finally {
      fundButton.disabled = false;
    }
  }

  async function refreshBalance() {
    if (!window.ethereum || !config?.signerAddress) {
      balanceLabel.textContent = "Use the wallet page to fund it";
      return;
    }
    const raw = await window.ethereum.request({ method: "eth_getBalance", params: [config.signerAddress, "latest"] });
    const eth = Number(BigInt(raw)) / 1e18;
    balanceLabel.textContent = `${eth.toFixed(5)} ETH`;
  }

  async function ethCall(to, data) {
    return window.ethereum.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  }

  async function waitForReceipt(txHash) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [txHash] });
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("The Base Sepolia transaction failed.");
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("The transaction is still pending. Check the wallet or Base Sepolia explorer.");
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

  async function getJson(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `Request failed with HTTP ${response.status}.`);
    return body;
  }

  function padAddress(address) {
    return String(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function decodeAddress(value) {
    const clean = String(value || "").replace(/^0x/, "");
    return `0x${clean.slice(-40)}`;
  }

  function shortAddress(value) {
    return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "unknown";
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
  }
})();
