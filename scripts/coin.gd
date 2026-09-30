extends RigidBody3D
class_name PusherCoin

@export var coin_value: int = 1

const DEFAULT_SKIN_TEXTURE_PATH: String = "res://assets/coin_skins/yes_default.webp"

const FAMILY_SKIN_TEXTURE_PATHS: Dictionary = {
	"horseshoe": "res://assets/coin_skins/horseshoe.webp",
	"four_leaf_clover": "res://assets/coin_skins/four_leaf_clover.webp",
	"leprechaun": "res://assets/coin_skins/leprechaun.webp",
	"pot_of_gold": "res://assets/coin_skins/pot_of_gold.webp",
	"treasure_chest": "res://assets/coin_skins/treasure_chest.webp",
}

var _skin_family: String = ""
var _skin_faces: Node3D
var _base_material: Material
var _active_skin_texture_path: String = DEFAULT_SKIN_TEXTURE_PATH
var _using_fallback_skin: bool = false


func _ready() -> void:
	add_to_group("coins")
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 8
	can_sleep = true

	var base_mesh: MeshInstance3D = get_node_or_null("Mesh") as MeshInstance3D
	if base_mesh != null:
		_base_material = base_mesh.material_override

	_rebuild_skin()


func mark_seed_coin() -> void:
	set_meta("seed_coin", true)


func is_seed_coin() -> bool:
	return bool(get_meta("seed_coin", false))


func apply_skin_family(skin_family: String) -> bool:
	var normalized: String = skin_family.strip_edges().to_lower()

	if normalized.is_empty():
		_skin_family = ""
		set_meta("skin_family", "")
		set_meta("skin_key", "")
		_rebuild_skin()
		return true

	if not _is_valid_skin_family(normalized):
		push_warning("Unknown YES DROP coin skin family: %s" % skin_family)
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


func get_active_skin_texture_path() -> String:
	return _active_skin_texture_path


func is_using_fallback_skin() -> bool:
	return _using_fallback_skin


func _is_valid_skin_family(value: String) -> bool:
	match value:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return true
	return false


func _skin_key_for_family(value: String) -> String:
	if value.is_empty():
		return ""
	return "yes_pusher.%s" % value


func _texture_path_for_family(value: String) -> String:
	if value.is_empty():
		return DEFAULT_SKIN_TEXTURE_PATH

	var configured: Variant = FAMILY_SKIN_TEXTURE_PATHS.get(value, DEFAULT_SKIN_TEXTURE_PATH)
	return str(configured)


func _rebuild_skin() -> void:
	if is_instance_valid(_skin_faces):
		_skin_faces.queue_free()
	_skin_faces = null

	var base_mesh: MeshInstance3D = get_node_or_null("Mesh") as MeshInstance3D
	if base_mesh == null:
		return

	if _base_material != null:
		base_mesh.material_override = _base_material

	var requested_path: String = _texture_path_for_family(_skin_family)
	var resolved_path: String = requested_path
	_using_fallback_skin = false

	if not ResourceLoader.exists(resolved_path):
		resolved_path = DEFAULT_SKIN_TEXTURE_PATH
		_using_fallback_skin = not _skin_family.is_empty()

	if not ResourceLoader.exists(resolved_path):
		push_error("YES DROP coin skin texture is missing: %s" % resolved_path)
		return

	var loaded_resource: Resource = load(resolved_path)
	var texture: Texture2D = loaded_resource as Texture2D
	if texture == null:
		push_error("YES DROP coin skin did not load as Texture2D: %s" % resolved_path)
		return

	_active_skin_texture_path = resolved_path
	set_meta("skin_texture_path", resolved_path)
	set_meta("skin_texture_fallback", _using_fallback_skin)

	_skin_faces = Node3D.new()
	_skin_faces.name = "SkinFaces"
	add_child(_skin_faces)

	_add_skin_face(_skin_faces, "Top", texture, 0.066, false)
	_add_skin_face(_skin_faces, "Bottom", texture, -0.066, true)


func _add_skin_face(
	parent: Node3D,
	node_name: String,
	texture: Texture2D,
	y_position: float,
	flip_for_bottom: bool
) -> void:
	# PlaneMesh is horizontal in Godot, matching the coin's Y-axis cylinder.
	# Keep the art slightly above the metal face to avoid z-fighting.
	var face: MeshInstance3D = MeshInstance3D.new()
	face.name = "SkinFace%s" % node_name

	var mesh: PlaneMesh = PlaneMesh.new()
	mesh.size = Vector2(0.84, 0.84)
	mesh.subdivide_width = 1
	mesh.subdivide_depth = 1
	face.mesh = mesh

	var material: StandardMaterial3D = StandardMaterial3D.new()
	material.albedo_texture = texture
	material.albedo_color = Color.WHITE
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	# The supplied skin art already contains the intended metal/blue lighting.
	# Unshaded rendering keeps the in-game face visually faithful to that artwork.
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	face.material_override = material

	face.position = Vector3(0.0, y_position, 0.0)
	if flip_for_bottom:
		face.rotation_degrees = Vector3(180.0, 0.0, 0.0)
	parent.add_child(face)
