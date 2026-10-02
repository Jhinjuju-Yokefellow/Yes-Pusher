extends Node3D

enum PreviewAssetKind {
	COIN,
	TOY,
}

const FAMILIES: Array[String] = [
	"horseshoe",
	"four_leaf_clover",
	"leprechaun",
	"pot_of_gold",
	"treasure_chest",
]

const FAMILY_LABELS: Array[String] = [
	"Horseshoe",
	"Four-Leaf Clover",
	"Leprechaun",
	"Pot of Gold",
	"Treasure Chest",
]

const COIN_SCENE: PackedScene = preload("res://Coin.tscn")
const TOY_SCENE: PackedScene = preload("res://Toy.tscn")

@export var asset_kind: PreviewAssetKind = PreviewAssetKind.COIN
@export_range(-1, 4, 1) var family_index: int = -1
@export var spin_preview: bool = false
@export_range(1.0, 90.0, 1.0) var spin_speed_degrees: float = 18.0

var _preview_anchor: Node3D
var _current_preview: Node3D
var _camera: Camera3D
var _info_label: Label
var _status_text: String = ""


func _ready() -> void:
	_build_stage()
	_spawn_preview()


func _process(delta: float) -> void:
	if spin_preview and is_instance_valid(_current_preview):
		_current_preview.rotate_y(deg_to_rad(spin_speed_degrees) * delta)


func _unhandled_key_input(event: InputEvent) -> void:
	if not event is InputEventKey:
		return

	var key_event: InputEventKey = event as InputEventKey
	if not key_event.pressed or key_event.echo:
		return

	match key_event.keycode:
		KEY_LEFT:
			_cycle_family(-1)
		KEY_RIGHT:
			_cycle_family(1)
		KEY_0:
			_set_family_index(-1)
		KEY_1:
			_set_family_index(0)
		KEY_2:
			_set_family_index(1)
		KEY_3:
			_set_family_index(2)
		KEY_4:
			_set_family_index(3)
		KEY_5:
			_set_family_index(4)
		KEY_C:
			asset_kind = PreviewAssetKind.COIN
			_spawn_preview()
		KEY_T:
			asset_kind = PreviewAssetKind.TOY
			_spawn_preview()
		KEY_SPACE:
			asset_kind = PreviewAssetKind.TOY if asset_kind == PreviewAssetKind.COIN else PreviewAssetKind.COIN
			_spawn_preview()
		KEY_R:
			spin_preview = not spin_preview
			_status_text = "Spin %s" % ("on" if spin_preview else "off")
			_update_label()
		KEY_S:
			_capture_preview()


