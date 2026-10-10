extends YesPusherSharedWorld
class_name YesDropCleanRoomSharedWorld

func _presentation_for_wallet(wallet: String, selected_skin: String) -> Dictionary:
	if _presentation_test_mode:
		return super._presentation_for_wallet(wallet, selected_skin)
	return {
		"version": 1,
		"source": "pending_yokefellow",
		"wallet": wallet,
		"profile": {},
		"equipped_skin": {
			"family": selected_skin,
			"label": _skin_display_name(selected_skin) if not selected_skin.is_empty() else "Default YES coin",
		},
		"toys": [],
		"loading": true,
	}
