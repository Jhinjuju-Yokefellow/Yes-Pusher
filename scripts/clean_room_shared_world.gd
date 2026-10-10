extends YesPusherSharedWorld
class_name YesDropCleanRoomSharedWorld

# Clean-room rule: Yokefellow Network holdings are the only authority for NFT
# ownership/equip state. Persistent machine state may retain turn/cooldown/
# settlement data, but it must never resurrect a previously owned NFT.

func _presentation_for_wallet(wallet: String, selected_skin: String) -> Dictionary:
	if _presentation_test_mode:
		return super._presentation_for_wallet(wallet, selected_skin)
	return {
		"version": 1,
		"source": "pending_yokefellow",
		"wallet": wallet,
		"profile": {},
		"equipped_skin": {
			"family": selected_skin,
			"label": _skin_display_name(selected_skin) if not selected_skin.is_empty() else "Default YES coin",
		},
		"toys": [],
		"loading": true,
	}

func _server_bootstrap() -> void:
	# Do not bootstrap from the legacy Bucket catalog. The first verified wallet
	# performs the authoritative Network-backed holdings read.
	if yf != null and yf.integration_ready():
		status_changed.emit("Shared server connected to Yokefellow Bucket %s." % yf.bucket_id)
	else:
		status_changed.emit("Shared server is running, but Yokefellow clean-room reads are not configured.")
	if not _active_turn.is_empty():
		call_deferred("_recover_active_turn")
	else:
		call_deferred("_process_next_turn")
	call_deferred("_process_settlement_outbox")

@rpc("any_peer", "call_remote", "reliable")
func _server_identify(wallet: String, session_token: String, requested_skin_family: String) -> void:
	if _presentation_test_mode:
		await super._server_identify(wallet, session_token, requested_skin_family)
		return
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var verification := await yf.verify_wallet_session(wallet, session_token)
	if not bool(verification.get("ok", false)):
		_client_identity_result.rpc_id(peer_id, false, "", [], String(verification.get("error", "Wallet verification failed.")))
		return
	var normalized_wallet := String(verification.get("wallet", wallet)).to_lower()
	var player := _player(normalized_wallet)
	player["peer_id"] = peer_id
	player["wallet"] = normalized_wallet
	player["verified"] = true
	player["skin_family"] = ""
	player["owned_skin_families"] = []
	_players[normalized_wallet] = player
	_players.erase(str(peer_id))

	# Verification is allowed to complete before the holdings request, but the
	# client receives an explicitly empty NFT inventory until Network answers.
	_client_identity_result.rpc_id(
		peer_id,
		true,
		normalized_wallet,
		[],
		"Wallet verified. Loading current Yokefellow NFT holdings… %s" % _turn_access_status_message(normalized_wallet)
	)
	_send_free_turn_state_to_peer(peer_id, normalized_wallet)
	_broadcast_queue_state()
	call_deferred("_server_load_identity_entitlements", peer_id, normalized_wallet, requested_skin_family)

func _server_load_identity_entitlements(peer_id: int, wallet: String, requested_skin_family: String) -> void:
	if _presentation_test_mode:
		await super._server_load_identity_entitlements(peer_id, wallet, requested_skin_family)
		return
	if not multiplayer.is_server() or not multiplayer.get_peers().has(peer_id):
		return
	var holdings_result := await yf.wallet_skin_families(wallet)
	if not multiplayer.get_peers().has(peer_id):
		return
	if not bool(holdings_result.get("ok", false)):
		_clear_player_nft_state(wallet)
		_save_state()
		_client_skin_entitlements.rpc_id(
			peer_id,
			false,
			[],
			"Wallet verified, but current Yokefellow NFT holdings could not be loaded. Inventory is empty until refresh succeeds. %s" % _turn_access_status_message(wallet)
		)
		return
	var owned_families: Array[String] = _normalized_family_array(holdings_result.get("families", []))
	var player := _player(wallet)
	var requested := _normalize_family(requested_skin_family)
	var selected := requested if requested.is_empty() or owned_families.has(requested) else ""
	player["owned_skin_families"] = owned_families
	player["skin_family"] = selected
	_players[wallet] = player
	_client_skin_entitlements.rpc_id(
		peer_id,
		true,
		owned_families,
		"Current Yokefellow NFT holdings loaded. %s" % _turn_access_status_message(wallet)
	)
	_save_state()

