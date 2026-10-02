extends Node3D

const REWARD_WHEEL_SCRIPT: Script = preload("res://scripts/reward_wheel.gd")
const COIN_SCENE: PackedScene = preload("res://Coin.tscn")
const TOY_SCENE: PackedScene = preload("res://Toy.tscn")
const FIXED_DROP_COUNT: int = 10
const RESULT_REVEAL_TOTAL_SECONDS: float = 4.70

@onready var machine: YesPusherMachine = $Machine
@onready var drop_button: Button = $Interface/Margin/Panel/Layout/DropControls/DropButton
@onready var status_label: Label = $Interface/Margin/Panel/Layout/Status
@onready var payout_label: Label = $Interface/Margin/Panel/Layout/Payouts
@onready var active_label: Label = $Interface/Margin/Panel/Layout/ActiveCoins
@onready var camera_controller = $Camera
@onready var interface_layer: CanvasLayer = $Interface

var total_paid_out: int = 0
var total_lost: int = 0
var total_dropped: int = 0
var _result_reveal_active: bool = false
var _active_skin_toy_family: String = ""
var _shared_world: YesPusherSharedWorld
var _current_turn_payout: int = 0
var _power_panel: PanelContainer
var _power_title: Label
var _power_detail: Label
var _power_wheel: Control
var _power_spin_button: Button
var _power_message_generation: int = 0
var _wallet_input: LineEdit
var _session_input: LineEdit
var _verify_button: Button
var _leave_queue_button: Button
var _queue_label: Label
var _free_turn_label: Label
var _free_turn_state: Dictionary = {}
var _free_turn_server_offset_seconds: int = 0
var _free_turn_last_rendered_second: int = -1
var _local_queue_position: int = -1
var _local_turn_active: bool = false
var _test_player_button: Button
var _skin_selector: OptionButton
var _refresh_skins_button: Button
var _updating_skin_selector: bool = false
var _turn_result_panel: PanelContainer
var _turn_result_title: Label
var _turn_result_detail: Label
var _turn_result_generation: int = 0
var _nft_award_panel: PanelContainer
var _nft_award_type: Label
var _nft_award_name: Label
var _nft_award_detail: Label
var _nft_award_action: Button
var _nft_image_rect: TextureRect
var _nft_preview_container: SubViewportContainer
var _nft_preview_viewport: SubViewport
var _nft_preview_root: Node3D
var _nft_preview_model: Node3D
var _nft_award_queue: Array[Dictionary] = []
var _nft_award_showing: bool = false
var _nft_award_generation: int = 0
var _active_nft_award: Dictionary = {}
var _active_player_showcase_panel: PanelContainer
var _active_player_avatar: TextureRect
var _active_player_avatar_fallback: Label
var _active_player_name: Label
var _active_player_handle: Label
var _active_player_tagline: Label
var _active_player_featured_outputs: HBoxContainer
var _active_player_toys: VBoxContainer
var _active_player_showcase_generation: int = 0
var _active_player_wallet: String = ""
var _active_player_turn_id: String = ""

func _ready() -> void:
	_build_power_panel()
	_build_turn_result_panel()
	_build_nft_award_panel()
	_build_active_player_showcase()
	_shared_world = YesPusherSharedWorld.new()
	_shared_world.name = "SharedWorld"
	add_child(_shared_world)
	_shared_world.status_changed.connect(_on_shared_status_changed)
	_shared_world.queue_changed.connect(_on_shared_queue_changed)
	_shared_world.active_player_changed.connect(_on_shared_active_player_changed)
	_shared_world.active_player_presentation_changed.connect(_on_active_player_presentation_changed)
	_shared_world.local_identity_changed.connect(_on_local_identity_changed)
	_shared_world.owned_skins_changed.connect(_on_owned_skins_changed)
	_shared_world.free_turn_state_changed.connect(_on_free_turn_state_changed)
	_shared_world.settlement_changed.connect(_on_settlement_changed)
	_shared_world.remote_turn_reveal_started.connect(_on_remote_turn_reveal_started)
	_shared_world.remote_turn_finished.connect(_on_remote_turn_finished)
	_shared_world.reward_wheel_available.connect(_on_reward_wheel_requested)
	_shared_world.reward_wheel_result.connect(_on_remote_reward_wheel_result)
	_shared_world.nft_awarded.connect(_on_nft_awarded)

	drop_button.pressed.connect(_on_drop_pressed)
	machine.coin_spawned.connect(_on_coin_spawned)
	machine.coin_paid_out.connect(_on_coin_paid_out)
	machine.coin_lost.connect(_on_coin_lost)
	machine.machine_reset.connect(_on_machine_reset)
	machine.turn_started.connect(_on_turn_started)
	machine.turn_finished.connect(_on_turn_finished)
	machine.turn_payout_corrected.connect(_on_turn_payout_corrected)
	machine.toy_spawned.connect(_on_toy_spawned)
	machine.toy_spawn_skipped.connect(_on_toy_spawn_skipped)
	machine.toy_captured.connect(_on_toy_captured)
	machine.toy_lost.connect(_on_toy_lost)
	machine.toy_power_activated.connect(_on_toy_power_activated)
	machine.turn_time_extended.connect(_on_turn_time_extended)
	machine.reward_wheel_requested.connect(_on_reward_wheel_requested)
	machine.reward_wheel_awarded.connect(_on_reward_wheel_awarded)

	var environment_skin_key := OS.get_environment("YF_ACTIVE_SKIN_KEY").strip_edges()
	if not environment_skin_key.is_empty():
		set_active_skin_key(environment_skin_key)
	else:
		var environment_family := (
			OS.get_environment("YF_ACTIVE_TOY_FAMILY").strip_edges().to_lower()
		)
		if not environment_family.is_empty():
			set_active_skin_toy_family(environment_family)
	_shared_world.configure(machine)
	_build_network_controls()
	if _shared_world.mode == "server" and DisplayServer.get_name() == "headless":
		interface_layer.visible = false
	_refresh_labels()

func _process(_delta: float) -> void:
	if is_instance_valid(_nft_preview_model) and _nft_award_panel != null and _nft_award_panel.visible:
		_nft_preview_model.rotate_y(_delta * 0.72)
	active_label.text = "Coins: %d   Toys: %d" % [
		machine.active_coin_count(),
		machine.active_toy_count(),
	]
	_refresh_free_turn_ui()

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_SPACE:
				_on_drop_pressed()
			KEY_0:
				set_active_skin_toy_family("")
			KEY_1:
				set_active_skin_toy_family("horseshoe")
			KEY_2:
				set_active_skin_toy_family("four_leaf_clover")
			KEY_3:
				set_active_skin_toy_family("leprechaun")
			KEY_4:
				set_active_skin_toy_family("pot_of_gold")
			KEY_5:
				set_active_skin_toy_family("treasure_chest")

func set_active_player_wallet(wallet: String) -> void:
	if _shared_world != null:
		_shared_world.local_wallet = wallet.strip_edges().to_lower()

func set_active_skin_toy_family(toy_family: String) -> bool:
	var normalized := toy_family.strip_edges().to_lower()
	if normalized.is_empty():
		_active_skin_toy_family = ""
		if _shared_world != null:
			_shared_world.set_local_skin_family("")
		_select_skin_option("")
		status_label.text = "Default YES coin equipped. No matching toy will enter."
		return true
	if not _is_valid_toy_family(normalized):
		status_label.text = "Unknown coin skin family: %s" % toy_family
		return false
	if _shared_world != null and _shared_world.mode == "client" and _shared_world.local_verified:
		if not _shared_world.local_owned_skin_families.has(normalized):
			status_label.text = "That wallet does not currently own the %s coin skin." % _toy_name(normalized)
			_select_skin_option(_active_skin_toy_family)
			return false
	_active_skin_toy_family = normalized
	if _shared_world != null:
		_shared_world.set_local_skin_family(normalized)
	_select_skin_option(normalized)
	status_label.text = (
		"%s coin skin equipped. Its matching toy will enter each turn."
		% _toy_name(normalized)
	)
	return true

