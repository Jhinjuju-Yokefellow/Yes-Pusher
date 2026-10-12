import fs from "node:fs/promises";

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`YES DROP funding patch could not find ${label}.`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`YES DROP funding patch found ${label} more than once.`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const serverSource = await fs.readFile(new URL("./server.mjs", import.meta.url), "utf8");
const appPath = new URL("./public/app.js", import.meta.url);
const appSource = await fs.readFile(appPath, "utf8");

const fundingRoutesBefore = `    if (request.method === "POST" && requestUrl.pathname === "/app/funding/prepare") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.prepareFunding(session.wallet, body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/status") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.fundingStatus(session.wallet, body));
    }`;

const fundingRoutesAfter = `    if (request.method === "POST" && requestUrl.pathname === "/app/funding/prepare") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.prepareFunding(session.wallet, body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/submit") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      const state = await workshop.getState(session.wallet);
      const bucketSlug = String(state?.bucketSlug || "").trim();
      if (!bucketSlug) {
        const error = new Error("Rainbow's End could not resolve its Yokefellow Bucket slug.");
        error.statusCode = 409;
        throw error;
      }
      const upstream = await fetch(
        \`\${yokefellowOrigin}/api/buckets/\${encodeURIComponent(bucketSlug)}/deposits/submit\`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            walletAddress: session.wallet,
            amountYesRaw: String(body.amountYesRaw || ""),
            referenceId: String(body.referenceId || ""),
            authorizationNonce: String(body.authorizationNonce || ""),
            validAfter: Number(body.validAfter),
            validBefore: Number(body.validBefore),
            signature: String(body.signature || ""),
          }),
          cache: "no-store",
        },
      );
      const payload = await upstream.json().catch(() => null);
      if (!upstream.ok || !payload) {
        const message = payload?.message || payload?.error || \`Yokefellow deposit submission failed (\${upstream.status}).\`;
        const error = new Error(typeof message === "string" ? message : "Yokefellow deposit submission failed.");
        error.statusCode = upstream.status || 409;
        throw error;
      }
      return sendJson(response, upstream.status, payload);
    }
    if (request.method === "POST" && requestUrl.pathname === "/app/funding/status") {
      const session = requirePlayerSession(request);
      const body = await readJson(request);
      return sendJson(response, 200, await workshop.fundingStatus(session.wallet, body));
    }`;

const cacheBefore = `  const isGameAsset = relative === "game" || relative.startsWith("game/");
  response.setHeader("Cache-Control", extension === ".html" || isGameAsset ? "no-store" : "public, max-age=300");`;
const cacheAfter = `  const isGameAsset = relative === "game" || relative.startsWith("game/");
  const noStore = extension === ".html" || isGameAsset || relative === "app.js";
  response.setHeader("Cache-Control", noStore ? "no-store" : "public, max-age=300");`;

let patchedServer = replaceExactlyOnce(serverSource, fundingRoutesBefore, fundingRoutesAfter, "funding route block");
patchedServer = replaceExactlyOnce(patchedServer, cacheBefore, cacheAfter, "static cache block");
await fs.writeFile(new URL("./server.runtime.mjs", import.meta.url), patchedServer, "utf8");

const fundingClientBefore = `      if (prepared.approval) {
        await sendPreparedWalletTransaction(prepared.approval);
      }
      if (!prepared.transaction) throw new Error("Unavailable");
      await sendPreparedWalletTransaction(prepared.transaction);`;

const fundingClientAfter = `      if (operation === "deposit") {
        const authorization = prepared.authorization;
        if (!authorization?.domain || !authorization?.types || !authorization?.message) {
          throw new Error("Yokefellow did not return a YES deposit authorization.");
        }
        const typedData = {
          domain: authorization.domain,
          primaryType: authorization.primaryType || "ReceiveWithAuthorization",
          types: {
            EIP712Domain: [
              { name: "name", type: "string" },
              { name: "version", type: "string" },
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            ...authorization.types,
          },
          message: authorization.message,
        };
        setAppMessage("Authorize this YES deposit in your wallet. Yokefellow Network will submit it on Base.", "");
        const signature = await window.ethereum.request({
          method: "eth_signTypedData_v4",
          params: [activeWallet, JSON.stringify(typedData)],
        });
        const authorizationNonce = prepared.authorizationNonce || authorization.message.nonce;
        const validAfter = Number(prepared.validAfter ?? authorization.message.validAfter);
        const validBefore = Number(prepared.validBefore ?? authorization.message.validBefore);
        if (!/^0x[a-fA-F0-9]{64}$/.test(String(authorizationNonce || ""))) {
          throw new Error("Yokefellow returned an invalid deposit authorization nonce.");
        }
        if (!Number.isInteger(validAfter) || validAfter < 0 || !Number.isInteger(validBefore) || validBefore <= 0) {
          throw new Error("Yokefellow returned an invalid deposit authorization window.");
        }
        const submittedResult = await appPost("/app/funding/submit", {
          amountYesRaw: amountRaw,
          referenceId,
          authorizationNonce,
          validAfter,
          validBefore,
          signature,
        });
        if (!submittedResult?.operation) throw new Error("Yokefellow did not accept the deposit authorization.");
      } else {
        if (prepared.approval) {
          await sendPreparedWalletTransaction(prepared.approval);
        }
        if (!prepared.transaction) throw new Error("Unavailable");
        await sendPreparedWalletTransaction(prepared.transaction);
      }`;

const patchedApp = replaceExactlyOnce(appSource, fundingClientBefore, fundingClientAfter, "browser funding execution block");
await fs.writeFile(appPath, patchedApp, "utf8");

console.log("YES DROP funding authorization patch applied: signed deposits + Network submission.");
await import(`./server.runtime.mjs?funding-auth=${Date.now()}`);
