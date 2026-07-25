extends Node
class_name YesPusherSharedWorld

signal status_changed(message: String)
signal queue_changed(position: int, total: int)
signal active_player_changed(wallet: String, turn_id: String)
signal local_identity_changed(wallet: String, verified: bool)
signal owned_skins_changed(families: Array, equipped: String)
signal settlement_changed(message: String)
signal remote_turn_reveal_started(summary: Dictionary, wallet: String)
signal remote_turn_finished(summary: Dictionary, wallet: String, lifetime_yes: int, milestones: Array)
signal reward_wheel_available(values: PackedInt32Array)
signal reward_wheel_result(value: int)
signal nft_awarded(award: Dictionary)

const FIXED_DROP_COUNT := 10
const SKIN_DROP_EVERY_COINS := 100
const STATE_VERSION := 1
const DEFAULT_PORT := 8787
const DEFAULT_MAX_CLIENTS := 128
const SETTLEMENT_RETRY_SECONDS := 10.0
const WEBSOCKET_BUFFER_BYTES := 4194304
const WEBSOCKET_SNAPSHOT_BACKPRESSURE_BYTES := 1048576
const NFT_AWARD_MESSAGE_PREFIX := "__YES_PUSHER_NFT_AWARD__"

var machine: YesPusherMachine
var yf: YokefellowServerClient
var mode: String = "local"
var local_wallet: String = ""
var local_session_token: String = ""
var local_skin_family: String = ""
var local_owned_skin_families: Array[String] = []
var local_verified: bool = false
var _client_connected: bool = false

var _server_port: int = DEFAULT_PORT
var _server_host: String = "127.0.0.1"
var _server_bind: String = "*"
var _server_url: String = ""
var _transport: String = "websocket"
var _snapshot_interval: float = 0.10
var _snapshot_elapsed: float = 0.0
var _websocket_peer: WebSocketMultiplayerPeer
var _turn_sequence: int = 0
var _queue: Array[Dictionary] = []
var _players: Dictionary = {}
var _active_turn: Dictionary = {}
var _settlements: Array[Dictionary] = []
var _processing_queue: bool = false
var _settlement_worker_active: bool = false
var _settlement_retry_elapsed: float = 0.0
var _state_path: String = "user://yes-pusher-shared-state.json"

func configure(target_machine: YesPusherMachine) -> void:
	machine = target_machine
	yf = YokefellowServerClient.new()
	yf.name = "YokefellowServerClient"
	add_child(yf)
	machine.reward_wheel_requested.connect(_on_authoritative_reward_wheel_requested)
	machine.reward_wheel_awarded.connect(_on_authoritative_reward_wheel_awarded)
	_read_environment()
	_start_mode()

func _read_environment() -> void:
	mode = OS.get_environment("YES_PUSHER_NETWORK_MODE").strip_edges().to_lower()
	var args := OS.get_cmdline_args()
	if args.has("--server"):
		mode = "server"
	elif args.has("--client"):
		mode = "client"
	if mode not in ["server", "client", "local"]:
		mode = "client" if not OS.get_environment("YES_PUSHER_SERVER_HOST").strip_edges().is_empty() else "local"
	_server_host = _env_or("YES_PUSHER_SERVER_HOST", "127.0.0.1")
	_server_bind = _env_or("YES_PUSHER_SERVER_BIND", "*")
	_server_port = _env_int("YES_PUSHER_SERVER_PORT", DEFAULT_PORT, 1, 65535)
	_server_url = OS.get_environment("YES_PUSHER_SERVER_URL").strip_edges()
	_transport = _env_or("YES_PUSHER_TRANSPORT", "websocket").to_lower()
	if _transport not in ["websocket", "enet"]:
		_transport = "websocket"
	if _server_url.is_empty():
		_server_url = "ws://%s:%d" % [_server_host, _server_port]
	_snapshot_interval = 1.0 / float(_env_int("YES_PUSHER_SNAPSHOT_RATE", 10, 5, 15))
	_state_path = _env_or("YES_PUSHER_STATE_PATH", "user://yes-pusher-shared-state.json")
	local_wallet = OS.get_environment("YF_WALLET_ADDRESS").strip_edges().to_lower()
	local_session_token = OS.get_environment("YF_WALLET_SESSION_TOKEN").strip_edges()
	local_skin_family = _normalize_family(OS.get_environment("YF_ACTIVE_TOY_FAMILY"))
	if local_skin_family.is_empty():
		local_skin_family = _family_from_skin_key(OS.get_environment("YF_ACTIVE_SKIN_KEY"))
	if OS.has_feature("web"):
		_read_browser_bootstrap()


func _read_browser_bootstrap() -> void:
	# The surrounding same-origin wallet page owns login. The Godot web client
	# receives only a short-lived wallet session and the public WebSocket URL.
	mode = "client"
	_transport = "websocket"
	var wallet_value: Variant = JavaScriptBridge.eval(
		"(window.parent && window.parent.YES_PUSHER_BOOTSTRAP && window.parent.YES_PUSHER_BOOTSTRAP.wallet) || ''",
		true
	)
	var token_value: Variant = JavaScriptBridge.eval(
		"(window.parent && window.parent.YES_PUSHER_BOOTSTRAP && window.parent.YES_PUSHER_BOOTSTRAP.sessionToken) || ''",
		true
	)
	var server_value: Variant = JavaScriptBridge.eval(
		"(window.parent && window.parent.YES_PUSHER_BOOTSTRAP && window.parent.YES_PUSHER_BOOTSTRAP.serverUrl) || ''",
		true
	)
	local_wallet = String(wallet_value).strip_edges().to_lower()
	local_session_token = String(token_value).strip_edges()
	var browser_server_url := String(server_value).strip_edges()
	if not browser_server_url.is_empty():
		_server_url = browser_server_url
	JavaScriptBridge.eval(
		"window.parent && window.parent.postMessage({type:'yes-pusher-ready'}, window.location.origin)",
		true
	)

func is_web_client() -> bool:
	return OS.has_feature("web") and mode == "client"

