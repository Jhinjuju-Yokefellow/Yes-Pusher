extends Node3D
class_name YesPusherMachine

signal coin_spawned(coin: RigidBody3D)
signal coin_paid_out(value: int)
signal coin_lost()
signal machine_reset()
signal turn_started(drop_count: int)
signal turn_finished(payout: int)
signal turn_payout_corrected(delta: int, corrected_payout: int)
signal toy_spawned(toy: RigidBody3D, toy_family: String, toy_instance_id: String)
signal toy_spawn_skipped(toy_family: String, active_count: int, max_count: int)
signal toy_captured(toy_family: String, toy_instance_id: String, turn_id: int, power_result: Dictionary)
signal toy_lost(toy_family: String, toy_instance_id: String)
signal toy_power_activated(toy_family: String, power_result: Dictionary)
signal turn_time_extended(seconds: float, total_bonus_seconds: float)
signal reward_wheel_requested(values: PackedInt32Array)
signal reward_wheel_awarded(extra_yes: int)

const TOY_SCENE: PackedScene = preload("res://Toy.tscn")
const FIXED_TURN_COIN_COUNT: int = 10
const WORLD_SNAPSHOT_VERSION: int = 2
const REMOVED_COIN_TOMBSTONE_MS: int = 2600
const REPLICA_RETIRE_SECONDS: float = 2.20
@export var coin_scene: PackedScene
@export_range(1.5, 8.0, 0.1) var pusher_period_seconds: float = 4.0
@export var pusher_rear_z: float = -7.15
@export var pusher_front_z: float = -2.55
@export_range(0, 200, 1) var starting_coin_count: int = 72
@export_range(4.0, 16.0, 0.5) var turn_settle_seconds: float = 8.0
@export_range(0.5, 3.0, 0.1) var bucket_quiet_seconds: float = 1.2
@export_range(1, 32, 1) var max_active_toys: int = 8
@export_range(0.0, 20.0, 0.5) var toy_bonus_seconds: float = 5.0
@export_range(0.0, 120.0, 1.0) var max_toy_bonus_seconds: float = 30.0
@export_range(0.5, 10.0, 0.5) var horseshoe_magnet_seconds: float = 3.5
@export_range(0.5, 120.0, 0.5) var horseshoe_magnet_force: float = 4.0
@export_range(0.5, 30.0, 0.5) var horseshoe_max_coin_speed: float = 2.5
@export_range(1, 40, 1) var horseshoe_coin_limit: int = 8
@export_range(1, 300, 1) var leprechaun_coin_limit: int = 200
@export_range(1, 100, 1) var clover_max_yes: int = 10
@export var clover_wheel_yes_values: PackedInt32Array = PackedInt32Array([1, 2, 3, 5, 10])
@export_range(1, 50, 1) var treasure_chest_bonus_coins: int = 10

@onready var pusher: AnimatableBody3D = $Pusher
@onready var coin_container: Node3D = $Coins
@onready var payout_zone: Area3D = $PayoutZone
@onready var cleanup_zone: Area3D = $CleanupZone

var _toy_container: Node3D

var _pusher_time: float = 0.0
var _random := RandomNumberGenerator.new()
var _resetting: bool = false
var _turn_active: bool = false
var _result_waiting: bool = false
var _turn_generation: int = 0
var _turn_bucket_value: int = 0
var _turn_bucket_coins: Array[Node3D] = []
var _last_bucket_entry_ms: int = 0
var _queued_turn_toy_family: String = ""
var _turn_bucket_toys: Array[Node3D] = []
var _turn_payout_multiplier: int = 1
var _turn_bonus_yes: int = 0
var _turn_end_deadline_ms: int = 0
var _turn_bonus_time_ms: int = 0
var _horseshoe_active_until_ms: int = 0
var _pending_clover_spins: int = 0
var _reported_turn_payout: int = 0
var _turn_caught_coin_count: int = 0
var _turn_lost_coin_count: int = 0
var _turn_toy_families: Array[String] = []
var _turn_toy_captures: Array[Dictionary] = []
var _last_turn_summary: Dictionary = {}
var _authoritative: bool = true
var _next_network_body_id: int = 1
var _replica_coin_targets: Dictionary = {}
var _replica_coin_velocities: Dictionary = {}
var _replica_toy_targets: Dictionary = {}
var _replica_pusher_target: Transform3D = Transform3D.IDENTITY
var _replica_pusher_target_valid: bool = false
var _recent_removed_coins: Dictionary = {}
var _replica_retiring_coins: Dictionary = {}

var _drop_x_positions: PackedFloat32Array = PackedFloat32Array([
	-3.15, -2.10, -1.05, 0.0, 1.05, 2.10, 3.15
])

func _ready() -> void:
	_remove_front_catcher_only()
	call_deferred("_remove_front_catcher_only")
	_random.randomize()
	_authoritative = not _running_as_network_client()
	_toy_container = get_node_or_null("Toys") as Node3D
	if _toy_container == null:
		_toy_container = Node3D.new()
		_toy_container.name = "Toys"
		add_child(_toy_container)
	payout_zone.body_entered.connect(_on_payout_body_entered)
	cleanup_zone.body_entered.connect(_on_cleanup_body_entered)
	_build_peg_board()
	_build_drop_slots()
	if _authoritative:
		reset_machine()
	else:
		_clear_dynamic_bodies_immediately()
		payout_zone.monitoring = false
		cleanup_zone.monitoring = false


func _remove_front_catcher_only() -> void:
	# Remove only the large oval catcher attached to the front of the machine.
	# The Pot of Gold gameplay toy is built under the Toys container and is
	# intentionally untouched. Exact names prevent this cleanup from affecting it.
	var theme := get_node_or_null("RainbowEndTheme")
	if theme != null:
		for visual_name in [
			"PotOfGoldCatchBucket",
			"LowerFrontPlinth",
			"LowerFrontGoldLine",
		]:
			var visual := theme.find_child(visual_name, true, false)
			if visual is Node3D:
				(visual as Node3D).visible = false
			if visual != null:
				visual.queue_free()

	# Older scene copies may still contain the physical catcher tray. Remove its
	# exact collision nodes while preserving PayoutZone, which still counts coins
	# and toys as they fall out of the machine.
	for catcher_name in [
		"PayoutTrayFloor",
		"PayoutTrayLeftWall",
		"PayoutTrayRightWall",
		"PayoutTrayFrontWall",
	]:
		var catcher := get_node_or_null(catcher_name)
		if catcher is CollisionObject3D:
			(catcher as CollisionObject3D).collision_layer = 0
			(catcher as CollisionObject3D).collision_mask = 0
		if catcher is Node3D:
			(catcher as Node3D).visible = false
		if catcher != null:
			catcher.queue_free()

