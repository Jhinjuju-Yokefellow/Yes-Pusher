extends RigidBody3D
class_name PusherCoin

@export var coin_value: int = 1

var _skin_family: String = ""
var _default_material: Material
var _skin_details: Node3D

func _ready() -> void:
	add_to_group("coins")
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 8
	can_sleep = true

	var base_mesh := get_node_or_null("Mesh") as MeshInstance3D
	if base_mesh != null:
		_default_material = base_mesh.material_override

func mark_seed_coin() -> void:
	set_meta("seed_coin", true)

func is_seed_coin() -> bool:
	return bool(get_meta("seed_coin", false))

func apply_skin_family(skin_family: String) -> bool:
	var normalized := skin_family.strip_edges().to_lower()
	if normalized.is_empty():
		_skin_family = ""
		set_meta("skin_family", "")
		set_meta("skin_key", "")
		_rebuild_skin()
		return true

	if not _is_valid_skin_family(normalized):
		push_warning("Unknown YES Pusher coin skin family: %s" % skin_family)
		return false

	_skin_family = normalized
	set_meta("skin_family", normalized)
	set_meta("skin_key", _skin_key_for_family(normalized))
	_rebuild_skin()
	return true

func get_skin_family() -> String:
	return _skin_family

func get_skin_key() -> String:
	return _skin_key_for_family(_skin_family)

func _is_valid_skin_family(value: String) -> bool:
	match value:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return true
	return false

func _skin_key_for_family(value: String) -> String:
	if value.is_empty():
		return ""
	return "yes_pusher.%s" % value

func _rebuild_skin() -> void:
	if is_instance_valid(_skin_details):
		_skin_details.queue_free()
	_skin_details = null

	var base_mesh := get_node_or_null("Mesh") as MeshInstance3D
	if base_mesh == null:
		return

	if _skin_family.is_empty():
		base_mesh.material_override = _default_material
		return

	_skin_details = Node3D.new()
	_skin_details.name = "SkinDetails"
	add_child(_skin_details)

	match _skin_family:
		"horseshoe":
			_build_horseshoe_skin(base_mesh, _skin_details)
		"four_leaf_clover":
			_build_clover_skin(base_mesh, _skin_details)
		"leprechaun":
			_build_leprechaun_skin(base_mesh, _skin_details)
		"pot_of_gold":
			_build_pot_of_gold_skin(base_mesh, _skin_details)
		"treasure_chest":
			_build_treasure_chest_skin(base_mesh, _skin_details)

func _build_horseshoe_skin(base_mesh: MeshInstance3D, root: Node3D) -> void:
	var gold := _material(Color(0.98, 0.64, 0.08, 1.0), 0.88, 0.18)
	var bright_gold := _material(Color(1.0, 0.83, 0.25, 1.0), 0.90, 0.12, Color(0.35, 0.13, 0.01, 1.0))
	var emerald := _material(Color(0.015, 0.27, 0.09, 1.0), 0.40, 0.20, Color(0.0, 0.10, 0.02, 1.0))
	var jewel := _material(Color(0.02, 0.65, 0.20, 1.0), 0.55, 0.10, Color(0.0, 0.18, 0.04, 1.0))
	base_mesh.material_override = gold
	_add_face_medallions(root, bright_gold, emerald)

	var points: Array[Vector2] = [
		Vector2(-0.155, 0.115), Vector2(-0.190, 0.015),
		Vector2(-0.145, -0.095), Vector2(-0.070, -0.165),
		Vector2(0.070, -0.165), Vector2(0.145, -0.095),
		Vector2(0.190, 0.015), Vector2(0.155, 0.115),
	]
	for side in [-1.0, 1.0]:
		for index in range(points.size()):
			var point := points[index]
			_add_cylinder(root, "Horseshoe_%s_%02d" % [_side_name(side), index], 0.058, 0.020, Vector3(point.x, side * 0.102, point.y), bright_gold)
		for nail_index in [1, 3, 4, 6]:
			var nail_point := points[nail_index]
			_add_cylinder(root, "EmeraldNail_%s_%02d" % [_side_name(side), nail_index], 0.018, 0.024, Vector3(nail_point.x, side * 0.116, nail_point.y), jewel)

