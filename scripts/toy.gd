extends RigidBody3D
class_name PusherToy

@export var toy_family: String = "horseshoe"
@export var toy_instance_id: String = ""
@export var source_wallet: String = ""

const CLOVER_MODEL_PATH = "res://assets/toys/four_leaf_clover.glb"

var _gold_material: StandardMaterial3D
var _green_material: StandardMaterial3D
var _dark_material: StandardMaterial3D
var _brown_material: StandardMaterial3D
var _red_material: StandardMaterial3D

func _ready() -> void:
	if not _is_valid_family(toy_family):
		toy_family = "horseshoe"
	if toy_instance_id.is_empty():
		toy_instance_id = "%s_%s" % [toy_family, str(Time.get_ticks_usec())]

	add_to_group("toys")
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 12
	can_sleep = true
	mass = 0.42
	linear_damp = 0.20
	angular_damp = 0.28
	collision_layer = 1
	collision_mask = 1

	var physics := PhysicsMaterial.new()
	physics.friction = 0.44
	physics.bounce = 0.08
	physics.rough = false
	physics.absorbent = false
	physics_material_override = physics

	_build_materials()
	_build_toy()

func _is_valid_family(value: String) -> bool:
	match value:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return true
	return false

func display_name() -> String:
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

func _build_materials() -> void:
	_gold_material = _material(Color(0.93, 0.61, 0.10, 1.0), 0.72, 0.22)
	_green_material = _material(Color(0.08, 0.48, 0.18, 1.0), 0.12, 0.42)
	_dark_material = _material(Color(0.035, 0.045, 0.040, 1.0), 0.38, 0.30)
	_brown_material = _material(Color(0.30, 0.12, 0.045, 1.0), 0.05, 0.56)
	_red_material = _material(Color(0.58, 0.12, 0.035, 1.0), 0.08, 0.48)