func _physics_process(delta: float) -> void:
	if not _authoritative:
		_update_replica_interpolation(delta)
		return
	_apply_horseshoe_magnet(delta)
	if not _turn_active:
		var idle_position := pusher.position
		idle_position.z = pusher_rear_z
		pusher.position = idle_position
		return

	_pusher_time = fmod(_pusher_time + delta, pusher_period_seconds)
	var cycle := _pusher_time / pusher_period_seconds
	var progress := _stroke_progress(cycle)
	var next_position := pusher.position
	next_position.z = lerpf(pusher_rear_z, pusher_front_z, progress)
	pusher.position = next_position

func _stroke_progress(cycle: float) -> float:
	# The shelf stays fully inside the wall, extends, pauses, then retracts.
	if cycle < 0.18:
		return 0.0
	if cycle < 0.45:
		return _smoothstep((cycle - 0.18) / 0.27)
	if cycle < 0.57:
		return 1.0
	if cycle < 0.88:
		return 1.0 - _smoothstep((cycle - 0.57) / 0.31)
	return 0.0

func _smoothstep(value: float) -> float:
	var clamped := clampf(value, 0.0, 1.0)
	return clamped * clamped * (3.0 - 2.0 * clamped)

func drop_coins(_count: int = FIXED_TURN_COIN_COUNT) -> void:
	if not _authoritative:
		return
	if _turn_active or _result_waiting:
		return

	var safe_count := FIXED_TURN_COIN_COUNT
	var turn_toy_family := _queued_turn_toy_family
	_queued_turn_toy_family = ""
	_turn_generation += 1
	var turn_token := _turn_generation
	_turn_active = true
	_turn_bucket_value = 0
	_turn_bucket_coins.clear()
	_turn_bucket_toys.clear()
	_turn_payout_multiplier = 1
	_turn_bonus_yes = 0
	_turn_end_deadline_ms = 0
	_turn_bonus_time_ms = 0
	_horseshoe_active_until_ms = 0
	_pending_clover_spins = 0
	_reported_turn_payout = 0
	_turn_caught_coin_count = 0
	_turn_lost_coin_count = 0
	_turn_toy_families.clear()
	_turn_toy_captures.clear()
	_last_turn_summary = {}
	_last_bucket_entry_ms = Time.get_ticks_msec()
	_pusher_time = 0.0

	var start_position := pusher.position
	start_position.z = pusher_rear_z
	pusher.position = start_position
	turn_started.emit(safe_count)

	for index in range(safe_count):
		if not _turn_active or turn_token != _turn_generation:
			return
		_spawn_drop_coin(turn_toy_family)
		if index < safe_count - 1:
			await get_tree().create_timer(1.0).timeout

	if not _turn_active or turn_token != _turn_generation:
		return

	if not turn_toy_family.is_empty():
		_spawn_turn_toy(turn_toy_family)

	_turn_end_deadline_ms = (
		Time.get_ticks_msec()
		+ int(turn_settle_seconds * 1000.0)
		+ _turn_bonus_time_ms
	)
	while _turn_active and turn_token == _turn_generation and Time.get_ticks_msec() < _turn_end_deadline_ms:
		await get_tree().create_timer(0.10).timeout

	await _finish_turn_when_ready(turn_token)

func is_turn_active() -> bool:
	return _turn_active or _result_waiting

func is_resetting() -> bool:
	return _resetting

func _finish_turn_when_ready(turn_token: int) -> void:
	while _turn_active and turn_token == _turn_generation:
		# A caught clover pauses final scoring until its visible wheel has been
		# resolved. The pusher keeps running and the toy's bonus time still applies.
		if _pending_clover_spins > 0:
			await get_tree().create_timer(0.10).timeout
			continue
		if Time.get_ticks_msec() < _turn_end_deadline_ms:
			await get_tree().create_timer(0.10).timeout
			continue
		var quiet_for_seconds := (
			float(Time.get_ticks_msec() - _last_bucket_entry_ms) / 1000.0
		)
		var cycle := _pusher_time / pusher_period_seconds
		var pusher_is_rear := cycle < 0.18 or cycle >= 0.88
		if quiet_for_seconds >= bucket_quiet_seconds and pusher_is_rear:
			break
		await get_tree().create_timer(0.10).timeout

	if not _turn_active or turn_token != _turn_generation:
		return

	# Reconcile the payout trigger once before locking the result.
	_reconcile_front_bucket_bodies()
	# A toy found by reconciliation may have added time or opened the Clover
	# wheel. Let that power finish before scoring the turn.
	if _pending_clover_spins > 0 or Time.get_ticks_msec() < _turn_end_deadline_ms:
		await _finish_turn_when_ready(turn_token)
		return
	var payout := _current_turn_payout()
	_reported_turn_payout = payout
	_last_turn_summary = get_turn_result_summary()
	_turn_active = false
	_result_waiting = true

	var rear_position := pusher.position
	rear_position.z = pusher_rear_z
	pusher.position = rear_position

	# Scoring is locked; paid bodies continue falling below the machine.
	coin_paid_out.emit(payout)
	turn_finished.emit(payout)

func complete_result_reveal() -> Dictionary:
	# The payout trigger owns scoring. Bodies keep falling naturally and are
	# removed by CleanupZone below the visible machine.
	await get_tree().physics_frame
	_reconcile_front_bucket_bodies()
	while _pending_clover_spins > 0:
		await get_tree().create_timer(0.10).timeout
	_reconcile_front_bucket_bodies()
	_last_turn_summary = get_turn_result_summary()
	_result_waiting = false
	return _last_turn_summary.duplicate(true)


func clear_front_bucket() -> void:
	# Compatibility hook retained for older callers. There is no catch bucket
	# anymore; paid bodies fall through and CleanupZone removes them.
	_turn_bucket_coins.clear()
	_turn_bucket_toys.clear()
	await get_tree().process_frame

func reset_machine() -> void:
	if not _authoritative:
		return
	if _resetting:
		return
	_resetting = true
	_turn_generation += 1
	_turn_active = false
	_result_waiting = false
	_turn_bucket_value = 0
	_turn_bonus_yes = 0
	_turn_payout_multiplier = 1
	_turn_bucket_coins.clear()
	_turn_bucket_toys.clear()
	_queued_turn_toy_family = ""
	_turn_end_deadline_ms = 0
	_turn_bonus_time_ms = 0
	_horseshoe_active_until_ms = 0
	_pending_clover_spins = 0
	_reported_turn_payout = 0
	_turn_caught_coin_count = 0
	_turn_lost_coin_count = 0
	_turn_toy_families.clear()
	_turn_toy_captures.clear()
	_last_turn_summary = {}
	for child in coin_container.get_children():
		child.queue_free()
	if _toy_container != null:
		for child in _toy_container.get_children():
			child.queue_free()
	await get_tree().process_frame
	if not _authoritative:
		_resetting = false
		_clear_dynamic_bodies_immediately()
		return
	_pusher_time = 0.0
	var reset_position := pusher.position
	reset_position.z = pusher_rear_z
	pusher.position = reset_position
	_seed_coin_bed()
	_resetting = false
	machine_reset.emit()