func _start_mode() -> void:
	if machine == null:
		push_error("Shared world requires a machine.")
		return
	match mode:
		"server":
			_start_server()
		"client":
			_start_client()
		_:
			machine.set_authoritative(true)
			local_verified = true
			status_changed.emit("Local machine mode. Every turn drops 10 coins.")

func _start_server() -> void:
	machine.set_authoritative(true)
	# Machine startup seeds its physical bed asynchronously. Do not restore the
	# persistent shared state until that initial reset has fully finished.
	while machine.is_resetting():
		await get_tree().process_frame
	var error := OK
	var created_peer: MultiplayerPeer
	if _transport == "enet":
		var enet_peer := ENetMultiplayerPeer.new()
		error = enet_peer.create_server(_server_port, DEFAULT_MAX_CLIENTS)
		created_peer = enet_peer
	else:
		var websocket_peer := WebSocketMultiplayerPeer.new()
		websocket_peer.inbound_buffer_size = WEBSOCKET_BUFFER_BYTES
		websocket_peer.outbound_buffer_size = WEBSOCKET_BUFFER_BYTES
		websocket_peer.max_queued_packets = 256
		error = websocket_peer.create_server(_server_port, _server_bind)
		created_peer = websocket_peer
		_websocket_peer = websocket_peer
	if error != OK:
		status_changed.emit("Shared server failed to start: %s" % error_string(error))
		return
	multiplayer.multiplayer_peer = created_peer
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	_load_state()
	# A previously saved empty snapshot can clear the freshly seeded bed. An
	# empty shared machine cannot run a useful coin-pusher turn, so repair only
	# that invalid startup state and immediately persist the corrected bed.
	if _active_turn.is_empty() and machine.active_coin_count() <= 0:
		machine.reset_machine()
		while machine.is_resetting():
			await get_tree().process_frame
		_save_state()
	status_changed.emit("Authoritative shared machine listening on %s port %d." % [_transport, _server_port])
	call_deferred("_server_bootstrap")

func _start_client() -> void:
	machine.set_authoritative(false)
	var error := OK
	var created_peer: MultiplayerPeer
	if _transport == "enet":
		var enet_peer := ENetMultiplayerPeer.new()
		error = enet_peer.create_client(_server_host, _server_port)
		created_peer = enet_peer
	else:
		var websocket_peer := WebSocketMultiplayerPeer.new()
		websocket_peer.inbound_buffer_size = WEBSOCKET_BUFFER_BYTES
		websocket_peer.outbound_buffer_size = WEBSOCKET_BUFFER_BYTES
		websocket_peer.max_queued_packets = 256
		error = websocket_peer.create_client(_server_url)
		created_peer = websocket_peer
		_websocket_peer = websocket_peer
	if error != OK:
		status_changed.emit("Could not connect to the shared machine: %s" % error_string(error))
		return
	multiplayer.multiplayer_peer = created_peer
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)
	var target := "%s:%d" % [_server_host, _server_port] if _transport == "enet" else _server_url
	status_changed.emit("Connecting to shared machine at %s…" % target)

func _server_bootstrap() -> void:
	var catalog_result := await yf.load_catalog()
	if bool(catalog_result.get("ok", false)):
		status_changed.emit("Shared server loaded bucket %s." % yf.bucket_id)
	else:
		status_changed.emit("Shared server is running, but bucket catalog loading failed: %s" % catalog_result.get("error", "unknown error"))
	if not _active_turn.is_empty():
		call_deferred("_recover_active_turn")
	else:
		call_deferred("_process_next_turn")
	call_deferred("_process_settlement_outbox")

func _process(delta: float) -> void:
	if mode != "server" or not multiplayer.is_server() or machine == null:
		return
	_snapshot_elapsed += delta
	var effective_snapshot_interval := _snapshot_interval if not _active_turn.is_empty() else 1.0
	if _snapshot_elapsed >= effective_snapshot_interval:
		_snapshot_elapsed = 0.0
		_broadcast_world_snapshot()
	_settlement_retry_elapsed += delta
	if _settlement_retry_elapsed >= SETTLEMENT_RETRY_SECONDS:
		_settlement_retry_elapsed = 0.0
		if _has_retryable_settlements():
			call_deferred("_process_settlement_outbox")

func identify_local_player(wallet: String, session_token: String) -> void:
	local_wallet = wallet.strip_edges().to_lower()
	local_session_token = session_token.strip_edges()
	local_verified = false
	local_identity_changed.emit(local_wallet, false)
	if mode == "client":
		if not _client_connected:
			status_changed.emit("Wallet saved. Waiting for the shared server connection before verification.")
			return
		_server_identify.rpc_id(1, local_wallet, local_session_token, local_skin_family)
	elif mode == "server":
		if _is_wallet(local_wallet):
			local_verified = true
			local_identity_changed.emit(local_wallet, true)
	else:
		local_verified = _is_wallet(local_wallet) or local_wallet.is_empty()
		local_identity_changed.emit(local_wallet, local_verified)

func request_turn(skin_family: String = "") -> void:
	var normalized_family := _normalize_family(skin_family)
	if mode == "local":
		if machine.is_turn_active():
			return
		machine.queue_turn_toy(normalized_family)
		machine.set_turn_seed(randi())
		machine.drop_coins(FIXED_DROP_COUNT)
		return
	if mode == "server":
		if not _is_wallet(local_wallet):
			status_changed.emit("Set YF_WALLET_ADDRESS before joining the server queue locally.")
			return
		_server_enqueue_local(local_wallet, normalized_family)
		return
	if not local_verified:
		status_changed.emit("A verified wallet session is required before joining the queue.")
		return
	_server_request_queue_join.rpc_id(1, normalized_family)

func leave_queue() -> void:
	if mode == "client":
		_server_request_queue_leave.rpc_id(1)
	elif mode == "server":
		_remove_wallet_from_queue(local_wallet)

func set_local_skin_family(value: String) -> void:
	var requested := _normalize_family(value)
	if mode == "client" and local_verified and not requested.is_empty() and not local_owned_skin_families.has(requested):
		status_changed.emit("That wallet does not currently own the requested YES Pusher skin.")
		return
	local_skin_family = requested
	owned_skins_changed.emit(local_owned_skin_families.duplicate(), local_skin_family)
	if mode == "client" and local_verified:
		_server_set_skin_family.rpc_id(1, local_skin_family)