func _build_clover_skin(base_mesh: MeshInstance3D, root: Node3D) -> void:
	var gold := _material(Color(0.95, 0.68, 0.12, 1.0), 0.82, 0.18)
	var dark_green := _material(Color(0.012, 0.20, 0.055, 1.0), 0.20, 0.32)
	var plush_green := _material(Color(0.05, 0.56, 0.16, 1.0), 0.08, 0.62, Color(0.0, 0.05, 0.01, 1.0))
	var light_green := _material(Color(0.18, 0.82, 0.29, 1.0), 0.12, 0.48)
	base_mesh.material_override = gold
	_add_face_medallions(root, gold, dark_green)

	var leaf_positions: Array[Vector2] = [
		Vector2(-0.085, 0.085), Vector2(0.085, 0.085),
		Vector2(-0.085, -0.085), Vector2(0.085, -0.085),
	]
	for side in [-1.0, 1.0]:
		for index in range(leaf_positions.size()):
			var point := leaf_positions[index]
			var leaf := _add_sphere(root, "CloverLeaf_%s_%02d" % [_side_name(side), index], 0.105, Vector3(point.x, side * 0.108, point.y), plush_green)
			leaf.scale = Vector3(1.10, 0.24, 1.18)
			var highlight := _add_sphere(root, "LeafHighlight_%s_%02d" % [_side_name(side), index], 0.036, Vector3(point.x - 0.022, side * 0.123, point.y - 0.018), light_green)
			highlight.scale = Vector3(1.0, 0.18, 1.0)
		_add_cylinder(root, "CloverCenter_%s" % _side_name(side), 0.047, 0.024, Vector3(0.0, side * 0.119, 0.0), gold)
		_add_box(root, "CloverStem_%s" % _side_name(side), Vector3(0.037, 0.020, 0.130), Vector3(0.020, side * 0.105, -0.205), plush_green, -0.17)

func _build_leprechaun_skin(base_mesh: MeshInstance3D, root: Node3D) -> void:
	var gold := _material(Color(0.95, 0.66, 0.10, 1.0), 0.84, 0.18)
	var green := _material(Color(0.02, 0.34, 0.08, 1.0), 0.20, 0.40)
	var bright_green := _material(Color(0.06, 0.58, 0.14, 1.0), 0.16, 0.34)
	var skin := _material(Color(0.94, 0.64, 0.39, 1.0), 0.02, 0.58)
	var orange := _material(Color(0.90, 0.25, 0.025, 1.0), 0.06, 0.48)
	var black := _material(Color(0.01, 0.014, 0.01, 1.0), 0.15, 0.32)
	base_mesh.material_override = green
	_add_face_medallions(root, gold, bright_green)

	for side in [-1.0, 1.0]:
		_add_cylinder(root, "LeprechaunFace_%s" % _side_name(side), 0.128, 0.020, Vector3(0.0, side * 0.103, -0.045), skin)
		_add_box(root, "HatCrown_%s" % _side_name(side), Vector3(0.245, 0.020, 0.150), Vector3(0.0, side * 0.108, 0.105), green)
		_add_box(root, "HatBrim_%s" % _side_name(side), Vector3(0.330, 0.021, 0.055), Vector3(0.0, side * 0.111, 0.030), gold)
		_add_box(root, "HatBand_%s" % _side_name(side), Vector3(0.250, 0.022, 0.038), Vector3(0.0, side * 0.122, 0.068), black)
		_add_box(root, "HatBuckle_%s" % _side_name(side), Vector3(0.060, 0.024, 0.052), Vector3(0.0, side * 0.135, 0.068), gold)
		for beard_index in range(5):
			var x: float = -0.105 + float(beard_index) * 0.0525
			var z: float = -0.120 - absf(float(beard_index) - 2.0) * 0.016
			_add_cylinder(root, "Beard_%s_%02d" % [_side_name(side), beard_index], 0.050, 0.021, Vector3(x, side * 0.111, z), orange)
		_add_cylinder(root, "EyeL_%s" % _side_name(side), 0.018, 0.024, Vector3(-0.047, side * 0.128, -0.035), black)
		_add_cylinder(root, "EyeR_%s" % _side_name(side), 0.018, 0.024, Vector3(0.047, side * 0.128, -0.035), black)

func _build_pot_of_gold_skin(base_mesh: MeshInstance3D, root: Node3D) -> void:
	var black := _material(Color(0.012, 0.014, 0.012, 1.0), 0.42, 0.20)
	var gold := _material(Color(0.98, 0.67, 0.08, 1.0), 0.90, 0.14, Color(0.28, 0.08, 0.0, 1.0))
	var emerald := _material(Color(0.01, 0.46, 0.11, 1.0), 0.42, 0.17)
	base_mesh.material_override = black
	_add_face_medallions(root, gold, black)

	for side in [-1.0, 1.0]:
		var pot := _add_sphere(root, "PotBody_%s" % _side_name(side), 0.155, Vector3(0.0, side * 0.102, -0.035), black)
		pot.scale = Vector3(1.25, 0.23, 0.85)
		_add_box(root, "PotRim_%s" % _side_name(side), Vector3(0.310, 0.022, 0.050), Vector3(0.0, side * 0.118, 0.080), gold)
		for coin_index in range(5):
			var angle := -0.65 + float(coin_index) * 0.325
			_add_cylinder(root, "PotCoin_%s_%02d" % [_side_name(side), coin_index], 0.040, 0.022, Vector3(sin(angle) * 0.125, side * 0.130, 0.115 + cos(angle) * 0.025), gold)
		_add_cylinder(root, "PotClover_%s" % _side_name(side), 0.035, 0.025, Vector3(0.0, side * 0.134, -0.040), emerald)