func active_coin_count() -> int:
	return get_tree().get_nodes_in_group("coins").size()

func active_toy_count() -> int:
	var count: int = 0
	for body in get_tree().get_nodes_in_group("toys"):
		if not is_instance_valid(body):
			continue
		# A toy already in the catch bowl is no longer part of the shared
		# machine capacity, even though it remains visible through the result reveal.
		if body.get_meta("captured_in_front_bucket", false):
			continue
		count += 1
	return count

func toy_capacity_remaining() -> int:
	return maxi(max_active_toys - active_toy_count(), 0)

func queue_turn_toy(toy_family: String) -> bool:
	var normalized := toy_family.strip_edges().to_lower()
	if normalized.is_empty():
		_queued_turn_toy_family = ""
		return true
	if not _is_valid_toy_family(normalized):
		push_warning("Unknown YES Pusher toy family: %s" % toy_family)
		return false
	_queued_turn_toy_family = normalized
	return true

func _is_valid_toy_family(value: String) -> bool:
	match value:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return true
	return false

func _spawn_drop_coin(skin_family: String = "") -> void:
	if coin_scene == null:
		push_error("Machine has no coin_scene assigned.")
		return

	# Every coin independently chooses one of the seven physical top slots.
	var slot := _random.randi_range(0, _drop_x_positions.size() - 1)
	# Use nearly all safe horizontal clearance inside the selected slot.
	# The slot is 1.05 wide and the coin is 0.84 wide, leaving about 0.105
	# units of center travel on either side.
	var spawn_position := Vector3(
		_drop_x_positions[slot] + _random.randf_range(-0.09, 0.09),
		20.70 + _random.randf_range(-0.04, 0.04),
		-4.80 + _random.randf_range(-0.015, 0.015)
	)
	var coin := _create_coin(spawn_position, false)
	if coin == null:
		return

	coin.apply_skin_family(skin_family)
	coin.set_meta("drop_slot", slot)
	coin.set_meta("turn_drop", true)

	# Each coin enters with a small independent tilt and momentum difference.
	# There is no alternating direction and no scripted peg-contact impulse.
	coin.rotation = Vector3(
		PI * 0.5 + _random.randf_range(-0.045, 0.045),
		_random.randf_range(-0.085, 0.085),
		_random.randf_range(0.0, TAU)
	)
	coin.linear_velocity = Vector3(
		_random.randf_range(-0.18, 0.18),
		_random.randf_range(-0.38, -0.26),
		_random.randf_range(-0.025, 0.025)
	)
	coin.angular_velocity = Vector3(
		_random.randf_range(-1.25, 1.25),
		_random.randf_range(-1.25, 1.25),
		_random.randf_range(-2.5, 2.5)
	)
	coin_spawned.emit(coin)

func _seed_coin_bed() -> void:
	if coin_scene == null or starting_coin_count <= 0:
		return

	# A centered, symmetric bed with a fuller middle and tapered ends.
	# The default 72 coins fill these nine rows exactly.
	var row_capacities := PackedInt32Array([7, 8, 9, 9, 9, 9, 8, 7, 6])
	var coin_spacing_x := 0.86
	var coin_spacing_z := 0.78
	var first_row_z := 0.10
	var resting_y := 0.32
	var layer_height := 0.135

	var created := 0
	var layer := 0

	while created < starting_coin_count:
		for row in range(row_capacities.size()):
			if created >= starting_coin_count:
				return

			var remaining := starting_coin_count - created
			var coins_in_row := mini(row_capacities[row], remaining)
			var row_width := float(coins_in_row - 1) * coin_spacing_x
			var row_start_x := -row_width * 0.5
			var z := (
				first_row_z
				+ float(row) * coin_spacing_z
				+ float(layer % 2) * 0.04
			)
			var y := resting_y + float(layer) * layer_height

			for column in range(coins_in_row):
				var x := row_start_x + float(column) * coin_spacing_x
				var coin := _create_coin(Vector3(x, y, z), true)
				if coin == null:
					return

				# Keep the pile visually natural without changing its symmetry.
				coin.rotation.y = _random.randf_range(0.0, TAU)
				coin.mark_seed_coin()
				created += 1

		layer += 1

func _create_coin(local_position: Vector3, start_sleeping: bool) -> PusherCoin:
	var coin := coin_scene.instantiate() as PusherCoin
	if coin == null:
		push_error("Coin scene root must use scripts/coin.gd.")
		return null
	coin_container.add_child(coin)
	_assign_network_body_id(coin, "coin")
	coin.position = local_position
	if start_sleeping:
		coin.sleeping = true
	return coin

func _spawn_turn_toy(toy_family: String) -> void:
	if _toy_container == null or not _is_valid_toy_family(toy_family):
		return

	var current_toy_count := active_toy_count()
	if current_toy_count >= max_active_toys:
		toy_spawn_skipped.emit(toy_family, current_toy_count, max_active_toys)
		return

	var toy := TOY_SCENE.instantiate() as PusherToy
	if toy == null:
		push_error("Toy scene root must use scripts/toy.gd.")
		return

	toy.toy_family = toy_family
	toy.toy_instance_id = "%s_turn_%d_%d" % [toy_family, _turn_generation, Time.get_ticks_usec()]
	_toy_container.add_child(toy)
	_assign_network_body_id(toy, "toy")

	# Spawn the toy clearly in front of the fully retracted pusher. The old
	# position overlapped the pusher's front collision face, so the toy could
	# exist in the scene and increment the counter while remaining hidden
	# inside or underneath the pusher.
	toy.position = Vector3(
		_random.randf_range(-2.2, 2.2),
		1.42,
		-4.25 + _random.randf_range(-0.10, 0.10)
	)
	toy.rotation = Vector3(
		_random.randf_range(-0.10, 0.10),
		_random.randf_range(0.0, TAU),
		_random.randf_range(-0.10, 0.10)
	)
	toy.linear_velocity = Vector3(
		_random.randf_range(-0.08, 0.08),
		0.0,
		_random.randf_range(0.18, 0.32)
	)
	toy.angular_velocity = Vector3(
		_random.randf_range(-0.8, 0.8),
		_random.randf_range(-1.2, 1.2),
		_random.randf_range(-0.8, 0.8)
	)
	toy_spawned.emit(toy, toy.toy_family, toy.toy_instance_id)