func set_active_skin_key(skin_key: String) -> bool:
	var family := _family_from_skin_key(skin_key)
	if family.is_empty() and not skin_key.strip_edges().is_empty():
		status_label.text = "Unknown YES Pusher skin key: %s" % skin_key
		return false
	return set_active_skin_toy_family(family)

func _family_from_skin_key(skin_key: String) -> String:
	var normalized := skin_key.strip_edges().to_lower()
	if normalized.begins_with("yes_pusher."):
		normalized = normalized.trim_prefix("yes_pusher.")
	elif normalized.begins_with("yes_drop."):
		normalized = normalized.trim_prefix("yes_drop.")
	if _is_valid_toy_family(normalized):
		return normalized
	return ""

func _is_valid_toy_family(value: String) -> bool:
	match value:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return true
	return false

func _on_drop_pressed() -> void:
	if machine.is_turn_active() or _result_reveal_active:
		return
	status_label.text = "Requesting one 10-coin turn…"
	_shared_world.request_turn(_active_skin_toy_family)

func _on_coin_spawned(_coin: RigidBody3D) -> void:
	total_dropped += 1
	_refresh_labels()

func _on_coin_paid_out(value: int) -> void:
	total_paid_out += value
	_refresh_labels()

func _on_turn_started(drop_total: int) -> void:
	_current_turn_payout = 0
	drop_button.disabled = true
	status_label.text = "Turn running: dropping %d coins one at a time…" % drop_total

func _on_turn_finished(payout: int) -> void:
	_current_turn_payout = payout
	_result_reveal_active = true
	var final_summary: Dictionary = await machine.complete_result_reveal()
	_current_turn_payout = maxi(0, int(final_summary.get("total_yes", 0)))
	_result_reveal_active = false
	if _shared_world.mode == "server":
		_shared_world.authoritative_turn_completed(final_summary)
	else:
		_show_turn_result(final_summary, true, -1, [], "")
	status_label.text = "Turn complete: %d YES paid out." % _current_turn_payout
	drop_button.disabled = false

func _on_turn_payout_corrected(delta: int, corrected_payout: int) -> void:
	# Late payout-trigger corrections still belong to the active turn.
	total_paid_out += delta
	_current_turn_payout = corrected_payout
	if _shared_world != null:
		_shared_world.authoritative_payout_corrected(corrected_payout)
	status_label.text = "Turn complete: %d YES paid out." % corrected_payout
	_refresh_labels()

func _on_coin_lost() -> void:
	total_lost += 1
	_refresh_labels()

func _on_machine_reset() -> void:
	_result_reveal_active = false
	_power_message_generation += 1
	_power_panel.visible = false
	_power_wheel.visible = false
	_power_spin_button.visible = false
	camera_controller.cancel_bucket_result()
	total_paid_out = 0
	total_lost = 0
	total_dropped = 0
	drop_button.disabled = false
	status_label.text = (
		"Machine ready. Keys 1–5 equip a coin skin and matching toy; 0 uses YES."
	)
	_refresh_labels()

func _on_toy_spawned(_toy: RigidBody3D, toy_family: String, _toy_instance_id: String) -> void:
	status_label.text = "%s entered the shared machine. Toys: %d/%d." % [
		_toy_name(toy_family),
		machine.active_toy_count(),
		machine.max_active_toys,
	]

func _on_toy_spawn_skipped(toy_family: String, active_count: int, max_count: int) -> void:
	status_label.text = (
		"%s skin coins dropped, but its toy did not enter because the machine is full (%d/%d toys)."
		% [_toy_name(toy_family), active_count, max_count]
	)

func _on_toy_captured(toy_family: String, _toy_instance_id: String, _turn_id: int, _power_result: Dictionary) -> void:
	status_label.text = "%s caught — power activated and its matching toy NFT will settle with this turn." % _toy_name(toy_family)

func _on_toy_lost(toy_family: String, _toy_instance_id: String) -> void:
	status_label.text = "%s left through a non-qualifying loss area." % _toy_name(toy_family)

func _on_toy_power_activated(toy_family: String, power_result: Dictionary) -> void:
	var title: String = "TOY POWER"
	var detail: String = ""
	var accent := Color(1.0, 0.72, 0.18, 1.0)
	match toy_family:
		"horseshoe":
			title = "HORSESHOE MAGNET"
			detail = "A small group of front coins is being gently pulled toward the payout edge for %.1f seconds." % float(power_result.get("durationSeconds", 0.0))
			accent = Color(0.16, 0.86, 0.34, 1.0)
		"four_leaf_clover":
			title = "LUCKY WHEEL"
			detail = "Spin for extra YES before the turn is scored."
			accent = Color(0.10, 0.90, 0.28, 1.0)
		"leprechaun":
			title = "LEPRECHAUN DOUBLE"
			detail = "%d of the closest coins were duplicated." % int(power_result.get("coinsAdded", 0))
			accent = Color(0.08, 0.72, 0.20, 1.0)
		"pot_of_gold":
			title = "POT OF GOLD"
			detail = "Every eligible coin caught this turn now pays 2× YES."
			accent = Color(1.0, 0.62, 0.08, 1.0)
		"treasure_chest":
			title = "CELTIC TREASURE"
			detail = "%d bonus coins are dropping into the shared machine." % int(power_result.get("coinsAdded", 0))
			accent = Color(0.94, 0.58, 0.08, 1.0)
	if not detail.is_empty():
		status_label.text = detail
		if toy_family != "four_leaf_clover":
			_show_power_message(title, detail, accent, true)

func _on_turn_time_extended(seconds: float, total_bonus_seconds: float) -> void:
	print("Toy added %.1f seconds to the turn (%.1f total bonus)." % [seconds, total_bonus_seconds])

func _on_reward_wheel_requested(values: PackedInt32Array) -> void:
	_power_wheel.call("set_values", values)
	_power_spin_button.disabled = false
	_power_spin_button.visible = true
	_power_wheel.visible = true
	_show_power_message(
		"FOUR-LEAF CLOVER",
		"The toy was caught. Spin the Lucky Wheel for extra YES.",
		Color(0.10, 0.90, 0.28, 1.0),
		false
	)

func _on_reward_wheel_awarded(extra_yes: int) -> void:
	_power_spin_button.visible = false
	_power_wheel.visible = true
	_show_power_message(
		"LUCKY WHEEL WIN",
		"+%d YES added to this turn's payout." % extra_yes,
		Color(1.0, 0.78, 0.18, 1.0),
		true
	)
	status_label.text = "Four-Leaf Clover awarded %d extra YES." % extra_yes

func _on_shared_status_changed(message: String) -> void:
	status_label.text = message

func _on_shared_queue_changed(position: int, total: int) -> void:
	_local_queue_position = position
	if _queue_label != null:
		_queue_label.text = "Queue: %d waiting%s" % [total, " · you are #%d" % position if position > 0 else ""]
	if position > 0:
		status_label.text = "Queue position %d of %d. Your turn will drop 10 coins." % [position, total]
	elif total > 0 and not machine.is_turn_active():
		status_label.text = "%d player%s waiting for the shared machine." % [total, "" if total == 1 else "s"]
	_update_network_drop_button()

func _on_shared_active_player_changed(wallet: String, turn_id: String) -> void:
	if wallet.is_empty():
		_local_turn_active = false
		_active_player_wallet = ""
		_active_player_turn_id = ""
		_hide_active_player_showcase()
		_update_network_drop_button()
		return
	var changed_player := wallet.to_lower() != _active_player_wallet or turn_id != _active_player_turn_id
	_active_player_wallet = wallet.to_lower()
	_active_player_turn_id = turn_id
	if changed_player:
		_show_active_player_placeholder(wallet)
	var is_local_turn: bool = wallet.to_lower() == _shared_world.local_wallet.to_lower()
	_local_turn_active = is_local_turn
	_update_network_drop_button()
	var owner := "your wallet" if is_local_turn else "%s…%s" % [wallet.left(6), wallet.right(4)]
	status_label.text = "Active turn %s belongs to %s and drops 10 coins." % [turn_id, owner]


