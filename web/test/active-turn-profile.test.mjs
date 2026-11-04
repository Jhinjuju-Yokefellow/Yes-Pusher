import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../../scripts/yokefellow_server_client.gd", import.meta.url), "utf8");
const shared = readFileSync(new URL("../../scripts/shared_world.gd", import.meta.url), "utf8");
const game = readFileSync(new URL("../../scripts/main.gd", import.meta.url), "utf8");

test("active turns use the canonical Profile Card without reimplementing user identity", () => {
  assert.match(client, /func load_profile_card\(wallet: String\)/);
  assert.match(client, /\/api\/profile\/card\?walletAddress=/);
  assert.match(client, /profile_card\.v1/);
  assert.match(client, /var profile_result := await load_profile_card\(normalized\)/);
  assert.match(shared, /await yf\.load_player_presentation\(wallet\)/);
  assert.match(shared, /active_player_presentation_changed\.emit\(_live_player_presentation\.duplicate\(true\)\)/);
  assert.match(game, /_render_active_player_presentation\(presentation\)/);
  assert.match(game, /profile\.get\("featuredOutputs"/);
});

test("shared profile lookup is bounded and isolated from wallet signature and NFT reads", () => {
  assert.match(client, /PROFILE_CARD_CACHE_OK_SECONDS: int = 3600/);
  assert.match(client, /PROFILE_CARD_CACHE_RETRY_SECONDS: int = 300/);
  assert.match(client, /PROFILE_CARD_CACHE_MAX_WALLETS: int = 128/);
  assert.match(client, /_profile_card_cache\.get\(normalized/);
  assert.match(client, /func _cache_profile_card\(/);
  assert.match(client, /func _profile_api_origin\(/);
  const loader = client.split("func load_profile_card(wallet: String) -> Dictionary:")[1]
    ?.split("func _profile_api_origin()")[0];
  assert(loader);
  assert.doesNotMatch(loader, /verify_wallet_session|sign|eth_call|load_wallet_holdings/);
  assert.match(client, /var holdings_result := await load_wallet_holdings\(normalized\)/);
});