func _activate_toy_power(toy: PusherToy) -> Dictionary:
	var result: Dictionary = {
		"toyFamily": toy.toy_family,
		"powerActivated": true,
	}

	match toy.toy_family:
		"horseshoe":
			_horseshoe_active_until_ms = max(
				_horseshoe_active_until_ms,
				Time.get_ticks_msec() + int(horseshoe_magnet_seconds * 1000.0)
			)
			result["power"] = "horseshoe_magnet"
			result["durationSeconds"] = horseshoe_magnet_seconds
		"four_leaf_clover":
			_pending_clover_spins += 1
			result["power"] = "reward_wheel"
			result["spinPending"] = true
			result["maxYes"] = clover_max_yes
			reward_wheel_requested.emit(_get_clover_wheel_values())
			_auto_resolve_clover_after_timeout(_turn_generation)
		"leprechaun":
			var added := _duplicate_closest_machine_coins(toy.global_position, leprechaun_coin_limit)
			result["power"] = "double_closest_machine_coins"
			result["coinLimit"] = leprechaun_coin_limit
			result["coinsAdded"] = added
		"pot_of_gold":
			_turn_payout_multiplier = max(_turn_payout_multiplier, 2)
			result["power"] = "double_turn_payout"
			result["payoutMultiplier"] = _turn_payout_multiplier
		"treasure_chest":
			var bonus_coins := maxi(1, treasure_chest_bonus_coins)
			result["power"] = "drop_bonus_coins"
			result["coinsAdded"] = bonus_coins
			_spawn_treasure_bonus_coins(bonus_coins)

	_add_toy_turn_time()
	result["bonusTimeSeconds"] = toy_bonus_seconds
	toy_power_activated.emit(toy.toy_family, result)
	return result

func _spawn_treasure_bonus_coins(count: int) -> void:
	var turn_token := _turn_generation
	for index in range(maxi(0, count)):
		if not _turn_active or turn_token != _turn_generation:
			return
		_spawn_drop_coin("")
		if index < count - 1:
			await get_tree().create_timer(0.18).timeout

func _add_toy_turn_time() -> void:
	if toy_bonus_seconds <= 0.0 or max_toy_bonus_seconds <= 0.0:
		return

	var max_bonus_ms := int(max_toy_bonus_seconds * 1000.0)
	var requested_ms := int(toy_bonus_seconds * 1000.0)
	var remaining_ms := maxi(0, max_bonus_ms - _turn_bonus_time_ms)
	var added_ms := mini(requested_ms, remaining_ms)
	if added_ms <= 0:
		return

	_turn_bonus_time_ms += added_ms
	if _turn_end_deadline_ms > 0:
		_turn_end_deadline_ms += added_ms
	turn_time_extended.emit(float(added_ms) / 1000.0, float(_turn_bonus_time_ms) / 1000.0)

func resolve_clover_reward(extra_yes: int) -> bool:
	if _pending_clover_spins <= 0:
		return false
	var wheel_values := _get_clover_wheel_values()
	if not wheel_values.has(extra_yes):
		push_warning("Rejected Clover wheel value outside the configured wheel: %d" % extra_yes)
		return false

	var safe_extra_yes := clampi(extra_yes, 0, clover_max_yes)
	_pending_clover_spins -= 1
	_turn_bonus_yes += safe_extra_yes
	reward_wheel_awarded.emit(safe_extra_yes)
	_publish_result_payout_correction()
	return true

func _get_clover_wheel_values() -> PackedInt32Array:
	var safe_values := PackedInt32Array()
	for value in clover_wheel_yes_values:
		safe_values.append(clampi(value, 0, clover_max_yes))
	if safe_values.is_empty():
		safe_values.append(clover_max_yes)
	return safe_values

func _auto_resolve_clover_after_timeout(turn_token: int) -> void:
	# Local fail-safe: the real player gets the visible SPIN button, but a missed
	# click must never leave the turn waiting forever.
	await get_tree().create_timer(8.0).timeout
	if turn_token != _turn_generation or _pending_clover_spins <= 0:
		return
	resolve_clover_reward(_spin_clover_reward_wheel())

func resolve_clover_server_spin() -> int:
	if not _authoritative or _pending_clover_spins <= 0:
		return -1
	var selected := _spin_clover_reward_wheel()
	return selected if resolve_clover_reward(selected) else -1

func _spin_clover_reward_wheel() -> int:
	var wheel_values := _get_clover_wheel_values()
	if wheel_values.is_empty():
		return 0
	var index := _random.randi_range(0, wheel_values.size() - 1)
	return wheel_values[index]

func _duplicate_closest_machine_coins(origin: Vector3, limit: int) -> int:
	var candidates: Array[PusherCoin] = []
	for node in get_tree().get_nodes_in_group("coins"):
		if not is_instance_valid(node) or not (node is PusherCoin):
			continue
		var source := node as PusherCoin
		if source.get_meta("captured_in_front_bucket", false):
			continue
		if source.get_parent() != coin_container:
			continue
		candidates.append(source)

	var added := 0
	var safe_limit := mini(maxi(0, limit), candidates.size())
	for _selection in range(safe_limit):
		var nearest_index := -1
		var nearest_distance := INF
		for index in range(candidates.size()):
			var distance := candidates[index].global_position.distance_squared_to(origin)
			if distance < nearest_distance:
				nearest_distance = distance
				nearest_index = index
		if nearest_index < 0:
			break

		var source := candidates[nearest_index]
		candidates.remove_at(nearest_index)
		var clone := _create_coin(
			source.position + Vector3(
				_random.randf_range(-0.08, 0.08),
				0.20 + _random.randf_range(0.0, 0.08),
				_random.randf_range(-0.08, 0.08)
			),
			false
		)
		if clone == null:
			continue
		clone.rotation = source.rotation + Vector3(0.0, _random.randf_range(-0.20, 0.20), 0.0)
		clone.linear_velocity = source.linear_velocity + Vector3(
			_random.randf_range(-0.14, 0.14),
			_random.randf_range(0.05, 0.18),
			_random.randf_range(-0.14, 0.14)
		)
		clone.angular_velocity = source.angular_velocity + Vector3(
			_random.randf_range(-0.7, 0.7),
			_random.randf_range(-0.7, 0.7),
			_random.randf_range(-0.7, 0.7)
		)
		clone.apply_skin_family(source.get_skin_family())
		coin_spawned.emit(clone)
		added += 1
	return added