func _on_active_player_presentation_changed(presentation: Dictionary) -> void:
	if presentation.is_empty():
		_hide_active_player_showcase()
		return
	_render_active_player_presentation(presentation)

func _on_local_identity_changed(wallet: String, verified: bool) -> void:
	if _verify_button != null:
		_verify_button.disabled = false
		_verify_button.text = "VERIFIED" if verified else "VERIFY WALLET SESSION"
	if _refresh_skins_button != null:
		_refresh_skins_button.disabled = not verified
	_update_network_drop_button()
	if verified:
		status_label.text = "Wallet %s…%s verified for the shared machine." % [wallet.left(6), wallet.right(4)]
	else:
		status_label.text = "Wallet verification failed. Spectator mode only."

func _on_free_turn_state_changed(state: Dictionary) -> void:
	_free_turn_state = state.duplicate(true)
	var server_now := int(_free_turn_state.get("server_time_unix", 0))
	if server_now > 0:
		_free_turn_server_offset_seconds = server_now - int(Time.get_unix_time_from_system())
	_free_turn_last_rendered_second = -1
	_refresh_free_turn_ui()

func _refresh_free_turn_ui() -> void:
	if _free_turn_label == null or _shared_world == null or _shared_world.mode == "local":
		return
	if _free_turn_state.is_empty():
		_free_turn_label.text = "FREE DROP · CHECKING…"
		return
	if not bool(_free_turn_state.get("enabled", false)):
		_free_turn_label.text = "HOURLY FREE DROP · UNAVAILABLE"
		_update_network_drop_button()
		return

	var state := String(_free_turn_state.get("state", "disabled"))
	var estimated_server_now := int(Time.get_unix_time_from_system()) + _free_turn_server_offset_seconds
	var next_free_at := maxi(0, int(_free_turn_state.get("next_free_turn_at_unix", 0)))
	var remaining := maxi(0, next_free_at - estimated_server_now)

	if state == "cooldown" and remaining <= 0:
		state = "available"
	if state == "cooldown" and remaining == _free_turn_last_rendered_second:
		return
	_free_turn_last_rendered_second = remaining

	match state:
		"available":
			_free_turn_label.text = "FREE DROP AVAILABLE NOW"
		"queued":
			_free_turn_label.text = "FREE DROP RESERVED · QUEUED"
		"active":
			_free_turn_label.text = "FREE DROP IN PROGRESS · COOLDOWN STARTS WHEN TURN ENDS"
		"reserved":
			_free_turn_label.text = "FREE DROP RESERVED"
		"cooldown":
			_free_turn_label.text = "NEXT FREE DROP · %s" % _format_free_turn_countdown(remaining)
		_:
			_free_turn_label.text = "HOURLY FREE DROP · UNAVAILABLE"
	_update_network_drop_button(state)

func _format_free_turn_countdown(total_seconds: int) -> String:
	var seconds := maxi(0, total_seconds)
	var hours := floori(float(seconds) / 3600.0)
	var minutes := floori(float(seconds % 3600) / 60.0)
	var remainder := seconds % 60
	if hours > 0:
		return "%d:%02d:%02d" % [hours, minutes, remainder]
	return "%02d:%02d" % [minutes, remainder]

func _update_network_drop_button(override_free_state: String = "") -> void:
	if _shared_world == null or _shared_world.mode == "local":
		return
	var free_state := override_free_state
	if free_state.is_empty():
		free_state = String(_free_turn_state.get("state", ""))
		if free_state == "cooldown":
			var estimated_server_now := int(Time.get_unix_time_from_system()) + _free_turn_server_offset_seconds
			if estimated_server_now >= int(_free_turn_state.get("next_free_turn_at_unix", 0)):
				free_state = "available"
	var can_queue := _shared_world.local_verified and _local_queue_position <= 0 and not _local_turn_active
	drop_button.disabled = not can_queue
	if free_state == "available":
		drop_button.text = "FREE DROP · 10 COINS"
	elif bool(_free_turn_state.get("paid_charge_bypassed_for_test", false)):
		drop_button.text = "DROP 10 COINS · TEST NO CHARGE"
	else:
		drop_button.text = "DROP 10 COINS · 10 YES"

func _on_settlement_changed(message: String) -> void:
	status_label.text = message

func _on_remote_turn_reveal_started(summary: Dictionary, wallet: String) -> void:
	# Retained for protocol compatibility with older shared servers. No camera
	# move or catch-pot hold is performed.
	var is_local_turn: bool = wallet.to_lower() == _shared_world.local_wallet.to_lower()
	status_label.text = "Your turn is settling…" if is_local_turn else "Settling turn for %s…%s…" % [wallet.left(6), wallet.right(4)]
	_show_turn_result(summary, false, -1, [], wallet)

func _on_remote_turn_finished(summary: Dictionary, wallet: String, lifetime_yes: int, milestones: Array) -> void:
	_current_turn_payout = maxi(0, int(summary.get("total_yes", 0)))
	total_dropped += maxi(0, int(summary.get("drop_count", FIXED_DROP_COUNT)))
	total_paid_out += _current_turn_payout
	total_lost += maxi(0, int(summary.get("lost_count", 0)))
	_refresh_labels()
	var is_local_turn: bool = wallet.to_lower() == _shared_world.local_wallet.to_lower()
	if is_local_turn:
		status_label.text = "Your turn complete: %d YES credited." % _current_turn_payout
	else:
		status_label.text = "%s…%s finished with %d YES." % [wallet.left(6), wallet.right(4), _current_turn_payout]
	_show_turn_result(summary, true, lifetime_yes if is_local_turn else -1, milestones if is_local_turn else [], wallet)

