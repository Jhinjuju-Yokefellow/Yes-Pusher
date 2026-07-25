extends Node3D

# Rainbow's End Theme Foundation — Pass 1
# Decorative only: this node creates no collision bodies and does not read or
# modify machine timing, scoring, coin capture, or pusher state.

const RAINBOW_ROAD_TEXTURE: Texture2D = preload("res://assets/rainbows_end_rainbow_road.png")

const RAINBOW_COLORS: Array[Color] = [
	Color(0.72, 0.055, 0.045, 1.0),
	Color(0.95, 0.28, 0.035, 1.0),
	Color(1.0, 0.68, 0.06, 1.0),
	Color(0.10, 0.48, 0.20, 1.0),
	Color(0.045, 0.30, 0.72, 1.0),
	Color(0.20, 0.11, 0.50, 1.0),
	Color(0.42, 0.08, 0.48, 1.0),
]

var _wood: StandardMaterial3D
var _wood_dark: StandardMaterial3D
var _antique_gold: StandardMaterial3D
var _emerald: StandardMaterial3D
var _marquee_back: StandardMaterial3D
var _rainbow_road: StandardMaterial3D


func _ready() -> void:
	_create_materials()
	_build_cabinet_foundation()
	_build_rainbow_marquee()
	call_deferred("_apply_rainbow_road")
	call_deferred("_match_existing_side_walls")


func _create_materials() -> void:
	_wood = _make_material(Color(0.115, 0.038, 0.017, 1.0), 0.06, 0.66)
	_wood_dark = _make_material(Color(0.048, 0.013, 0.008, 1.0), 0.10, 0.58)
	_antique_gold = _make_material(Color(0.68, 0.39, 0.075, 1.0), 0.82, 0.28)
	_emerald = _make_material(
		Color(0.018, 0.22, 0.095, 1.0), 0.38, 0.28, Color(0.0, 0.14, 0.045, 1.0), 0.28
	)
	_marquee_back = _make_material(Color(0.022, 0.010, 0.008, 1.0), 0.18, 0.52)
	_rainbow_road = StandardMaterial3D.new()
	_rainbow_road.albedo_texture = RAINBOW_ROAD_TEXTURE
	_rainbow_road.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	_rainbow_road.roughness = 0.78
	_rainbow_road.metallic = 0.02
	_rainbow_road.emission_enabled = false
	_rainbow_road.uv1_scale = Vector3(1.0, 1.0, 1.0)


func _make_material(
	albedo: Color,
	metallic: float,
	roughness: float,
	emission_color: Color = Color(0, 0, 0, 1),
	emission_energy: float = 0.0
) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = albedo
	material.metallic = metallic
	material.roughness = roughness
	if emission_energy > 0.0:
		material.emission_enabled = true
		material.emission = emission_color
		material.emission_energy_multiplier = emission_energy
	return material