func refresh_owned_skins() -> void:
	if mode != "client" or not local_verified:
		status_changed.emit("Verify the wallet before refreshing owned skins.")
		return
	status_changed.emit("Refreshing wallet-owned coin skins…")
	_server_refresh_skin_entitlements.rpc_id(1)

func request_reward_wheel_spin() -> void:
	if mode == "client":
		_server_request_reward_wheel_spin.rpc_id(1)
	elif mode == "server":
		machine.resolve_clover_server_spin()

func is_network_client() -> bool:
	return mode == "client"

func is_authoritative() -> bool:
	return mode != "client"

func queue_position_for_local_player() -> int:
	if mode == "server":
		return _queue_position_for_wallet(local_wallet)
	return -1

func authoritative_turn_reveal_started(summary: Dictionary) -> void:
	if mode != "server" or _active_turn.is_empty():
		return
	var safe_summary: Dictionary = summary.duplicate(true)
	var payout: int = maxi(0, int(safe_summary.get("total_yes", 0)))
	_active_turn["latest_payout_yes"] = payout
	_active_turn["result_summary"] = safe_summary
	_active_turn["status"] = "revealing_result"
	_save_state()
	var wallet: String = String(_active_turn.get("wallet", ""))
	if not multiplayer.get_peers().is_empty():
		_client_turn_reveal_started.rpc(safe_summary, wallet)

func authoritative_turn_completed(summary: Dictionary) -> void:
	if mode != "server" or _active_turn.is_empty():
		return
	var safe_summary: Dictionary = summary.duplicate(true)
	var payout: int = maxi(0, int(safe_summary.get("total_yes", 0)))
	var completed: Dictionary = _active_turn.duplicate(true)
	completed["payout_yes"] = payout
	completed["result_summary"] = safe_summary
	completed["status"] = "settlement_pending"
	completed["completed_at_unix"] = Time.get_unix_time_from_system()
	var wallet := String(completed.get("wallet", ""))
	var player: Dictionary = _player(wallet)
	var old_lifetime: int = int(player.get("lifetime_yes", 0))
	var new_lifetime: int = old_lifetime + payout
	var paid_out_this_turn: int = maxi(0, int(safe_summary.get("caught_coin_count", safe_summary.get("caught_base_yes", 0))))
	var old_lifetime_paid_out: int = int(player.get("lifetime_coins_paid_out", 0))
	var new_lifetime_paid_out: int = old_lifetime_paid_out + paid_out_this_turn
	player["lifetime_yes"] = new_lifetime
	player["lifetime_coins_paid_out"] = new_lifetime_paid_out
	_players[wallet] = player
	var old_milestones: int = floori(float(old_lifetime_paid_out) / float(SKIN_DROP_EVERY_COINS))
	var new_milestones: int = floori(float(new_lifetime_paid_out) / float(SKIN_DROP_EVERY_COINS))
	var milestones: Array[int] = []
	for milestone_number in range(old_milestones + 1, new_milestones + 1):
		milestones.append(milestone_number)
	safe_summary["lifetime_coins_paid_out"] = new_lifetime_paid_out
	safe_summary["skin_drop_every_coins"] = SKIN_DROP_EVERY_COINS
	completed["skin_milestones"] = milestones
	completed["skin_milestones_confirmed"] = []
	var completed_toy_captures: Array = []
	var completed_toy_captures_value: Variant = safe_summary.get("toy_captures", [])
	if completed_toy_captures_value is Array:
		completed_toy_captures = (completed_toy_captures_value as Array).duplicate(true)
	completed["toy_captures"] = completed_toy_captures
	completed["toy_captures_confirmed"] = []
	_settlements.append(completed)
	if not multiplayer.get_peers().is_empty():
		_client_turn_completed.rpc(safe_summary, wallet, new_lifetime, milestones)
	_active_turn = {}
	_save_state()
	_broadcast_queue_state()
	active_player_changed.emit("", "")
	call_deferred("_process_settlement_outbox")
	call_deferred("_process_next_turn")

func authoritative_payout_corrected(corrected_payout: int) -> void:
	if mode == "server" and not _active_turn.is_empty():
		_active_turn["latest_payout_yes"] = corrected_payout

func _on_connected_to_server() -> void:
	_client_connected = true
	if local_wallet.is_empty():
		status_changed.emit("Connected as a spectator. Enter a wallet session to join the queue.")
	else:
		status_changed.emit("Connected. Verifying wallet session…")
		_server_identify.rpc_id(1, local_wallet, local_session_token, local_skin_family)

func _on_connection_failed() -> void:
	_client_connected = false
	local_verified = false
	status_changed.emit("Connection to the shared machine failed.")

func _on_server_disconnected() -> void:
	_client_connected = false
	local_verified = false
	status_changed.emit("Disconnected from the shared machine. Reconnect before joining another turn.")

func _on_peer_connected(peer_id: int) -> void:
	_players[str(peer_id)] = {"peer_id": peer_id, "wallet": "", "verified": false, "skin_family": "", "lifetime_yes": 0, "lifetime_coins_paid_out": 0}
	_broadcast_queue_state()

func _on_peer_disconnected(peer_id: int) -> void:
	var wallet := _wallet_for_peer(peer_id)
	_remove_peer_from_queue(peer_id)
	_players.erase(str(peer_id))
	if not wallet.is_empty() and _players.has(wallet):
		var player := _players[wallet] as Dictionary
		player["peer_id"] = 0
		_players[wallet] = player
	_broadcast_queue_state()