func _build_active_player_showcase() -> void:
	_active_player_showcase_panel = PanelContainer.new()
	_active_player_showcase_panel.name = "ActivePlayerShowcase"
	_active_player_showcase_panel.visible = false
	_active_player_showcase_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	interface_layer.add_child(_active_player_showcase_panel)
	# Mirror the main control menu as a vertical rail on the opposite side.
	# Keep the center of the viewport clear so the machine remains unobstructed.
	_active_player_showcase_panel.anchor_left = 1.0
	_active_player_showcase_panel.anchor_right = 1.0
	_active_player_showcase_panel.anchor_top = 0.0
	_active_player_showcase_panel.anchor_bottom = 1.0
	_active_player_showcase_panel.offset_left = -390.0
	_active_player_showcase_panel.offset_right = -18.0
	_active_player_showcase_panel.offset_top = 18.0
	_active_player_showcase_panel.offset_bottom = -18.0

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.010, 0.018, 0.014, 0.95)
	style.border_width_left = 2
	style.border_width_top = 2
	style.border_width_right = 2
	style.border_width_bottom = 2
	style.border_color = Color(0.96, 0.76, 0.20, 0.92)
	style.corner_radius_top_left = 18
	style.corner_radius_top_right = 18
	style.corner_radius_bottom_left = 18
	style.corner_radius_bottom_right = 18
	style.content_margin_left = 18.0
	style.content_margin_right = 18.0
	style.content_margin_top = 14.0
	style.content_margin_bottom = 14.0
	_active_player_showcase_panel.add_theme_stylebox_override("panel", style)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 12)
	_active_player_showcase_panel.add_child(root)

	var profile_box := VBoxContainer.new()
	profile_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	profile_box.add_theme_constant_override("separation", 5)
	root.add_child(profile_box)

	var eyebrow := Label.new()
	eyebrow.text = "CURRENT DROPPER"
	eyebrow.add_theme_font_size_override("font_size", 12)
	eyebrow.add_theme_color_override("font_color", Color(0.96, 0.76, 0.20, 1.0))
	profile_box.add_child(eyebrow)

	var identity := HBoxContainer.new()
	identity.add_theme_constant_override("separation", 10)
	profile_box.add_child(identity)

	var avatar_stack := Control.new()
	avatar_stack.custom_minimum_size = Vector2(62.0, 62.0)
	identity.add_child(avatar_stack)

	var avatar_back := ColorRect.new()
	avatar_back.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	avatar_back.color = Color(0.035, 0.075, 0.055, 1.0)
	avatar_stack.add_child(avatar_back)

	_active_player_avatar_fallback = Label.new()
	_active_player_avatar_fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_active_player_avatar_fallback.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_active_player_avatar_fallback.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_active_player_avatar_fallback.add_theme_font_size_override("font_size", 18)
	_active_player_avatar_fallback.add_theme_color_override("font_color", Color(0.30, 0.92, 0.60, 1.0))
	avatar_stack.add_child(_active_player_avatar_fallback)

	_active_player_avatar = TextureRect.new()
	_active_player_avatar.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_active_player_avatar.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_active_player_avatar.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_active_player_avatar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	avatar_stack.add_child(_active_player_avatar)

	var identity_text := VBoxContainer.new()
	identity_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	identity.add_child(identity_text)

	_active_player_name = Label.new()
	_active_player_name.text = "Player"
	_active_player_name.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_active_player_name.add_theme_font_size_override("font_size", 21)
	_active_player_name.add_theme_color_override("font_color", Color.WHITE)
	identity_text.add_child(_active_player_name)

	_active_player_handle = Label.new()
	_active_player_handle.text = ""
	_active_player_handle.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_active_player_handle.add_theme_font_size_override("font_size", 13)
	_active_player_handle.add_theme_color_override("font_color", Color(0.67, 0.74, 0.69, 1.0))
	identity_text.add_child(_active_player_handle)

	_active_player_tagline = Label.new()
	_active_player_tagline.text = ""
	_active_player_tagline.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_active_player_tagline.custom_minimum_size = Vector2(220.0, 36.0)
	_active_player_tagline.add_theme_font_size_override("font_size", 12)
	_active_player_tagline.add_theme_color_override("font_color", Color(0.95, 0.72, 0.22, 1.0))
	profile_box.add_child(_active_player_tagline)

	_active_player_featured_outputs = HBoxContainer.new()
	_active_player_featured_outputs.add_theme_constant_override("separation", 5)
	profile_box.add_child(_active_player_featured_outputs)

	var separator := HSeparator.new()
	root.add_child(separator)

	var showcase_box := VBoxContainer.new()
	showcase_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	showcase_box.size_flags_vertical = Control.SIZE_EXPAND_FILL
	showcase_box.add_theme_constant_override("separation", 7)
	root.add_child(showcase_box)

	var showcase_title := Label.new()
	showcase_title.text = "RAINBOW'S END TOYS"
	showcase_title.add_theme_font_size_override("font_size", 12)
	showcase_title.add_theme_color_override("font_color", Color(0.96, 0.76, 0.20, 1.0))
	showcase_box.add_child(showcase_title)

	var toy_scroll := ScrollContainer.new()
	toy_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	toy_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	toy_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	showcase_box.add_child(toy_scroll)

	_active_player_toys = VBoxContainer.new()
	_active_player_toys.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_active_player_toys.add_theme_constant_override("separation", 8)
	toy_scroll.add_child(_active_player_toys)


func _hide_active_player_showcase() -> void:
	_active_player_showcase_generation += 1
	if _active_player_showcase_panel != null:
		_active_player_showcase_panel.visible = false


func _show_active_player_placeholder(wallet: String) -> void:
	if _active_player_showcase_panel == null:
		return
	_active_player_showcase_generation += 1
	_active_player_showcase_panel.visible = true
	_active_player_showcase_panel.modulate.a = 0.0
	var reveal := create_tween()
	reveal.tween_property(_active_player_showcase_panel, "modulate:a", 1.0, 0.22)
	_active_player_avatar.texture = null
	_active_player_avatar_fallback.text = "YF"
	_active_player_name.text = "%s…%s" % [wallet.left(6), wallet.right(4)] if wallet.length() >= 10 else "Player"
	_active_player_handle.text = "Loading Yokefellow profile…"
	_active_player_tagline.text = ""
	_clear_active_player_featured_outputs()
	_clear_active_player_toy_cards()
	_add_showcase_message("Loading Toy NFT collection…")


func _render_active_player_presentation(presentation: Dictionary) -> void:
	if _active_player_showcase_panel == null:
		return
	_active_player_showcase_generation += 1
	var generation := _active_player_showcase_generation
	_active_player_showcase_panel.visible = true

	var wallet := String(presentation.get("wallet", "")).strip_edges().to_lower()
	var profile: Dictionary = {}
	var profile_value: Variant = presentation.get("profile", {})
	if profile_value is Dictionary:
		profile = profile_value as Dictionary

	_active_player_avatar.texture = null
	_active_player_avatar_fallback.text = "YF"
	if profile.is_empty():
		_active_player_name.text = "%s…%s" % [wallet.left(6), wallet.right(4)] if wallet.length() >= 10 else "Player"
		_active_player_handle.text = "Yokefellow profile unavailable"
		_active_player_tagline.text = ""
	else:
		_active_player_name.text = String(profile.get("displayName", "Player"))
		var handle := String(profile.get("handle", profile.get("slug", ""))).strip_edges()
		_active_player_handle.text = "@%s" % handle if not handle.is_empty() else ""
		var settings: Dictionary = {}
		var settings_value: Variant = profile.get("cardSettings", {})
		if settings_value is Dictionary:
			settings = settings_value as Dictionary
		_active_player_tagline.text = String(settings.get("tagline", "")).strip_edges()
		var avatar_url := String(profile.get("avatarUrl", "")).strip_edges()
		if not avatar_url.is_empty():
			_load_showcase_texture(avatar_url, _active_player_avatar, generation)
		_render_featured_profile_outputs(profile, generation)

	_clear_active_player_toy_cards()
	var toys_value: Variant = presentation.get("toys", [])
	if not (toys_value is Array) or (toys_value as Array).is_empty():
		_add_showcase_message("No Rainbow's End Toy NFTs yet.")
		return
	_render_toy_family_cards(toys_value as Array, generation)


func _clear_active_player_featured_outputs() -> void:
	if _active_player_featured_outputs == null:
		return
	for child in _active_player_featured_outputs.get_children():
		child.queue_free()


func _render_featured_profile_outputs(profile: Dictionary, generation: int) -> void:
	_clear_active_player_featured_outputs()
	var outputs_value: Variant = profile.get("featuredOutputs", [])
	if not (outputs_value is Array):
		return
	var shown := 0
	for output_value in outputs_value:
		if shown >= 3:
			break
		if not (output_value is Dictionary):
			continue
		var output := output_value as Dictionary
		var icon := TextureRect.new()
		icon.custom_minimum_size = Vector2(28.0, 28.0)
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_active_player_featured_outputs.add_child(icon)
		var url := String(output.get("imageUrl", "")).strip_edges()
		if not url.is_empty():
			_load_showcase_texture(url, icon, generation)
		shown += 1


func _clear_active_player_toy_cards() -> void:
	if _active_player_toys == null:
		return
	for child in _active_player_toys.get_children():
		child.queue_free()


func _add_showcase_message(message: String) -> void:
	var label := Label.new()
	label.text = message
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", 14)
	label.add_theme_color_override("font_color", Color(0.67, 0.74, 0.69, 1.0))
	_active_player_toys.add_child(label)


func _render_toy_family_cards(toys: Array, generation: int) -> void:
	var by_family: Dictionary = {}
	for toy_value in toys:
		if not (toy_value is Dictionary):
			continue
		var toy := toy_value as Dictionary
		var family := String(toy.get("family", "")).strip_edges().to_lower()
		if not _is_valid_toy_family(family):
			continue
		if not by_family.has(family):
			by_family[family] = []
		var entries := by_family[family] as Array
		entries.append(toy.duplicate(true))
		by_family[family] = entries

	for family in ["horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest"]:
		if not by_family.has(family):
			continue
		var entries := by_family[family] as Array
		var counts := {"small": 0, "medium": 0, "large": 0}
		var best: Dictionary = {}
		var best_rank := -1
		for entry_value in entries:
			if not (entry_value is Dictionary):
				continue
			var entry := entry_value as Dictionary
			var tier := String(entry.get("tier", "small")).strip_edges().to_lower()
			var rank := _toy_tier_rank(tier)
			counts[tier] = int(counts.get(tier, 0)) + maxi(1, int(entry.get("quantity", 1)))
			if rank > best_rank:
				best_rank = rank
				best = entry
		_add_toy_family_card(family, counts, best, generation)