func _build_stage() -> void:
	var world_environment: WorldEnvironment = WorldEnvironment.new()
	world_environment.name = "WorldEnvironment"

	var environment: Environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.035, 0.028, 0.045, 1.0)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.82, 0.88, 1.0, 1.0)
	environment.ambient_light_energy = 0.72
	world_environment.environment = environment
	add_child(world_environment)

	var key_light: DirectionalLight3D = DirectionalLight3D.new()
	key_light.name = "KeyLight"
	key_light.rotation_degrees = Vector3(-48.0, -32.0, 0.0)
	key_light.light_color = Color(1.0, 0.86, 0.68, 1.0)
	key_light.light_energy = 2.35
	key_light.shadow_enabled = true
	add_child(key_light)

	var fill_light: OmniLight3D = OmniLight3D.new()
	fill_light.name = "FillLight"
	fill_light.position = Vector3(-2.4, 2.2, 2.8)
	fill_light.light_color = Color(0.60, 0.78, 1.0, 1.0)
	fill_light.light_energy = 3.2
	fill_light.omni_range = 7.5
	add_child(fill_light)

	var rim_light: OmniLight3D = OmniLight3D.new()
	rim_light.name = "RimLight"
	rim_light.position = Vector3(2.5, 2.6, -2.4)
	rim_light.light_color = Color(0.45, 1.0, 0.62, 1.0)
	rim_light.light_energy = 2.1
	rim_light.omni_range = 6.5
	add_child(rim_light)

	_camera = Camera3D.new()
	_camera.name = "Camera3D"
	_camera.position = Vector3(3.25, 2.8, 4.25)
	_camera.fov = 34.0
	_camera.current = true
	add_child(_camera)
	_camera.look_at(Vector3(0.0, 0.85, 0.0), Vector3.UP)

	var floor: MeshInstance3D = MeshInstance3D.new()
	floor.name = "Floor"
	var floor_mesh: PlaneMesh = PlaneMesh.new()
	floor_mesh.size = Vector2(10.0, 10.0)
	floor.mesh = floor_mesh
	var floor_material: StandardMaterial3D = StandardMaterial3D.new()
	floor_material.albedo_color = Color(0.055, 0.07, 0.062, 1.0)
	floor_material.roughness = 0.82
	floor.material_override = floor_material
	add_child(floor)

	var pedestal: MeshInstance3D = MeshInstance3D.new()
	pedestal.name = "Pedestal"
	var pedestal_mesh: CylinderMesh = CylinderMesh.new()
	pedestal_mesh.top_radius = 1.06
	pedestal_mesh.bottom_radius = 1.16
	pedestal_mesh.height = 0.24
	pedestal_mesh.radial_segments = 64
	pedestal.mesh = pedestal_mesh
	pedestal.position = Vector3(0.0, 0.12, 0.0)
	var pedestal_material: StandardMaterial3D = StandardMaterial3D.new()
	pedestal_material.albedo_color = Color(0.09, 0.20, 0.13, 1.0)
	pedestal_material.metallic = 0.30
	pedestal_material.roughness = 0.27
	pedestal.material_override = pedestal_material
	add_child(pedestal)

	var gold_ring: MeshInstance3D = MeshInstance3D.new()
	gold_ring.name = "PedestalGoldRing"
	var ring_mesh: TorusMesh = TorusMesh.new()
	ring_mesh.inner_radius = 1.00
	ring_mesh.outer_radius = 1.08
	ring_mesh.rings = 64
	ring_mesh.ring_segments = 12
	gold_ring.mesh = ring_mesh
	gold_ring.position = Vector3(0.0, 0.245, 0.0)
	var ring_material: StandardMaterial3D = StandardMaterial3D.new()
	ring_material.albedo_color = Color(0.90, 0.58, 0.12, 1.0)
	ring_material.metallic = 0.86
	ring_material.roughness = 0.18
	gold_ring.material_override = ring_material
	add_child(gold_ring)

	_preview_anchor = Node3D.new()
	_preview_anchor.name = "PreviewAnchor"
	add_child(_preview_anchor)

	var ui: CanvasLayer = CanvasLayer.new()
	ui.name = "PreviewUI"
	add_child(ui)

	_info_label = Label.new()
	_info_label.name = "Info"
	_info_label.position = Vector2(24.0, 20.0)
	_info_label.add_theme_font_size_override("font_size", 18)
	_info_label.add_theme_color_override("font_color", Color(0.95, 0.93, 0.84, 1.0))
	ui.add_child(_info_label)
	_update_label()


func _spawn_preview() -> void:
	if is_instance_valid(_current_preview):
		_current_preview.queue_free()
		_current_preview = null

	family_index = clampi(family_index, -1, FAMILIES.size() - 1)
	if asset_kind == PreviewAssetKind.TOY and family_index < 0:
		family_index = 0
	var family_key: String = "" if family_index < 0 else FAMILIES[family_index]

	if asset_kind == PreviewAssetKind.COIN:
		var coin: PusherCoin = COIN_SCENE.instantiate() as PusherCoin
		if coin == null:
			push_error("YD-7 preview could not instantiate Coin.tscn")
			return
		_current_preview = coin
		_preview_anchor.add_child(coin)
		_prepare_rigid_body(coin)
		coin.apply_skin_family(family_key)
	else:
		var toy: PusherToy = TOY_SCENE.instantiate() as PusherToy
		if toy == null:
			push_error("YD-7 preview could not instantiate Toy.tscn")
			return
		toy.toy_family = family_key
		_current_preview = toy
		_preview_anchor.add_child(toy)
		_prepare_rigid_body(toy)

	_status_text = ""
	_update_label()
	call_deferred("_frame_current_preview")


func _prepare_rigid_body(body: RigidBody3D) -> void:
	body.freeze = true
	body.gravity_scale = 0.0
	body.collision_layer = 0
	body.collision_mask = 0