func _build_cabinet_foundation() -> void:
	var cabinet := Node3D.new()
	cabinet.name = "CarvedWoodCabinet"
	add_child(cabinet)

	# Tall structural posts frame the existing glass and playfield without
	# replacing or touching any collision-bearing machine nodes.
	_add_box(
		cabinet, "LeftCrownPost", Vector3(0.86, 22.8, 1.10), Vector3(-6.08, 10.55, -4.30), _wood
	)
	_add_box(
		cabinet, "RightCrownPost", Vector3(0.86, 22.8, 1.10), Vector3(6.08, 10.55, -4.30), _wood
	)
	_add_box(
		cabinet, "LeftLowerCase", Vector3(0.76, 8.65, 13.65), Vector3(-6.08, 4.20, 1.58), _wood_dark
	)
	_add_box(
		cabinet, "RightLowerCase", Vector3(0.76, 8.65, 13.65), Vector3(6.08, 4.20, 1.58), _wood_dark
	)


	# Antique-gold inlay gives the cabinet one readable silhouette from every
	# camera angle while leaving playfield decoration for Pass 2.
	_add_box(
		cabinet,
		"LeftOuterInlay",
		Vector3(0.10, 21.9, 0.16),
		Vector3(-5.60, 10.55, -3.67),
		_antique_gold
	)
	_add_box(
		cabinet,
		"RightOuterInlay",
		Vector3(0.10, 21.9, 0.16),
		Vector3(5.60, 10.55, -3.67),
		_antique_gold
	)
	_add_box(
		cabinet,
		"LeftLowerInlay",
		Vector3(0.10, 7.80, 12.55),
		Vector3(-5.58, 4.22, 1.60),
		_antique_gold
	)
	_add_box(
		cabinet,
		"RightLowerInlay",
		Vector3(0.10, 7.80, 12.55),
		Vector3(5.58, 4.22, 1.60),
		_antique_gold
	)

	# Restrained emerald cabochons establish the accent color without turning
	# the cabinet into a bright green object.
	for side in [-1.0, 1.0]:
		for y in [3.2, 9.0, 14.8, 20.4]:
			_add_sphere(
				cabinet,
				"Emerald_%s_%s" % [str(side), str(y)],
				0.18,
				Vector3(side * 5.56, y, -3.54),
				Vector3(1.0, 1.25, 0.55),
				_emerald,
				16,
				8
			)

	# Wood plinth behind the pot makes the catch bucket feel built into the
	# machine rather than attached as a separate prop.
	_add_box(
		cabinet,
		"LowerFrontPlinth",
		Vector3(12.5, 1.45, 1.15),
		Vector3(0.0, -2.62, 8.95),
		_wood_dark
	)
	_add_box(
		cabinet,
		"LowerFrontGoldLine",
		Vector3(11.7, 0.13, 0.20),
		Vector3(0.0, -1.93, 9.58),
		_antique_gold
	)


func _build_rainbow_marquee() -> void:
	var marquee := Node3D.new()
	marquee.name = "RainbowMarquee"
	add_child(marquee)

	_add_box(
		marquee, "MarqueeBack", Vector3(12.8, 3.35, 0.62), Vector3(0.0, 22.63, -4.22), _wood_dark
	)
	_add_box(
		marquee,
		"MarqueeInset",
		Vector3(11.95, 2.55, 0.18),
		Vector3(0.0, 22.52, -3.88),
		_marquee_back
	)
	_add_box(
		marquee,
		"MarqueeBottomRail",
		Vector3(12.45, 0.18, 0.24),
		Vector3(0.0, 21.03, -3.74),
		_antique_gold
	)

	# The rainbow is a true layered arch made from tangent-aligned segments.
	# It is deliberately dimensional rather than a flat texture.
	var center := Vector2(0.0, 21.05)
	var outer_radius := 5.05
	var band_width := 0.31
	var depth := 0.20
	var segment_count := 28
	var min_angle := deg_to_rad(17.0)
	var max_angle := deg_to_rad(163.0)

	_build_arch_band(
		marquee,
		"OuterGold",
		center,
		outer_radius + 0.23,
		0.12,
		depth + 0.08,
		segment_count,
		min_angle,
		max_angle,
		_antique_gold
	)

	for band_index in range(RAINBOW_COLORS.size()):
		var radius := outer_radius - float(band_index) * band_width
		var rainbow_material := _make_material(
			RAINBOW_COLORS[band_index], 0.18, 0.30, RAINBOW_COLORS[band_index] * 0.22, 0.34
		)
		_build_arch_band(
			marquee,
			"RainbowBand_%02d" % band_index,
			center,
			radius,
			band_width + 0.035,
			depth,
			segment_count,
			min_angle,
			max_angle,
			rainbow_material
		)

	_build_arch_band(
		marquee,
		"InnerGold",
		center,
		outer_radius - float(RAINBOW_COLORS.size()) * band_width - 0.02,
		0.11,
		depth + 0.06,
		segment_count,
		min_angle,
		max_angle,
		_antique_gold
	)

	# A forward-set dark nameplate keeps the full title legible instead of
	# allowing the inner rainbow bands to cover its first and last letters.
	_add_box(
		marquee, "TitlePlaque", Vector3(7.65, 1.16, 0.16), Vector3(0.0, 22.12, -3.38), _marquee_back
	)
	_add_box(
		marquee,
		"TitlePlaqueTop",
		Vector3(7.88, 0.09, 0.09),
		Vector3(0.0, 22.71, -3.27),
		_antique_gold
	)
	_add_box(
		marquee,
		"TitlePlaqueBottom",
		Vector3(7.88, 0.09, 0.09),
		Vector3(0.0, 21.53, -3.27),
		_antique_gold
	)
	_add_box(
		marquee,
		"TitlePlaqueLeft",
		Vector3(0.09, 1.16, 0.09),
		Vector3(-3.94, 22.12, -3.27),
		_antique_gold
	)
	_add_box(
		marquee,
		"TitlePlaqueRight",
		Vector3(0.09, 1.16, 0.09),
		Vector3(3.94, 22.12, -3.27),
		_antique_gold
	)

	var title := Label3D.new()
	title.name = "RainbowEndTitle"
	title.text = "RAINBOW'S END"
	title.font_size = 96
	title.pixel_size = 0.0086
	title.modulate = Color(1.0, 0.79, 0.24, 1.0)
	title.outline_size = 14
	title.outline_modulate = Color(0.035, 0.008, 0.004, 1.0)
	title.position = Vector3(0.0, 22.10, -3.16)
	marquee.add_child(title)

	for side in [-1.0, 1.0]:
		_add_sphere(
			marquee,
			"MarqueeEmerald_%s" % str(side),
			0.30,
			Vector3(side * 5.15, 22.10, -3.56),
			Vector3(1.0, 1.25, 0.52),
			_emerald,
			20,
			10
		)