func _apply_horseshoe_magnet(_delta: float) -> void:
	if Time.get_ticks_msec() >= _horseshoe_active_until_ms:
		return

	var target := payout_zone.global_position + Vector3(0.0, 0.35, 0.0)
	var candidates: Array[PusherCoin] = []
	for node in get_tree().get_nodes_in_group("coins"):
		# Only real gameplay coins may receive the magnet force. Toys are kept in
		# their own group/container and are explicitly rejected here even if a
		# future scene is accidentally assigned to the coins group.
		if not is_instance_valid(node) or not (node is PusherCoin):
			continue
		var coin := node as PusherCoin
		if coin.get_parent() != coin_container:
			continue
		if coin.is_in_group("toys"):
			continue
		if coin.get_meta("captured_in_front_bucket", false):
			continue
		candidates.append(coin)

	var affected := mini(horseshoe_coin_limit, candidates.size())
	for _selection in range(affected):
		var nearest_index := -1
		var nearest_distance := INF
		for index in range(candidates.size()):
			var distance := candidates[index].global_position.distance_squared_to(target)
			if distance < nearest_distance:
				nearest_distance = distance
				nearest_index = index
		if nearest_index < 0:
			break

		var coin := candidates[nearest_index]
		candidates.remove_at(nearest_index)
		var offset := target - coin.global_position
		if offset.length_squared() < 0.04:
			continue
		coin.sleeping = false
		coin.apply_central_force(offset.normalized() * horseshoe_magnet_force)
		if coin.linear_velocity.length() > horseshoe_max_coin_speed:
			coin.linear_velocity = coin.linear_velocity.normalized() * horseshoe_max_coin_speed

func _build_peg_board() -> void:
	var peg_container := get_node_or_null("PegBoard/Pegs") as Node3D
	if peg_container == null or peg_container.get_child_count() > 0:
		return

	var peg_material := StandardMaterial3D.new()
	peg_material.albedo_color = Color(0.82, 0.84, 0.79, 1.0)
	peg_material.metallic = 0.72
	peg_material.roughness = 0.24

	# Physical peg response only. This adds a visible but controlled rebound
	# without applying any scripted direction or contact impulse.
	var peg_physics := PhysicsMaterial.new()
	peg_physics.friction = 0.10
	peg_physics.bounce = 0.52
	peg_physics.rough = false
	peg_physics.absorbent = false

	# Offset peg field.
	# The top pegs are shifted off the seven drop-slot centerlines so coins do
	# not land straight onto a peg at spawn. The field stays wide enough to use
	# the whole board while still steering coins back toward the center exits.
	var peg_rows: Array[PackedFloat32Array] = [
		PackedFloat32Array([-2.62, -0.87, 0.87, 2.62]),
		PackedFloat32Array([-3.50, -1.75, 0.0, 1.75, 3.50]),
		PackedFloat32Array([-2.62, -0.87, 0.87, 2.62]),
		PackedFloat32Array([-3.50, -1.75, 0.0, 1.75, 3.50]),
		PackedFloat32Array([-2.62, -0.87, 0.87, 2.62]),
		PackedFloat32Array([-3.50, -1.75, 0.0, 1.75, 3.50]),
		PackedFloat32Array([-2.62, -0.87, 0.87, 2.62]),
		PackedFloat32Array([-2.62, 0.0, 2.62]),
		PackedFloat32Array([-0.87, 0.87])
	]
	var row_y: PackedFloat32Array = PackedFloat32Array([
		19.10, 17.35, 15.60,
		13.85, 12.10, 10.35,
		8.60, 6.85, 5.10
	])

	for row in range(peg_rows.size()):
		for column in range(peg_rows[row].size()):
			var peg := StaticBody3D.new()
			peg.name = "Peg_%02d_%02d" % [row, column]
			peg.position = Vector3(
				peg_rows[row][column],
				row_y[row],
				-4.80
			)
			peg.rotation_degrees = Vector3(90.0, 0.0, 0.0)
			peg.collision_layer = 1
			peg.collision_mask = 1
			peg.physics_material_override = peg_physics

			var mesh_instance := MeshInstance3D.new()
			var peg_mesh := CylinderMesh.new()
			peg_mesh.top_radius = 0.14
			peg_mesh.bottom_radius = 0.14
			peg_mesh.height = 0.20
			peg_mesh.radial_segments = 16
			mesh_instance.mesh = peg_mesh
			mesh_instance.material_override = peg_material
			peg.add_child(mesh_instance)

			var collision := CollisionShape3D.new()
			var peg_shape := CylinderShape3D.new()
			peg_shape.radius = 0.14
			peg_shape.height = 0.20
			collision.shape = peg_shape
			peg.add_child(collision)

			peg_container.add_child(peg)

func _build_drop_slots() -> void:
	var slot_container := get_node_or_null("PegBoard/DropSlots") as Node3D
	if slot_container == null or slot_container.get_child_count() > 0:
		return

	var slot_material := StandardMaterial3D.new()
	slot_material.albedo_color = Color(0.82, 0.61, 0.16, 1.0)
	slot_material.metallic = 0.62
	slot_material.roughness = 0.28

	# Eight dividers form seven real top drop slots.
	for divider_index in range(8):
		var divider := StaticBody3D.new()
		divider.name = "Divider_%02d" % divider_index
		divider.position = Vector3(-3.675 + float(divider_index) * 1.05, 20.55, -4.80)
		divider.collision_layer = 1
		divider.collision_mask = 1

		var mesh_instance := MeshInstance3D.new()
		var divider_mesh := BoxMesh.new()
		divider_mesh.size = Vector3(0.08, 1.00, 0.18)
		mesh_instance.mesh = divider_mesh
		mesh_instance.material_override = slot_material
		divider.add_child(mesh_instance)

		var collision := CollisionShape3D.new()
		var divider_shape := BoxShape3D.new()
		divider_shape.size = Vector3(0.08, 1.00, 0.18)
		collision.shape = divider_shape
		divider.add_child(collision)

		slot_container.add_child(divider)



func _on_payout_body_entered(body: Node3D) -> void:
	if body.is_in_group("toys"):
		_register_toy_capture(body)
	elif body.is_in_group("coins"):
		_register_coin_capture(body)

func _register_coin_capture(body: Node3D) -> void:
	# Count once as the coin crosses the open payout area, then leave physics
	# alone so it continues falling out of view.
	if body.get_meta("front_bucket_value_counted", false):
		return
	body.set_meta("captured_in_front_bucket", true)
	body.set_meta("front_bucket_value_counted", true)
	if not _turn_active and not _result_waiting:
		return
	var value := 1
	if body is PusherCoin:
		value = body.coin_value
	_turn_bucket_value += value
	_turn_caught_coin_count += 1
	if not _turn_bucket_coins.has(body):
		_turn_bucket_coins.append(body)
	_last_bucket_entry_ms = Time.get_ticks_msec()
	_publish_result_payout_correction()

