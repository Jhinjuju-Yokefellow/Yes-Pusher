# YES Pusher Railway deployment

This patch adds deployment files only. It does not change the machine scene, camera, physics, pusher, peg wall, rainbow floor, toy powers, or payout geometry.

The hosted game uses two Railway services from the same GitHub repository:

- **yes-pusher-web**: browser build, wallet login, and signed session verification.
- **yes-pusher-machine**: one continuously running authoritative Godot machine.

## 1. Apply this patch

Extract this ZIP over the latest game folder after the CoinPusher 44 and 45 patches. Commit the result to a dedicated GitHub repository or branch.

The only existing source file replaced by this deployment patch is `web/server.mjs`. Its functional change is to permit HTTPS NFT metadata images in the hosted browser security policy.

## 2. Create the Railway services

Create an empty Railway project, then create two services connected to the same GitHub repository and branch.

### Web service

Name: `yes-pusher-web`

In **Settings → Config as Code**, set the config path to:

```text
/railway.web.toml
```

Generate a public domain under **Networking**.

Copy the values from `deploy/web.railway.env.example` into Railway Variables. Generate `SESSION_SECRET` locally with:

```powershell
.\deploy\NEW-SESSION-SECRET.ps1
```

Do not set the NFT mint private key or instant-mint secret yet.

### Machine service

Name: `yes-pusher-machine`

In **Settings → Config as Code**, set the config path to:

```text
/railway.machine.toml
```

Generate a public domain under **Networking**. Railway supplies `PORT`; the included start script passes that port to Godot's WebSocket server.

Attach a Railway volume with this mount path:

```text
/data
```

Copy the values from `deploy/machine.railway.env.example` into Railway Variables. Put the existing `coin-pusher` app secret in `YF_APP_API_KEY`. Never place it in the web service or browser files.

## 3. Connect the two domains

After Railway creates both domains, update these values and redeploy:

Web service:

```text
PUBLIC_ORIGIN=https://YOUR-WEB-DOMAIN
GAME_SERVER_URL=wss://YOUR-MACHINE-DOMAIN
```

Machine service:

```text
YF_SESSION_VERIFY_URL=https://YOUR-WEB-DOMAIN/auth/session/verify
```

`YF_API_BASE_URL` can be either the Yokefellow site origin or its `/api/sdk/v1` URL; the server normalizes the origin automatically.

## 4. Yokefellow app permissions

The saved `coin-pusher` connection must allow:

```text
coin_drop_started
coin_drop_completed
skin_drop_earned
toy_caught
```

Restrict the connection to:

```text
Coin Skin Drop
Catch a Toy
```

Do not attach `Craft a Bigger Toy` to the machine connection.

## 5. Hosted acceptance check

1. Open `https://YOUR-WEB-DOMAIN/health`; it should return `ok: true`.
2. Connect a wallet and sign the login message.
3. Confirm the browser reaches the shared machine over `wss://YOUR-MACHINE-DOMAIN`.
4. Open a second browser and verify both show the same machine state.
5. Complete a paid turn and verify the spend and payout credit in Yokefellow.
6. Verify a Coin Skin Drop after 100 lifetime coins physically paid out by the machine.
7. Catch a toy and verify the matching NFT metadata image appears.
8. Restart the machine service and verify the board restores from `/data/yes-pusher-shared-state.json`.

## Godot runtime

`Dockerfile.machine` installs Godot `4.7-beta3`, matching the project's `4.7` feature marker. Change `GODOT_VERSION` only after opening and validating the project with another engine version.
