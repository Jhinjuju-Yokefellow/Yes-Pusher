extends Camera3D

@export var target := Vector3(0.0, 8.40, -0.10)
@export_range(8.0, 45.0, 0.5) var distance: float = 34.0
@export var yaw: float = 0.58
@export var pitch: float = 0.48

var _dragging := false
var _showing_result := false
var _view_tween: Tween

var _saved_target := Vector3.ZERO
var _saved_distance: float = 34.0
var _saved_yaw: float = 0.58
var _saved_pitch: float = 0.48
var _saved_fov: float = 48.0

func _ready() -> void:
	_update_camera()

func _process(_delta: float) -> void:
	_update_camera()

func _unhandled_input(event: InputEvent) -> void:
	if _showing_result:
		return

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			_dragging = event.pressed
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			distance = maxf(8.0, distance - 1.0)
			get_viewport().set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			distance = minf(45.0, distance + 1.0)
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion and _dragging:
		yaw -= event.relative.x * 0.006
		pitch = clampf(pitch - event.relative.y * 0.006, 0.16, 1.15)
		get_viewport().set_input_as_handled()

func show_bucket_result(bucket_target: Vector3, hold_seconds: float = 3.2) -> void:
	if _showing_result:
		return

	_showing_result = true
	_dragging = false
	_saved_target = target
	_saved_distance = distance
	_saved_yaw = yaw
	_saved_pitch = pitch
	_saved_fov = fov

	if _view_tween != null and _view_tween.is_valid():
		_view_tween.kill()

	_view_tween = create_tween()
	_view_tween.set_parallel(true)
	_view_tween.set_trans(Tween.TRANS_SINE)
	_view_tween.set_ease(Tween.EASE_IN_OUT)
	_view_tween.tween_property(self, "target", bucket_target, 0.75)
	_view_tween.tween_property(self, "distance", 9.4, 0.75)
	_view_tween.tween_property(self, "yaw", 0.0, 0.75)
	_view_tween.tween_property(self, "pitch", 0.68, 0.75)
	_view_tween.tween_property(self, "fov", 40.0, 0.75)
	await _view_tween.finished

	await get_tree().create_timer(hold_seconds).timeout

	_view_tween = create_tween()
	_view_tween.set_parallel(true)
	_view_tween.set_trans(Tween.TRANS_SINE)
	_view_tween.set_ease(Tween.EASE_IN_OUT)
	_view_tween.tween_property(self, "target", _saved_target, 0.75)
	_view_tween.tween_property(self, "distance", _saved_distance, 0.75)
	_view_tween.tween_property(self, "yaw", _saved_yaw, 0.75)
	_view_tween.tween_property(self, "pitch", _saved_pitch, 0.75)
	_view_tween.tween_property(self, "fov", _saved_fov, 0.75)
	await _view_tween.finished

	_showing_result = false

func cancel_bucket_result() -> void:
	if not _showing_result:
		return

	if _view_tween != null and _view_tween.is_valid():
		_view_tween.kill()

	target = _saved_target
	distance = _saved_distance
	yaw = _saved_yaw
	pitch = _saved_pitch
	fov = _saved_fov
	_showing_result = false

func _update_camera() -> void:
	var horizontal := cos(pitch) * distance
	var offset := Vector3(
		sin(yaw) * horizontal,
		sin(pitch) * distance,
		cos(yaw) * horizontal
	)
	global_position = target + offset
	look_at(target, Vector3.UP)