func _register_toy_capture(body: Node3D) -> void:
	# Toys use the same open payout path. Their power resolves once, then the
	# physical toy continues falling until CleanupZone removes it.
	body.set_meta("captured_in_front_bucket", true)
	if not (body is PusherToy):
		return
	var toy := body as PusherToy
	if not _turn_active and not _result_waiting:
		return
	if not _turn_bucket_toys.has(toy):
		_turn_bucket_toys.append(toy)
	_last_bucket_entry_ms = Time.get_ticks_msec()
	if not toy.get_meta("front_bucket_power_resolved", false):
		toy.set_meta("front_bucket_power_resolved", true)
		if not _turn_toy_families.has(toy.toy_family):
			_turn_toy_families.append(toy.toy_family)
		var power_result := _activate_toy_power(toy)
		_turn_toy_captures.append({
			"toy_family": toy.toy_family,
			"toy_instance_id": toy.toy_instance_id,
			"power_result": power_result.duplicate(true),
		})
		toy_captured.emit(
			toy.toy_family,
			toy.toy_instance_id,
			_turn_generation,
			power_result
		)
	_publish_result_payout_correction()

func _current_turn_payout() -> int:
	return (_turn_bucket_value * _turn_payout_multiplier) + _turn_bonus_yes

func get_turn_result_summary() -> Dictionary:
	return {
		"drop_count": FIXED_TURN_COIN_COUNT,
		"caught_coin_count": _turn_caught_coin_count,
		"caught_base_yes": _turn_bucket_value,
		"payout_multiplier": _turn_payout_multiplier,
		"bonus_yes": _turn_bonus_yes,
		"lost_count": _turn_lost_coin_count,
		"toy_families": _turn_toy_families.duplicate(),
		"toy_captures": _turn_toy_captures.duplicate(true),
		"total_yes": _current_turn_payout(),
	}

func get_last_turn_summary() -> Dictionary:
	return _last_turn_summary.duplicate(true)

func _publish_result_payout_correction() -> void:
	if not _result_waiting:
		return
	var corrected := _current_turn_payout()
	var delta := corrected - _reported_turn_payout
	if delta <= 0:
		return
	_reported_turn_payout = corrected
	turn_payout_corrected.emit(delta, corrected)

func _reconcile_front_bucket_bodies() -> void:
	# One final overlap pass catches bodies already inside the payout trigger.
	for body in payout_zone.get_overlapping_bodies():
		if not (body is Node3D):
			continue
		if body.is_in_group("toys"):
			_register_toy_capture(body)
		elif body.is_in_group("coins"):
			_register_coin_capture(body)

func _on_cleanup_body_entered(body: Node3D) -> void:
	var was_paid_out := bool(body.get_meta("captured_in_front_bucket", false))

	if body.is_in_group("toys"):
		if body is PusherToy and not was_paid_out:
			var toy := body as PusherToy
			toy_lost.emit(toy.toy_family, toy.toy_instance_id)
		body.queue_free()
		return

	if not body.is_in_group("coins"):
		return
	if not was_paid_out:
		if _turn_active or _result_waiting:
			_turn_lost_coin_count += 1
		coin_lost.emit()
		_remember_coin_removal(body, "lost")
	else:
		_remember_coin_removal(body, "paid_out")
	body.queue_free()


func set_authoritative(value: bool) -> void:
	_authoritative = value
	if _authoritative:
		payout_zone.monitoring = true
		cleanup_zone.monitoring = true
	else:
		_turn_active = false
		_result_waiting = false
		_replica_pusher_target = pusher.transform
		_replica_pusher_target_valid = false
		payout_zone.monitoring = false
		cleanup_zone.monitoring = false
		_clear_dynamic_bodies_immediately()

func is_authoritative() -> bool:
	return _authoritative

func set_turn_seed(value: int) -> void:
	if value == 0:
		_random.randomize()
	else:
		_random.seed = value

func get_reported_turn_payout() -> int:
	return _reported_turn_payout

func export_world_snapshot() -> Dictionary:
	var coins: Array[Dictionary] = []
	for node in coin_container.get_children():
		if not (node is PusherCoin):
			continue
		var coin := node as PusherCoin
		coins.append({
			"id": _assign_network_body_id(coin, "coin"),
			"transform": _transform_to_data(coin.transform),
			"linear_velocity": _vector_to_data(coin.linear_velocity),
			"angular_velocity": _vector_to_data(coin.angular_velocity),
			"skin_family": coin.get_skin_family(),
			"seed_coin": coin.is_seed_coin(),
		})
	var toys: Array[Dictionary] = []
	if _toy_container != null:
		for node in _toy_container.get_children():
			if not (node is PusherToy):
				continue
			var toy := node as PusherToy
			toys.append({
				"id": _assign_network_body_id(toy, "toy"),
				"transform": _transform_to_data(toy.transform),
				"linear_velocity": _vector_to_data(toy.linear_velocity),
				"angular_velocity": _vector_to_data(toy.angular_velocity),
				"toy_family": toy.toy_family,
				"toy_instance_id": toy.toy_instance_id,
			})
	_prune_removed_coin_tombstones()
	var removed_coins: Array[Dictionary] = []
	for removal_value in _recent_removed_coins.values():
		if removal_value is Dictionary:
			removed_coins.append((removal_value as Dictionary).duplicate(true))
	return {
		"kind": "yes-pusher-world",
		"version": WORLD_SNAPSHOT_VERSION,
		"pusher_transform": _transform_to_data(pusher.transform),
		"coins": coins,
		"toys": toys,
		"removed_coins": removed_coins,
	}

func apply_world_snapshot(snapshot: Dictionary) -> void:
	var snapshot_version := int(snapshot.get("version", 0))
	if _authoritative or snapshot_version not in [1, WORLD_SNAPSHOT_VERSION]:
		return
	_replica_pusher_target = _data_to_transform(snapshot.get("pusher_transform", []), pusher.transform)
	if not _replica_pusher_target_valid:
		pusher.transform = _replica_pusher_target
		_replica_pusher_target_valid = true
	var coin_values: Array = []
	var coin_values_raw: Variant = snapshot.get("coins", [])
	if coin_values_raw is Array:
		coin_values = coin_values_raw as Array
	var toy_values: Array = []
	var toy_values_raw: Variant = snapshot.get("toys", [])
	if toy_values_raw is Array:
		toy_values = toy_values_raw as Array
	var removed_coin_values: Array = []
	var removed_coin_values_raw: Variant = snapshot.get("removed_coins", [])
	if removed_coin_values_raw is Array:
		removed_coin_values = removed_coin_values_raw as Array
	_apply_coin_snapshot(coin_values, removed_coin_values)
	_apply_toy_snapshot(toy_values)