@rpc("any_peer", "call_remote", "reliable")
func _server_identify(wallet: String, session_token: String, requested_skin_family: String) -> void:
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var verification := await yf.verify_wallet_session(wallet, session_token)
	if not bool(verification.get("ok", false)):
		_client_identity_result.rpc_id(peer_id, false, "", [], String(verification.get("error", "Wallet verification failed.")))
		return
	var normalized_wallet := String(verification.get("wallet", wallet)).to_lower()
	var prior := _player(normalized_wallet)
	var cached_owned: Array[String] = _normalized_family_array(prior.get("owned_skin_families", []))
	var requested := _normalize_family(requested_skin_family)
	var selected := requested if requested.is_empty() or cached_owned.has(requested) or yf.allow_unverified_wallets else ""
	prior["peer_id"] = peer_id
	prior["wallet"] = normalized_wallet
	prior["verified"] = true
	prior["skin_family"] = selected
	prior["owned_skin_families"] = cached_owned
	_players[normalized_wallet] = prior
	_players.erase(str(peer_id))

	# Wallet verification controls whether the player can enter the queue. Do not
	# block it behind a second network request for NFT entitlements. Confirm the
	# signed session now, then refresh the equip menu independently.
	_client_identity_result.rpc_id(peer_id, true, normalized_wallet, cached_owned, "Wallet verified. Loading owned skins…")
	_broadcast_queue_state()
	call_deferred("_server_load_identity_entitlements", peer_id, normalized_wallet, requested_skin_family)

func _server_load_identity_entitlements(peer_id: int, wallet: String, requested_skin_family: String) -> void:
	if not multiplayer.is_server() or not multiplayer.get_peers().has(peer_id):
		return
	var entitlement_result := await yf.wallet_skin_families(wallet)
	if not multiplayer.get_peers().has(peer_id):
		return
	if not bool(entitlement_result.get("ok", false)):
		_client_skin_entitlements.rpc_id(peer_id, false, [], "Wallet verified. Owned skins could not be refreshed yet.")
		return
	var owned_families: Array[String] = _normalized_family_array(entitlement_result.get("families", []))
	var player := _player(wallet)
	var requested := _normalize_family(requested_skin_family)
	var selected := requested if requested.is_empty() or owned_families.has(requested) or yf.allow_unverified_wallets else ""
	player["owned_skin_families"] = owned_families
	player["skin_family"] = selected
	_players[wallet] = player
	_client_skin_entitlements.rpc_id(peer_id, true, owned_families, "Wallet verified. Owned skins loaded.")
	_save_state()

@rpc("authority", "call_remote", "reliable")
func _client_identity_result(verified: bool, wallet: String, owned_families: Array, message: String) -> void:
	local_verified = verified
	if verified:
		local_owned_skin_families = _normalized_family_array(owned_families)
	else:
		local_owned_skin_families.clear()
	if verified:
		local_wallet = wallet
	if verified and not local_skin_family.is_empty() and not local_owned_skin_families.has(local_skin_family):
		local_skin_family = ""
	local_identity_changed.emit(local_wallet, verified)
	owned_skins_changed.emit(local_owned_skin_families.duplicate(), local_skin_family)
	status_changed.emit(message)

@rpc("any_peer", "call_remote", "reliable")
func _server_request_queue_join(requested_skin_family: String) -> void:
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
	if not requested.is_empty() and not owned.has(requested) and not yf.allow_unverified_wallets:
		_client_status.rpc_id(peer_id, "That wallet does not currently own the requested YES Pusher skin.")
		return
	player["skin_family"] = requested
	_players[wallet] = player
	_enqueue_player(peer_id, wallet, requested)

@rpc("any_peer", "call_remote", "reliable")
func _server_request_queue_leave() -> void:
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	_remove_peer_from_queue(peer_id)
	_broadcast_queue_state()

@rpc("any_peer", "call_remote", "reliable")
func _server_set_skin_family(requested_skin_family: String) -> void:
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _wallet_for_peer(peer_id)
	if wallet.is_empty():
		return
	var player := _player(wallet)
	var requested := _normalize_family(requested_skin_family)
	var owned: Array = player.get("owned_skin_families", [])
	if requested.is_empty() or owned.has(requested) or yf.allow_unverified_wallets:
		player["skin_family"] = requested
		_players[wallet] = player

@rpc("any_peer", "call_remote", "reliable")
func _server_refresh_skin_entitlements() -> void:
	if not multiplayer.is_server():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _wallet_for_peer(peer_id)
	if wallet.is_empty():
		_client_skin_entitlements.rpc_id(peer_id, false, [], "A verified wallet is required before refreshing skins.")
		return
	var entitlement_result := await yf.wallet_skin_families(wallet)
	if not bool(entitlement_result.get("ok", false)):
		_client_skin_entitlements.rpc_id(peer_id, false, [], String(entitlement_result.get("error", "Wallet skins could not be refreshed.")))
		return
	var families: Array[String] = _normalized_family_array(entitlement_result.get("families", []))
	var player := _player(wallet)
	player["owned_skin_families"] = families
	if not String(player.get("skin_family", "")).is_empty() and not families.has(String(player.get("skin_family", ""))):
		player["skin_family"] = ""
	_players[wallet] = player
	_client_skin_entitlements.rpc_id(peer_id, true, families, "Wallet-owned coin skins refreshed.")
	_save_state()

@rpc("authority", "call_remote", "reliable")
func _client_skin_entitlements(ok: bool, owned_families: Array, message: String) -> void:
	if ok:
		local_owned_skin_families = _normalized_family_array(owned_families)
		if not local_skin_family.is_empty() and not local_owned_skin_families.has(local_skin_family):
			local_skin_family = ""
	owned_skins_changed.emit(local_owned_skin_families.duplicate(), local_skin_family)
	status_changed.emit(message)

@rpc("any_peer", "call_remote", "reliable")
func _server_request_reward_wheel_spin() -> void:
	if not multiplayer.is_server() or _active_turn.is_empty():
		return
	var peer_id := multiplayer.get_remote_sender_id()
	if peer_id != int(_active_turn.get("peer_id", 0)):
		_client_status.rpc_id(peer_id, "Only the active player can spin this turn's Lucky Wheel.")
		return
	var selected := machine.resolve_clover_server_spin()
	if selected < 0:
		_client_status.rpc_id(peer_id, "No Lucky Wheel spin is waiting for this turn.")

@rpc("authority", "call_remote", "reliable")
func _client_reward_wheel_available(values: PackedInt32Array) -> void:
	reward_wheel_available.emit(values)

@rpc("authority", "call_remote", "reliable")
func _client_reward_wheel_result(value: int) -> void:
	reward_wheel_result.emit(value)

@rpc("authority", "call_remote", "reliable")
func _client_turn_reveal_started(summary: Dictionary, wallet: String) -> void:
	remote_turn_reveal_started.emit(summary.duplicate(true), wallet)

