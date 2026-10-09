extends Node

const PATH_KEY := "yes_drop.toy_upgrade"
const REQUIRED_COUNT := 3
const FAMILIES := [
	"four_leaf_clover",
	"horseshoe",
	"leprechaun",
	"pot_of_gold",
	"treasure_chest",
]
const SOURCE_SIZES := ["small", "medium"]

var _shared: YesPusherSharedWorld
var _inventory: Array[Dictionary] = []
var _status: Label
var _refresh_button: Button
var _buttons: Dictionary = {}
var _busy := false

func _ready() -> void:
	call_deferred("_attach")

func _attach() -> void:
	for _attempt in range(120):
		var scene := get_tree().current_scene
		if scene != null:
			_shared = scene.get_node_or_null("SharedWorld") as YesPusherSharedWorld
			if _shared != null:
				break
		await get_tree().process_frame
	if _shared == null:
		push_warning("Toy Upgrade could not find the YES DROP shared world.")
		return

	_shared.local_identity_changed.connect(_on_identity_changed)
	if _shared.mode != "server" or DisplayServer.get_name() != "headless":
		_build_ui()
	if _shared.mode == "client" and _shared.local_verified:
		refresh_inventory()

func _build_ui() -> void:
	var scene := get_tree().current_scene
	if scene == null:
		return
	var layout := scene.get_node_or_null("Interface/Margin/Panel/Layout") as VBoxContainer
	if layout == null:
		return

	var divider := HSeparator.new()
	layout.add_child(divider)

	var heading := HBoxContainer.new()
	layout.add_child(heading)
	var title := Label.new()
	title.text = "TOY UPGRADES"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_theme_color_override("font_color", Color(0.96, 0.76, 0.24, 1.0))
	heading.add_child(title)
	_refresh_button = Button.new()
	_refresh_button.text = "REFRESH"
	_refresh_button.custom_minimum_size = Vector2(82.0, 30.0)
	_refresh_button.pressed.connect(refresh_inventory)
	heading.add_child(_refresh_button)

	_status = Label.new()
	_status.text = "Verify your wallet to load upgradeable toys."
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.add_theme_font_size_override("font_size", 12)
	layout.add_child(_status)

	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 6)
	grid.add_theme_constant_override("v_separation", 5)
	layout.add_child(grid)

	for family in FAMILIES:
		for source_size in SOURCE_SIZES:
			var button := Button.new()
			button.custom_minimum_size = Vector2(164.0, 34.0)
			button.add_theme_font_size_override("font_size", 12)
			button.disabled = true
			button.pressed.connect(_on_upgrade_pressed.bind(family, source_size))
			grid.add_child(button)
			_buttons[_recipe_key(family, source_size)] = button
	_update_buttons()

func _on_identity_changed(_wallet: String, verified: bool) -> void:
	_inventory.clear()
	_update_buttons()
	if verified:
		refresh_inventory()
	elif _status != null:
		_status.text = "Verify your wallet to load upgradeable toys."

func refresh_inventory() -> void:
	if _shared == null:
		return
	if _shared.mode == "client":
		if not _shared.local_verified:
			_set_status("Verify your wallet before loading toys.")
			return
		_set_busy(true, "Loading your toy NFTs…")
		_server_refresh_inventory.rpc_id(1)
	elif _shared.mode == "server" and _is_wallet(_shared.local_wallet):
		_set_busy(true, "Loading your toy NFTs…")
		var result := await _load_toy_inventory(_shared.local_wallet)
		_receive_inventory(bool(result.get("ok", false)), result.get("inventory", []), String(result.get("error", "")))

func _on_upgrade_pressed(family: String, source_size: String) -> void:
	if _busy or _shared == null or not _shared.local_verified:
		return
	if _count_for(family, source_size) < REQUIRED_COUNT:
		_set_status("You need 3 %s %s toys for this upgrade." % [_display_family(family), source_size.capitalize()])
		return
	var request_id := "yes-drop-upgrade:%s:%d:%d" % [
		_shared.local_wallet.to_lower(),
		Time.get_ticks_msec(),
		randi(),
	]
	_set_busy(true, "Upgrading 3 %s %s toys…" % [_display_family(family), source_size.capitalize()])
	if _shared.mode == "client":
		_server_request_upgrade.rpc_id(1, family, source_size, request_id)
	else:
		var result := await _execute_upgrade(_shared.local_wallet, family, source_size, request_id)
		_receive_upgrade_result(bool(result.get("ok", false)), String(result.get("message", result.get("error", ""))), result.get("inventory", []))

@rpc("any_peer", "call_remote", "reliable")
func _server_refresh_inventory() -> void:
	if not multiplayer.is_server() or _shared == null:
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _shared._wallet_for_peer(peer_id)
	if wallet.is_empty():
		_client_inventory.rpc_id(peer_id, false, [], "A verified wallet is required before loading toys.")
		return
	var result := await _load_toy_inventory(wallet)
	_client_inventory.rpc_id(peer_id, bool(result.get("ok", false)), result.get("inventory", []), String(result.get("error", "")))