func restore_authoritative_snapshot(snapshot: Dictionary) -> void:
	var snapshot_version := int(snapshot.get("version", 0))
	if not _authoritative or snapshot_version not in [1, WORLD_SNAPSHOT_VERSION]:
		return
	_turn_generation += 1
	_turn_active = false
	_result_waiting = false
	_clear_dynamic_bodies_immediately()
	pusher.transform = _data_to_transform(snapshot.get("pusher_transform", []), pusher.transform)
	var highest_id := 0
	var restored_coins: Array = []
	var restored_coins_raw: Variant = snapshot.get("coins", [])
	if restored_coins_raw is Array:
		restored_coins = restored_coins_raw as Array
	for value in restored_coins:
		if not (value is Dictionary):
			continue
		var data := value as Dictionary
		var coin := coin_scene.instantiate() as PusherCoin
		if coin == null:
			continue
		coin_container.add_child(coin)
		var body_id := String(data.get("id", ""))
		coin.set_meta("network_body_id", body_id)
		highest_id = maxi(highest_id, _numeric_body_id(body_id))
		coin.transform = _data_to_transform(data.get("transform", []), Transform3D.IDENTITY)
		coin.linear_velocity = _data_to_vector(data.get("linear_velocity", []))
		coin.angular_velocity = _data_to_vector(data.get("angular_velocity", []))
		coin.apply_skin_family(String(data.get("skin_family", "")))
		if bool(data.get("seed_coin", false)):
			coin.mark_seed_coin()
	var restored_toys: Array = []
	var restored_toys_raw: Variant = snapshot.get("toys", [])
	if restored_toys_raw is Array:
		restored_toys = restored_toys_raw as Array
	for value in restored_toys:
		if not (value is Dictionary):
			continue
		var data := value as Dictionary
		var toy := TOY_SCENE.instantiate() as PusherToy
		if toy == null:
			continue
		toy.toy_family = String(data.get("toy_family", "horseshoe"))
		toy.toy_instance_id = String(data.get("toy_instance_id", ""))
		_toy_container.add_child(toy)
		var body_id := String(data.get("id", ""))
		toy.set_meta("network_body_id", body_id)
		highest_id = maxi(highest_id, _numeric_body_id(body_id))
		toy.transform = _data_to_transform(data.get("transform", []), Transform3D.IDENTITY)
		toy.linear_velocity = _data_to_vector(data.get("linear_velocity", []))
		toy.angular_velocity = _data_to_vector(data.get("angular_velocity", []))
	_next_network_body_id = maxi(_next_network_body_id, highest_id + 1)

func _apply_coin_snapshot(values: Array, removed_values: Array = []) -> void:
	var existing := _body_map(coin_container)
	var removals: Dictionary = {}
	for removal_value in removed_values:
		if not (removal_value is Dictionary):
			continue
		var removal := removal_value as Dictionary
		var removal_id := String(removal.get("id", ""))
		if not removal_id.is_empty():
			removals[removal_id] = removal
	var seen: Dictionary = {}
	for value in values:
		if not (value is Dictionary):
			continue
		var data := value as Dictionary
		var body_id := String(data.get("id", ""))
		if body_id.is_empty():
			continue
		seen[body_id] = true
		if _replica_retiring_coins.has(body_id):
			var retired := _replica_retiring_coins[body_id] as Dictionary
			var retired_node := retired.get("node") as Node
			if is_instance_valid(retired_node):
				retired_node.queue_free()
			_replica_retiring_coins.erase(body_id)
		var coin: PusherCoin = existing.get(body_id) as PusherCoin
		if coin == null:
			coin = coin_scene.instantiate() as PusherCoin
			if coin == null:
				continue
			coin_container.add_child(coin)
			coin.set_meta("network_body_id", body_id)
			coin.transform = _data_to_transform(data.get("transform", []), Transform3D.IDENTITY)
			coin.apply_skin_family(String(data.get("skin_family", "")))
			if bool(data.get("seed_coin", false)):
				coin.mark_seed_coin()
			_set_replica_body_mode(coin)
		else:
			var family := String(data.get("skin_family", ""))
			if coin.get_skin_family() != family:
				coin.apply_skin_family(family)
		_replica_coin_targets[body_id] = _data_to_transform(data.get("transform", []), coin.transform)
		_replica_coin_velocities[body_id] = _data_to_vector(data.get("linear_velocity", []))
	for body_id_value in existing.keys():
		var body_id := String(body_id_value)
		if seen.has(body_id) or _replica_retiring_coins.has(body_id):
			continue
		var stale := existing.get(body_id) as Node3D
		if not is_instance_valid(stale):
			continue
		var removal: Dictionary = removals.get(body_id, {}) as Dictionary
		# Legacy result-clear tombstones are removed immediately on replicas.
		if String(removal.get("kind", "")) == "result_clear":
			stale.queue_free()
			_replica_coin_targets.erase(body_id)
			_replica_coin_velocities.erase(body_id)
		elif not removal.is_empty() or _should_animate_replica_exit(stale):
			_begin_replica_coin_retirement(stale, body_id, removal)
		else:
			stale.queue_free()
			_replica_coin_targets.erase(body_id)
			_replica_coin_velocities.erase(body_id)

func _apply_toy_snapshot(values: Array) -> void:
	var existing := _body_map(_toy_container)
	var seen: Dictionary = {}
	for value in values:
		if not (value is Dictionary):
			continue
		var data := value as Dictionary
		var body_id := String(data.get("id", ""))
		if body_id.is_empty():
			continue
		seen[body_id] = true
		var toy: PusherToy = existing.get(body_id) as PusherToy
		if toy == null:
			toy = TOY_SCENE.instantiate() as PusherToy
			if toy == null:
				continue
			toy.toy_family = String(data.get("toy_family", "horseshoe"))
			toy.toy_instance_id = String(data.get("toy_instance_id", body_id))
			_toy_container.add_child(toy)
			toy.set_meta("network_body_id", body_id)
			toy.transform = _data_to_transform(data.get("transform", []), Transform3D.IDENTITY)
			_set_replica_body_mode(toy)
		_replica_toy_targets[body_id] = _data_to_transform(data.get("transform", []), toy.transform)
	for body_id in existing.keys():
		if not seen.has(body_id):
			var stale := existing[body_id] as Node
			if is_instance_valid(stale):
				stale.queue_free()
			_replica_toy_targets.erase(body_id)

func _update_replica_interpolation(delta: float) -> void:
	# Frame-rate-independent smoothing keeps the browser moving continuously
	# between authoritative server snapshots instead of visibly stepping at
	# the network update rate.
	var weight := clampf(1.0 - exp(-18.0 * delta), 0.0, 1.0)
	if _replica_pusher_target_valid:
		pusher.transform = pusher.transform.interpolate_with(_replica_pusher_target, weight)
	var coins := _body_map(coin_container)
	for body_id_value in _replica_coin_targets.keys():
		var body_id := String(body_id_value)
		var coin := coins.get(body_id) as Node3D
		if coin != null:
			coin.transform = coin.transform.interpolate_with(_replica_coin_targets[body_id] as Transform3D, weight)

	var toys := _body_map(_toy_container)
	for body_id in _replica_toy_targets.keys():
		var toy := toys.get(body_id) as Node3D
		if toy != null:
			toy.transform = toy.transform.interpolate_with(_replica_toy_targets[body_id] as Transform3D, weight)

	_update_replica_retiring_coins(delta)