@rpc("authority", "call_remote", "reliable")
func _client_turn_completed(summary: Dictionary, wallet: String, lifetime_yes: int, milestones: Array) -> void:
	var safe_summary: Dictionary = summary.duplicate(true)
	var payout: int = maxi(0, int(safe_summary.get("total_yes", 0)))
	remote_turn_finished.emit(safe_summary, wallet, lifetime_yes, milestones)
	if wallet.to_lower() != local_wallet.to_lower():
		return
	var lifetime_paid_out := maxi(0, int(safe_summary.get("lifetime_coins_paid_out", 0)))
	if milestones.is_empty():
		status_changed.emit("Your 10-coin turn finished with %d YES. Skin progress: %d / %d coins paid out." % [payout, lifetime_paid_out % SKIN_DROP_EVERY_COINS, SKIN_DROP_EVERY_COINS])
	else:
		status_changed.emit("Your turn finished with %d YES and earned %d Coin Skin Drop%s for reaching %d lifetime coin payouts." % [payout, milestones.size(), "" if milestones.size() == 1 else "s", lifetime_paid_out])

func _send_nft_award_to_peer(peer_id: int, award: Dictionary) -> void:
	if peer_id <= 1:
		nft_awarded.emit(award.duplicate(true))
		return
	# Reuse the existing status RPC so adding the NFT presentation does not
	# change the client/server RPC map and break shared-machine compatibility.
	_client_status.rpc_id(peer_id, NFT_AWARD_MESSAGE_PREFIX + JSON.stringify(award))

@rpc("authority", "call_remote", "reliable")
func _client_status(message: String) -> void:
	if message.begins_with(NFT_AWARD_MESSAGE_PREFIX):
		var encoded := message.substr(NFT_AWARD_MESSAGE_PREFIX.length())
		var parsed: Variant = JSON.parse_string(encoded)
		if parsed is Dictionary:
			nft_awarded.emit((parsed as Dictionary).duplicate(true))
		else:
			push_warning("Received an invalid NFT award payload from the shared server.")
		return
	status_changed.emit(message)

@rpc("authority", "call_remote", "reliable")
func _client_queue_state(entries: Array, active: Dictionary) -> void:
	var position := -1
	for index in range(entries.size()):
		var entry := entries[index] as Dictionary
		if String(entry.get("wallet", "")).to_lower() == local_wallet.to_lower():
			position = index + 1
			break
	queue_changed.emit(position, entries.size())
	var active_wallet := String(active.get("wallet", ""))
	var active_turn_id := String(active.get("turn_id", ""))
	active_player_changed.emit(active_wallet, active_turn_id)

@rpc("authority", "call_remote", "unreliable_ordered", 0)
func _client_world_snapshot(snapshot: Dictionary) -> void:
	if mode != "client" or machine == null:
		return
	machine.apply_world_snapshot(snapshot.get("world", {}) as Dictionary)
	var active := snapshot.get("active_turn", {}) as Dictionary
	var payout := int(active.get("latest_payout_yes", 0))
	if not active.is_empty() and String(active.get("wallet", "")) == local_wallet:
		if String(active.get("status", "")) == "revealing_result":
			status_changed.emit("Your turn is settling. Current payout: %d YES." % payout)
		else:
			status_changed.emit("Your 10-coin turn is running. Current caught value: %d YES." % payout)

func _server_enqueue_local(wallet: String, skin_family: String) -> void:
	var player := _player(wallet)
	player["peer_id"] = 1
	player["wallet"] = wallet
	player["verified"] = true
	player["skin_family"] = skin_family
	_players[wallet] = player
	_enqueue_player(1, wallet, skin_family)

func _enqueue_player(peer_id: int, wallet: String, skin_family: String) -> void:
	if _active_turn.get("wallet", "") == wallet:
		_client_status_for(peer_id, "Your turn is already active.")
		return
	for entry in _queue:
		if String(entry.get("wallet", "")) == wallet:
			_client_status_for(peer_id, "You are already in the queue.")
			return
	_turn_sequence += 1
	var request_id := "turn_%d_%d" % [int(Time.get_unix_time_from_system()), _turn_sequence]
	_queue.append({
		"peer_id": peer_id,
		"wallet": wallet,
		"skin_family": skin_family,
		"request_id": request_id,
		"joined_at_unix": Time.get_unix_time_from_system(),
	})
	_client_status_for(peer_id, "Added to the shared queue. Every turn drops exactly 10 coins.")
	_broadcast_queue_state()
	call_deferred("_process_next_turn")

func _process_next_turn() -> void:
	if mode != "server" or _processing_queue or machine.is_turn_active() or not _active_turn.is_empty() or _queue.is_empty():
		return
	_processing_queue = true
	var entry := _queue.pop_front() as Dictionary
	_broadcast_queue_state()
	var turn_id := String(entry.get("request_id", ""))
	var wallet := String(entry.get("wallet", "")).to_lower()
	var seed := randi()
	_active_turn = {
		"turn_id": turn_id,
		"wallet": wallet,
		"peer_id": int(entry.get("peer_id", 0)),
		"skin_family": String(entry.get("skin_family", "")),
		"drop_count": FIXED_DROP_COUNT,
		"seed": seed,
		"status": "charging",
		"pre_turn_world": machine.export_world_snapshot(),
		"latest_payout_yes": 0,
		"started_at_unix": 0,
	}
	_save_state()
	var spend_result := await yf.spend_turn_credit(wallet, turn_id)
	if not bool(spend_result.get("ok", false)):
		var message := "Turn could not start: %s" % spend_result.get("error", "bucket credit charge failed")
		_client_status_for(int(entry.get("peer_id", 0)), message)
		_active_turn = {}
		_save_state()
		_processing_queue = false
		_broadcast_queue_state()
		call_deferred("_process_next_turn")
		return
	_active_turn["status"] = "charged"
	_save_state()
	_start_active_turn()
	_processing_queue = false