@rpc("any_peer", "call_remote", "reliable")
func _server_refresh_skin_entitlements() -> void:
	if _presentation_test_mode:
		await super._server_refresh_skin_entitlements()
		return
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _wallet_for_peer(peer_id)
	if wallet.is_empty():
		_client_skin_entitlements.rpc_id(peer_id, false, [], "A verified wallet is required before refreshing skins.")
		return
	var holdings_result := await yf.wallet_skin_families(wallet)
	if not bool(holdings_result.get("ok", false)):
		_clear_player_nft_state(wallet)
		_save_state()
		_client_skin_entitlements.rpc_id(
			peer_id,
			false,
			[],
			"Current Yokefellow NFT holdings could not be loaded. Inventory was cleared."
		)
		return
	var families: Array[String] = _normalized_family_array(holdings_result.get("families", []))
	var player := _player(wallet)
	player["owned_skin_families"] = families
	if not String(player.get("skin_family", "")).is_empty() and not families.has(String(player.get("skin_family", ""))):
		player["skin_family"] = ""
	_players[wallet] = player
	_client_skin_entitlements.rpc_id(peer_id, true, families, "Current Yokefellow NFT holdings refreshed.")
	_save_state()

@rpc("authority", "call_remote", "reliable")
func _client_skin_entitlements(ok: bool, owned_families: Array, message: String) -> void:
	if ok:
		local_owned_skin_families = _normalized_family_array(owned_families)
		if not local_skin_family.is_empty() and not local_owned_skin_families.has(local_skin_family):
			local_skin_family = ""
	else:
		# A failed authoritative read is empty, never "use the last good cache".
		local_owned_skin_families.clear()
		local_skin_family = ""
	owned_skins_changed.emit(local_owned_skin_families.duplicate(), local_skin_family)
	status_changed.emit(message)

@rpc("any_peer", "call_remote", "reliable")
func _server_set_skin_family(requested_skin_family: String) -> void:
	if _presentation_test_mode:
		super._server_set_skin_family(requested_skin_family)
		return
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _wallet_for_peer(peer_id)
	if wallet.is_empty():
		return
	var player := _player(wallet)
	var requested := _normalize_family(requested_skin_family)
	var owned: Array = player.get("owned_skin_families", [])
	if requested.is_empty() or owned.has(requested):
		player["skin_family"] = requested
		_players[wallet] = player

@rpc("any_peer", "call_remote", "reliable")
func _server_request_queue_join(requested_skin_family: String) -> void:
	if _presentation_test_mode:
		super._server_request_queue_join(requested_skin_family)
		return
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _wallet_for_peer(peer_id)
	if wallet.is_empty():
		_client_status.rpc_id(peer_id, "A verified wallet is required before joining the queue.")
		return
	var player := _player(wallet)
	var requested := _normalize_family(requested_skin_family)
	var owned: Array = player.get("owned_skin_families", [])
	if not requested.is_empty() and not owned.has(requested):
		_client_status.rpc_id(peer_id, "That wallet does not currently own the requested YES DROP skin.")
		return
	player["skin_family"] = requested
	_players[wallet] = player
	_enqueue_player(peer_id, wallet, requested)

func _load_state() -> void:
	super._load_state()
	if _presentation_test_mode:
		return
	_scrub_loaded_nft_state()
	# Rewrite the mounted state immediately so the stale NFT cache is removed
	# from disk as well as from memory.
	_save_state()

func _save_state() -> void:
	if _presentation_test_mode:
		super._save_state()
		return
	# Active-turn recovery may persist physics and settlement state, but an
	# equipped NFT is revalidated from holdings after reconnect and is not saved.
	var had_active_skin := _active_turn.has("skin_family")
	var active_skin: Variant = _active_turn.get("skin_family", "")
	if had_active_skin:
		_active_turn["skin_family"] = ""
	super._save_state()
	if had_active_skin:
		_active_turn["skin_family"] = active_skin

func _persistent_players() -> Dictionary:
	var result: Dictionary = super._persistent_players()
	if _presentation_test_mode:
		return result
	for key in result.keys():
		if not (result.get(key) is Dictionary):
			continue
		var player := (result.get(key) as Dictionary).duplicate(true)
		player.erase("owned_skin_families")
		player["skin_family"] = ""
		result[key] = player
	return result

func _scrub_loaded_nft_state() -> void:
	for key in _players.keys():
		if not (_players.get(key) is Dictionary):
			continue
		var player := (_players.get(key) as Dictionary).duplicate(true)
		player["owned_skin_families"] = []
		player["skin_family"] = ""
		_players[key] = player
	if not _active_turn.is_empty():
		_active_turn["skin_family"] = ""
	local_owned_skin_families.clear()
	local_skin_family = ""

func _clear_player_nft_state(wallet: String) -> void:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return
	var player := _player(normalized)
	player["owned_skin_families"] = []
	player["skin_family"] = ""
	_players[normalized] = player