func _add_toy_family_card(family: String, counts: Dictionary, best: Dictionary, generation: int) -> void:
	var tier := String(best.get("tier", "small")).strip_edges().to_lower()
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(0.0, 88.0)
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.025, 0.044, 0.033, 0.96)
	style.border_width_left = 1
	style.border_width_top = 1
	style.border_width_right = 1
	style.border_width_bottom = 1
	style.border_color = Color(0.22, 0.48, 0.32, 0.9)
	style.corner_radius_top_left = 10
	style.corner_radius_top_right = 10
	style.corner_radius_bottom_left = 10
	style.corner_radius_bottom_right = 10
	style.content_margin_left = 8.0
	style.content_margin_right = 8.0
	style.content_margin_top = 7.0
	style.content_margin_bottom = 7.0
	card.add_theme_stylebox_override("panel", style)
	_active_player_toys.add_child(card)

	var layout := HBoxContainer.new()
	layout.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	layout.add_theme_constant_override("separation", 10)
	card.add_child(layout)

	var image := TextureRect.new()
	image.custom_minimum_size = Vector2(72.0, 72.0)
	image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layout.add_child(image)

	var text_box := VBoxContainer.new()
	text_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text_box.alignment = BoxContainer.ALIGNMENT_CENTER
	text_box.add_theme_constant_override("separation", 2)
	layout.add_child(text_box)

	var title := Label.new()
	title.text = _toy_name(family)
	title.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	title.add_theme_font_size_override("font_size", 13)
	title.add_theme_color_override("font_color", Color.WHITE)
	text_box.add_child(title)

	var tier_label := Label.new()
	tier_label.text = tier.to_upper()
	tier_label.add_theme_font_size_override("font_size", 10)
	tier_label.add_theme_color_override(
		"font_color",
		Color(1.0, 0.78, 0.20, 1.0) if tier == "large" else Color(0.40, 0.90, 0.62, 1.0)
	)
	text_box.add_child(tier_label)

	var counts_label := Label.new()
	counts_label.text = "Small %d  ·  Medium %d  ·  Large %d" % [
		int(counts.get("small", 0)),
		int(counts.get("medium", 0)),
		int(counts.get("large", 0)),
	]
	counts_label.add_theme_font_size_override("font_size", 10)
	counts_label.add_theme_color_override("font_color", Color(0.65, 0.72, 0.67, 1.0))
	text_box.add_child(counts_label)

	var image_url := String(best.get("imageUrl", "")).strip_edges()
	if not image_url.is_empty():
		_load_showcase_texture(image_url, image, generation)

func _toy_tier_rank(tier: String) -> int:
	match tier:
		"large": return 2
		"medium": return 1
	return 0


func _load_showcase_texture(raw_url: String, target: TextureRect, generation: int) -> void:
	var url := _nft_image_request_url(raw_url)
	if url.is_empty():
		return
	var request := HTTPRequest.new()
	request.timeout = 12.0
	add_child(request)
	var start_error := request.request(url, PackedStringArray(["Accept: image/*"]))
	if start_error != OK:
		request.queue_free()
		return
	var completed: Array = await request.request_completed
	request.queue_free()
	if generation != _active_player_showcase_generation or not is_instance_valid(target):
		return
	if int(completed[0]) != HTTPRequest.RESULT_SUCCESS or int(completed[1]) < 200 or int(completed[1]) >= 300:
		return
	var image_data := Image.new()
	var load_error := _load_image_bytes(image_data, completed[3], completed[2], url)
	if load_error != OK:
		return
	target.texture = ImageTexture.create_from_image(image_data)


func _build_network_controls() -> void:
	var layout := $Interface/Margin/Panel/Layout as VBoxContainer
	if _shared_world.mode == "local":
		return

	var divider := HSeparator.new()
	layout.add_child(divider)

	var network_title := Label.new()
	network_title.text = "SHARED MACHINE"
	network_title.add_theme_color_override("font_color", Color(0.96, 0.76, 0.24, 1.0))
	layout.add_child(network_title)

	_queue_label = Label.new()
	_queue_label.text = "Queue: 0 waiting"
	layout.add_child(_queue_label)

	_free_turn_label = Label.new()
	_free_turn_label.text = "FREE DROP · CHECKING…"
	_free_turn_label.add_theme_font_size_override("font_size", 15)
	_free_turn_label.add_theme_color_override("font_color", Color(0.96, 0.76, 0.24, 1.0))
	layout.add_child(_free_turn_label)
	var drop_controls := $Interface/Margin/Panel/Layout/DropControls as HBoxContainer
	layout.move_child(_free_turn_label, drop_controls.get_index())

	if _is_local_web_yd2_test():
		_test_player_button = Button.new()
		_test_player_button.text = "QUEUE TEST PLAYER B"
		_test_player_button.tooltip_text = "Adds a presentation-only second player. No wallet switch or Yokefellow settlement."
		_test_player_button.pressed.connect(_on_queue_test_player_pressed)
		layout.add_child(_test_player_button)

	var skin_title := Label.new()
	skin_title.text = "EQUIPPED COIN"
	skin_title.add_theme_color_override("font_color", Color(0.96, 0.76, 0.24, 1.0))
	layout.add_child(skin_title)

	var skin_actions := HBoxContainer.new()
	layout.add_child(skin_actions)
	_skin_selector = OptionButton.new()
	_skin_selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_skin_selector.item_selected.connect(_on_skin_option_selected)
	skin_actions.add_child(_skin_selector)
	_refresh_skins_button = Button.new()
	_refresh_skins_button.text = "REFRESH SKINS"
	_refresh_skins_button.disabled = not _shared_world.local_verified
	_refresh_skins_button.pressed.connect(_on_refresh_skins_pressed)
	skin_actions.add_child(_refresh_skins_button)
	_rebuild_skin_selector(_shared_world.local_owned_skin_families, _shared_world.local_skin_family)

	if _shared_world.mode == "server":
		var server_label := Label.new()
		server_label.text = "Authoritative server · port %d" % _shared_world._server_port
		layout.add_child(server_label)
		return

	var identity_actions := HBoxContainer.new()
	layout.add_child(identity_actions)
	if _shared_world.is_web_client():
		var wallet_label := Label.new()
		if _shared_world.local_wallet.is_empty():
			wallet_label.text = "Open this game through the wallet login page."
		else:
			wallet_label.text = "Wallet: %s…%s · verifying signed session" % [
				_shared_world.local_wallet.left(6),
				_shared_world.local_wallet.right(4),
			]
		layout.add_child(wallet_label)
	else:
		_wallet_input = LineEdit.new()
		_wallet_input.placeholder_text = "Wallet address (0x…)"
		_wallet_input.text = _shared_world.local_wallet
		layout.add_child(_wallet_input)

		_session_input = LineEdit.new()
		_session_input.placeholder_text = "Signed Yokefellow session token"
		_session_input.secret = true
		_session_input.text = _shared_world.local_session_token
		layout.add_child(_session_input)

		_verify_button = Button.new()
		_verify_button.text = "VERIFY WALLET SESSION"
		_verify_button.pressed.connect(_on_verify_wallet_pressed)
		identity_actions.add_child(_verify_button)
	_leave_queue_button = Button.new()
	_leave_queue_button.text = "LEAVE QUEUE"
	_leave_queue_button.pressed.connect(_on_leave_queue_pressed)
	identity_actions.add_child(_leave_queue_button)
	_update_network_drop_button()
	_refresh_free_turn_ui()

func _on_owned_skins_changed(families: Array, equipped: String) -> void:
	_rebuild_skin_selector(families, equipped)
	_active_skin_toy_family = equipped

func _on_skin_option_selected(index: int) -> void:
	if _updating_skin_selector or _skin_selector == null:
		return
	var family := String(_skin_selector.get_item_metadata(index))
	set_active_skin_toy_family(family)

