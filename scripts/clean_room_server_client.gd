extends YokefellowServerClient
class_name YesDropCleanRoomServerClient

# Clean-room skin milestones are keyed by the lifetime YES threshold itself.
# That makes each threshold idempotent per wallet even if settlement is retried.
func submit_skin_milestone(wallet: String, turn_id: String, milestone_threshold_yes: int, legacy_lifetime_coins_paid_out: int) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow skin settlement is not configured.")
	if milestone_threshold_yes <= 0:
		return _failure("A positive lifetime YES skin milestone is required.")
	if catalog.is_empty():
		var catalog_result := await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var ordinal := _skin_milestone_ordinal(milestone_threshold_yes)
	var request_id := "yes-drop:wallet:%s:skin-lifetime-yes:%d" % [wallet.to_lower(), milestone_threshold_yes]
	var response := await _execute_action_path(
		SKIN_DROP_PATH,
		wallet,
		request_id,
		"",
		{},
		{
			"turnId": turn_id,
			"milestoneNumber": ordinal,
			"milestoneThresholdYes": milestone_threshold_yes,
			"milestoneEvery": 100,
			"lifetimeYes": milestone_threshold_yes,
			# Keep the prior metric available to existing Path result trees while
			# making lifetime YES the authoritative milestone basis.
			"lifetimeCoinsPaidOut": legacy_lifetime_coins_paid_out,
		},
		{
			"source": app_slug,
			"milestoneBasis": "lifetime_yes",
			"milestoneScheduleVersion": 2,
		}
	)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var family := _selected_family_from_action_path_body(body)
	if family.is_empty():
		# The mint itself is authoritative even when the Action Path response does
		# not expose a locally recognized presentation family. Never retry it.
		response["skinResult"] = {
			"resultType": "minted",
			"mintStatus": "completed",
			"txHash": _first_action_tx_hash(body),
		}
		return response
	var selected_class_id := String(class_id_by_family.get(family, ""))
	response["skinResult"] = {
		"selectedClassId": selected_class_id,
		"classId": selected_class_id,
		"resultType": "minted",
		"mintStatus": "completed",
		"imageUrl": String(skin_image_url_by_family.get(family, "")),
		"txHash": _first_action_tx_hash(body),
	}
	return response

func _skin_milestone_ordinal(threshold_yes: int) -> int:
	match threshold_yes:
		10:
			return 1
		25:
			return 2
		50:
			return 3
	if threshold_yes >= 100 and threshold_yes % 100 == 0:
		return 3 + threshold_yes / 100
	return 0
