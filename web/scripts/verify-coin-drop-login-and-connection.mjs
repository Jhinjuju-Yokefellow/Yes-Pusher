import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const appScript = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const serverScript = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const gameHtml = readFileSync(new URL("../public/game/index.html", import.meta.url), "utf8");
const pageHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const wallet = "0x" + "a".repeat(40);

function createBrowser({ sign = async () => "0xsignature" } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const requests = [];
  const frameWrites = [];
  const timers = new Map();
  let nextTimerId = 0;
  let selectedWallet = wallet;
  let activeAccount = wallet;

  function element(selector) {
    if (!elements.has(selector)) {
      const events = new Map();
      const node = {
        disabled: false, hidden: selector === "#app-shell", textContent: "",
        dataset: {}, classList: { toggle() {} }, events,
        addEventListener(name, callback) { events.set(name, callback); },
        get src() { return this._src || ""; },
        set src(value) {
          this._src = value;
          if (selector === "#game") frameWrites.push(value);
        },
      };
      if (selector === "#game") node.contentWindow = {};
      elements.set(selector, node);
    }
    return elements.get(selector);
  }

  const document = {
    querySelector: element,
    querySelectorAll: () => [],
    addEventListener(name, callback) { listeners.set("document:" + name, callback); },
  };
  const provider = {
    on(name, callback) { listeners.set("ethereum:" + name, callback); },
    async request({ method }) {
      requests.push(method);
      if (method === "eth_requestAccounts") return [selectedWallet];
      if (method === "eth_accounts") return [activeAccount];
      if (method === "personal_sign") return sign();
      throw new Error("Unexpected wallet request: " + method);
    },
  };
  const window = {
    location: { origin: "https://coin.example.test" },
    ethereum: provider,
    addEventListener(name, callback) { listeners.set("window:" + name, callback); },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const routes = [];
  const fetch = async (url, options) => {
    routes.push(url);
    let status = 200;
    let body;
    switch (url) {
      case "/config":
        body = {ok:true,gameReady:true,chainId:84532,gameServerUrl:"wss://game.example.test"};
        break;
      case "/auth/challenge":
        body = {ok:true,challengeId:"challenge",message:"Sign in to YES DROP"};
        break;
      case "/auth/verify":
        body = {ok:true,wallet,sessionToken:"coin-drop-only-session"};
        break;
      case "/app/state":
        status = 503;
        body = {ok:false,error:"offline-test-no-database"};
        break;
      default:
        throw new Error("Unexpected network request: " + url);
    }
    if (options && options.method === "POST" && url === "/auth/verify") {
      assert.equal(JSON.parse(options.body).signature, "0xsignature");
    }
    return {ok:status === 200,status,json:async()=>body};
  };
  const context = {window,document,fetch,console:{warn() {}},URLSearchParams,Date,Math};
  runInNewContext(appScript, context, { filename: "app.js" });

  return {
    element, requests, routes, frameWrites, timers, listeners,
    click: (name) => element("#" + name).events.get("click")(),
    socket(state, launch) {
      listeners.get("window:message")({
        origin: window.location.origin,
        source: element("#game").contentWindow,
        data: {type:"yes-pusher-socket-state",state,launch},
      });
    },
    gameFailure(launch) {
      listeners.get("window:message")({
        origin: window.location.origin,
        source: element("#game").contentWindow,
        data: {type:"yes-pusher-game-load-failed",launch},
      });
    },
    fireTimeout(delay) {
      const found = Array.from(timers).find(([, timer]) => timer.delay === delay);
      assert.ok(found, "Expected timeout " + delay);
      timers.delete(found[0]);
      found[1].callback();
    },
    setAccount(value) { activeAccount = value; },
    switchWallet(value) { selectedWallet = value; },
  };
}

async function until(predicate) {
  for (let n = 0; n < 50; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for mocked async work");
}

let finishSignature;
const pendingSignature = new Promise((resolve) => { finishSignature = resolve; });
const login = createBrowser({sign:async()=>pendingSignature});
const firstLogin = login.click("connect");
const overlappingLogin = login.click("connect");
await until(() => login.requests.includes("personal_sign"));
assert.equal(login.requests.filter((method)=>method==="eth_requestAccounts").length, 1);
assert.equal(login.requests.filter((method)=>method==="personal_sign").length, 1);
assert.equal(login.routes.filter((path)=>path==="/auth/challenge").length, 1);
assert.equal(login.requests.includes("eth_chainId"),false,"Login must not switch chains");
assert.equal(login.requests.includes("wallet_switchEthereumChain"),false);
assert.equal(login.element("#watch").disabled,true,"Spectator cannot interrupt pending login");
finishSignature("0xsignature");
await Promise.all([firstLogin, overlappingLogin]);
assert.equal(login.element("#app-shell").hidden,false);
assert.equal(login.element("#login").hidden,true);
assert.equal(login.requests.filter((method)=>method==="personal_sign").length,1);
assert.equal(login.element("#watch").disabled,false);
await login.click("home-workshop");
assert.equal(login.routes.filter((path)=>path==="/app/state").length,1,"View changes must not retry even failed Network state reads");
login.click("funding-refresh");
await until(()=>login.routes.filter((path)=>path==="/app/state").length===2);
assert.equal(login.routes.filter((path)=>path==="/app/state").length,2,"Only an explicit refresh may re-read state");

const rejected = createBrowser({sign:async()=>{throw new Error("user_rejected");}});
await rejected.click("connect");
assert.match(rejected.element("#status").textContent,/user_rejected/);
await rejected.click("connect");
assert.equal(rejected.requests.filter((method)=>method==="personal_sign").length,2,"Only explicit retries may sign again");

const accountChanged = createBrowser({
  sign: async () => {
    accountChanged.setAccount("0x" + "b".repeat(40));
    return "0xsignature";
  },
});
await accountChanged.click("connect");
assert.equal(accountChanged.element("#login").hidden,false,"Changed account cannot gain stale session");
assert.match(accountChanged.element("#status").textContent,/wallet account changed/);

const spectator = createBrowser();
await spectator.click("watch");
assert.equal(spectator.frameWrites.length,1);
assert.equal(spectator.requests.length,0,"Spectator must never request a wallet signature");
const firstLaunch = new URL("https://coin.example.test" + spectator.frameWrites[0]).searchParams.get("launch");
assert.ok(firstLaunch);
assert.ok(Array.from(spectator.timers.values()).some((timer)=>timer.delay===180000));
spectator.fireTimeout(180000);
assert.equal(spectator.frameWrites.length,1,"Slow Godot load must not reload iframe");
assert.equal(spectator.element("#retry-connection").disabled,false);
spectator.socket("connecting",firstLaunch);
assert.ok(Array.from(spectator.timers.values()).some((timer)=>timer.delay===30000));
spectator.fireTimeout(30000);
assert.equal(spectator.frameWrites.length,1,"Stalled socket must not reload iframe");
spectator.socket("error",firstLaunch);
assert.equal(spectator.frameWrites.length,1,"Socket error must not cause reload loop");
spectator.gameFailure("stale-launch");
assert.equal(spectator.frameWrites.length,1);
spectator.click("retry-connection");
assert.equal(spectator.frameWrites.length,2,"Explicit Retry starts one new frame");
const secondLaunch = new URL("https://coin.example.test" + spectator.frameWrites[1]).searchParams.get("launch");
assert.notEqual(firstLaunch,secondLaunch);
spectator.socket("closed",firstLaunch);
assert.equal(spectator.element("#retry-connection").disabled,true,"Stale socket events ignored");
spectator.socket("open",secondLaunch);
assert.equal(spectator.element("#retry-connection").textContent,"CONNECTED");
assert.equal(spectator.timers.size,0);

assert.match(serverScript,/payload\.app !== "yes-drop"/);
assert.equal((serverScript.match(/payload\.app !== "yes-drop"/g)||[]).length,2,"Coin Drop accepts only its own sessions");
assert.match(gameHtml,/yes-pusher-game-load-failed/,"Godot engine errors must surface to parent");
assert.doesNotMatch(pageHtml,/profile-card\.js/,"Disabled profile cards must not fetch Yokefellow on focus");

console.log("Coin Drop wallet login: one signature, independent session, no chain switch, retry safe.");
console.log("Coin Drop Godot: no timed or socket-triggered iframe reload, explicit retry only.");