func _on_refresh_skins_pressed() -> void:
	if _shared_world != null:
		_shared_world.refresh_owned_skins()

func _rebuild_skin_selector(families: Array, equipped: String) -> void:
	if _skin_selector == null:
		return
	_updating_skin_selector = true
	_skin_selector.clear()
	_skin_selector.add_item("Default YES coin")
	_skin_selector.set_item_metadata(0, "")
	var normalized_equipped := equipped.strip_edges().to_lower()
	var selected_index := 0
	for value in families:
		var family := String(value).strip_edges().to_lower()
		if not _is_valid_toy_family(family):
			continue
		var item_index := _skin_selector.item_count
		_skin_selector.add_item("%s skin" % _toy_name(family))
		_skin_selector.set_item_metadata(item_index, family)
		if family == normalized_equipped:
			selected_index = item_index
	_skin_selector.select(selected_index)
	_updating_skin_selector = false

func _select_skin_option(family: String) -> void:
	if _skin_selector == null:
		return
	var normalized := family.strip_edges().to_lower()
	for index in range(_skin_selector.item_count):
		if String(_skin_selector.get_item_metadata(index)) == normalized:
			_updating_skin_selector = true
			_skin_selector.select(index)
			_updating_skin_selector = false
			return

func _on_verify_wallet_pressed() -> void:
	if _wallet_input == null or _session_input == null:
		return
	_verify_button.disabled = true
	_verify_button.text = "VERIFYING…"
	_shared_world.identify_local_player(_wallet_input.text, _session_input.text)

func _on_leave_queue_pressed() -> void:
	_shared_world.leave_queue()

func _on_queue_test_player_pressed() -> void:
	if _test_player_button != null:
		_test_player_button.disabled = true
	_shared_world.request_presentation_test_opponent()
	await get_tree().create_timer(1.0).timeout
	if _test_player_button != null:
		_test_player_button.disabled = false

func _is_local_web_yd2_test() -> bool:
	if not OS.has_feature("web"):
		return false
	var hostname: Variant = JavaScriptBridge.eval(
		"(window.parent && window.parent.location && window.parent.location.hostname) || ''",
		true
	)
	return String(hostname).strip_edges().to_lower() in ["127.0.0.1", "localhost"]

func _on_nft_awarded(award: Dictionary) -> void:
	_nft_award_queue.append(award.duplicate(true))
	if not _nft_award_showing:
		_show_next_nft_award()

func _show_next_nft_award() -> void:
	if _nft_award_queue.is_empty():
		_nft_award_showing = false
		_active_nft_award = {}
		_nft_award_panel.visible = false
		_clear_nft_preview()
		return

	_nft_award_showing = true
	_active_nft_award = _nft_award_queue.pop_front()
	_nft_award_generation += 1
	var generation := _nft_award_generation
	var kind := String(_active_nft_award.get("kind", "nft")).strip_edges().to_lower()
	var family := String(_active_nft_award.get("family", "")).strip_edges().to_lower()
	var title := String(_active_nft_award.get("title", "Yokefellow NFT")).strip_edges()
	var source := String(_active_nft_award.get("source", "Yokefellow")).strip_edges()
	var detail := String(_active_nft_award.get("detail", "Added to your wallet.")).strip_edges()
	var token_id := String(_active_nft_award.get("token_id", "")).strip_edges()
	var image_url := String(_active_nft_award.get("image_url", "")).strip_edges()

	_nft_award_type.text = "COIN SKIN NFT" if kind == "skin" else "TOY NFT" if kind == "toy" else "YOKEFELLOW NFT"
	_nft_award_name.text = title
	var detail_lines := PackedStringArray([detail])
	if not source.is_empty():
		detail_lines.append("Earned through %s." % source)
	if not token_id.is_empty():
		detail_lines.append("Token #%s" % token_id)
	_nft_award_detail.text = "\n".join(detail_lines)
	_nft_award_action.text = "EQUIP THIS SKIN" if kind == "skin" and not family.is_empty() else "CONTINUE"
	_build_nft_preview(kind, family)
	if not image_url.is_empty():
		call_deferred("_load_nft_award_image", image_url, generation)

	_nft_award_panel.modulate = Color(1.0, 1.0, 1.0, 0.0)
	_nft_award_panel.visible = true
	var tween := create_tween()
	tween.set_trans(Tween.TRANS_BACK)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_property(_nft_award_panel, "modulate:a", 1.0, 0.32)
	_hide_nft_award_later(generation)

func _hide_nft_award_later(generation: int) -> void:
	await get_tree().create_timer(8.0).timeout
	if generation == _nft_award_generation and _nft_award_showing:
		_dismiss_nft_award()

func _on_nft_award_action_pressed() -> void:
	var kind := String(_active_nft_award.get("kind", "")).strip_edges().to_lower()
	var family := String(_active_nft_award.get("family", "")).strip_edges().to_lower()
	if kind == "skin" and not family.is_empty():
		set_active_skin_toy_family(family)
	_dismiss_nft_award()

func _dismiss_nft_award() -> void:
	if not _nft_award_showing:
		return
	_nft_award_generation += 1
	_nft_award_showing = false
	var tween := create_tween()
	tween.tween_property(_nft_award_panel, "modulate:a", 0.0, 0.24)
	await tween.finished
	_nft_award_panel.visible = false
	_clear_nft_preview()
	call_deferred("_show_next_nft_award")

func _build_nft_award_panel() -> void:
	_nft_award_panel = PanelContainer.new()
	_nft_award_panel.name = "NftAwardPanel"
	_nft_award_panel.visible = false
	_nft_award_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	interface_layer.add_child(_nft_award_panel)
	_nft_award_panel.anchor_left = 0.5
	_nft_award_panel.anchor_right = 0.5
	_nft_award_panel.anchor_top = 0.5
	_nft_award_panel.anchor_bottom = 0.5
	_nft_award_panel.offset_left = -310.0
	_nft_award_panel.offset_right = 310.0
	_nft_award_panel.offset_top = -300.0
	_nft_award_panel.offset_bottom = 300.0

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.012, 0.020, 0.016, 0.985)
	style.border_width_left = 4
	style.border_width_top = 4
	style.border_width_right = 4
	style.border_width_bottom = 4
	style.border_color = Color(1.0, 0.72, 0.12, 1.0)
	style.corner_radius_top_left = 24
	style.corner_radius_top_right = 24
	style.corner_radius_bottom_left = 24
	style.corner_radius_bottom_right = 24
	style.content_margin_left = 28.0
	style.content_margin_right = 28.0
	style.content_margin_top = 22.0
	style.content_margin_bottom = 24.0
	_nft_award_panel.add_theme_stylebox_override("panel", style)

	var layout := VBoxContainer.new()
	layout.alignment = BoxContainer.ALIGNMENT_CENTER
	layout.add_theme_constant_override("separation", 10)
	_nft_award_panel.add_child(layout)

	var earned := Label.new()
	earned.text = "NFT EARNED"
	earned.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	earned.add_theme_font_size_override("font_size", 34)
	earned.add_theme_color_override("font_color", Color(1.0, 0.78, 0.18, 1.0))
	layout.add_child(earned)

	_nft_award_type = Label.new()
	_nft_award_type.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_nft_award_type.add_theme_font_size_override("font_size", 16)
	_nft_award_type.add_theme_color_override("font_color", Color(0.38, 0.94, 0.55, 1.0))
	layout.add_child(_nft_award_type)

	var preview_stack := Control.new()
	preview_stack.custom_minimum_size = Vector2(540.0, 275.0)
	preview_stack.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layout.add_child(preview_stack)

	_nft_preview_container = SubViewportContainer.new()
	_nft_preview_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_nft_preview_container.stretch = true
	_nft_preview_container.mouse_filter = Control.MOUSE_FILTER_IGNORE
	preview_stack.add_child(_nft_preview_container)

	_nft_preview_viewport = SubViewport.new()
	_nft_preview_viewport.size = Vector2i(540, 275)
	_nft_preview_viewport.transparent_bg = true
	_nft_preview_viewport.own_world_3d = true
	_nft_preview_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_nft_preview_container.add_child(_nft_preview_viewport)

	_nft_image_rect = TextureRect.new()
	_nft_image_rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_nft_image_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_nft_image_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_nft_image_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_nft_image_rect.visible = false
	preview_stack.add_child(_nft_image_rect)

	_nft_preview_root = Node3D.new()
	_nft_preview_viewport.add_child(_nft_preview_root)
	var camera := Camera3D.new()
	_nft_preview_root.add_child(camera)
	camera.position = Vector3(0.0, 1.7, 5.2)
	camera.fov = 38.0
	camera.current = true
	camera.look_at(Vector3(0.0, 0.25, 0.0), Vector3.UP)
	var key_light := DirectionalLight3D.new()
	key_light.rotation_degrees = Vector3(-42.0, -28.0, 0.0)
	key_light.light_energy = 2.2
	_nft_preview_root.add_child(key_light)
	var fill_light := OmniLight3D.new()
	fill_light.position = Vector3(-2.2, 1.8, 2.8)
	fill_light.light_energy = 5.0
	fill_light.omni_range = 8.0
	_nft_preview_root.add_child(fill_light)

	_nft_award_name = Label.new()
	_nft_award_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_nft_award_name.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_nft_award_name.add_theme_font_size_override("font_size", 28)
	_nft_award_name.add_theme_color_override("font_color", Color.WHITE)
	layout.add_child(_nft_award_name)

	_nft_award_detail = Label.new()
	_nft_award_detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_nft_award_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_nft_award_detail.custom_minimum_size = Vector2(520.0, 62.0)
	_nft_award_detail.add_theme_font_size_override("font_size", 17)
	layout.add_child(_nft_award_detail)

	_nft_award_action = Button.new()
	_nft_award_action.text = "CONTINUE"
	_nft_award_action.custom_minimum_size = Vector2(280.0, 52.0)
	_nft_award_action.add_theme_font_size_override("font_size", 19)
	_nft_award_action.pressed.connect(_on_nft_award_action_pressed)
	layout.add_child(_nft_award_action)