func _frame_current_preview() -> void:
	if not is_instance_valid(_current_preview):
		return

	_current_preview.position = Vector3.ZERO
	_current_preview.rotation = Vector3.ZERO
	_current_preview.scale = Vector3.ONE

	var bounds: AABB = _combined_local_bounds(_current_preview)
	if bounds.size == Vector3.ZERO:
		return

	var largest_dimension: float = maxf(bounds.size.x, maxf(bounds.size.y, bounds.size.z))
	if largest_dimension <= 0.001:
		return

	var target_dimension: float = 1.45 if asset_kind == PreviewAssetKind.COIN else 1.85
	var scale_factor: float = target_dimension / largest_dimension
	_current_preview.scale = Vector3.ONE * scale_factor

	var scaled_bounds: AABB = _combined_local_bounds(_current_preview)
	var center: Vector3 = scaled_bounds.position + scaled_bounds.size * 0.5
	_current_preview.position.x -= center.x
	_current_preview.position.z -= center.z
	_current_preview.position.y += 0.30 - scaled_bounds.position.y


func _combined_local_bounds(root: Node3D) -> AABB:
	var meshes: Array[MeshInstance3D] = []
	_collect_meshes(root, meshes)
	if meshes.is_empty():
		return AABB()

	var root_inverse: Transform3D = root.global_transform.affine_inverse()
	var found: bool = false
	var combined: AABB = AABB()

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

	return combined if found else AABB()


func _collect_meshes(node: Node, output: Array[MeshInstance3D]) -> void:
	for child: Node in node.get_children():
		if child is MeshInstance3D:
			output.append(child as MeshInstance3D)
		_collect_meshes(child, output)


func _cycle_family(direction: int) -> void:
	var state_count: int = FAMILIES.size() + 1
	var state_index: int = family_index + 1
	state_index = posmod(state_index + direction, state_count)
	family_index = state_index - 1
	if asset_kind == PreviewAssetKind.TOY and family_index < 0:
		family_index = FAMILIES.size() - 1 if direction < 0 else 0
	_spawn_preview()


func _set_family_index(index: int) -> void:
	family_index = clampi(index, -1, FAMILIES.size() - 1)
	if asset_kind == PreviewAssetKind.TOY and family_index < 0:
		family_index = 0
	_spawn_preview()


func _asset_label() -> String:
	return "Coin Skin" if asset_kind == PreviewAssetKind.COIN else "Gameplay Toy"


func _update_label() -> void:
	if _info_label == null:
		return

	var family_label: String = "Default YES" if family_index < 0 else FAMILY_LABELS[family_index]
	var lines: PackedStringArray = PackedStringArray([
		"YD-7 ASSET PREVIEW",
		"%s — %s" % [family_label, _asset_label()],
		"Left/Right family   0 default YES   1-5 skins   C coin   T toy   Space toggle   R spin   S screenshot",
	])
	if not _status_text.is_empty():
		lines.append(_status_text)
	_info_label.text = "\n".join(lines)


func _capture_preview() -> void:
	if _info_label != null:
		_info_label.visible = false

	await RenderingServer.frame_post_draw

	var image: Image = get_viewport().get_texture().get_image()
	var output_dir: String = "user://yd7_previews"
	var absolute_dir: String = ProjectSettings.globalize_path(output_dir)
	var mkdir_error: int = DirAccess.make_dir_recursive_absolute(absolute_dir)
	if mkdir_error != OK and mkdir_error != ERR_ALREADY_EXISTS:
		_status_text = "Screenshot failed: could not create %s" % absolute_dir
		if _info_label != null:
			_info_label.visible = true
		_update_label()
		return

	var kind_slug: String = "coin" if asset_kind == PreviewAssetKind.COIN else "toy"
	var family_slug: String = "yes_default" if family_index < 0 else FAMILIES[family_index]
	var filename: String = "%s_%s.png" % [family_slug, kind_slug]
	var output_path: String = output_dir.path_join(filename)
	var save_error: int = image.save_png(output_path)

	if _info_label != null:
		_info_label.visible = true

	if save_error == OK:
		_status_text = "Saved %s" % ProjectSettings.globalize_path(output_path)
	else:
		_status_text = "Screenshot failed with error %s" % str(save_error)
	_update_label()