func _start_active_turn() -> void:
	if _active_turn.is_empty() or machine.is_turn_active():
		return
	_active_turn["status"] = "running"
	_active_turn["started_at_unix"] = Time.get_unix_time_from_system()
	_save_state()
	var wallet := String(_active_turn.get("wallet", ""))
	var turn_id := String(_active_turn.get("turn_id", ""))
	active_player_changed.emit(wallet, turn_id)
	_broadcast_queue_state()
	_client_status_for(int(_active_turn.get("peer_id", 0)), "Your paid 10-coin turn is starting.")
	machine.set_turn_seed(int(_active_turn.get("seed", 0)))
	machine.queue_turn_toy(String(_active_turn.get("skin_family", "")))
	machine.drop_coins(FIXED_DROP_COUNT)

func _recover_active_turn() -> void:
	if _active_turn.is_empty():
		return
	var pre_turn_world := _active_turn.get("pre_turn_world", {}) as Dictionary
	if not pre_turn_world.is_empty():
		machine.restore_authoritative_snapshot(pre_turn_world)
	var status := String(_active_turn.get("status", "charging"))
	if status == "charging":
		var spend_result := await yf.spend_turn_credit(String(_active_turn.get("wallet", "")), String(_active_turn.get("turn_id", "")))
		if not bool(spend_result.get("ok", false)):
			status_changed.emit("Recovered turn is waiting for credit charge: %s" % spend_result.get("error", "unknown error"))
			return
		_active_turn["status"] = "charged"
		_save_state()
	_start_active_turn()

func _process_settlement_outbox() -> void:
	if mode != "server" or _settlement_worker_active:
		return
	_settlement_worker_active = true
	for index in range(_settlements.size()):
		var settlement := _settlements[index] as Dictionary
		var current_status := String(settlement.get("status", ""))
		if current_status in ["confirmed", "skin_review_required", "toy_review_required"]:
			continue
		var wallet := String(settlement.get("wallet", ""))
		var turn_id := String(settlement.get("turn_id", ""))
		var payout := int(settlement.get("payout_yes", 0))
		settlement["status"] = "submitting"
		_settlements[index] = settlement
		_save_state()
		var credit_result := await yf.grant_turn_winnings(wallet, turn_id, payout)
		if not bool(credit_result.get("ok", false)):
			settlement["status"] = "credit_failed"
			settlement["last_error"] = String(credit_result.get("error", "Winnings credit failed."))
			_settlements[index] = settlement
			_save_state()
			settlement_changed.emit("Turn %s remains pending: %s" % [turn_id, settlement["last_error"]])
			continue
		var milestone_failed := false
		var milestones: Array = settlement.get("skin_milestones", [])
		var confirmed_milestones: Array = settlement.get("skin_milestones_confirmed", [])
		for milestone_value in milestones:
			var milestone_number := int(milestone_value)
			if confirmed_milestones.has(milestone_number):
				continue
			var skin_result := await yf.submit_skin_milestone(
				wallet,
				turn_id,
				milestone_number,
				int(_player(wallet).get("lifetime_coins_paid_out", 0))
			)
			if not bool(skin_result.get("ok", false)):
				milestone_failed = true
				# A mint may have reached the chain before a later response failed.
				# Never retry an ambiguous milestone automatically.
				settlement["status"] = "skin_review_required"
				settlement["skin_review_milestone"] = milestone_number
				settlement["last_error"] = String(skin_result.get("error", "Skin milestone needs operator review."))
				break
			var awarded_result: Dictionary = {}
			var awarded_result_value: Variant = skin_result.get("skinResult", {})
			if awarded_result_value is Dictionary:
				awarded_result = awarded_result_value as Dictionary
			var awarded_class_id := String(awarded_result.get("selectedClassId", awarded_result.get("classId", "")))
			var awarded_family := yf.family_for_class_id(awarded_class_id)
			if not awarded_family.is_empty():
				var awarded_player := _player(wallet)
				var awarded_owned: Array[String] = _normalized_family_array(awarded_player.get("owned_skin_families", []))
				if not awarded_owned.has(awarded_family):
					awarded_owned.append(awarded_family)
				awarded_player["owned_skin_families"] = awarded_owned
				_players[wallet] = awarded_player
				var awarded_peer_id := int(awarded_player.get("peer_id", 0))
				var award := {
					"kind": "skin",
					"family": awarded_family,
					"title": "%s Coin Skin" % _skin_display_name(awarded_family),
					"source": yf.skin_offering_name,
					"detail": "Minted and ready to equip.",
					"mint_status": String(awarded_result.get("mintStatus", awarded_result.get("resultType", "earned"))),
					"image_url": String(awarded_result.get("imageUrl", yf.skin_image_url_for_class_id(awarded_class_id))),
					"class_id": awarded_class_id,
					"token_id": String(awarded_result.get("tokenId", "")),
					"tx_hash": String(awarded_result.get("txHash", "")),
				}
				if awarded_peer_id > 1:
					_client_skin_entitlements.rpc_id(awarded_peer_id, true, awarded_owned, "%s coin skin is ready to equip." % _skin_display_name(awarded_family))
					_send_nft_award_to_peer(awarded_peer_id, award)
				elif awarded_peer_id == 1:
					nft_awarded.emit(award.duplicate(true))
			confirmed_milestones.append(milestone_number)
			settlement["skin_milestones_confirmed"] = confirmed_milestones
			_settlements[index] = settlement
			_save_state()
		if milestone_failed:
			_settlements[index] = settlement
			_save_state()
			settlement_changed.emit(
				"Turn %s credited %d YES; skin milestone %d needs operator review before any retry."
				% [turn_id, payout, int(settlement.get("skin_review_milestone", 0))]
			)
			continue

		var toy_failed := false
		var toy_captures: Array = settlement.get("toy_captures", [])
		var confirmed_toy_captures: Array = settlement.get("toy_captures_confirmed", [])
		for capture_value in toy_captures:
			if not (capture_value is Dictionary):
				continue
			var capture := capture_value as Dictionary
			var toy_instance_id := String(capture.get("toy_instance_id", "")).strip_edges()
			var toy_family := String(capture.get("toy_family", "")).strip_edges().to_lower()
			if toy_instance_id.is_empty() or confirmed_toy_captures.has(toy_instance_id):
				continue
			var power_result: Dictionary = {}
			var power_result_value: Variant = capture.get("power_result", {})
			if power_result_value is Dictionary:
				power_result = power_result_value as Dictionary
			var toy_result := await yf.submit_toy_caught(wallet, turn_id, toy_instance_id, toy_family, power_result)
			if not bool(toy_result.get("ok", false)):
				toy_failed = true
				# The event may have queued or minted before a later response failed.
				# Hold the exact capture for review instead of risking a duplicate toy NFT.
				settlement["status"] = "toy_review_required"
				settlement["toy_review_instance_id"] = toy_instance_id
				settlement["last_error"] = String(toy_result.get("error", "Toy catch needs operator review."))
				break
			var toy_awarded_result: Dictionary = {}
			var toy_awarded_result_value: Variant = toy_result.get("toyResult", {})
			if toy_awarded_result_value is Dictionary:
				toy_awarded_result = toy_awarded_result_value as Dictionary
			var toy_awarded_family := String(toy_awarded_result.get("toyFamily", toy_family)).strip_edges().to_lower()
			var toy_awarded_peer_id := int(_player(wallet).get("peer_id", 0))
			var toy_mint_status := String(toy_awarded_result.get("mintStatus", toy_awarded_result.get("resultType", "earned")))
			var toy_completed_mint := toy_mint_status in ["completed", "minted"] or String(toy_awarded_result.get("resultType", "")) == "minted"
			var toy_award := {
				"kind": "toy",
				"family": toy_awarded_family,
				"title": String(toy_awarded_result.get("classTitle", "%s Toy" % _skin_display_name(toy_awarded_family))),
				"source": yf.toy_offering_name,
				"detail": "Minted and added to your collection." if toy_completed_mint else "Mint queued for your wallet.",
				"mint_status": toy_mint_status,
				"image_url": String(toy_awarded_result.get("imageUrl", "")),
				"class_id": String(toy_awarded_result.get("selectedClassId", toy_awarded_result.get("classId", ""))),
				"class_key": String(toy_awarded_result.get("classKey", "")),
				"token_id": String(toy_awarded_result.get("tokenId", "")),
				"tx_hash": String(toy_awarded_result.get("txHash", "")),
			}
			if toy_awarded_peer_id > 1:
				_send_nft_award_to_peer(toy_awarded_peer_id, toy_award)
			elif toy_awarded_peer_id == 1:
				nft_awarded.emit(toy_award.duplicate(true))
			confirmed_toy_captures.append(toy_instance_id)
			settlement["toy_captures_confirmed"] = confirmed_toy_captures
			_settlements[index] = settlement
			_save_state()
		if toy_failed:
			_settlements[index] = settlement
			_save_state()
			settlement_changed.emit(
				"Turn %s credited %d YES; toy %s needs operator review before any retry."
				% [turn_id, payout, String(settlement.get("toy_review_instance_id", ""))]
			)
			continue
		settlement["status"] = "confirmed"
		settlement["confirmed_at_unix"] = Time.get_unix_time_from_system()
		settlement["last_error"] = ""
		_settlements[index] = settlement
		_save_state()
		settlement_changed.emit("Turn %s settled: %d YES credited." % [turn_id, payout])
	_settlement_worker_active = false

