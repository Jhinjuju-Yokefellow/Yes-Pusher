extends Node
class_name YokefellowServerClient

signal catalog_loaded(catalog: Dictionary)
signal integration_error(message: String)

const DEFAULT_SKIN_ACTION := "yes_pusher.skin_drop"
const DEFAULT_TOY_ACTION := "yes_pusher.toy_caught"
const DEFAULT_TURN_CAPTURE_ACTION := "yes_drop.turn.capture"
const DEFAULT_TURN_PAYOUT_ACTION := "yes_drop.turn.payout"
const DEFAULT_SKIN_OFFERING := "Coin Skin Drop"
const DEFAULT_TOY_OFFERING := "Catch a Toy"
const TERMINAL_ACTION_STATUSES := ["confirmed", "recovered", "readable", "projected", "indexed"]

var network_base_url: String = ""
var bucket_id: String = ""
var app_api_key: String = ""
var turn_capture_action_key: String = DEFAULT_TURN_CAPTURE_ACTION
var turn_payout_action_key: String = DEFAULT_TURN_PAYOUT_ACTION
var skin_action_key: String = DEFAULT_SKIN_ACTION
var toy_action_key: String = DEFAULT_TOY_ACTION
var skin_offering_name: String = DEFAULT_SKIN_OFFERING
var toy_offering_name: String = DEFAULT_TOY_OFFERING
var turn_price_yes_raw: String = ""
var yes_per_payout_raw: String = "1000000000000000000"
var allow_unverified_wallets: bool = false
var test_free_turns: bool = false

var catalog: Dictionary = {}
var class_id_by_family: Dictionary = {}
var class_key_by_family: Dictionary = {}
var skin_image_url_by_family: Dictionary = {}
var toy_class_id_by_family: Dictionary = {}
var toy_class_key_by_family: Dictionary = {}
var toy_title_by_family: Dictionary = {}
var toy_image_url_by_family: Dictionary = {}
var class_meta_by_id: Dictionary = {}

func _ready() -> void:
	load_from_environment()

func load_from_environment() -> void:
	network_base_url = _normalize_network_base(OS.get_environment("YF_NETWORK_BASE_URL"))
	bucket_id = OS.get_environment("YF_NETWORK_BUCKET_ID").strip_edges().to_lower()
	app_api_key = OS.get_environment("YF_NETWORK_APP_API_KEY").strip_edges()
	turn_capture_action_key = _env_or("YES_DROP_TURN_CAPTURE_ACTION_KEY", DEFAULT_TURN_CAPTURE_ACTION)
	turn_payout_action_key = _env_or("YES_DROP_TURN_PAYOUT_ACTION_KEY", DEFAULT_TURN_PAYOUT_ACTION)
	skin_action_key = _env_or("YES_DROP_SKIN_ACTION_KEY", DEFAULT_SKIN_ACTION)
	toy_action_key = _env_or("YES_DROP_TOY_ACTION_KEY", DEFAULT_TOY_ACTION)
	skin_offering_name = _env_or("YES_PUSHER_SKIN_DROP_OFFERING_NAME", DEFAULT_SKIN_OFFERING)
	toy_offering_name = _env_or("YES_PUSHER_TOY_OFFERING_NAME", DEFAULT_TOY_OFFERING)
	turn_price_yes_raw = OS.get_environment("YES_PUSHER_TURN_PRICE_YES_RAW").strip_edges()
	yes_per_payout_raw = _env_or("YES_PUSHER_YES_PER_PAYOUT_RAW", "1000000000000000000")
	allow_unverified_wallets = _env_bool("YES_PUSHER_ALLOW_UNVERIFIED_WALLETS", false)
	test_free_turns = _env_bool("YES_PUSHER_TEST_FREE_TURNS", false)

func integration_ready() -> bool:
	return (
		not network_base_url.is_empty()
		and not bucket_id.is_empty()
		and not app_api_key.is_empty()
		and app_api_key.begins_with("yfk_")
	)

func paid_turns_ready() -> bool:
	if test_free_turns:
		return true
	return integration_ready() and _positive_integer_string(turn_price_yes_raw)

