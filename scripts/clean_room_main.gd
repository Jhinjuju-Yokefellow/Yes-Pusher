extends "res://scripts/main.gd"

func _ready() -> void:
	_build_power_panel()
	_build_capture_panel()
	_build_turn_result_panel()
	_build_nft_award_panel()
	_build_active_player_showcase()
	_shared_world = YesDropCleanRoomSharedWorld.new()
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
	_shared_world.presentation_event.connect(_on_presentation_event)

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