func _build_arch_band(
	parent: Node3D,
	band_name: String,
	center: Vector2,
	radius: float,
	width: float,
	depth: float,
	segment_count: int,
	min_angle: float,
	max_angle: float,
	material: Material
) -> void:
	var band := Node3D.new()
	band.name = band_name
	parent.add_child(band)

	var angle_step := (max_angle - min_angle) / float(segment_count - 1)
	var segment_length := radius * angle_step * 1.15
	for segment_index in range(segment_count):
		var angle := min_angle + float(segment_index) * angle_step
		var segment := _add_box(
			band,
			"Segment_%02d" % segment_index,
			Vector3(segment_length, width, depth),
			Vector3(center.x + cos(angle) * radius, center.y + sin(angle) * radius, -3.54),
			material
		)
		segment.rotation.z = angle - PI * 0.5



func _match_existing_side_walls() -> void:
	await get_tree().process_frame
	var machine := get_parent() as Node
	if machine == null:
		return

	# Reuse the existing right-side materials on the existing left-side walls.
	# No extra wall meshes are created here.
	var left_cabinet_panel := machine.get_node_or_null("LeftCabinetPanel") as MeshInstance3D
	var right_cabinet_panel := machine.get_node_or_null("RightCabinetPanel") as MeshInstance3D
	if left_cabinet_panel != null and right_cabinet_panel != null:
		left_cabinet_panel.material_override = right_cabinet_panel.material_override

	var left_wall_mesh := machine.get_node_or_null("LeftWall/Mesh") as MeshInstance3D
	var right_wall_mesh := machine.get_node_or_null("RightWall/Mesh") as MeshInstance3D
	if left_wall_mesh != null and right_wall_mesh != null:
		left_wall_mesh.material_override = right_wall_mesh.material_override


func _apply_rainbow_road() -> void:
	await get_tree().process_frame
	var machine := get_parent() as Node
	if machine == null:
		return
	var lower_board_mesh := machine.get_node_or_null("LowerBoard/Mesh") as MeshInstance3D
	if lower_board_mesh == null:
		return
	lower_board_mesh.material_override = _rainbow_road



func _add_box(
	parent: Node3D, node_name: String, size: Vector3, local_position: Vector3, material: Material
) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var instance := MeshInstance3D.new()
	instance.name = node_name
	instance.mesh = mesh
	instance.material_override = material
	instance.position = local_position
	parent.add_child(instance)
	return instance


func _add_sphere(
	parent: Node3D,
	node_name: String,
	radius: float,
	local_position: Vector3,
	local_scale: Vector3,
	material: Material,
	radial_segments: int,
	rings: int
) -> MeshInstance3D:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = radial_segments
	mesh.rings = rings
	var instance := MeshInstance3D.new()
	instance.name = node_name
	instance.mesh = mesh
	instance.material_override = material
	instance.position = local_position
	instance.scale = local_scale
	parent.add_child(instance)
	return instance