func load_catalog(_wallet: String = "") -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network is not configured.")
	var url := "%s/v1/actions/capabilities?bucketId=%s" % [
		network_base_url,
		bucket_id.uri_encode(),
	]
	var response: Dictionary = await _request_json(
		HTTPClient.METHOD_GET,
		url,
		{}
	)
	if not bool(response.get("ok", false)):
		return response
	var body_value: Variant = response.get("body", {})
	var body: Dictionary = body_value as Dictionary if body_value is Dictionary else {}
	catalog = body.duplicate(true)
	_resolve_capabilities(body)
	catalog_loaded.emit(catalog)
	return response

func verify_wallet_session(wallet: String, session_token: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	if allow_unverified_wallets:
		return {"ok": true, "wallet": normalized, "mode": "unverified_test"}
	if not integration_ready():
		return _failure("Yokefellow Network participant verification is not configured.")
	if session_token.strip_edges().is_empty():
		return _failure("A Yokefellow Network participant session is required.")
	var response: Dictionary = await _request_json(
		HTTPClient.METHOD_POST,
		"%s/v1/participants/verify" % network_base_url,
		{
			"bucketId": bucket_id,
			"wallet": normalized,
			"participantSessionToken": session_token,
		}
	)
	if not bool(response.get("ok", false)):
		return response
	var body_value: Variant = response.get("body", {})
	var body: Dictionary = body_value as Dictionary if body_value is Dictionary else {}
	var session_value: Variant = body.get("session", {})
	var session: Dictionary = session_value as Dictionary if session_value is Dictionary else {}
	var verified_wallet := String(session.get("wallet", normalized)).strip_edges().to_lower()
	if verified_wallet != normalized:
		return _failure("The Yokefellow Network participant session belongs to a different wallet.")
	return {
		"ok": true,
		"wallet": normalized,
		"mode": "network",
		"assurance": String(session.get("assurance", "WALLET_AUTHORIZED")),
		"expiresAt": String(session.get("expiresAt", "")),
	}

func wallet_skin_families(wallet: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	if class_meta_by_id.is_empty():
		var catalog_result: Dictionary = await load_catalog(normalized)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var holdings_result: Dictionary = await load_wallet_entitlements(normalized)
	if not bool(holdings_result.get("ok", false)):
		return holdings_result
	var body_value: Variant = holdings_result.get("body", {})
	var body: Dictionary = body_value as Dictionary if body_value is Dictionary else {}
	var holdings_value: Variant = body.get("holdings", [])
	var families: Array[String] = []
	if holdings_value is Array:
		for holding_value in holdings_value:
			if not (holding_value is Dictionary):
				continue
			var holding: Dictionary = holding_value as Dictionary
			var class_id := String(holding.get("classId", "")).strip_edges().to_lower()
			var family := family_for_class_id(class_id)
			if not family.is_empty() and not families.has(family):
				families.append(family)
	return {"ok": true, "families": families, "body": body}

func load_wallet_entitlements(wallet: String) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network NFT holdings are not configured.")
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	var url := "%s/v1/nfts/buckets/%s/holdings/%s?limit=200" % [
		network_base_url,
		bucket_id.uri_encode(),
		normalized.uri_encode(),
	]
	return await _request_json(HTTPClient.METHOD_GET, url, {})

func load_player_presentation(wallet: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return {
			"ok": false,
			"wallet": normalized,
			"profile": {},
			"toys": [],
			"errors": ["Invalid wallet."],
		}
	if class_meta_by_id.is_empty():
		await load_catalog(normalized)
	var holdings_result: Dictionary = await load_wallet_entitlements(normalized)
	var toys: Array[Dictionary] = []
	if bool(holdings_result.get("ok", false)):
		var body_value: Variant = holdings_result.get("body", {})
		var body: Dictionary = body_value as Dictionary if body_value is Dictionary else {}
		var holdings_value: Variant = body.get("holdings", [])
		if holdings_value is Array:
			for holding_value in holdings_value:
				if not (holding_value is Dictionary):
					continue
				var holding: Dictionary = holding_value as Dictionary
				var class_id := String(holding.get("classId", "")).strip_edges().to_lower()
				var meta_value: Variant = class_meta_by_id.get(class_id, {})
				if not (meta_value is Dictionary):
					continue
				var meta: Dictionary = meta_value as Dictionary
				if String(meta.get("kind", "")) != "toy":
					continue
				var quantity := maxi(0, int(String(holding.get("quantity", "0"))))
				if quantity <= 0:
					continue
				toys.append({
					"family": String(meta.get("family", "")),
					"tier": String(meta.get("tier", "small")),
					"quantity": quantity,
					"classId": class_id,
					"classKey": String(meta.get("classKey", "")),
					"imageUrl": String(meta.get("imageUrl", "")),
				})
	var short_wallet := "%s…%s" % [normalized.left(6), normalized.right(4)]
	return {
		"ok": true,
		"wallet": normalized,
		"profile": {
			"displayName": "Player %s" % short_wallet,
			"display_name": "Player %s" % short_wallet,
			"handle": "",
			"avatarUrl": "",
			"avatar_url": "",
			"profile_picture_url": "",
			"cardSettings": {},
			"featuredOutputs": [],
		},
		"toys": toys,
		"errors": [],
	}

func spend_turn_credit(wallet: String, turn_id: String, participant_session_token: String = "") -> Dictionary:
	if test_free_turns:
		return {"ok": true, "freeTestTurn": true, "amountYesRaw": "0"}
	if not paid_turns_ready():
		return _failure("Paid turns are not configured in Yokefellow Network.")
	if participant_session_token.strip_edges().is_empty():
		return _failure("The paid turn requires the player's Yokefellow Network session.")
	var reference := "yes-drop:turn:%s:capture" % turn_id
	var result: Dictionary = await _invoke_action(
		turn_capture_action_key,
		reference,
		wallet,
		participant_session_token,
		{"amount": turn_price_yes_raw}
	)
	if bool(result.get("ok", false)):
		result["amountYesRaw"] = turn_price_yes_raw
	return result

func grant_turn_winnings(wallet: String, turn_id: String, payout_yes: int) -> Dictionary:
	if payout_yes <= 0:
		return {"ok": true, "skipped": "no_payout", "amountYesRaw": "0"}
	if not integration_ready():
		return _failure("Yokefellow Network winnings settlement is not configured.")
	var amount_raw := _multiply_integer_strings(str(payout_yes), yes_per_payout_raw)
	var reference := "yes-drop:turn:%s:payout" % turn_id
	var result: Dictionary = await _invoke_action(
		turn_payout_action_key,
		reference,
		wallet,
		"",
		{"amount": amount_raw}
	)
	if bool(result.get("ok", false)):
		result["amountYesRaw"] = amount_raw
	return result

func submit_skin_milestone(
	wallet: String,
	turn_id: String,
	milestone_number: int,
	lifetime_coins_paid_out: int
) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network skin settlement is not configured.")
	if class_meta_by_id.is_empty():
		var catalog_result: Dictionary = await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var reference := "yes-drop:skin:%s:%d" % [wallet.to_lower(), milestone_number]
	var result: Dictionary = await _invoke_action(
		skin_action_key,
		reference,
		wallet,
		"",
		{}
	)
	if not bool(result.get("ok", false)):
		return result
	var action_value: Variant = result.get("action", {})
	var action: Dictionary = action_value as Dictionary if action_value is Dictionary else {}
	var action_result_value: Variant = action.get("result", {})
	var action_result: Dictionary = action_result_value as Dictionary if action_result_value is Dictionary else {}
	var selected_value: Variant = action_result.get("selected", {})
	var selected: Dictionary = selected_value as Dictionary if selected_value is Dictionary else {}
	var selected_class_id := String(selected.get("classId", "")).strip_edges().to_lower()
	if selected_class_id.is_empty():
		return _failure("Yokefellow Network confirmed the Skin result without a selected Class.")
	var minted := _first_minted_asset(action_result)
	var completed_result := {
		"resultType": "minted",
		"mintStatus": String(action.get("status", "confirmed")),
		"selectedClassId": selected_class_id,
		"classId": selected_class_id,
		"classKey": String(_class_key_for_id(selected_class_id)),
		"txHash": String(action.get("transactionHash", "")),
		"tokenId": String(minted.get("tokenId", "")),
		"imageUrl": skin_image_url_for_class_id(selected_class_id),
		"milestoneNumber": milestone_number,
		"lifetimeCoinsPaidOut": lifetime_coins_paid_out,
		"turnId": turn_id,
	}
	result["skinResult"] = completed_result
	return result

func submit_toy_caught(
	wallet: String,
	turn_id: String,
	toy_instance_id: String,
	toy_family: String,
	power_result: Dictionary = {}
) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network toy settlement is not configured.")
	var family := _family_from_loose_text(toy_family)
	if family.is_empty():
		return _failure("The caught toy family is not recognized.")
	if class_meta_by_id.is_empty():
		var catalog_result: Dictionary = await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var reference := "yes-drop:turn:%s:toy:%s" % [turn_id, toy_instance_id]
	var result: Dictionary = await _invoke_action(
		toy_action_key,
		reference,
		wallet,
		"",
		{"selectionKey": family}
	)
	if not bool(result.get("ok", false)):
		return result
	var action_value: Variant = result.get("action", {})
	var action: Dictionary = action_value as Dictionary if action_value is Dictionary else {}
	var action_result_value: Variant = action.get("result", {})
	var action_result: Dictionary = action_result_value as Dictionary if action_result_value is Dictionary else {}
	var selected_value: Variant = action_result.get("selected", {})
	var selected: Dictionary = selected_value as Dictionary if selected_value is Dictionary else {}
	var selected_class_id := String(selected.get("classId", "")).strip_edges().to_lower()
	if selected_class_id.is_empty():
		return _failure("Yokefellow Network confirmed the Toy result without a selected Class.")
	var minted := _first_minted_asset(action_result)
	var completed_result := {
		"resultType": "minted",
		"mintStatus": String(action.get("status", "confirmed")),
		"selectedClassId": selected_class_id,
		"classId": selected_class_id,
		"classKey": String(_class_key_for_id(selected_class_id)),
		"classTitle": "%s Toy" % _family_display_name(family),
		"toyFamily": family,
		"txHash": String(action.get("transactionHash", "")),
		"tokenId": String(minted.get("tokenId", "")),
		"imageUrl": toy_image_url_for_class_id(selected_class_id),
		"turnId": turn_id,
		"toyInstanceId": toy_instance_id,
		"powerResult": power_result.duplicate(true),
	}
	result["toyResult"] = completed_result
	return result

func publish_app_event(
	event_type: String,
	reference_id: String,
	wallet: String = "",
	data: Dictionary = {}
) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network App events are not configured.")
	var participant: Variant = null
	if _is_wallet(wallet.strip_edges().to_lower()):
		participant = {"wallet": wallet.strip_edges().to_lower()}
	return await _request_json(
		HTTPClient.METHOD_POST,
		"%s/v1/app-events" % network_base_url,
		{
			"bucketId": bucket_id,
			"type": event_type,
			"referenceId": reference_id,
			"schemaVersion": 1,
			"participant": participant,
			"data": data,
		}
	)

func _invoke_action(
	action_key: String,
	reference_id: String,
	wallet: String,
	participant_session_token: String,
	data: Dictionary
) -> Dictionary:
	if action_key.strip_edges().is_empty():
		return _failure("A Yokefellow Network action key is missing.")
	var normalized_wallet := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized_wallet):
		return _failure("A valid participant wallet is required.")
	var body := {
		"bucketId": bucket_id,
		"key": action_key,
		"referenceId": reference_id,
		"participant": {"wallet": normalized_wallet},
		"data": data.duplicate(true),
	}
	if not participant_session_token.strip_edges().is_empty():
		body["participantSessionToken"] = participant_session_token.strip_edges()
	var response: Dictionary = await _request_json(
		HTTPClient.METHOD_POST,
		"%s/v1/actions/invoke" % network_base_url,
		body,
		60.0
	)
	if not bool(response.get("ok", false)):
		return response
	var response_body_value: Variant = response.get("body", {})
	var response_body: Dictionary = response_body_value as Dictionary if response_body_value is Dictionary else {}
	var action_value: Variant = response_body.get("action", {})
	var action: Dictionary = action_value as Dictionary if action_value is Dictionary else {}
	var status := String(action.get("status", "")).strip_edges().to_lower()
	if status == "failed":
		return _failure(_action_error(action, "Yokefellow Network action failed."), int(response.get("status", 0)), response_body)
	if not TERMINAL_ACTION_STATUSES.has(status):
		var action_id := String(action.get("actionId", "")).strip_edges()
		if not action_id.is_empty():
			var reconcile: Dictionary = await _request_json(
				HTTPClient.METHOD_POST,
				"%s/v1/actions/%s/reconcile" % [network_base_url, action_id.uri_encode()],
				{},
				30.0
			)
			if bool(reconcile.get("ok", false)):
				var reconcile_body_value: Variant = reconcile.get("body", {})
				var reconcile_body: Dictionary = reconcile_body_value as Dictionary if reconcile_body_value is Dictionary else {}
				var reconciled_value: Variant = reconcile_body.get("action", {})
				if reconciled_value is Dictionary:
					action = reconciled_value as Dictionary
					status = String(action.get("status", "")).strip_edges().to_lower()
	if status == "failed":
		return _failure(_action_error(action, "Yokefellow Network action failed."), int(response.get("status", 0)), response_body)
	if not TERMINAL_ACTION_STATUSES.has(status):
		return _failure(
			_action_error(action, "Yokefellow Network reconciliation is still required."),
			int(response.get("status", 0)),
			{"action": action}
		)
	return {
		"ok": true,
		"status": int(response.get("status", 200)),
		"body": response_body,
		"action": action,
		"reused": bool(response_body.get("reused", false)),
	}

func _resolve_capabilities(value: Dictionary) -> void:
	class_id_by_family.clear()
	class_key_by_family.clear()
	skin_image_url_by_family.clear()
	toy_class_id_by_family.clear()
	toy_class_key_by_family.clear()
	toy_title_by_family.clear()
	toy_image_url_by_family.clear()
	class_meta_by_id.clear()
	var capabilities_value: Variant = value.get("capabilities", [])
	if not (capabilities_value is Array):
		return
	for capability_value in capabilities_value:
		if not (capability_value is Dictionary):
			continue
		var capability: Dictionary = capability_value as Dictionary
		var descriptor_value: Variant = capability.get("descriptor", {})
		var descriptor: Dictionary = descriptor_value as Dictionary if descriptor_value is Dictionary else {}
		_register_class_descriptor(
			descriptor.get("asset", {}),
			String(descriptor.get("classKey", "")),
			""
		)
		var results_value: Variant = descriptor.get("results", [])
		if results_value is Array:
			for result_value in results_value:
				if not (result_value is Dictionary):
					continue
				var result: Dictionary = result_value as Dictionary
				_register_class_descriptor(
					result.get("asset", {}),
					String(result.get("classKey", result.get("externalOutputKey", ""))),
					String(result.get("externalOutputKey", ""))
				)
		var craft_inputs_value: Variant = descriptor.get("craftInputs", [])
		if craft_inputs_value is Array:
			for input_value in craft_inputs_value:
				if not (input_value is Dictionary):
					continue
				var input: Dictionary = input_value as Dictionary
				_register_class_descriptor(
					input.get("asset", {}),
					String(input.get("classKey", "")),
					""
				)

func _register_class_descriptor(asset_value: Variant, class_key: String, selection_key: String) -> void:
	if not (asset_value is Dictionary):
		return
	var asset: Dictionary = asset_value as Dictionary
	var class_id := String(asset.get("classId", "")).strip_edges().to_lower()
	if class_id.is_empty():
		return
	var family := _family_from_loose_text("%s %s" % [class_key, selection_key])
	if family.is_empty():
		return
	var tier := _toy_tier_from_class(class_key, selection_key)
	var kind := "toy" if not tier.is_empty() else "skin"
	class_meta_by_id[class_id] = {
		"family": family,
		"tier": tier,
		"kind": kind,
		"classKey": class_key,
		"imageUrl": "",
	}
	if kind == "skin":
		class_id_by_family[family] = class_id
		class_key_by_family[family] = class_key
	elif tier == "small":
		toy_class_id_by_family[family] = class_id
		toy_class_key_by_family[family] = class_key
		toy_title_by_family[family] = "%s Toy" % _family_display_name(family)
		toy_image_url_by_family[family] = ""

func family_for_class_id(class_id: String) -> String:
	var normalized := class_id.strip_edges().to_lower()
	var meta_value: Variant = class_meta_by_id.get(normalized, {})
	if meta_value is Dictionary:
		var meta: Dictionary = meta_value as Dictionary
		if String(meta.get("kind", "")) == "skin":
			return String(meta.get("family", ""))
	return ""

func skin_image_url_for_class_id(class_id: String) -> String:
	var family := family_for_class_id(class_id)
	return String(skin_image_url_by_family.get(family, "")).strip_edges()

func toy_image_url_for_class_id(class_id: String) -> String:
	var family := toy_family_for_class_id(class_id)
	return String(toy_image_url_by_family.get(family, "")).strip_edges()

func toy_family_for_class_id(class_id: String) -> String:
	var normalized := class_id.strip_edges().to_lower()
	var meta_value: Variant = class_meta_by_id.get(normalized, {})
	if meta_value is Dictionary:
		var meta: Dictionary = meta_value as Dictionary
		if String(meta.get("kind", "")) == "toy":
			return String(meta.get("family", ""))
	return ""

func _class_key_for_id(class_id: String) -> String:
	var normalized := class_id.strip_edges().to_lower()
	var meta_value: Variant = class_meta_by_id.get(normalized, {})
	if meta_value is Dictionary:
		return String((meta_value as Dictionary).get("classKey", ""))
	return ""

func _first_minted_asset(action_result: Dictionary) -> Dictionary:
	var issuance_value: Variant = action_result.get("issuance", {})
	if not (issuance_value is Dictionary):
		return {}
	var issuance: Dictionary = issuance_value as Dictionary
	var result_value: Variant = issuance.get("result", {})
	if not (result_value is Dictionary):
		return {}
	var result: Dictionary = result_value as Dictionary
	var minted_value: Variant = result.get("minted", [])
	if minted_value is Array and not (minted_value as Array).is_empty():
		var first: Variant = (minted_value as Array)[0]
		if first is Dictionary:
			return (first as Dictionary).duplicate(true)
	return {}

func _action_error(action: Dictionary, fallback: String) -> String:
	var error_value: Variant = action.get("error", {})
	if error_value is Dictionary:
		var error: Dictionary = error_value as Dictionary
		var message := String(error.get("message", error.get("code", fallback))).strip_edges()
		if not message.is_empty():
			return message
	return fallback

func _family_from_class_key(class_key: String) -> String:
	return _family_from_loose_text(class_key)

func _family_from_loose_text(value: String) -> String:
	var normalized := value.strip_edges().to_lower().replace("-", "_").replace(" ", "_").replace(".", "_").replace("/", "_")
	if normalized.contains("four_leaf_clover") or normalized.contains("fourleafclover") or normalized.contains("clover"):
		return "four_leaf_clover"
	if normalized.contains("pot_of_gold") or normalized.contains("potofgold"):
		return "pot_of_gold"
	if normalized.contains("treasure_chest") or normalized.contains("treasurechest"):
		return "treasure_chest"
	if normalized.contains("horseshoe"):
		return "horseshoe"
	if normalized.contains("leprechaun"):
		return "leprechaun"
	return ""

func _toy_tier_from_class(class_key: String, class_title: String) -> String:
	var normalized := ("%s %s" % [class_key, class_title]).strip_edges().to_lower().replace("-", "_").replace(" ", "_").replace(".", "_").replace("/", "_")
	if normalized.contains("_l3") or normalized.ends_with("l3") or normalized.contains("level_3") or normalized.contains("large"):
		return "large"
	if normalized.contains("_l2") or normalized.ends_with("l2") or normalized.contains("level_2") or normalized.contains("medium"):
		return "medium"
	if normalized.contains("_l1") or normalized.ends_with("l1") or normalized.contains("level_1") or normalized.contains("small"):
		return "small"
	return ""

func _family_display_name(family: String) -> String:
	match family:
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

func _request_json(
	method: int,
	url: String,
	body: Dictionary,
	timeout_seconds: float = 20.0
) -> Dictionary:
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = timeout_seconds
	var headers := PackedStringArray(["Accept: application/json"])
	if method != HTTPClient.METHOD_GET:
		headers.append("Content-Type: application/json")
	if not app_api_key.is_empty():
		headers.append("Authorization: Bearer %s" % app_api_key)
	var payload := "" if method == HTTPClient.METHOD_GET else JSON.stringify(body)
	var start_error := request.request(url, headers, method, payload)
	if start_error != OK:
		request.queue_free()
		return _failure("Yokefellow Network request could not start: %s" % error_string(start_error))
	var completed: Array = await request.request_completed
	request.queue_free()
	var transport_result := int(completed[0])
	var response_code := int(completed[1])
	var response_bytes: PackedByteArray = completed[3]
	var text := response_bytes.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text)
	var parsed_body: Dictionary = parsed as Dictionary if parsed is Dictionary else {}
	if transport_result != HTTPRequest.RESULT_SUCCESS:
		return _failure(
			"Yokefellow Network request failed before receiving a response.",
			response_code,
			parsed_body
		)
	if response_code < 200 or response_code >= 300:
		return _failure(
			_error_message(parsed_body, "Yokefellow Network returned HTTP %d." % response_code),
			response_code,
			parsed_body
		)
	return {"ok": true, "status": response_code, "body": parsed_body}

func _error_message(body: Dictionary, fallback: String) -> String:
	var value: Variant = body.get("error", body.get("message", fallback))
	if value is Dictionary:
		return String((value as Dictionary).get("message", fallback))
	var text := String(value).strip_edges()
	return text if not text.is_empty() else fallback

func _failure(message: String, status: int = 0, body: Dictionary = {}) -> Dictionary:
	integration_error.emit(message)
	return {
		"ok": false,
		"error": message,
		"status": status,
		"body": body,
	}

func _normalize_network_base(value: String) -> String:
	var base := value.strip_edges().trim_suffix("/")
	if base.is_empty():
		return ""
	return base

func _env_or(name: String, fallback: String) -> String:
	var value := OS.get_environment(name).strip_edges()
	return value if not value.is_empty() else fallback

func _env_bool(name: String, fallback: bool) -> bool:
	var value := OS.get_environment(name).strip_edges().to_lower()
	if value.is_empty():
		return fallback
	return value in ["1", "true", "yes", "on"]

func _positive_integer_string(value: String) -> bool:
	var normalized := value.strip_edges()
	if normalized.is_empty():
		return false
	var has_nonzero := false
	for index in range(normalized.length()):
		var code := normalized.unicode_at(index)
		if code < 48 or code > 57:
			return false
		if code != 48:
			has_nonzero = true
	return has_nonzero

func _multiply_integer_strings(left: String, right: String) -> String:
	var a := left.strip_edges()
	var b := right.strip_edges()
	if a.is_empty() or b.is_empty():
		return "0"
	for character in a + b:
		if "0123456789".find(character) == -1:
			return "0"
	if a == "0" or b == "0":
		return "0"
	var digits: Array[int] = []
	digits.resize(a.length() + b.length())
	digits.fill(0)
	for a_index in range(a.length() - 1, -1, -1):
		var a_digit := int(a.unicode_at(a_index) - 48)
		for b_index in range(b.length() - 1, -1, -1):
			var b_digit := int(b.unicode_at(b_index) - 48)
			var target := a_index + b_index + 1
			var total := digits[target] + (a_digit * b_digit)
			digits[target] = total % 10
			digits[target - 1] += floori(float(total) / 10.0)
	var output := ""
	var started := false
	for digit in digits:
		if digit != 0 or started:
			started = true
			output += str(digit)
	return output if not output.is_empty() else "0"

func _is_wallet(value: String) -> bool:
	if value.length() != 42 or not value.begins_with("0x"):
		return false
	for index in range(2, value.length()):
		if "0123456789abcdefABCDEF".find(value[index]) == -1:
			return false
	return true