func _load_nft_award_image(raw_url: String, generation: int) -> void:
	var url := _nft_image_request_url(raw_url)
	if url.is_empty():
		return
	var request := HTTPRequest.new()
	request.timeout = 15.0
	add_child(request)
	var start_error := request.request(url, PackedStringArray(["Accept: image/*"]))
	if start_error != OK:
		request.queue_free()
		return
	var completed: Array = await request.request_completed
	request.queue_free()
	if generation != _nft_award_generation or not _nft_award_showing:
		return
	if int(completed[0]) != HTTPRequest.RESULT_SUCCESS or int(completed[1]) < 200 or int(completed[1]) >= 300:
		return
	var headers: PackedStringArray = completed[2]
	var bytes: PackedByteArray = completed[3]
	var image := Image.new()
	var load_error := _load_image_bytes(image, bytes, headers, url)
	if load_error != OK:
		return
	_nft_image_rect.texture = ImageTexture.create_from_image(image)
	_nft_image_rect.visible = true
	_nft_preview_container.visible = false

func _nft_image_request_url(raw_url: String) -> String:
	var url := raw_url.strip_edges()
	if url.begins_with("ipfs://"):
		return "https://ipfs.io/ipfs/%s" % url.trim_prefix("ipfs://").trim_prefix("ipfs/")
	return url if url.begins_with("https://") or url.begins_with("http://") else ""

func _load_image_bytes(image: Image, bytes: PackedByteArray, headers: PackedStringArray, url: String) -> int:
	var content_type := ""
	for header in headers:
		var text := String(header)
		if text.to_lower().begins_with("content-type:"):
			content_type = text.substr(text.find(":") + 1).strip_edges().to_lower()
			break
	var lowered_url := String(url.to_lower().split("?")[0])
	if content_type.contains("png") or lowered_url.ends_with(".png"):
		return image.load_png_from_buffer(bytes)
	if content_type.contains("jpeg") or content_type.contains("jpg") or lowered_url.ends_with(".jpg") or lowered_url.ends_with(".jpeg"):
		return image.load_jpg_from_buffer(bytes)
	if content_type.contains("webp") or lowered_url.ends_with(".webp"):
		return image.load_webp_from_buffer(bytes)
	var error := image.load_png_from_buffer(bytes)
	if error == OK:
		return OK
	error = image.load_jpg_from_buffer(bytes)
	if error == OK:
		return OK
	return image.load_webp_from_buffer(bytes)

func _build_nft_preview(kind: String, family: String) -> void:
	_clear_nft_preview()
	if kind == "toy":
		var toy := TOY_SCENE.instantiate() as PusherToy
		if toy == null:
			return
		toy.toy_family = family if not family.is_empty() else "horseshoe"
		_nft_preview_root.add_child(toy)
		toy.freeze = true
		toy.collision_layer = 0
		toy.collision_mask = 0
		toy.position = Vector3(0.0, -0.15, 0.0)
		toy.scale = Vector3.ONE * 0.72
		_nft_preview_model = toy
		return

	var coin := COIN_SCENE.instantiate() as PusherCoin
	if coin == null:
		return
	_nft_preview_root.add_child(coin)
	coin.freeze = true
	coin.collision_layer = 0
	coin.collision_mask = 0
	coin.apply_skin_family(family)
	coin.position = Vector3(0.0, 0.15, 0.0)
	coin.rotation_degrees = Vector3(68.0, 0.0, 0.0)
	coin.scale = Vector3.ONE * 3.2
	_nft_preview_model = coin

func _clear_nft_preview() -> void:
	if is_instance_valid(_nft_preview_model):
		_nft_preview_model.free()
	_nft_preview_model = null
	if _nft_image_rect != null:
		_nft_image_rect.texture = null
		_nft_image_rect.visible = false
	if _nft_preview_container != null:
		_nft_preview_container.visible = true

func _build_turn_result_panel() -> void:
	_turn_result_panel = PanelContainer.new()
	_turn_result_panel.name = "TurnResultPanel"
	_turn_result_panel.visible = false
	_turn_result_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	interface_layer.add_child(_turn_result_panel)
	_turn_result_panel.anchor_left = 1.0
	_turn_result_panel.anchor_right = 1.0
	_turn_result_panel.anchor_top = 0.0
	_turn_result_panel.anchor_bottom = 0.0
	_turn_result_panel.offset_left = -410.0
	_turn_result_panel.offset_right = -28.0
	_turn_result_panel.offset_top = 92.0
	_turn_result_panel.offset_bottom = 330.0

	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.018, 0.026, 0.020, 0.96)
	panel_style.border_width_left = 2
	panel_style.border_width_top = 2
	panel_style.border_width_right = 2
	panel_style.border_width_bottom = 2
	panel_style.border_color = Color(0.96, 0.76, 0.20, 1.0)
	panel_style.corner_radius_top_left = 14
	panel_style.corner_radius_top_right = 14
	panel_style.corner_radius_bottom_left = 14
	panel_style.corner_radius_bottom_right = 14
	panel_style.content_margin_left = 20.0
	panel_style.content_margin_right = 20.0
	panel_style.content_margin_top = 16.0
	panel_style.content_margin_bottom = 16.0
	_turn_result_panel.add_theme_stylebox_override("panel", panel_style)

	var layout := VBoxContainer.new()
	layout.add_theme_constant_override("separation", 9)
	_turn_result_panel.add_child(layout)

	_turn_result_title = Label.new()
	_turn_result_title.text = "TURN COMPLETE"
	_turn_result_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_turn_result_title.add_theme_font_size_override("font_size", 25)
	_turn_result_title.add_theme_color_override("font_color", Color(1.0, 0.78, 0.20, 1.0))
	layout.add_child(_turn_result_title)

	_turn_result_detail = Label.new()
	_turn_result_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_turn_result_detail.add_theme_font_size_override("font_size", 17)
	_turn_result_detail.custom_minimum_size = Vector2(340.0, 150.0)
	layout.add_child(_turn_result_detail)