@rpc("any_peer", "call_remote", "reliable")
func _server_request_upgrade(family: String, source_size: String, request_id: String) -> void:
	if not multiplayer.is_server() or _shared == null:
		return
	var peer_id := multiplayer.get_remote_sender_id()
	var wallet := _shared._wallet_for_peer(peer_id)
	if wallet.is_empty():
		_client_upgrade_result.rpc_id(peer_id, false, "A verified wallet is required before upgrading toys.", [])
		return
	var result := await _execute_upgrade(wallet, family, source_size, request_id)
	_client_upgrade_result.rpc_id(
		peer_id,
		bool(result.get("ok", false)),
		String(result.get("message", result.get("error", "Toy upgrade failed."))),
		result.get("inventory", [])
	)

@rpc("authority", "call_remote", "reliable")
func _client_inventory(ok: bool, inventory: Array, error: String) -> void:
	_receive_inventory(ok, inventory, error)

@rpc("authority", "call_remote", "reliable")
func _client_upgrade_result(ok: bool, message: String, inventory: Array) -> void:
	_receive_upgrade_result(ok, message, inventory)

func _receive_inventory(ok: bool, inventory: Array, error: String) -> void:
	_inventory.clear()
	if ok:
		for entry in inventory:
			if entry is Dictionary:
				_inventory.append((entry as Dictionary).duplicate(true))
		_set_busy(false, "Toy inventory loaded. Choose any available 3 → 1 upgrade.")
	else:
		_set_busy(false, error if not error.is_empty() else "Toy inventory could not be loaded.")
	_update_buttons()

func _receive_upgrade_result(ok: bool, message: String, inventory: Array) -> void:
	_inventory.clear()
	for entry in inventory:
		if entry is Dictionary:
			_inventory.append((entry as Dictionary).duplicate(true))
	_set_busy(false, message if not message.is_empty() else ("Toy upgrade complete." if ok else "Toy upgrade failed."))
	_update_buttons()

func _load_toy_inventory(wallet: String) -> Dictionary:
	if _shared == null or _shared.yf == null:
		return {"ok": false, "error": "Yokefellow is not connected."}
	var response := await _shared.yf.load_wallet_entitlements(wallet)
	if not bool(response.get("ok", false)):
		return {"ok": false, "error": String(response.get("error", "Wallet toys could not be loaded."))}
	var body := response.get("body", {}) as Dictionary
	return {"ok": true, "inventory": _toy_inventory_from_entitlements(body)}

func _execute_upgrade(wallet: String, family: String, source_size: String, request_id: String) -> Dictionary:
	var normalized_family := family.strip_edges().to_lower()
	var normalized_size := source_size.strip_edges().to_lower()
	if not FAMILIES.has(normalized_family) or not SOURCE_SIZES.has(normalized_size):
		return {"ok": false, "error": "That toy upgrade recipe is not valid."}
	if request_id.strip_edges().length() < 8:
		return {"ok": false, "error": "Toy upgrade request ID is invalid."}

	var inventory_result := await _load_toy_inventory(wallet)
	if not bool(inventory_result.get("ok", false)):
		return inventory_result
	var inventory: Array = inventory_result.get("inventory", [])
	var selected := _select_inputs(inventory, normalized_family, normalized_size)
	if int(selected.get("amount", 0)) < REQUIRED_COUNT:
		return {
			"ok": false,
			"error": "You need 3 %s %s toys for this upgrade." % [_display_family(normalized_family), normalized_size.capitalize()],
			"inventory": inventory,
		}

	var yf := _shared.yf
	if yf.sdk_base_url.is_empty() or yf.bucket_id.is_empty() or yf.app_api_key.is_empty():
		return {"ok": false, "error": "YES DROP is not configured for Yokefellow Action Paths.", "inventory": inventory}
	var endpoint := "%s/buckets/%s/action-paths/%s/execute" % [
		yf.sdk_base_url,
		yf.bucket_id.uri_encode(),
		PATH_KEY.uri_encode(),
	]
	var choice := "%s_%s" % [normalized_family, normalized_size]
	var response := await yf._request_json(
		HTTPClient.METHOD_POST,
		endpoint,
		{
			"wallet": wallet,
			"requestId": request_id,
			"choice": choice,
			"tokenIds": selected.get("token_ids", []),
			"meta": {
				"source": "yes_drop",
				"family": normalized_family,
				"fromSize": normalized_size,
				"toSize": "medium" if normalized_size == "small" else "large",
			},
		},
		request_id,
		{},
		120.0
	)
	if not bool(response.get("ok", false)):
		return {
			"ok": false,
			"error": String(response.get("error", "Yokefellow rejected the Toy Upgrade Action Path.")),
			"inventory": inventory,
		}
	var response_body := response.get("body", {}) as Dictionary
	if not bool(response_body.get("ok", false)):
		var api_error: Variant = response_body.get("error", "Toy upgrade failed.")
		var api_message := String(api_error.get("message", "Toy upgrade failed.")) if api_error is Dictionary else String(api_error)
		return {"ok": false, "error": api_message, "inventory": inventory}

	var refreshed := await _load_toy_inventory(wallet)
	var refreshed_inventory: Array = refreshed.get("inventory", inventory) if bool(refreshed.get("ok", false)) else inventory
	var target_size := "Medium" if normalized_size == "small" else "Large"
	return {
		"ok": true,
		"message": "%s upgraded to %s." % [_display_family(normalized_family), target_size],
		"inventory": refreshed_inventory,
		"execution": response_body.get("execution", {}),
	}

