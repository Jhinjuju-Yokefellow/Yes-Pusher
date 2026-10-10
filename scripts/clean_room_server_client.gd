extends YokefellowServerClient
class_name YesDropCleanRoomServerClient

# Clean-room paid turns fail closed unless Yokefellow returns the confirmed
# collect_yes_payment action and proves that the full configured turn price was captured.
func spend_turn_credit(wallet: String, turn_id: String) -> Dictionary:
	if test_free_turns:
		return {"ok": true, "freeTestTurn": true, "amountYesRaw": "0"}
	if not paid_turns_ready():
		return _failure("Paid turns are blocked until the Yokefellow App connection is configured.")
	var request_id := "yes-drop:turn:%s:spend" % turn_id
	var response := await _execute_action_path(
		TURN_SPEND_PATH,
		wallet,
		request_id,
		"",
		{},
		{"turnId": turn_id},
		{"source": app_slug, "kind": "paid_turn"}
	)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var captured_amount := _confirmed_action_amount(body, "collect_yes_payment")
	if captured_amount != turn_price_yes_raw:
		return _failure(
			"Paid turn capture proof did not confirm the full %s YES base units; the turn was not started." % turn_price_yes_raw,
			int(response.get("status", 0)),
			body
		)
	response["amountYesRaw"] = captured_amount
	return response

func _confirmed_action_amount(body: Dictionary, primitive: String) -> String:
	var actions_value: Variant = body.get("actions", [])
	if not (actions_value is Array):
		return ""
	for action_value in actions_value as Array:
		if not (action_value is Dictionary):
			continue
		var action := action_value as Dictionary
		if String(action.get("primitive", "")).strip_edges() != primitive:
			continue
		if String(action.get("status", "")).strip_edges().to_lower() != "succeeded":
			continue
		var detail_value: Variant = action.get("detail", {})
		if not (detail_value is Dictionary):
			continue
		var result_value: Variant = (detail_value as Dictionary).get("result", {})
		if not (result_value is Dictionary):
			continue
		var amount := String((result_value as Dictionary).get("amount", "")).strip_edges()
		if not amount.is_empty():
			return amount
	return ""

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
		return 3 + floori(float(threshold_yes) / 100.0)
	return 0