func _show_turn_result(summary: Dictionary, final: bool, lifetime_yes: int, milestones: Array, owner_wallet: String) -> void:
	_turn_result_generation += 1
	var generation: int = _turn_result_generation
	_turn_result_title.text = "TURN COMPLETE" if final else "TURN SETTLING"
	var lines: PackedStringArray = PackedStringArray()
	var drop_count: int = maxi(0, int(summary.get("drop_count", FIXED_DROP_COUNT)))
	var caught_count: int = maxi(0, int(summary.get("caught_coin_count", 0)))
	var lost_count: int = maxi(0, int(summary.get("lost_count", 0)))
	var base_yes: int = maxi(0, int(summary.get("caught_base_yes", caught_count)))
	var multiplier: int = maxi(1, int(summary.get("payout_multiplier", 1)))
	var bonus_yes: int = maxi(0, int(summary.get("bonus_yes", 0)))
	var total_yes: int = maxi(0, int(summary.get("total_yes", 0)))
	lines.append("Coins dropped: %d" % drop_count)
	lines.append("Coins caught: %d" % caught_count)
	lines.append("Coins lost this turn: %d" % lost_count)
	if multiplier > 1:
		lines.append("Caught value: %d YES × %d" % [base_yes, multiplier])
	else:
		lines.append("Caught value: %d YES" % base_yes)
	if bonus_yes > 0:
		lines.append("Bonus YES: +%d" % bonus_yes)
	var toy_names: PackedStringArray = PackedStringArray()
	var toy_values: Variant = summary.get("toy_families", [])
	if toy_values is Array:
		for toy_value in toy_values:
			toy_names.append(_toy_name(String(toy_value)))
	if not toy_names.is_empty():
		lines.append("Toy caught: %s" % ", ".join(toy_names))
	lines.append("")
	lines.append("TOTAL: %d YES" % total_yes)
	if final and lifetime_yes >= 0:
		lines.append("Lifetime earned: %d YES" % lifetime_yes)
	if final:
		var lifetime_paid_out := maxi(0, int(summary.get("lifetime_coins_paid_out", 0)))
		var skin_every := maxi(1, int(summary.get("skin_drop_every_coins", 100)))
		lines.append("Skin progress: %d / %d coins paid out" % [lifetime_paid_out % skin_every, skin_every])
	if final and not milestones.is_empty():
		lines.append("Coin Skin Drop earned: %d" % milestones.size())
	if not owner_wallet.is_empty() and owner_wallet.to_lower() != _shared_world.local_wallet.to_lower():
		lines.append("Player: %s…%s" % [owner_wallet.left(6), owner_wallet.right(4)])
	_turn_result_detail.text = "\n".join(lines)
	_turn_result_panel.modulate = Color.WHITE
	_turn_result_panel.visible = true
	if final:
		_hide_turn_result_later(generation)

func _hide_turn_result_later(generation: int) -> void:
	await get_tree().create_timer(6.0).timeout
	if generation != _turn_result_generation:
		return
	var tween := create_tween()
	tween.tween_property(_turn_result_panel, "modulate:a", 0.0, 0.35)
	await tween.finished
	if generation == _turn_result_generation:
		_turn_result_panel.visible = false

func _build_power_panel() -> void:
	_power_panel = PanelContainer.new()
	_power_panel.name = "ToyPowerPanel"
	_power_panel.visible = false
	_power_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	interface_layer.add_child(_power_panel)
	_power_panel.anchor_left = 0.5
	_power_panel.anchor_right = 0.5
	_power_panel.anchor_top = 0.0
	_power_panel.anchor_bottom = 0.0
	_power_panel.offset_left = -220.0
	_power_panel.offset_right = 220.0
	_power_panel.offset_top = 22.0
	_power_panel.offset_bottom = 470.0

	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.018, 0.026, 0.020, 0.97)
	panel_style.border_width_left = 3
	panel_style.border_width_top = 3
	panel_style.border_width_right = 3
	panel_style.border_width_bottom = 3
	panel_style.border_color = Color(0.94, 0.64, 0.12, 1.0)
	panel_style.corner_radius_top_left = 18
	panel_style.corner_radius_top_right = 18
	panel_style.corner_radius_bottom_left = 18
	panel_style.corner_radius_bottom_right = 18
	panel_style.content_margin_left = 22.0
	panel_style.content_margin_right = 22.0
	panel_style.content_margin_top = 18.0
	panel_style.content_margin_bottom = 18.0
	_power_panel.add_theme_stylebox_override("panel", panel_style)

	var layout := VBoxContainer.new()
	layout.alignment = BoxContainer.ALIGNMENT_CENTER
	layout.add_theme_constant_override("separation", 10)
	_power_panel.add_child(layout)

	_power_title = Label.new()
	_power_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_power_title.add_theme_font_size_override("font_size", 28)
	_power_title.add_theme_color_override("font_color", Color(1.0, 0.76, 0.20, 1.0))
	layout.add_child(_power_title)

	_power_detail = Label.new()
	_power_detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_power_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_power_detail.custom_minimum_size = Vector2(390.0, 48.0)
	_power_detail.add_theme_font_size_override("font_size", 18)
	layout.add_child(_power_detail)

	_power_wheel = REWARD_WHEEL_SCRIPT.new() as Control
	_power_wheel.visible = false
	_power_wheel.connect("spin_finished", Callable(self, "_on_reward_wheel_spin_finished"))
	layout.add_child(_power_wheel)

	_power_spin_button = Button.new()
	_power_spin_button.text = "SPIN THE LUCKY WHEEL"
	_power_spin_button.custom_minimum_size = Vector2(260.0, 52.0)
	_power_spin_button.visible = false
	_power_spin_button.add_theme_font_size_override("font_size", 19)
	_power_spin_button.pressed.connect(_on_reward_wheel_spin_pressed)
	layout.add_child(_power_spin_button)

func _show_power_message(title: String, detail: String, accent: Color, auto_hide: bool) -> void:
	_power_message_generation += 1
	var generation: int = _power_message_generation
	_power_title.text = title
	_power_title.add_theme_color_override("font_color", accent)
	_power_detail.text = detail
	_power_panel.offset_bottom = 470.0 if _power_wheel.visible else 160.0
	_power_panel.modulate = Color(1.0, 1.0, 1.0, 1.0)
	_power_panel.visible = true
	if auto_hide:
		_hide_power_message_later(generation)

func _hide_power_message_later(generation: int) -> void:
	await get_tree().create_timer(3.0).timeout
	if generation != _power_message_generation:
		return
	var tween := create_tween()
	tween.tween_property(_power_panel, "modulate:a", 0.0, 0.35)
	await tween.finished
	if generation == _power_message_generation:
		_power_panel.visible = false
		_power_wheel.visible = false

func _on_reward_wheel_spin_pressed() -> void:
	if bool(_power_wheel.call("is_spinning")):
		return
	_power_spin_button.disabled = true
	_power_detail.text = "Waiting for the shared server's result…"
	if _shared_world != null and _shared_world.is_network_client():
		_shared_world.request_reward_wheel_spin()
	else:
		_power_wheel.call("spin")

func _on_remote_reward_wheel_result(value: int) -> void:
	_power_detail.text = "The shared server selected the result…"
	_power_wheel.call("spin_to_value", value)

func _on_reward_wheel_spin_finished(value: int) -> void:
	if _shared_world != null and _shared_world.is_network_client():
		_on_reward_wheel_awarded(value)
		return
	if not machine.resolve_clover_reward(value):
		_power_spin_button.disabled = false
		_power_detail.text = "The wheel result could not be applied."

func _toy_name(toy_family: String) -> String:
	match toy_family:
		"horseshoe":
			return "Horseshoe"
		"four_leaf_clover":
			return "Four-Leaf Clover"
		"leprechaun":
			return "Leprechaun"
		"pot_of_gold":
			return "Pot of Gold"
		"treasure_chest":
			return "Treasure Chest"
	return "Toy"

func _refresh_labels() -> void:
	payout_label.text = "Dropped: %d   Paid out: %d   Lost: %d" % [
		total_dropped,
		total_paid_out,
		total_lost,
	]