func _toy_inventory_from_entitlements(body: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var wallet_state_value: Variant = body.get("walletState", {})
	if not (wallet_state_value is Dictionary):
		return result
	var owned_value: Variant = (wallet_state_value as Dictionary).get("ownedMints", [])
	if not (owned_value is Array):
		return result
	for value in owned_value:
		if not (value is Dictionary):
			continue
		var mint := value as Dictionary
		var search_text := "%s %s" % [String(mint.get("classSlug", "")), String(mint.get("className", ""))]
		var family := _family_from_text(search_text)
		var size := _size_from_text(search_text)
		if family.is_empty() or size.is_empty():
			continue
		result.append({
			"family": family,
			"size": size,
			"token_id": String(mint.get("tokenId", "")),
			"amount": maxi(0, int(mint.get("quantity", 1))),
			"class_id": String(mint.get("classId", "")),
			"class_name": String(mint.get("className", "")),
			"standard": String(mint.get("standard", "")),
		})
	return result

func _select_inputs(inventory: Array, family: String, source_size: String) -> Dictionary:
	var token_ids: Array[String] = []
	var amount := 0
	for value in inventory:
		if not (value is Dictionary):
			continue
		var entry := value as Dictionary
		if String(entry.get("family", "")) != family or String(entry.get("size", "")) != source_size:
			continue
		var entry_amount := maxi(0, int(entry.get("amount", 0)))
		if entry_amount <= 0:
			continue
		var token_id := String(entry.get("token_id", "")).strip_edges()
		if not token_id.is_empty() and not token_ids.has(token_id):
			token_ids.append(token_id)
		amount += entry_amount
		if amount >= REQUIRED_COUNT:
			break
	return {"amount": amount, "token_ids": token_ids}

func _count_for(family: String, source_size: String) -> int:
	var total := 0
	for entry in _inventory:
		if String(entry.get("family", "")) == family and String(entry.get("size", "")) == source_size:
			total += maxi(0, int(entry.get("amount", 0)))
	return total

func _update_buttons() -> void:
	for family in FAMILIES:
		for source_size in SOURCE_SIZES:
			var key := _recipe_key(family, source_size)
			var button := _buttons.get(key) as Button
			if button == null:
				continue
			var count := _count_for(family, source_size)
			var target := "M" if source_size == "small" else "L"
			var source := "S" if source_size == "small" else "M"
			button.text = "%s %s→%s  %d/3" % [_short_family(family), source, target, mini(count, 3)]
			button.disabled = _busy or _shared == null or not _shared.local_verified or count < REQUIRED_COUNT

func _set_busy(value: bool, message: String) -> void:
	_busy = value
	if _refresh_button != null:
		_refresh_button.disabled = value
	_set_status(message)
	_update_buttons()

func _set_status(message: String) -> void:
	if _status != null:
		_status.text = message

func _family_from_text(value: String) -> String:
	var text := value.strip_edges().to_lower().replace("-", "_").replace(" ", "_").replace("’", "")
	if text.contains("four_leaf_clover") or text.contains("fourleafclover") or text.contains("clover"):
		return "four_leaf_clover"
	if text.contains("horseshoe"):
		return "horseshoe"
	if text.contains("leprechaun"):
		return "leprechaun"
	if text.contains("pot_of_gold") or text.contains("potofgold"):
		return "pot_of_gold"
	if text.contains("treasure_chest") or text.contains("treasurechest"):
		return "treasure_chest"
	return ""

func _size_from_text(value: String) -> String:
	var text := value.strip_edges().to_lower().replace("-", "_").replace(" ", "_").replace(".", "_")
	for size in ["small", "medium", "large"]:
		if ("_%s_" % size) in ("_%s_" % text) or text.ends_with("_%s" % size):
			return size
	return ""

func _recipe_key(family: String, source_size: String) -> String:
	return "%s:%s" % [family, source_size]

func _display_family(family: String) -> String:
	match family:
		"four_leaf_clover": return "Four Leaf Clover"
		"horseshoe": return "Horseshoe"
		"leprechaun": return "Leprechaun"
		"pot_of_gold": return "Pot of Gold"
		"treasure_chest": return "Treasure Chest"
	return family.capitalize()

func _short_family(family: String) -> String:
	match family:
		"four_leaf_clover": return "Clover"
		"pot_of_gold": return "Pot"
		"treasure_chest": return "Chest"
	return _display_family(family)

func _is_wallet(value: String) -> bool:
	var wallet := value.strip_edges().to_lower()
	if wallet.length() != 42 or not wallet.begins_with("0x"):
		return false
	for index in range(2, wallet.length()):
		if "0123456789abcdef".find(wallet[index]) == -1:
			return false
	return true