func retry_pending_settlements() -> void:
	call_deferred("_process_settlement_outbox")

func _has_retryable_settlements() -> bool:
	for settlement_value in _settlements:
		if not (settlement_value is Dictionary):
			continue
		var settlement := settlement_value as Dictionary
		if String(settlement.get("status", "")) not in ["confirmed", "skin_review_required", "toy_review_required"]:
			return true
	return false

func _on_authoritative_reward_wheel_requested(values: PackedInt32Array) -> void:
	if mode == "server" and not _active_turn.is_empty():
		var peer_id := int(_active_turn.get("peer_id", 0))
		if peer_id > 1:
			_client_reward_wheel_available.rpc_id(peer_id, values)

func _on_authoritative_reward_wheel_awarded(value: int) -> void:
	if mode == "server" and not _active_turn.is_empty():
		var peer_id := int(_active_turn.get("peer_id", 0))
		if peer_id > 1:
			_client_reward_wheel_result.rpc_id(peer_id, value)

func _broadcast_world_snapshot() -> void:
	var peer_ids := multiplayer.get_peers()
	if peer_ids.is_empty():
		return
	var snapshot: Dictionary = {
		"server_time_ms": Time.get_ticks_msec(),
		"world": machine.export_world_snapshot(),
		"active_turn": _public_active_turn(),
	}
	for peer_id in peer_ids:
		if _transport == "websocket" and _websocket_peer != null:
			var socket_peer: WebSocketPeer = _websocket_peer.get_peer(peer_id)
			if socket_peer == null or socket_peer.get_ready_state() != WebSocketPeer.STATE_OPEN:
				continue
			# A newer snapshot replaces an older one. Skip this frame instead of
			# filling the WebSocket buffer when a browser cannot consume updates fast enough.
			if socket_peer.get_current_outbound_buffered_amount() >= WEBSOCKET_SNAPSHOT_BACKPRESSURE_BYTES:
				continue
		_client_world_snapshot.rpc_id(peer_id, snapshot)

func _broadcast_queue_state() -> void:
	if mode == "server":
		var entries: Array[Dictionary] = []
		for entry in _queue:
			entries.append({"wallet": String(entry.get("wallet", "")), "request_id": String(entry.get("request_id", ""))})
		if not multiplayer.get_peers().is_empty():
			_client_queue_state.rpc(entries, _public_active_turn())
		var local_position := _queue_position_for_wallet(local_wallet)
		queue_changed.emit(local_position, entries.size())

func _public_active_turn() -> Dictionary:
	if _active_turn.is_empty():
		return {}
	return {
		"turn_id": String(_active_turn.get("turn_id", "")),
		"wallet": String(_active_turn.get("wallet", "")),
		"drop_count": FIXED_DROP_COUNT,
		"status": String(_active_turn.get("status", "")),
		"latest_payout_yes": int(_active_turn.get("latest_payout_yes", 0)),
	}

func _client_status_for(peer_id: int, message: String) -> void:
	if peer_id <= 1:
		status_changed.emit(message)
	else:
		_client_status.rpc_id(peer_id, message)