func _material(color: Color, metallic: float, roughness: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.metallic = metallic
	material.roughness = roughness
	return material

func _build_toy() -> void:
	match toy_family:
		"horseshoe":
			_build_horseshoe()
		"four_leaf_clover":
			_build_clover()
		"leprechaun":
			_build_leprechaun()
		"pot_of_gold":
			_build_pot_of_gold()
		"treasure_chest":
			_build_treasure_chest()

func _build_horseshoe() -> void:
	# The horseshoe is the showcase toy: a real open U-shaped body instead of
	# three boxes, with a raised gold face, emerald inlay, rivets, and clover.
	mass = 0.62
	var deep_gold := _material(Color(0.84, 0.38, 0.035, 1.0), 0.90, 0.20)
	var bright_gold := _material(Color(1.0, 0.68, 0.12, 1.0), 0.82, 0.14)
	var emerald := _material(Color(0.015, 0.48, 0.09, 1.0), 0.30, 0.18)
	var emerald_dark := _material(Color(0.005, 0.12, 0.025, 1.0), 0.18, 0.24)

	# Thick lower casting, then a smaller raised face to give it a beveled edge.
	_add_annular_sector(0.37, 0.90, 0.24, -138.0, 138.0, 30, Vector3(0.0, -0.02, 0.0), deep_gold)
	_add_annular_sector(0.43, 0.84, 0.14, -138.0, 138.0, 30, Vector3(0.0, 0.13, 0.0), bright_gold)

	# Recessed emerald stripe running through both arms.
	_add_annular_sector(0.56, 0.64, 0.035, -121.0, 121.0, 26, Vector3(0.0, 0.218, 0.0), emerald_dark)
	_add_annular_sector(0.575, 0.625, 0.046, -119.0, 119.0, 26, Vector3(0.0, 0.225, 0.0), emerald)

	# Chunky capped heels make the opening read clearly from the game camera.
	for angle_degrees in [-138.0, 138.0]:
		var angle := deg_to_rad(angle_degrees)
		var heel_position := Vector3(sin(angle) * 0.635, 0.045, cos(angle) * 0.635)
		_add_box(Vector3(0.52, 0.34, 0.46), heel_position, Vector3(0.0, angle_degrees, 0.0), deep_gold)
		_add_box(Vector3(0.43, 0.13, 0.37), heel_position + Vector3(0.0, 0.205, 0.0), Vector3(0.0, angle_degrees, 0.0), bright_gold)
		_add_cylinder(0.060, 0.042, heel_position + Vector3(0.0, 0.295, 0.0), Vector3.ZERO, emerald_dark)
		_add_cylinder(0.040, 0.050, heel_position + Vector3(0.0, 0.303, 0.0), Vector3.ZERO, emerald)

	# Emerald nail heads along the face make it readable among the coin pile.
	for angle_degrees in [-96.0, -66.0, 66.0, 96.0]:
		var angle := deg_to_rad(angle_degrees)
		var stud_position := Vector3(sin(angle) * 0.735, 0.225, cos(angle) * 0.735)
		_add_cylinder(0.065, 0.032, stud_position, Vector3.ZERO, emerald_dark)
		_add_cylinder(0.043, 0.040, stud_position + Vector3(0.0, 0.012, 0.0), Vector3.ZERO, emerald)

	# Raised four-leaf-clover badge on the front of the shoe.
	var clover_center := Vector3(0.0, 0.245, 0.675)
	var leaf_offsets := [
		Vector3(-0.115, 0.0, 0.0),
		Vector3(0.115, 0.0, 0.0),
		Vector3(0.0, 0.0, -0.115),
		Vector3(0.0, 0.0, 0.115),
	]
	for offset in leaf_offsets:
		_add_sphere(Vector3(0.155, 0.045, 0.155), clover_center + offset, bright_gold)
	for offset in leaf_offsets:
		_add_sphere(Vector3(0.112, 0.030, 0.112), clover_center + offset + Vector3(0.0, 0.045, 0.0), emerald)
	_add_sphere(Vector3(0.105, 0.050, 0.105), clover_center + Vector3(0.0, 0.020, 0.0), bright_gold)
	_add_sphere(Vector3(0.064, 0.030, 0.064), clover_center + Vector3(0.0, 0.070, 0.0), emerald)

	# Compound collision follows the U instead of filling its center with one box.
	var collision_segments := 14
	for index in range(collision_segments):
		var t := (float(index) + 0.5) / float(collision_segments)
		var angle_degrees := lerpf(-135.0, 135.0, t)
		var angle := deg_to_rad(angle_degrees)
		var collision_position := Vector3(sin(angle) * 0.635, 0.015, cos(angle) * 0.635)
		_add_box_collision(
			Vector3(0.34, 0.34, 0.50),
			collision_position,
			Vector3(0.0, angle_degrees, 0.0)
		)

func _build_clover() -> void:
	# YD-7 Clover: use the finished shaded GLB as the gameplay visual.
	# The generated model already uses the same flat clover orientation as the
	# existing collision layout, so only centering/scaling is applied here.
	mass = 0.52
	_add_clover_model_visual()

	# Keep gameplay physics simple and stable instead of deriving collision from
	# the high-detail plush mesh.
	var leaf_angles := [0.0, 90.0, 180.0, 270.0]
	_add_sphere_collision(0.25, Vector3.ZERO)
	for angle_degrees in leaf_angles:
		var angle := deg_to_rad(angle_degrees)
		var direction := Vector3(sin(angle), 0.0, cos(angle))
		_add_sphere_collision(0.34, direction * 0.42)
	_add_capsule_collision(
		0.15,
		0.60,
		Vector3(0.0, 0.0, 0.69),
		Vector3(90.0, 0.0, -10.0)
	)


func _add_clover_model_visual() -> void:
	if not ResourceLoader.exists(CLOVER_MODEL_PATH):
		push_error("YD-7 Clover model is missing: %s" % CLOVER_MODEL_PATH)
		return

	var resource: Resource = load(CLOVER_MODEL_PATH)
	if not (resource is PackedScene):
		push_error("YD-7 Clover model did not import as a PackedScene: %s" % CLOVER_MODEL_PATH)
		return

	var model_instance: Node = (resource as PackedScene).instantiate()
	if not (model_instance is Node3D):
		model_instance.queue_free()
		push_error("YD-7 Clover model root is not Node3D: %s" % CLOVER_MODEL_PATH)
		return

	var holder := Node3D.new()
	holder.name = "CloverVisual"
	add_child(holder)

	var model := model_instance as Node3D
	model.name = "FourLeafCloverModel"
	holder.add_child(model)
	_fit_external_visual(holder, 1.55)


func _fit_external_visual(root: Node3D, target_dimension: float) -> void:
	var meshes: Array[MeshInstance3D] = []
	_collect_external_meshes(root, meshes)
	if meshes.is_empty():
		push_error("YD-7 Clover model contains no MeshInstance3D nodes.")
		return

	var root_inverse: Transform3D = root.global_transform.affine_inverse()
	var found := false
	var combined := AABB()

	for mesh_instance: MeshInstance3D in meshes:
		if mesh_instance.mesh == null:
			continue
		var mesh_transform: Transform3D = root_inverse * mesh_instance.global_transform
		var transformed: AABB = mesh_transform * mesh_instance.get_aabb()
		if not found:
			combined = transformed
			found = true
		else:
			combined = combined.merge(transformed)

	if not found:
		return

	var largest_dimension := maxf(combined.size.x, maxf(combined.size.y, combined.size.z))
	if largest_dimension <= 0.001:
		return

	var scale_factor := target_dimension / largest_dimension
	var center := combined.position + combined.size * 0.5
	root.scale = Vector3.ONE * scale_factor
	root.position = -(center * scale_factor)


func _collect_external_meshes(node: Node, output: Array[MeshInstance3D]) -> void:
	for child: Node in node.get_children():
		if child is MeshInstance3D:
			output.append(child as MeshInstance3D)
		_collect_external_meshes(child, output)

func _build_plush_clover_leaf(
	angle_degrees: float,
	back_material: Material,
	face_material: Material,
	highlight_material: Material,
	thread_material: Material
) -> void:
	var angle := deg_to_rad(angle_degrees)
	var direction := Vector3(sin(angle), 0.0, cos(angle))
	var tangent := Vector3(cos(angle), 0.0, -sin(angle))
	var outer_center := direction * 0.49
	var left_lobe := outer_center + tangent * 0.145
	var right_lobe := outer_center - tangent * 0.145
	var base_center := direction * 0.325
	var rotation := Vector3(0.0, angle_degrees, 0.0)

	# Dark lower cushion acts as a visible seam around the brighter top fabric.
	_add_sphere(Vector3(0.305, 0.135, 0.330), left_lobe, back_material, rotation)
	_add_sphere(Vector3(0.305, 0.135, 0.330), right_lobe, back_material, rotation)
	_add_sphere(Vector3(0.275, 0.125, 0.360), base_center, back_material, rotation)
	_add_sphere(Vector3(0.263, 0.100, 0.286), left_lobe + Vector3(0.0, 0.115, 0.0), face_material, rotation)
	_add_sphere(Vector3(0.263, 0.100, 0.286), right_lobe + Vector3(0.0, 0.115, 0.0), face_material, rotation)
	_add_sphere(Vector3(0.235, 0.092, 0.315), base_center + Vector3(0.0, 0.105, 0.0), face_material, rotation)

	# Soft highlight patches make the plush surface read under the cabinet lights.
	_add_sphere(Vector3(0.115, 0.025, 0.150), left_lobe + direction * 0.020 + Vector3(0.0, 0.225, 0.0), highlight_material, rotation)
	_add_sphere(Vector3(0.082, 0.022, 0.105), right_lobe + direction * 0.015 + Vector3(0.0, 0.220, 0.0), highlight_material, rotation)

	# Gold piping and leaf-vein embroidery.
	var seam_points := [
		outer_center + direction * 0.240,
		left_lobe + tangent * 0.150,
		right_lobe - tangent * 0.150,
		base_center - direction * 0.165 + tangent * 0.105,
		base_center - direction * 0.165 - tangent * 0.105,
	]
	for seam_point in seam_points:
		_add_sphere(Vector3(0.038, 0.018, 0.038), seam_point + Vector3(0.0, 0.225, 0.0), thread_material)
	_add_box(Vector3(0.030, 0.022, 0.320), direction * 0.435 + Vector3(0.0, 0.235, 0.0), Vector3(0.0, angle_degrees, 0.0), thread_material)
	_add_box(Vector3(0.026, 0.020, 0.150), direction * 0.520 + tangent * 0.060 + Vector3(0.0, 0.237, 0.0), Vector3(0.0, angle_degrees + 34.0, 0.0), thread_material)

func _build_leprechaun() -> void:
	# A full seated plush character rather than a few stacked primitives. The
	# broad hat, orange beard, face, coat, hands, shoes, and gold trim keep the
	# leprechaun readable even when it is partly buried in the coin pile.
	mass = 0.72
	var plush_green_dark := _material(Color(0.018, 0.14, 0.035, 1.0), 0.01, 0.96)
	var plush_green := _material(Color(0.035, 0.48, 0.10, 1.0), 0.01, 0.94)
	var plush_green_light := _material(Color(0.08, 0.66, 0.16, 1.0), 0.01, 0.91)
	var plush_skin := _material(Color(0.96, 0.63, 0.40, 1.0), 0.0, 0.92)
	var plush_skin_light := _material(Color(1.0, 0.77, 0.57, 1.0), 0.0, 0.90)
	var ginger_dark := _material(Color(0.48, 0.10, 0.015, 1.0), 0.01, 0.96)
	var ginger := _material(Color(0.90, 0.25, 0.025, 1.0), 0.01, 0.93)
	var gold_thread := _material(Color(1.0, 0.66, 0.09, 1.0), 0.30, 0.42)
	var belt_brown := _material(Color(0.20, 0.065, 0.018, 1.0), 0.02, 0.86)
	var eye_white := _material(Color(0.96, 0.98, 0.94, 1.0), 0.0, 0.32)
	var eye_green := _material(Color(0.02, 0.43, 0.12, 1.0), 0.12, 0.25)
	var eye_black := _material(Color(0.004, 0.006, 0.005, 1.0), 0.28, 0.16)
	var cheek_pink := _material(Color(0.92, 0.25, 0.27, 1.0), 0.0, 0.78)

	# Soft seated body with a darker lower cushion showing around the coat.
	_add_sphere(Vector3(0.48, 0.54, 0.40), Vector3(0.0, 0.02, 0.04), plush_green_dark)
	_add_sphere(Vector3(0.43, 0.49, 0.36), Vector3(0.0, 0.08, -0.015), plush_green)
	_add_sphere(Vector3(0.23, 0.22, 0.25), Vector3(-0.25, -0.26, 0.08), plush_green_dark)
	_add_sphere(Vector3(0.23, 0.22, 0.25), Vector3(0.25, -0.26, 0.08), plush_green_dark)

	# Coat lapels, belt, buckle, and oversized toy-like buttons.
	_add_box(Vector3(0.11, 0.48, 0.055), Vector3(-0.13, 0.12, -0.355), Vector3(0.0, 0.0, -18.0), plush_green_light)
	_add_box(Vector3(0.11, 0.48, 0.055), Vector3(0.13, 0.12, -0.355), Vector3(0.0, 0.0, 18.0), plush_green_light)
	_add_box(Vector3(0.74, 0.105, 0.065), Vector3(0.0, -0.06, -0.37), Vector3.ZERO, belt_brown)
	_add_box(Vector3(0.25, 0.22, 0.075), Vector3(0.0, -0.06, -0.415), Vector3.ZERO, gold_thread)
	_add_box(Vector3(0.125, 0.095, 0.045), Vector3(0.0, -0.06, -0.458), Vector3.ZERO, belt_brown)
	for button_y in [0.16, 0.31]:
		_add_sphere(Vector3(0.070, 0.070, 0.035), Vector3(0.0, button_y, -0.378), gold_thread)

	# Stubby padded arms and hands make the silhouette read as a plush doll.
	_add_capsule(0.16, 0.58, Vector3(-0.45, 0.12, -0.01), plush_green_dark, Vector3(0.0, 0.0, -56.0))
	_add_capsule(0.135, 0.52, Vector3(-0.43, 0.16, -0.045), plush_green, Vector3(0.0, 0.0, -56.0))
	_add_capsule(0.16, 0.58, Vector3(0.45, 0.12, -0.01), plush_green_dark, Vector3(0.0, 0.0, 56.0))
	_add_capsule(0.135, 0.52, Vector3(0.43, 0.16, -0.045), plush_green, Vector3(0.0, 0.0, 56.0))
	_add_sphere(Vector3(0.175, 0.175, 0.165), Vector3(-0.66, -0.02, -0.08), plush_skin)
	_add_sphere(Vector3(0.175, 0.175, 0.165), Vector3(0.66, -0.02, -0.08), plush_skin)
	_add_sphere(Vector3(0.090, 0.080, 0.045), Vector3(-0.66, -0.015, -0.235), plush_skin_light)
	_add_sphere(Vector3(0.090, 0.080, 0.045), Vector3(0.66, -0.015, -0.235), plush_skin_light)

	# Seated legs, striped socks, and broad buckled shoes.
	_add_capsule(0.19, 0.56, Vector3(-0.25, -0.34, -0.20), plush_green, Vector3(72.0, 0.0, 0.0))
	_add_capsule(0.19, 0.56, Vector3(0.25, -0.34, -0.20), plush_green, Vector3(72.0, 0.0, 0.0))
	for leg_x in [-0.25, 0.25]:
		_add_box(Vector3(0.28, 0.055, 0.065), Vector3(leg_x, -0.31, -0.43), Vector3.ZERO, plush_skin_light)
		_add_box(Vector3(0.28, 0.055, 0.068), Vector3(leg_x, -0.39, -0.45), Vector3.ZERO, plush_green_light)
	_add_sphere(Vector3(0.31, 0.17, 0.37), Vector3(-0.27, -0.49, -0.48), plush_green_dark)
	_add_sphere(Vector3(0.31, 0.17, 0.37), Vector3(0.27, -0.49, -0.48), plush_green_dark)
	_add_box(Vector3(0.18, 0.13, 0.055), Vector3(-0.27, -0.47, -0.835), Vector3.ZERO, gold_thread)
	_add_box(Vector3(0.18, 0.13, 0.055), Vector3(0.27, -0.47, -0.835), Vector3.ZERO, gold_thread)

	# Head cushion, ears, side hair, and a layered orange plush beard.
	_add_sphere(Vector3(0.46, 0.44, 0.41), Vector3(0.0, 0.69, 0.005), ginger_dark)
	_add_sphere(Vector3(0.405, 0.385, 0.365), Vector3(0.0, 0.72, -0.045), plush_skin)
	_add_sphere(Vector3(0.15, 0.19, 0.11), Vector3(-0.405, 0.69, -0.045), plush_skin)
	_add_sphere(Vector3(0.15, 0.19, 0.11), Vector3(0.405, 0.69, -0.045), plush_skin)
	_add_sphere(Vector3(0.065, 0.10, 0.035), Vector3(-0.43, 0.69, -0.145), plush_skin_light)
	_add_sphere(Vector3(0.065, 0.10, 0.035), Vector3(0.43, 0.69, -0.145), plush_skin_light)

	var beard_positions := [
		Vector3(-0.31, 0.54, -0.30),
		Vector3(-0.19, 0.45, -0.345),
		Vector3(-0.065, 0.41, -0.365),
		Vector3(0.065, 0.41, -0.365),
		Vector3(0.19, 0.45, -0.345),
		Vector3(0.31, 0.54, -0.30),
	]
	for beard_position in beard_positions:
		_add_sphere(Vector3(0.145, 0.175, 0.105), beard_position, ginger_dark)
		_add_sphere(Vector3(0.116, 0.145, 0.078), beard_position + Vector3(0.0, 0.018, -0.055), ginger)

	# Large expressive embroidered face on the front of the head.
	for eye_x in [-0.145, 0.145]:
		_add_sphere(Vector3(0.105, 0.125, 0.045), Vector3(eye_x, 0.79, -0.375), eye_white)
		_add_sphere(Vector3(0.070, 0.092, 0.030), Vector3(eye_x, 0.79, -0.415), eye_green)
		_add_sphere(Vector3(0.040, 0.062, 0.020), Vector3(eye_x, 0.785, -0.438), eye_black)
		_add_sphere(Vector3(0.016, 0.022, 0.010), Vector3(eye_x - 0.018, 0.825, -0.456), eye_white)
	_add_capsule(0.026, 0.16, Vector3(-0.145, 0.925, -0.375), ginger, Vector3(0.0, 0.0, 77.0))
	_add_capsule(0.026, 0.16, Vector3(0.145, 0.925, -0.375), ginger, Vector3(0.0, 0.0, 103.0))
	_add_sphere(Vector3(0.078, 0.070, 0.060), Vector3(0.0, 0.69, -0.430), plush_skin_light)
	_add_sphere(Vector3(0.080, 0.050, 0.030), Vector3(-0.25, 0.65, -0.405), cheek_pink)
	_add_sphere(Vector3(0.080, 0.050, 0.030), Vector3(0.25, 0.65, -0.405), cheek_pink)
	_add_sphere(Vector3(0.135, 0.070, 0.032), Vector3(0.0, 0.565, -0.410), eye_black)
	_add_sphere(Vector3(0.085, 0.035, 0.024), Vector3(0.0, 0.590, -0.442), plush_skin_light)

	# Oversized plush top hat with dark band, gold buckle, piping, and clover pin.
	_add_sphere(Vector3(0.56, 0.085, 0.43), Vector3(0.0, 1.055, 0.0), plush_green_dark)
	_add_sphere(Vector3(0.51, 0.065, 0.39), Vector3(0.0, 1.105, -0.015), plush_green)
	_add_cylinder(0.395, 0.48, Vector3(0.0, 1.31, 0.02), Vector3.ZERO, plush_green_dark, 0.43)
	_add_cylinder(0.355, 0.43, Vector3(0.0, 1.34, -0.005), Vector3.ZERO, plush_green, 0.39)
	_add_cylinder(0.405, 0.115, Vector3(0.0, 1.205, -0.005), Vector3.ZERO, belt_brown)
	_add_box(Vector3(0.285, 0.205, 0.060), Vector3(-0.08, 1.205, -0.405), Vector3.ZERO, gold_thread)
	_add_box(Vector3(0.145, 0.090, 0.042), Vector3(-0.08, 1.205, -0.440), Vector3.ZERO, belt_brown)
	_add_box(Vector3(0.055, 0.035, 0.36), Vector3(0.0, 1.535, -0.03), Vector3(0.0, 90.0, 0.0), gold_thread)

	var pin_center := Vector3(0.235, 1.34, -0.385)
	for pin_offset in [Vector3(-0.055, 0.0, 0.0), Vector3(0.055, 0.0, 0.0), Vector3(0.0, 0.055, 0.0), Vector3(0.0, -0.055, 0.0)]:
		_add_sphere(Vector3(0.062, 0.062, 0.025), pin_center + pin_offset, gold_thread)
	for pin_offset in [Vector3(-0.045, 0.0, -0.020), Vector3(0.045, 0.0, -0.020), Vector3(0.0, 0.045, -0.020), Vector3(0.0, -0.045, -0.020)]:
		_add_sphere(Vector3(0.045, 0.045, 0.018), pin_center + pin_offset, plush_green_light)

	# Compound collision follows the seated body, head, hat, hands, and feet.
	_add_capsule_collision(0.43, 0.92, Vector3(0.0, 0.02, 0.02))
	_add_sphere_collision(0.43, Vector3(0.0, 0.70, 0.0))
	_add_box_collision(Vector3(0.90, 0.58, 0.78), Vector3(0.0, 1.29, 0.0))
	_add_sphere_collision(0.18, Vector3(-0.66, -0.02, -0.08))
	_add_sphere_collision(0.18, Vector3(0.66, -0.02, -0.08))
	_add_capsule_collision(0.20, 0.58, Vector3(-0.25, -0.34, -0.20), Vector3(72.0, 0.0, 0.0))
	_add_capsule_collision(0.20, 0.58, Vector3(0.25, -0.34, -0.20), Vector3(72.0, 0.0, 0.0))
	_add_sphere_collision(0.30, Vector3(-0.27, -0.49, -0.48))
	_add_sphere_collision(0.30, Vector3(0.27, -0.49, -0.48))

func _build_pot_of_gold() -> void:
	# A proper showcase pot-of-gold toy: a rounded black cauldron with an
	# oversized gold rim, loop handles, feet, emerald clover badge, and a
	# layered pile of individual gold coins that stays readable in the machine.
	mass = 0.76
	var iron_black := _material(Color(0.018, 0.022, 0.020, 1.0), 0.42, 0.28)
	var iron_highlight := _material(Color(0.055, 0.065, 0.058, 1.0), 0.34, 0.24)
	var deep_gold := _material(Color(0.78, 0.34, 0.025, 1.0), 0.92, 0.20)
	var bright_gold := _material(Color(1.0, 0.68, 0.08, 1.0), 0.86, 0.13)
	var coin_gold := _material(Color(1.0, 0.78, 0.16, 1.0), 0.82, 0.16)
	var emerald_dark := _material(Color(0.004, 0.14, 0.025, 1.0), 0.25, 0.24)
	var emerald := _material(Color(0.015, 0.62, 0.10, 1.0), 0.22, 0.16)

	# Layered cauldron body gives the pot a round belly without making it a
	# perfect rolling ball. The raised front highlight keeps the silhouette clear.
	_add_sphere(Vector3(0.57, 0.46, 0.53), Vector3(0.0, -0.06, 0.0), iron_black)
	_add_sphere(Vector3(0.50, 0.39, 0.47), Vector3(0.0, 0.015, -0.055), iron_highlight)
	_add_cylinder(0.50, 0.25, Vector3(0.0, 0.23, 0.0), Vector3.ZERO, iron_black, 0.56)

	# Thick two-layer gold mouth with a dark inner opening beneath the coin pile.
	_add_cylinder(0.64, 0.16, Vector3(0.0, 0.365, 0.0), Vector3.ZERO, deep_gold)
	_add_cylinder(0.59, 0.105, Vector3(0.0, 0.430, 0.0), Vector3.ZERO, bright_gold)
	_add_cylinder(0.47, 0.115, Vector3(0.0, 0.450, 0.0), Vector3.ZERO, iron_black)

	# Gold loop handles sit outside the body so the toy reads as a cauldron from
	# the normal camera angle. They remain visual-only to avoid physics snagging.
	_add_annular_sector(0.105, 0.205, 0.085, 0.0, 360.0, 24, Vector3(-0.61, 0.05, 0.0), deep_gold, Vector3(0.0, 0.0, 90.0))
	_add_annular_sector(0.105, 0.205, 0.085, 0.0, 360.0, 24, Vector3(0.61, 0.05, 0.0), deep_gold, Vector3(0.0, 0.0, 90.0))
	_add_annular_sector(0.125, 0.180, 0.095, 0.0, 360.0, 24, Vector3(-0.61, 0.05, -0.010), bright_gold, Vector3(0.0, 0.0, 90.0))
	_add_annular_sector(0.125, 0.180, 0.095, 0.0, 360.0, 24, Vector3(0.61, 0.05, -0.010), bright_gold, Vector3(0.0, 0.0, 90.0))
	_add_sphere(Vector3(0.11, 0.12, 0.10), Vector3(-0.54, 0.16, 0.0), deep_gold)
	_add_sphere(Vector3(0.11, 0.12, 0.10), Vector3(0.54, 0.16, 0.0), deep_gold)

	# Three chunky feet keep the toy stable and add a premium arcade-toy shape.
	_add_sphere(Vector3(0.18, 0.13, 0.18), Vector3(-0.34, -0.43, -0.18), deep_gold)
	_add_sphere(Vector3(0.18, 0.13, 0.18), Vector3(0.34, -0.43, -0.18), deep_gold)
	_add_sphere(Vector3(0.16, 0.12, 0.16), Vector3(0.0, -0.43, 0.30), deep_gold)
	_add_sphere(Vector3(0.13, 0.09, 0.13), Vector3(-0.34, -0.39, -0.20), bright_gold)
	_add_sphere(Vector3(0.13, 0.09, 0.13), Vector3(0.34, -0.39, -0.20), bright_gold)

	# A layered pile of real coin discs instead of three generic gold blobs.
	var coin_specs := [
		[Vector3(-0.27, 0.505, -0.18), Vector3(8.0, 0.0, -12.0), 0.155],
		[Vector3(-0.02, 0.515, -0.22), Vector3(-6.0, 0.0, 14.0), 0.165],
		[Vector3(0.25, 0.505, -0.16), Vector3(10.0, 0.0, 18.0), 0.150],
		[Vector3(-0.36, 0.535, 0.03), Vector3(-12.0, 0.0, -20.0), 0.145],
		[Vector3(-0.12, 0.555, 0.02), Vector3(4.0, 0.0, 8.0), 0.170],
		[Vector3(0.15, 0.550, 0.05), Vector3(-8.0, 0.0, -10.0), 0.160],
		[Vector3(0.36, 0.530, 0.03), Vector3(13.0, 0.0, 18.0), 0.140],
		[Vector3(-0.24, 0.610, 0.20), Vector3(5.0, 0.0, -6.0), 0.150],
		[Vector3(0.02, 0.635, 0.18), Vector3(-4.0, 0.0, 12.0), 0.175],
		[Vector3(0.27, 0.605, 0.18), Vector3(8.0, 0.0, 15.0), 0.148],
		[Vector3(-0.13, 0.700, -0.02), Vector3(7.0, 0.0, -16.0), 0.160],
		[Vector3(0.15, 0.690, -0.03), Vector3(-6.0, 0.0, 10.0), 0.155],
	]
	for index in range(coin_specs.size()):
		var spec: Array = coin_specs[index]
		var coin_position: Vector3 = spec[0]
		var coin_rotation: Vector3 = spec[1]
		var coin_radius: float = spec[2]
		var coin_material: Material = bright_gold if index % 3 == 0 else coin_gold
		_add_cylinder(coin_radius, 0.060, coin_position, coin_rotation, coin_material)

	# Three visible top coins get emerald lucky centers so the pile remains
	# visually different from the regular orange gameplay coins.
	_add_cylinder(0.060, 0.018, Vector3(-0.13, 0.738, -0.022), Vector3(7.0, 0.0, -16.0), emerald)
	_add_cylinder(0.058, 0.018, Vector3(0.15, 0.728, -0.032), Vector3(-6.0, 0.0, 10.0), emerald)
	_add_cylinder(0.055, 0.018, Vector3(0.02, 0.674, 0.176), Vector3(-4.0, 0.0, 12.0), emerald)

	# Raised emerald clover medallion on the front of the pot.
	var badge_center := Vector3(0.0, -0.08, -0.505)
	var badge_offsets := [
		Vector3(-0.105, 0.0, 0.0),
		Vector3(0.105, 0.0, 0.0),
		Vector3(0.0, 0.105, 0.0),
		Vector3(0.0, -0.105, 0.0),
	]
	for offset in badge_offsets:
		_add_sphere(Vector3(0.135, 0.135, 0.045), badge_center + offset, bright_gold)
	for offset in badge_offsets:
		_add_sphere(Vector3(0.098, 0.098, 0.035), badge_center + offset + Vector3(0.0, 0.0, -0.045), emerald)
	_add_sphere(Vector3(0.075, 0.075, 0.040), badge_center + Vector3(0.0, 0.0, -0.030), bright_gold)
	_add_box(Vector3(0.060, 0.20, 0.055), Vector3(0.055, -0.255, -0.530), Vector3(0.0, 0.0, -20.0), bright_gold)
	_add_box(Vector3(0.035, 0.16, 0.045), Vector3(0.055, -0.255, -0.565), Vector3(0.0, 0.0, -20.0), emerald_dark)

	# Solid compound collision: stable belly, raised rim, and flat lower support.
	# Decorative handles and loose-looking coin discs do not snag other objects.
	_add_cylinder_collision(0.51, 0.62, Vector3(0.0, -0.06, 0.0))
	_add_cylinder_collision(0.63, 0.17, Vector3(0.0, 0.37, 0.0))
	_add_box_collision(Vector3(0.70, 0.14, 0.58), Vector3(0.0, -0.43, 0.02))

func _build_treasure_chest() -> void:
	# A heavy Celtic treasure chest with an arched walnut lid, antique-gold
	# armor, emerald knotwork panels, a clover seal, and visible bonus coins.
	# The bright trim and broad silhouette keep it readable in the coin pile.
	mass = 0.86
	var walnut_dark := _material(Color(0.11, 0.030, 0.010, 1.0), 0.01, 0.82)
	var walnut := _material(Color(0.30, 0.085, 0.022, 1.0), 0.01, 0.70)
	var walnut_light := _material(Color(0.48, 0.17, 0.045, 1.0), 0.02, 0.62)
	var antique_gold := _material(Color(0.74, 0.36, 0.045, 1.0), 0.78, 0.26)
	var bright_gold := _material(Color(1.0, 0.68, 0.11, 1.0), 0.86, 0.16)
	var coin_gold := _material(Color(1.0, 0.77, 0.16, 1.0), 0.92, 0.12)
	var emerald_dark := _material(Color(0.005, 0.11, 0.025, 1.0), 0.18, 0.28)
	var emerald := _material(Color(0.015, 0.48, 0.09, 1.0), 0.26, 0.18)
	var black_iron := _material(Color(0.025, 0.030, 0.027, 1.0), 0.58, 0.30)

	# Deep wooden lower chest with layered boards and armored gold rails.
	_add_box(Vector3(1.24, 0.60, 0.84), Vector3(0.0, -0.16, 0.02), Vector3.ZERO, walnut_dark)
	_add_box(Vector3(1.12, 0.50, 0.74), Vector3(0.0, -0.12, -0.01), Vector3.ZERO, walnut)
	for board_y in [-0.30, -0.13, 0.04]:
		_add_box(Vector3(1.08, 0.035, 0.045), Vector3(0.0, board_y, -0.395), Vector3.ZERO, walnut_light)

	# Bottom rail, upper lip, corner guards, and oversized rivets.
	_add_box(Vector3(1.30, 0.105, 0.90), Vector3(0.0, -0.46, 0.02), Vector3.ZERO, antique_gold)
	_add_box(Vector3(1.26, 0.105, 0.88), Vector3(0.0, 0.16, 0.02), Vector3.ZERO, antique_gold)
	_add_box(Vector3(1.14, 0.045, 0.78), Vector3(0.0, 0.215, 0.01), Vector3.ZERO, bright_gold)
	for guard_x in [-0.54, 0.54]:
		_add_box(Vector3(0.12, 0.70, 0.90), Vector3(guard_x, -0.13, 0.02), Vector3.ZERO, antique_gold)
		for rivet_y in [-0.34, -0.05, 0.16]:
			_add_sphere(Vector3(0.055, 0.055, 0.030), Vector3(guard_x, rivet_y, -0.455), bright_gold)

	# Rounded barrel lid. A dark-gold cylinder sits under the smaller walnut
	# barrel, leaving a metallic edge visible around the arched end caps.
	var lid_center := Vector3(0.0, 0.35, 0.02)
	_add_cylinder(0.48, 1.20, lid_center, Vector3(0.0, 0.0, 90.0), antique_gold)
	_add_cylinder(0.415, 1.10, lid_center, Vector3(0.0, 0.0, 90.0), walnut)

	# Long wooden lid slats follow the arch and break up the plain barrel.
	for slat_angle in [-62.0, -31.0, 0.0, 31.0, 62.0]:
		var slat_radians := deg_to_rad(slat_angle)
		var slat_position := Vector3(
			0.0,
			lid_center.y + cos(slat_radians) * 0.425,
			lid_center.z + sin(slat_radians) * 0.425
		)
		_add_box(
			Vector3(1.07, 0.035, 0.155),
			slat_position,
			Vector3(slat_angle, 0.0, 0.0),
			walnut_light if slat_angle == 0.0 else walnut_dark
		)

	# Three raised Celtic arch bands around the lid.
	for band_x in [-0.46, 0.0, 0.46]:
		_add_annular_sector(
			0.405,
			0.505,
			0.115,
			0.0,
			180.0,
			22,
			Vector3(band_x, lid_center.y, lid_center.z),
			antique_gold,
			Vector3(0.0, 0.0, 90.0)
		)
		_add_annular_sector(
			0.455,
			0.495,
			0.123,
			8.0,
			172.0,
			20,
			Vector3(band_x, lid_center.y, lid_center.z),
			bright_gold,
			Vector3(0.0, 0.0, 90.0)
		)

	# Front emerald panels framed in gold. The crossing padded strands read as
	# Celtic knotwork without relying on a flat texture.
	for panel_x in [-0.31, 0.31]:
		_add_box(Vector3(0.46, 0.35, 0.075), Vector3(panel_x, -0.12, -0.435), Vector3.ZERO, antique_gold)
		_add_box(Vector3(0.39, 0.28, 0.050), Vector3(panel_x, -0.12, -0.480), Vector3.ZERO, emerald_dark)
		_add_capsule(0.031, 0.31, Vector3(panel_x - 0.075, -0.12, -0.520), bright_gold, Vector3(0.0, 0.0, -43.0))
		_add_capsule(0.031, 0.31, Vector3(panel_x + 0.075, -0.12, -0.520), bright_gold, Vector3(0.0, 0.0, 43.0))
		_add_capsule(0.025, 0.23, Vector3(panel_x, -0.035, -0.530), bright_gold, Vector3(0.0, 0.0, 90.0))
		_add_capsule(0.025, 0.23, Vector3(panel_x, -0.205, -0.530), bright_gold, Vector3(0.0, 0.0, 90.0))

	# Central lock plate and deep iron keyhole.
	_add_box(Vector3(0.28, 0.38, 0.095), Vector3(0.0, -0.12, -0.455), Vector3.ZERO, antique_gold)
	_add_box(Vector3(0.20, 0.30, 0.055), Vector3(0.0, -0.12, -0.515), Vector3.ZERO, bright_gold)
	_add_sphere(Vector3(0.070, 0.085, 0.028), Vector3(0.0, -0.075, -0.560), black_iron)
	_add_box(Vector3(0.055, 0.145, 0.045), Vector3(0.0, -0.185, -0.560), Vector3.ZERO, black_iron)

	# Large emerald clover seal on the center lid band.
	_add_cylinder(0.255, 0.070, Vector3(0.0, 0.39, -0.455), Vector3(90.0, 0.0, 0.0), antique_gold)
	_add_cylinder(0.205, 0.082, Vector3(0.0, 0.39, -0.495), Vector3(90.0, 0.0, 0.0), emerald_dark)
	var seal_center := Vector3(0.0, 0.39, -0.545)
	var seal_offsets := [
		Vector3(-0.080, 0.0, 0.0),
		Vector3(0.080, 0.0, 0.0),
		Vector3(0.0, 0.080, 0.0),
		Vector3(0.0, -0.080, 0.0),
	]
	for offset in seal_offsets:
		_add_sphere(Vector3(0.092, 0.092, 0.030), seal_center + offset, bright_gold)
	for offset in seal_offsets:
		_add_sphere(Vector3(0.065, 0.065, 0.025), seal_center + offset + Vector3(0.0, 0.0, -0.030), emerald)
	_add_box(Vector3(0.038, 0.14, 0.035), Vector3(0.035, 0.265, -0.575), Vector3(0.0, 0.0, -20.0), bright_gold)

	# A visible line of bonus coins tucked beneath the lid makes the chest's
	# power immediately obvious without creating separate physics bodies.
	var coin_positions := [
		Vector3(-0.36, 0.205, -0.455),
		Vector3(-0.18, 0.230, -0.475),
		Vector3(0.0, 0.215, -0.490),
		Vector3(0.18, 0.235, -0.475),
		Vector3(0.36, 0.205, -0.455),
	]
	for coin_index in range(coin_positions.size()):
		var coin_position: Vector3 = coin_positions[coin_index]
		_add_cylinder(0.105, 0.040, coin_position, Vector3(90.0, 0.0, float(coin_index - 2) * 7.0), coin_gold)
		_add_cylinder(0.056, 0.044, coin_position + Vector3(0.0, 0.0, -0.024), Vector3(90.0, 0.0, float(coin_index - 2) * 7.0), bright_gold)

	# Four gold feet keep the chest from reading as another rectangular block.
	for foot_x in [-0.48, 0.48]:
		for foot_z in [-0.30, 0.30]:
			_add_sphere(Vector3(0.13, 0.10, 0.13), Vector3(foot_x, -0.55, foot_z), antique_gold)
			_add_sphere(Vector3(0.075, 0.055, 0.075), Vector3(foot_x, -0.60, foot_z), bright_gold)

	# Stable compound collision follows the body and arched lid while ignoring
	# the small knotwork, rivets, and coins so they cannot snag the pile.
	_add_box_collision(Vector3(1.25, 0.62, 0.85), Vector3(0.0, -0.16, 0.02))
	_add_box_collision(Vector3(1.16, 0.56, 0.78), Vector3(0.0, 0.38, 0.02))


func _add_annular_sector(
	inner_radius: float,
	outer_radius: float,
	height: float,
	start_degrees: float,
	end_degrees: float,
	segments: int,
	position: Vector3,
	material: Material,
	rotation_degrees_value: Vector3 = Vector3.ZERO
) -> void:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var half_height := height * 0.5

	for index in range(segments):
		var t0 := float(index) / float(segments)
		var t1 := float(index + 1) / float(segments)
		var angle0 := deg_to_rad(lerpf(start_degrees, end_degrees, t0))
		var angle1 := deg_to_rad(lerpf(start_degrees, end_degrees, t1))

		var inner_top0 := Vector3(sin(angle0) * inner_radius, half_height, cos(angle0) * inner_radius)
		var outer_top0 := Vector3(sin(angle0) * outer_radius, half_height, cos(angle0) * outer_radius)
		var inner_top1 := Vector3(sin(angle1) * inner_radius, half_height, cos(angle1) * inner_radius)
		var outer_top1 := Vector3(sin(angle1) * outer_radius, half_height, cos(angle1) * outer_radius)
		var inner_bottom0 := Vector3(inner_top0.x, -half_height, inner_top0.z)
		var outer_bottom0 := Vector3(outer_top0.x, -half_height, outer_top0.z)
		var inner_bottom1 := Vector3(inner_top1.x, -half_height, inner_top1.z)
		var outer_bottom1 := Vector3(outer_top1.x, -half_height, outer_top1.z)

		# Top and bottom faces.
		_add_triangle(surface, inner_top0, outer_top0, outer_top1)
		_add_triangle(surface, inner_top0, outer_top1, inner_top1)
		_add_triangle(surface, inner_bottom0, outer_bottom1, outer_bottom0)
		_add_triangle(surface, inner_bottom0, inner_bottom1, outer_bottom1)

		# Outer and inner curved walls.
		_add_triangle(surface, outer_bottom0, outer_bottom1, outer_top1)
		_add_triangle(surface, outer_bottom0, outer_top1, outer_top0)
		_add_triangle(surface, inner_bottom0, inner_top1, inner_bottom1)
		_add_triangle(surface, inner_bottom0, inner_top0, inner_top1)

	# Close the two open ends of the sector.
	var start_angle := deg_to_rad(start_degrees)
	var end_angle := deg_to_rad(end_degrees)
	var start_inner_top := Vector3(sin(start_angle) * inner_radius, half_height, cos(start_angle) * inner_radius)
	var start_outer_top := Vector3(sin(start_angle) * outer_radius, half_height, cos(start_angle) * outer_radius)
	var start_inner_bottom := Vector3(start_inner_top.x, -half_height, start_inner_top.z)
	var start_outer_bottom := Vector3(start_outer_top.x, -half_height, start_outer_top.z)
	_add_triangle(surface, start_inner_bottom, start_outer_bottom, start_outer_top)
	_add_triangle(surface, start_inner_bottom, start_outer_top, start_inner_top)

	var end_inner_top := Vector3(sin(end_angle) * inner_radius, half_height, cos(end_angle) * inner_radius)
	var end_outer_top := Vector3(sin(end_angle) * outer_radius, half_height, cos(end_angle) * outer_radius)
	var end_inner_bottom := Vector3(end_inner_top.x, -half_height, end_inner_top.z)
	var end_outer_bottom := Vector3(end_outer_top.x, -half_height, end_outer_top.z)
	_add_triangle(surface, end_inner_bottom, end_outer_top, end_outer_bottom)
	_add_triangle(surface, end_inner_bottom, end_inner_top, end_outer_top)

	surface.generate_normals()
	surface.index()
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.mesh = surface.commit()
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees_value
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mesh_instance)