func _remember_coin_removal(body: Node3D, kind: String) -> void:
	if not _authoritative or not is_instance_valid(body):
		return
	var body_id := _assign_network_body_id(body, "coin")
	var velocity := Vector3.ZERO
	if body is RigidBody3D:
		velocity = (body as RigidBody3D).linear_velocity
	_recent_removed_coins[body_id] = {
		"id": body_id,
		"kind": kind,
		"transform": _transform_to_data(body.transform),
		"linear_velocity": _vector_to_data(velocity),
		"removed_at_ms": Time.get_ticks_msec(),
	}

func _prune_removed_coin_tombstones() -> void:
	var now := Time.get_ticks_msec()
	for body_id_value in _recent_removed_coins.keys():
		var body_id := String(body_id_value)
		var removal := _recent_removed_coins[body_id] as Dictionary
		if now - int(removal.get("removed_at_ms", 0)) > REMOVED_COIN_TOMBSTONE_MS:
			_recent_removed_coins.erase(body_id)

func _should_animate_replica_exit(body: Node3D) -> bool:
	# The browser intentionally trails the authoritative machine by a fraction of
	# a second. A coin that leaves the server near the front lip should finish its
	# visible fall instead of popping out of existence at the last snapshot.
	return body.global_position.z >= 6.2 or body.global_position.y <= -0.4

func _begin_replica_coin_retirement(body: Node3D, body_id: String, removal: Dictionary) -> void:
	var kind := String(removal.get("kind", "lost"))
	var velocity := _replica_coin_velocities.get(body_id, Vector3.ZERO) as Vector3
	if removal.has("linear_velocity"):
		velocity = _data_to_vector(removal.get("linear_velocity", []))
	if removal.has("transform"):
		var authoritative_transform := _data_to_transform(removal.get("transform", []), body.transform)
		body.transform = body.transform.interpolate_with(authoritative_transform, 0.65)
	_replica_coin_targets.erase(body_id)
	_replica_coin_velocities.erase(body_id)
	body.set_meta("network_retiring", true)
	_replica_retiring_coins[body_id] = {
		"node": body,
		"kind": kind,
		"velocity": velocity,
		"age": 0.0,
	}

func _update_replica_retiring_coins(delta: float) -> void:
	var finished: Array[String] = []
	for body_id_value in _replica_retiring_coins.keys():
		var body_id := String(body_id_value)
		var retirement := _replica_retiring_coins[body_id] as Dictionary
		var body := retirement.get("node") as Node3D
		if not is_instance_valid(body):
			finished.append(body_id)
			continue
		var age := float(retirement.get("age", 0.0)) + delta
		var kind := String(retirement.get("kind", "lost"))
		var velocity := retirement.get("velocity", Vector3.ZERO) as Vector3
		velocity.y -= 13.5 * delta
		var position := body.global_position + velocity * delta
		body.global_position = position
		retirement["age"] = age
		retirement["velocity"] = velocity
		_replica_retiring_coins[body_id] = retirement
		var duration := 0.75 if kind == "paid_out" else 1.35
		if age > duration - 0.35:
			_set_replica_body_alpha(body, clampf((duration - age) / 0.35, 0.0, 1.0))
		if age >= duration or position.y < -8.5:
			body.queue_free()
			finished.append(body_id)
	for body_id in finished:
		_replica_retiring_coins.erase(body_id)

func _set_replica_body_alpha(node: Node, alpha: float) -> void:
	if node is GeometryInstance3D:
		(node as GeometryInstance3D).transparency = 1.0 - alpha
	for child in node.get_children():
		_set_replica_body_alpha(child, alpha)

func _body_map(container: Node) -> Dictionary:
	var result: Dictionary = {}
	if container == null:
		return result
	for node in container.get_children():
		var body_id := String(node.get_meta("network_body_id", ""))
		if not body_id.is_empty():
			result[body_id] = node
	return result

func _assign_network_body_id(body: Node, prefix: String) -> String:
	var existing := String(body.get_meta("network_body_id", ""))
	if not existing.is_empty():
		return existing
	var body_id := "%s_%d" % [prefix, _next_network_body_id]
	_next_network_body_id += 1
	body.set_meta("network_body_id", body_id)
	return body_id

func _set_replica_body_mode(body: Node) -> void:
	if body is RigidBody3D:
		var rigid := body as RigidBody3D
		rigid.freeze = true
		rigid.freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
		rigid.collision_layer = 0
		rigid.collision_mask = 0
		rigid.contact_monitor = false

func _clear_dynamic_bodies_immediately() -> void:
	for child in coin_container.get_children():
		child.free()
	if _toy_container != null:
		for child in _toy_container.get_children():
			child.free()
	_replica_coin_targets.clear()
	_replica_coin_velocities.clear()
	_replica_toy_targets.clear()
	for retirement_value in _replica_retiring_coins.values():
		if retirement_value is Dictionary:
			var retirement := retirement_value as Dictionary
			var retired_node := retirement.get("node") as Node
			if is_instance_valid(retired_node):
				retired_node.free()
	_replica_retiring_coins.clear()

func _transform_to_data(value: Transform3D) -> Array:
	var rotation := value.basis.get_rotation_quaternion()
	return [
		value.origin.x, value.origin.y, value.origin.z,
		rotation.x, rotation.y, rotation.z, rotation.w,
	]

func _data_to_transform(value: Variant, fallback: Transform3D) -> Transform3D:
	if not (value is Array) or value.size() < 7:
		return fallback
	var position := Vector3(float(value[0]), float(value[1]), float(value[2]))
	var rotation := Quaternion(float(value[3]), float(value[4]), float(value[5]), float(value[6])).normalized()
	return Transform3D(Basis(rotation), position)

func _vector_to_data(value: Vector3) -> Array:
	return [value.x, value.y, value.z]

func _data_to_vector(value: Variant) -> Vector3:
	if not (value is Array) or value.size() < 3:
		return Vector3.ZERO
	return Vector3(float(value[0]), float(value[1]), float(value[2]))

func _numeric_body_id(value: String) -> int:
	var parts := value.split("_")
	return int(parts[parts.size() - 1]) if parts.size() > 1 else 0

func _running_as_network_client() -> bool:
	var configured := OS.get_environment("YES_PUSHER_NETWORK_MODE").strip_edges().to_lower()
	var has_server_target := (
		not OS.get_environment("YES_PUSHER_SERVER_URL").strip_edges().is_empty()
		or not OS.get_environment("YES_PUSHER_SERVER_HOST").strip_edges().is_empty()
	)
	return configured == "client" or OS.get_cmdline_args().has("--client") or (configured.is_empty() and has_server_target)