func _build_treasure_chest_skin(base_mesh: MeshInstance3D, root: Node3D) -> void:
	var gold := _material(Color(0.92, 0.60, 0.10, 1.0), 0.85, 0.20)
	var walnut := _material(Color(0.19, 0.055, 0.018, 1.0), 0.08, 0.52)
	var dark_wood := _material(Color(0.075, 0.018, 0.008, 1.0), 0.05, 0.58)
	var emerald := _material(Color(0.01, 0.33, 0.085, 1.0), 0.30, 0.24)
	var black := _material(Color(0.01, 0.01, 0.008, 1.0), 0.12, 0.30)
	base_mesh.material_override = walnut
	_add_face_medallions(root, gold, dark_wood)

	for side in [-1.0, 1.0]:
		_add_box(root, "ChestBody_%s" % _side_name(side), Vector3(0.295, 0.021, 0.175), Vector3(0.0, side * 0.106, -0.070), walnut)
		_add_box(root, "ChestLid_%s" % _side_name(side), Vector3(0.295, 0.021, 0.105), Vector3(0.0, side * 0.109, 0.075), dark_wood)
		_add_box(root, "ChestRailTop_%s" % _side_name(side), Vector3(0.320, 0.022, 0.035), Vector3(0.0, side * 0.121, 0.018), gold)
		_add_box(root, "ChestRailBottom_%s" % _side_name(side), Vector3(0.320, 0.022, 0.035), Vector3(0.0, side * 0.121, -0.157), gold)
		_add_box(root, "ChestBandL_%s" % _side_name(side), Vector3(0.038, 0.023, 0.275), Vector3(-0.105, side * 0.125, -0.020), gold)
		_add_box(root, "ChestBandR_%s" % _side_name(side), Vector3(0.038, 0.023, 0.275), Vector3(0.105, side * 0.125, -0.020), gold)
		_add_box(root, "CelticPanel_%s" % _side_name(side), Vector3(0.135, 0.024, 0.070), Vector3(0.0, side * 0.135, -0.074), emerald)
		_add_cylinder(root, "ChestLock_%s" % _side_name(side), 0.047, 0.026, Vector3(0.0, side * 0.148, -0.020), gold)
		_add_box(root, "Keyhole_%s" % _side_name(side), Vector3(0.018, 0.028, 0.045), Vector3(0.0, side * 0.164, -0.025), black)
		for knot_index in [-1, 1]:
			_add_box(root, "Knot_%s_%s" % [_side_name(side), knot_index], Vector3(0.060, 0.024, 0.016), Vector3(float(knot_index) * 0.037, side * 0.150, -0.074), gold, float(knot_index) * 0.65)

func _add_face_medallions(root: Node3D, rim_material: Material, face_material: Material) -> void:
	for side in [-1.0, 1.0]:
		_add_cylinder(root, "FaceRim_%s" % _side_name(side), 0.392, 0.015, Vector3(0.0, side * 0.068, 0.0), rim_material)
		_add_cylinder(root, "FaceInset_%s" % _side_name(side), 0.342, 0.018, Vector3(0.0, side * 0.084, 0.0), face_material)

func _material(color: Color, metallic: float, roughness: float, emission: Color = Color(0.0, 0.0, 0.0, 1.0)) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = metallic
	material.roughness = roughness
	if emission.r > 0.0 or emission.g > 0.0 or emission.b > 0.0:
		material.emission_enabled = true
		material.emission = emission
		material.emission_energy_multiplier = 0.55
	return material

func _add_cylinder(parent: Node3D, node_name: String, radius: float, height: float, local_position: Vector3, material: Material) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = node_name
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 20
	instance.mesh = mesh
	instance.material_override = material
	instance.position = local_position
	parent.add_child(instance)
	return instance

func _add_box(parent: Node3D, node_name: String, size: Vector3, local_position: Vector3, material: Material, rotation_y: float = 0.0) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = node_name
	var mesh := BoxMesh.new()
	mesh.size = size
	instance.mesh = mesh
	instance.material_override = material
	instance.position = local_position
	instance.rotation.y = rotation_y
	parent.add_child(instance)
	return instance

func _add_sphere(parent: Node3D, node_name: String, radius: float, local_position: Vector3, material: Material) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.name = node_name
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * 2.0
	mesh.radial_segments = 16
	mesh.rings = 8
	instance.mesh = mesh
	instance.material_override = material
	instance.position = local_position
	parent.add_child(instance)
	return instance

func _side_name(side: float) -> String:
	return "Top" if side > 0.0 else "Bottom"