func _add_triangle(surface: SurfaceTool, point_a: Vector3, point_b: Vector3, point_c: Vector3) -> void:
	surface.add_vertex(point_a)
	surface.add_vertex(point_b)
	surface.add_vertex(point_c)

func _add_box(size: Vector3, position: Vector3, rotation_degrees_value: Vector3, material: Material) -> void:
	var mesh_instance := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees_value
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mesh_instance)

func _add_sphere(
	scale_value: Vector3,
	position: Vector3,
	material: Material,
	rotation_degrees_value: Vector3 = Vector3.ZERO
) -> void:
	var mesh_instance := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.5
	mesh.height = 1.0
	mesh.radial_segments = 16
	mesh.rings = 8
	mesh_instance.mesh = mesh
	mesh_instance.scale = scale_value * 2.0
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees_value
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mesh_instance)

func _add_cylinder(top_radius: float, height: float, position: Vector3, rotation_degrees_value: Vector3, material: Material, bottom_radius: float = -1.0) -> void:
	var mesh_instance := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = top_radius
	mesh.bottom_radius = top_radius if bottom_radius < 0.0 else bottom_radius
	mesh.height = height
	mesh.radial_segments = 20
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees_value
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mesh_instance)

func _add_capsule(
	radius: float,
	height: float,
	position: Vector3,
	material: Material,
	rotation_degrees_value: Vector3 = Vector3.ZERO
) -> void:
	var mesh_instance := MeshInstance3D.new()
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = height
	mesh.radial_segments = 16
	mesh.rings = 8
	mesh_instance.mesh = mesh
	mesh_instance.position = position
	mesh_instance.rotation_degrees = rotation_degrees_value
	mesh_instance.material_override = material
	mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(mesh_instance)

func _add_box_collision(size: Vector3, position: Vector3 = Vector3.ZERO, rotation_degrees_value: Vector3 = Vector3.ZERO) -> void:
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	collision.position = position
	collision.rotation_degrees = rotation_degrees_value
	add_child(collision)

func _add_sphere_collision(radius: float, position: Vector3 = Vector3.ZERO) -> void:
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = radius
	collision.shape = shape
	collision.position = position
	add_child(collision)

func _add_capsule_collision(
	radius: float,
	height: float,
	position: Vector3 = Vector3.ZERO,
	rotation_degrees_value: Vector3 = Vector3.ZERO
) -> void:
	var collision := CollisionShape3D.new()
	var shape := CapsuleShape3D.new()
	shape.radius = radius
	shape.height = height
	collision.shape = shape
	collision.position = position
	collision.rotation_degrees = rotation_degrees_value
	add_child(collision)

func _add_cylinder_collision(radius: float, height: float, position: Vector3 = Vector3.ZERO) -> void:
	var collision := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = radius
	shape.height = height
	collision.shape = shape
	collision.position = position
	add_child(collision)
