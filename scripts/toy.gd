extends RigidBody3D
class_name PusherToy

@export var toy_family: String = "horseshoe"
@export var toy_instance_id: String = ""
@export var source_wallet: String = ""

const HORSESHOE_MODEL_PATH = "res://assets/Toys/horseshoe.glb"
const CLOVER_MODEL_PATH = "res://assets/Toys/four_leaf_clover.glb"
const LEPRECHAUN_MODEL_PATH = "res://assets/Toys/leprechaun.glb"
const POT_OF_GOLD_MODEL_PATH = "res://assets/Toys/pot_of_gold.glb"
const TREASURE_CHEST_MODEL_PATH = "res://assets/Toys/treasure_chest.glb"

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
	linear_damp = 0.14
	angular_damp = 0.24
	collision_layer = 1
	collision_mask = 1

	var physics := PhysicsMaterial.new()
	physics.friction = 0.36
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
	# YD-7 Horseshoe: use the finished plush GLB as the gameplay visual.
	mass = 0.54
	linear_damp = 0.15
	angular_damp = 0.28
	_add_external_model_visual(
		HORSESHOE_MODEL_PATH,
		"HorseshoeVisual",
		"HorseshoeModel",
		1.55
	)

	# Broad, shallow compound collision approximates the plush U-shape. This
	# keeps the opening clear while encouraging the toy to settle on either face.
	var thickness := 0.22
	_add_box_collision(
		Vector3(0.34, 0.58, thickness),
		Vector3(-0.43, 0.18, 0.0),
		Vector3(0.0, 0.0, -10.0)
	)
	_add_box_collision(
		Vector3(0.34, 0.58, thickness),
		Vector3(0.43, 0.18, 0.0),
		Vector3(0.0, 0.0, 10.0)
	)
	_add_box_collision(
		Vector3(0.38, 0.50, thickness),
		Vector3(-0.30, -0.30, 0.0),
		Vector3(0.0, 0.0, -28.0)
	)
	_add_box_collision(
		Vector3(0.38, 0.50, thickness),
		Vector3(0.30, -0.30, 0.0),
		Vector3(0.0, 0.0, 28.0)
	)
	_add_box_collision(Vector3(0.62, 0.30, thickness), Vector3(0.0, -0.52, 0.0))
	_add_box_collision(
		Vector3(0.42, 0.25, thickness),
		Vector3(-0.44, 0.58, 0.0),
		Vector3(0.0, 0.0, -6.0)
	)
	_add_box_collision(
		Vector3(0.42, 0.25, thickness),
		Vector3(0.44, 0.58, 0.0),
		Vector3(0.0, 0.0, 6.0)
	)

func _build_clover() -> void:
	# YD-7 Clover: use the finished shaded GLB as the gameplay visual.
	mass = 0.48
	linear_damp = 0.15
	angular_damp = 0.28
	_add_external_model_visual(
		CLOVER_MODEL_PATH,
		"CloverVisual",
		"FourLeafCloverModel",
		1.55
	)

	# The imported plush is broad in local X/Y and shallow in local Z. Match that
	# with a deliberately thin compound collision profile so it can tumble, then
	# naturally settle face-up or face-down instead of rolling on sphere shapes.
	var leaf_size := Vector3(0.64, 0.58, 0.22)
	_add_box_collision(leaf_size, Vector3(-0.34, 0.27, 0.0), Vector3(0.0, 0.0, -8.0))
	_add_box_collision(leaf_size, Vector3(0.34, 0.27, 0.0), Vector3(0.0, 0.0, 8.0))
	_add_box_collision(leaf_size, Vector3(-0.34, -0.24, 0.0), Vector3(0.0, 0.0, 8.0))
	_add_box_collision(leaf_size, Vector3(0.34, -0.24, 0.0), Vector3(0.0, 0.0, -8.0))

	# Small center and stem shapes close the gaps without turning the high-detail
	# rendered mesh itself into collision geometry.
	_add_box_collision(Vector3(0.34, 0.34, 0.24), Vector3(0.0, 0.02, 0.0))
	_add_box_collision(
		Vector3(0.20, 0.43, 0.18),
		Vector3(0.06, -0.62, 0.0),
		Vector3(0.0, 0.0, -12.0)
	)


func _add_external_model_visual(
	model_path: String,
	holder_name: String,
	model_name: String,
	target_dimension: float
) -> void:
	if not ResourceLoader.exists(model_path):
		push_error("YD-7 model is missing: %s" % model_path)
		return

	var resource: Resource = load(model_path)
	if not (resource is PackedScene):
		push_error("YD-7 model did not import as a PackedScene: %s" % model_path)
		return

	var model_instance: Node = (resource as PackedScene).instantiate()
	if not (model_instance is Node3D):
		model_instance.queue_free()
		push_error("YD-7 model root is not Node3D: %s" % model_path)
		return

	var holder := Node3D.new()
	holder.name = holder_name
	add_child(holder)

	var model := model_instance as Node3D
	model.name = model_name
	holder.add_child(model)
	_fit_external_visual(holder, target_dimension)


func _fit_external_visual(root: Node3D, target_dimension: float) -> void:
	var meshes: Array[MeshInstance3D] = []
	_collect_external_meshes(root, meshes)
	if meshes.is_empty():
		push_error("YD-7 external model contains no MeshInstance3D nodes.")
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
	# YD-7 Leprechaun: use the finished GLB as the gameplay visual while
	# preserving the existing rigid-body behavior and compound collision.
	mass = 0.64
	linear_damp = 0.15
	angular_damp = 0.29
	_add_external_model_visual(
		LEPRECHAUN_MODEL_PATH,
		"LeprechaunVisual",
		"LeprechaunModel",
		1.55
	)

	# Compound collision follows the seated body, head, hat, hands, and feet.
	# The detailed imported mesh remains visual-only so it cannot snag the pile.
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
	# YD-7 Pot of Gold: use the finished GLB as the gameplay visual while
	# preserving the existing rigid-body behavior and stable compound collision.
	mass = 0.68
	linear_damp = 0.15
	angular_damp = 0.29
	_add_external_model_visual(
		POT_OF_GOLD_MODEL_PATH,
		"PotOfGoldVisual",
		"PotOfGoldModel",
		1.55
	)

	# Keep collision simple and solid so decorative handles, coins, and trim
	# from the imported model cannot snag other objects in the machine.
	_add_cylinder_collision(0.51, 0.62, Vector3(0.0, -0.06, 0.0))
	_add_cylinder_collision(0.63, 0.17, Vector3(0.0, 0.37, 0.0))
	_add_box_collision(Vector3(0.70, 0.14, 0.58), Vector3(0.0, -0.43, 0.02))

func _build_treasure_chest() -> void:
	# YD-7 Treasure Chest: use the finished GLB as the gameplay visual while
	# retaining the same heavy, stable collision profile used by the old toy.
	mass = 0.76
	linear_damp = 0.17
	angular_damp = 0.31
	_add_external_model_visual(
		TREASURE_CHEST_MODEL_PATH,
		"TreasureChestVisual",
		"TreasureChestModel",
		1.55
	)

	# Stable compound collision follows the lower chest and arched lid while
	# leaving decorative trim, rivets, and lock details visual-only.
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