func _remove_wallet_from_queue(wallet: String) -> void:
	var kept: Array[Dictionary] = []
	for entry in _queue:
		if String(entry.get("wallet", "")) != wallet:
			kept.append(entry)
	_queue = kept
	_broadcast_queue_state()

func _remove_peer_from_queue(peer_id: int) -> void:
	var kept: Array[Dictionary] = []
	for entry in _queue:
		if int(entry.get("peer_id", 0)) != peer_id:
			kept.append(entry)
	_queue = kept

func _queue_position_for_wallet(wallet: String) -> int:
	for index in range(_queue.size()):
		if String(_queue[index].get("wallet", "")) == wallet:
			return index + 1
	return -1

func _wallet_for_peer(peer_id: int) -> String:
	for key in _players.keys():
		var player: Variant = _players[key]
		if player is Dictionary and int(player.get("peer_id", 0)) == peer_id and bool(player.get("verified", false)):
			return String(player.get("wallet", ""))
	return ""

func _player(wallet: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if _players.has(normalized) and _players[normalized] is Dictionary:
		return (_players[normalized] as Dictionary).duplicate(true)
	return {
		"peer_id": 0,
		"wallet": normalized,
		"verified": false,
		"skin_family": "",
		"owned_skin_families": [],
		"lifetime_yes": 0,
		"lifetime_coins_paid_out": 0,
	}

func _save_state() -> void:
	if mode != "server":
		return
	var state := {
		"kind": "yes-pusher-shared-state",
		"version": STATE_VERSION,
		"turn_sequence": _turn_sequence,
		"players": _persistent_players(),
		"active_turn": _active_turn,
		"settlements": _settlements,
		"world": machine.export_world_snapshot() if _active_turn.is_empty() else _active_turn.get("pre_turn_world", {}),
	}
	var file := FileAccess.open(_state_path, FileAccess.WRITE)
	if file == null:
		push_error("Could not save shared world state to %s" % _state_path)
		return
	file.store_string(JSON.stringify(state))
	file.flush()

func _load_state() -> void:
	if not FileAccess.file_exists(_state_path):
		return
	var file := FileAccess.open(_state_path, FileAccess.READ)
	if file == null:
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	if not (parsed is Dictionary):
		return
	var state := parsed as Dictionary
	if state.get("kind", "") != "yes-pusher-shared-state" or int(state.get("version", 0)) != STATE_VERSION:
		return
	_turn_sequence = int(state.get("turn_sequence", 0))
	_players = state.get("players", {}) as Dictionary
	_active_turn = state.get("active_turn", {}) as Dictionary
	_settlements.clear()
	var restored_settlements: Variant = state.get("settlements", [])
	if restored_settlements is Array:
		for value in restored_settlements:
			if value is Dictionary:
				_settlements.append((value as Dictionary).duplicate(true))
	_migrate_lifetime_paid_out_counts()
	var world := state.get("world", {}) as Dictionary
	if not world.is_empty():
		machine.restore_authoritative_snapshot(world)

func _migrate_lifetime_paid_out_counts() -> void:
	for wallet_value in _players.keys():
		var wallet := String(wallet_value).strip_edges().to_lower()
		if not _is_wallet(wallet) or not (_players.get(wallet_value) is Dictionary):
			continue
		var player := (_players.get(wallet_value) as Dictionary).duplicate(true)
		if player.has("lifetime_coins_paid_out"):
			player.erase("lifetime_coins_dropped")
			_players[wallet_value] = player
			continue
		var reconstructed := 0
		for settlement_value in _settlements:
			if not (settlement_value is Dictionary):
				continue
			var settlement := settlement_value as Dictionary
			if String(settlement.get("wallet", "")).strip_edges().to_lower() != wallet:
				continue
			var result_summary: Dictionary = {}
			var result_value: Variant = settlement.get("result_summary", {})
			if result_value is Dictionary:
				result_summary = result_value as Dictionary
			reconstructed += maxi(0, int(result_summary.get("caught_coin_count", result_summary.get("caught_base_yes", 0))))
		player["lifetime_coins_paid_out"] = reconstructed
		player.erase("lifetime_coins_dropped")
		_players[wallet_value] = player

func _persistent_players() -> Dictionary:
	var result: Dictionary = {}
	for key in _players.keys():
		if not (key is String) or not _is_wallet(String(key)):
			continue
		var player := (_players[key] as Dictionary).duplicate(true)
		player["peer_id"] = 0
		player["verified"] = false
		result[key] = player
	return result

func _normalize_family(value: String) -> String:
	var normalized := value.strip_edges().to_lower()
	match normalized:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return normalized
	return ""

func _normalized_family_array(values: Variant) -> Array[String]:
	var result: Array[String] = []
	if not (values is Array):
		return result
	var source_values: Array = values as Array
	for value in source_values:
		var family := _normalize_family(String(value))
		if not family.is_empty() and not result.has(family):
			result.append(family)
	return result

func _skin_display_name(family: String) -> String:
	match family:
		"horseshoe": return "Horseshoe"
		"four_leaf_clover": return "Four-Leaf Clover"
		"leprechaun": return "Leprechaun"
		"pot_of_gold": return "Pot of Gold"
		"treasure_chest": return "Treasure Chest"
	return "Coin"

func _family_from_skin_key(value: String) -> String:
	var normalized := value.strip_edges().to_lower()
	for prefix in ["yes_pusher.", "yes_drop."]:
		if normalized.begins_with(prefix):
			normalized = normalized.trim_prefix(prefix)
	return _normalize_family(normalized)

func _env_or(name: String, fallback: String) -> String:
	var value := OS.get_environment(name).strip_edges()
	return value if not value.is_empty() else fallback

func _env_int(name: String, fallback: int, minimum: int, maximum: int) -> int:
	var value := OS.get_environment(name).strip_edges()
	if not value.is_valid_int():
		return fallback
	return clampi(int(value), minimum, maximum)

func _is_wallet(value: String) -> bool:
	if value.length() != 42 or not value.begins_with("0x"):
		return false
	for index in range(2, value.length()):
		if "0123456789abcdefABCDEF".find(value[index]) == -1:
			return false
	return true
