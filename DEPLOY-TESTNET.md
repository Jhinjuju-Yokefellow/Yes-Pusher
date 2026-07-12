# YES Pusher hosted test deployment

The hosted test uses two deployments from the same repository:

- **Vercel:** Vite/Three.js browser game.
- **Railway:** authoritative Node world server, physics, queue, wallet authentication, world persistence, and Yokefellow requests.

The world server is kept outside Vercel Functions because it owns a continuous physics loop and live event stream.

## 1. Push this folder to GitHub

Do not commit `.env`, `.world-data`, or an app key. The included `.gitignore` already excludes local secrets and world files.

## 2. Deploy the world server on Railway first

Create a Railway service from the GitHub repository. Railway reads `railway.json` from the project root.

Generate a public Railway domain, then add a persistent volume mounted at:

```text
/data
```

Set these Railway variables:

```dotenv
YES_PUSHER_REQUIRE_WALLET=true
YES_PUSHER_TEST_MODE=false
YES_PUSHER_DATA_DIR=/data
YES_PUSHER_TICK_RATE=45
YES_PUSHER_BROADCAST_RATE=2

# Add the final Vercel preview/production origin after Vercel is created.
# Multiple origins are comma-separated.
YES_PUSHER_ALLOWED_ORIGINS=https://YOUR-VERCEL-PROJECT.vercel.app

YF_API_BASE_URL=https://YOUR-YOKEFELLOW-TESTNET-DOMAIN/api/sdk/v1
YF_APP_KEY=YOUR_TEST_APP_KEY
YF_BUCKET_ID=bucket_78de9370-1f1d-4075-8145-1fba4d76b48b
YES_PUSHER_APP_SLUG=yes-pusher
YES_PUSHER_SKIN_DROP_TRIGGER_KEY=coin_pusher.random_skin_drop
YES_PUSHER_SKIN_DROP_OFFERING_NAME=Random Coin Skin Drop
YES_PUSHER_YES_PER_COIN_RAW=1000000000000000000
YF_CREDIT_GRANT_URL=
```

Confirm the Railway server is alive:

```text
https://YOUR-RAILWAY-DOMAIN/api/health
```

The response should include `"ok":true`, `"authoritative":true`, and the starting coin count.

## 3. Deploy the browser game on Vercel

Import the same GitHub repository into Vercel. `vercel.json` configures the Vite build.

Add this Vercel environment variable before deploying:

```dotenv
VITE_WORLD_SERVER_URL=https://YOUR-RAILWAY-DOMAIN
```

This value is public and is compiled into the browser bundle. Do not put `YF_APP_KEY` or any other server secret in Vercel `VITE_*` variables.

## 4. Finish the origin lock

Copy the exact Vercel production URL and set it as Railway's `YES_PUSHER_ALLOWED_ORIGINS`. Redeploy/restart the Railway service after changing the variable.

For Vercel preview deployments, add each preview origin temporarily or use a stable custom test domain. Production should use an explicit origin list rather than allowing every origin.

## 5. Test

1. Open the Vercel URL.
2. Connect and sign with the test wallet.
3. Join the queue.
4. Start a turn.
5. Open the Vercel URL in another browser to verify both clients see the same machine.
6. Reach a 50-coin milestone and inspect the world-server logs for `coin_pusher.random_skin_drop`.
7. Confirm the returned output maps to one of the fifteen `yes_drop.*` skin identifiers.

The world server stores confirmed world, player progress, and settlement outbox files in the Railway volume. Redeploying the frontend does not reset the machine.


## Confirm live or fallback synchronization

Open `https://YOUR-RAILWAY-DOMAIN/api/health`. A normal live connection reports `streamConnections: 1` or higher. If the stream is interrupted but the frontend remains synchronized, `pollingClients` reports the fallback client instead. Both modes use the same authoritative Railway world.
