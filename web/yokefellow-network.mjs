export function createYokefellowNetworkClient({
  baseUrl,
  appApiKey,
  bucketId,
}) {
  const origin = String(baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(appApiKey || "").trim();
  const normalizedBucketId = String(bucketId || "").trim().toLowerCase();

  function configured() {
    return Boolean(
      origin
      && apiKey.startsWith("yfk_")
      && /^0x[0-9a-f]{64}$/.test(normalizedBucketId)
    );
  }

  async function request(pathname, init = {}) {
    if (!configured()) {
      const error = new Error("Yokefellow Network is not configured for YES drop.");
      error.statusCode = 503;
      throw error;
    }

    const response = await fetch(`${origin}${pathname}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        typeof body?.message === "string"
          ? body.message
          : typeof body?.error === "string"
            ? body.error
            : `Yokefellow Network returned HTTP ${response.status}.`,
      );
      error.statusCode = response.status;
      error.code = typeof body?.error === "string" ? body.error : "";
      error.body = body;
      throw error;
    }
    return body;
  }

  return {
    configured,
    bucketId: normalizedBucketId,

    async health() {
      if (!origin) return { ok: false, configured: false };
      const response = await fetch(`${origin}/v1/health`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      return { configured: configured(), ...body };
    },

    async createParticipantChallenge(wallet) {
      const body = await request("/v1/participants/challenges", {
        method: "POST",
        body: JSON.stringify({ bucketId: normalizedBucketId, wallet }),
      });
      return body.challenge;
    },

    async createParticipantSession(challengeId, signature) {
      return request("/v1/participants/sessions", {
        method: "POST",
        body: JSON.stringify({ challengeId, signature }),
      });
    },

    async verifyParticipantSession(wallet, participantSessionToken) {
      return request("/v1/participants/verify", {
        method: "POST",
        body: JSON.stringify({
          bucketId: normalizedBucketId,
          wallet,
          participantSessionToken,
        }),
      });
    },

    async invokeAction({
      key,
      referenceId,
      wallet,
      participantSessionToken = "",
      data = {},
    }) {
      return request("/v1/actions/invoke", {
        method: "POST",
        body: JSON.stringify({
          bucketId: normalizedBucketId,
          key,
          referenceId,
          participant: { wallet },
          ...(participantSessionToken
            ? { participantSessionToken }
            : {}),
          data,
        }),
      });
    },

    async actionByReference(referenceId) {
      const query = new URLSearchParams({
        bucketId: normalizedBucketId,
        referenceId,
      });
      return request(`/v1/actions/by-reference?${query}`);
    },

    async reconcileAction(actionId) {
      return request(`/v1/actions/${encodeURIComponent(actionId)}/reconcile`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },

    async resumeAction(actionId) {
      return request(`/v1/actions/${encodeURIComponent(actionId)}/resume`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },

    async publishEvent({ type, referenceId, wallet = null, data = {}, schemaVersion = 1 }) {
      return request("/v1/app-events", {
        method: "POST",
        body: JSON.stringify({
          bucketId: normalizedBucketId,
          type,
          referenceId,
          schemaVersion,
          participant: wallet ? { wallet } : null,
          data,
        }),
      });
    },

    async holdings(wallet, { cursor = 0, limit = 200, collections = [] } = {}) {
      const query = new URLSearchParams({
        cursor: String(cursor),
        limit: String(limit),
      });
      if (collections.length) query.set("collections", collections.join(","));
      return request(
        `/v1/nfts/buckets/${encodeURIComponent(normalizedBucketId)}/holdings/${encodeURIComponent(wallet)}?${query}`,
      );
    },

    async getCredit(wallet) {
      const query = new URLSearchParams({ wallet });
      return request(
        `/v1/funding/buckets/${encodeURIComponent(normalizedBucketId)}/credit?${query}`,
      );
    },

    async getBucketFunding() {
      return request(
        `/v1/funding/buckets/${encodeURIComponent(normalizedBucketId)}`,
      );
    },

    async prepareFunding({ operation, wallet, amount, referenceId, participantSessionToken }) {
      const segment = operation === "deposit" ? "deposits" : "withdrawals";
      return request(
        `/v1/funding/buckets/${encodeURIComponent(normalizedBucketId)}/${segment}/prepare`,
        {
          method: "POST",
          body: JSON.stringify({
            wallet,
            amount,
            referenceId,
            participantSessionToken,
          }),
        },
      );
    },

    async fundingStatus({ operation, wallet, referenceId }) {
      const segment = operation === "deposit" ? "deposits" : "withdrawals";
      const query = new URLSearchParams({ wallet, referenceId });
      return request(
        `/v1/funding/buckets/${encodeURIComponent(normalizedBucketId)}/${segment}/status?${query}`,
      );
    },

    async listCapabilities() {
      const query = new URLSearchParams({ bucketId: normalizedBucketId });
      return request(`/v1/actions/capabilities?${query}`);
    },
  };
}
