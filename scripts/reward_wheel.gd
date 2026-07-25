extends Control
class_name CloverRewardWheel

signal spin_finished(value: int)

var values: PackedInt32Array = PackedInt32Array([1, 2, 3, 5, 10])
var _rotation_angle: float = 0.0
var _spinning: bool = false
var _random := RandomNumberGenerator.new()

func _ready() -> void:
	custom_minimum_size = Vector2(280.0, 280.0)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_random.randomize()
	queue_redraw()

func set_values(next_values: PackedInt32Array) -> void:
	if next_values.is_empty():
		return
	values = next_values.duplicate()
	queue_redraw()

func is_spinning() -> bool:
	return _spinning

func spin() -> void:
	if _spinning or values.is_empty():
		return
	_spin_to_index(_random.randi_range(0, values.size() - 1))

func spin_to_value(value: int) -> void:
	if _spinning or values.is_empty():
		return
	var selected_index := values.find(value)
	if selected_index < 0:
		return
	_spin_to_index(selected_index)

func _spin_to_index(selected_index: int) -> void:
	_spinning = true
	var segment_angle: float = TAU / float(values.size())
	# The fixed pointer is at the top. Rotate the selected segment's center
	# beneath it after several complete turns.
	var selected_center: float = (float(selected_index) + 0.5) * segment_angle
	var desired_rotation: float = -PI * 0.5 - selected_center
	var extra_turns: float = TAU * float(_random.randi_range(5, 7))
	var normalized_current: float = fmod(_rotation_angle, TAU)
	var forward_delta: float = fmod(desired_rotation - normalized_current + TAU, TAU)
	var target_rotation: float = _rotation_angle + extra_turns + forward_delta

	var tween := create_tween()
	tween.set_trans(Tween.TRANS_QUART)
	tween.set_ease(Tween.EASE_OUT)
	tween.tween_method(_set_rotation_angle, _rotation_angle, target_rotation, 2.2)
	await tween.finished

	_rotation_angle = fmod(target_rotation, TAU)
	_spinning = false
	spin_finished.emit(values[selected_index])

func _set_rotation_angle(value: float) -> void:
	_rotation_angle = value
	queue_redraw()

func _draw() -> void:
	if values.is_empty():
		return

	var center := size * 0.5
	var radius: float = minf(size.x, size.y) * 0.42
	var segment_angle: float = TAU / float(values.size())
	var colors: Array[Color] = [
		Color(0.035, 0.42, 0.12, 1.0),
		Color(0.92, 0.62, 0.10, 1.0),
		Color(0.02, 0.24, 0.075, 1.0),
		Color(1.0, 0.77, 0.20, 1.0),
		Color(0.06, 0.58, 0.17, 1.0),
	]

	for index in range(values.size()):
		var start_angle: float = _rotation_angle + float(index) * segment_angle
		var points := PackedVector2Array()
		points.append(center)
		var steps: int = 18
		for step in range(steps + 1):
			var angle: float = start_angle + segment_angle * float(step) / float(steps)
			points.append(center + Vector2(cos(angle), sin(angle)) * radius)
		draw_colored_polygon(points, colors[index % colors.size()])

		var label_angle: float = start_angle + segment_angle * 0.5
		var label_position := center + Vector2(cos(label_angle), sin(label_angle)) * radius * 0.62
		var label_text := "%d YES" % values[index]
		var font := get_theme_default_font()
		var font_size: int = 20
		var text_size := font.get_string_size(label_text, HORIZONTAL_ALIGNMENT_LEFT, -1.0, font_size)
		draw_string(
			font,
			label_position - Vector2(text_size.x * 0.5, -text_size.y * 0.28),
			label_text,
			HORIZONTAL_ALIGNMENT_LEFT,
			-1.0,
			font_size,
			Color(0.02, 0.018, 0.01, 1.0)
		)

	# Outer rings and center cap make the wheel read as a physical arcade prize wheel.
	draw_arc(center, radius, 0.0, TAU, 96, Color(1.0, 0.78, 0.22, 1.0), 12.0, true)
	draw_arc(center, radius - 13.0, 0.0, TAU, 96, Color(0.10, 0.035, 0.005, 1.0), 4.0, true)
	draw_circle(center, radius * 0.16, Color(0.95, 0.64, 0.10, 1.0))
	draw_circle(center, radius * 0.09, Color(0.02, 0.34, 0.09, 1.0))

	# Fixed gold pointer at twelve o'clock.
	var pointer := PackedVector2Array([
		center + Vector2(0.0, -radius - 7.0),
		center + Vector2(-20.0, -radius - 42.0),
		center + Vector2(20.0, -radius - 42.0),
	])
	draw_colored_polygon(pointer, Color(1.0, 0.70, 0.12, 1.0))
