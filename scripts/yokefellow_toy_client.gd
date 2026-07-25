extends Node
class_name YokefellowToyClient

# Legacy compatibility shim. The shared authoritative server now owns every
# Yokefellow request and keeps the app key out of player builds. Toy catches are
# settled by the server through the Catch a Toy offering.
signal toy_nft_request_started(toy_family: String)
signal toy_nft_queued(toy_family: String, response: Dictionary)
signal toy_nft_failed(toy_family: String, message: String)
signal toy_nft_skipped(toy_family: String, reason: String)

func load_from_environment() -> void:
	pass

func configure_connection(_base_url: String, _target_bucket_id: String, _api_key: String, _wallet: String) -> void:
	push_warning("Direct client-side Yokefellow configuration is disabled. Configure the authoritative shared server instead.")

func set_wallet(_wallet: String) -> void:
	pass

func set_toy_route(_toy_family: String, _offering_id: String, _output_id: String = "") -> void:
	pass

func submit_toy_captured(
	toy_family: String,
	_toy_instance_id: String,
	_turn_id: int,
	_power_result: Dictionary
) -> void:
	toy_nft_skipped.emit(toy_family, "Direct client submission is disabled; the authoritative server settles Catch a Toy after the turn.")
