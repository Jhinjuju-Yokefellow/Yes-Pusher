extends Node
class_name YokefellowServerClient

signal catalog_loaded(catalog: Dictionary)
signal integration_error(message: String)

const DEFAULT_APP_SLUG := "yes-drop"
const DEFAULT_SKIN_OFFERING := "Coin Skin Drop"
const DEFAULT_TOY_OFFERING := "Toy Drop"
const TURN_SPEND_PATH := "yes_drop.turn_spend"
const PAYOUT_PATH := "yes_drop.payout"
const SKIN_DROP_PATH := "yes_drop.skin_drop"
const TOY_DROP_PATH := "yes_drop.toy_drop"

var sdk_base_url: String = ""
var bucket_id: String = ""
var app_api_key: String = ""
var app_slug: String = DEFAULT_APP_SLUG
var skin_offering_name: String = DEFAULT_SKIN_OFFERING
var toy_offering_name: String = DEFAULT_TOY_OFFERING
var turn_price_yes_raw: String = "10000000000000000000"
var yes_per_payout_raw: String = "1000000000000000000"
var session_verify_url: String = ""
var allow_unverified_wallets: bool = false
var test_free_turns: bool = false

# Compatibility cache for callers that still ask the client to "load_catalog".
# Ownership is never sourced from the old catalog/entitlements rails; this cache
# is populated only from the Network-backed holdings SDK read.
var catalog: Dictionary = {}
var bucket_slug: String = ""
var class_id_by_family: Dictionary = {}
var class_key_by_family: Dictionary = {}
var skin_image_url_by_family: Dictionary = {}
var toy_class_id_by_family: Dictionary = {}
var toy_class_key_by_family: Dictionary = {}
var toy_title_by_family: Dictionary = {}
var toy_image_url_by_family: Dictionary = {}

func _ready() -> void:
	load_from_environment()

func load_from_environment() -> void:
	sdk_base_url = _normalize_sdk_base(OS.get_environment("YF_API_BASE_URL"))
	bucket_id = OS.get_environment("YF_BUCKET_ID").strip_edges()
	app_api_key = OS.get_environment("YF_APP_API_KEY").strip_edges()
	if app_api_key.is_empty():
		app_api_key = OS.get_environment("YF_APP_KEY").strip_edges()
	app_slug = _env_or("YES_PUSHER_APP_SLUG", DEFAULT_APP_SLUG)
	skin_offering_name = _env_or("YES_PUSHER_SKIN_DROP_OFFERING_NAME", DEFAULT_SKIN_OFFERING)
	toy_offering_name = _env_or("YES_PUSHER_TOY_OFFERING_NAME", DEFAULT_TOY_OFFERING)
	turn_price_yes_raw = _env_or("YES_PUSHER_TURN_PRICE_YES_RAW", "10000000000000000000")
	yes_per_payout_raw = _env_or("YES_PUSHER_YES_PER_PAYOUT_RAW", "1000000000000000000")
	session_verify_url = OS.get_environment("YF_SESSION_VERIFY_URL").strip_edges().trim_suffix("/")
	allow_unverified_wallets = _env_bool("YES_PUSHER_ALLOW_UNVERIFIED_WALLETS", false)
	test_free_turns = _env_bool("YES_PUSHER_TEST_FREE_TURNS", false)

func integration_ready() -> bool:
	return not sdk_base_url.is_empty() and not bucket_id.is_empty() and not app_api_key.is_empty()

func paid_turns_ready() -> bool:
	return test_free_turns or integration_ready()

# Kept for SharedWorld call compatibility. This no longer touches the legacy
# bucket catalog route. With a wallet it resolves presentation metadata from
# the Network-backed holdings response; without one it only confirms config.
func load_catalog(wallet: String = "") -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow clean-room reads are not configured.")
	var normalized_wallet := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized_wallet):
		return {
			"ok": true,
			"status": 204,
			"body": {
				"ok": true,
				"source": {"ownership": "yokefellow_network_v1_projection"},
			},
		}
	return await load_wallet_holdings(normalized_wallet)

func verify_wallet_session(wallet: String, session_token: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	if allow_unverified_wallets:
		return {"ok": true, "wallet": normalized, "mode": "unverified_test"}
	if session_verify_url.is_empty():
		return _failure("Wallet session verification is not configured on the shared server.")
	if session_token.strip_edges().is_empty():
		return _failure("A signed wallet session is required.")
	var response := await _request_json(
		HTTPClient.METHOD_POST,
		session_verify_url,
		{"wallet": normalized, "sessionToken": session_token},
		""
	)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var verified_wallet := String(body.get("wallet", body.get("walletAddress", ""))).strip_edges().to_lower()
	if not bool(body.get("ok", true)) or verified_wallet != normalized:
		return _failure("The wallet session did not verify for this wallet.")
	return {"ok": true, "wallet": normalized, "mode": "verified"}

func wallet_skin_families(wallet: String) -> Dictionary:
	var response := await load_wallet_holdings(wallet)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var families: Array[String] = []
	var holdings_value: Variant = body.get("holdings", [])
	if holdings_value is Array:
		for holding_value in holdings_value as Array:
			if not (holding_value is Dictionary):
				continue
			var holding := holding_value as Dictionary
			if _holding_quantity(holding) <= 0:
				continue
			var presentation := _holding_presentation(holding)
			var family := _skin_family_from_class_key(String(presentation.get("slug", presentation.get("key", ""))))
			if family.is_empty():
				family = family_for_class_id(String(holding.get("classId", "")))
			if not family.is_empty() and not families.has(family):
				families.append(family)
	return {"ok": true, "families": families, "body": body}

func load_wallet_holdings(wallet: String) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow Network holdings are not configured.")
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	var url := "%s/buckets/%s/holdings/%s" % [
		sdk_base_url,
		bucket_id.uri_encode(),
		normalized.uri_encode(),
	]
	var response := await _request_json(HTTPClient.METHOD_GET, url, {}, "")
	if not bool(response.get("ok", false)):
		return response
	catalog = response.get("body", {}) as Dictionary
	_resolve_catalog(catalog)
	catalog_loaded.emit(catalog)
	return response

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

	var errors: Array[String] = []
	var profile: Dictionary = {}
	var profile_result := await _load_profile_card(normalized)
	if bool(profile_result.get("ok", false)):
		var card_value: Variant = profile_result.get("card", {})
		if card_value is Dictionary:
			profile = (card_value as Dictionary).duplicate(true)
			if not profile.is_empty():
				profile["display_name"] = String(profile.get("displayName", ""))
				profile["avatar_url"] = String(profile.get("avatarUrl", ""))
				profile["profile_picture_url"] = String(profile.get("avatarUrl", ""))
	else:
		errors.append(String(profile_result.get("error", "Profile Card could not be loaded.")))

	var toys: Array[Dictionary] = []
	var holdings_result := await load_wallet_holdings(normalized)
	if bool(holdings_result.get("ok", false)):
		toys = _toy_showcase_from_holdings(holdings_result.get("body", {}) as Dictionary)
	else:
		errors.append(String(holdings_result.get("error", "NFT holdings could not be loaded.")))

	# A valid wallet always returns a usable presentation envelope. Missing
	# Profile Card or projection data stays empty and explicit; it is never
	# replaced with a fabricated Player identity or demo inventory.
	return {
		"ok": true,
		"version": 1,
		"source": "yokefellow_clean_room",
		"wallet": normalized,
		"profile": profile,
		"toys": toys,
		"errors": errors,
	}

func spend_turn_credit(wallet: String, turn_id: String) -> Dictionary:
	if test_free_turns:
		return {"ok": true, "freeTestTurn": true, "amountYesRaw": "0"}
	if not paid_turns_ready():
		return _failure("Paid turns are blocked until the Yokefellow App connection is configured.")
	var request_id := "yes-drop:turn:%s:spend" % turn_id
	return await _execute_action_path(
		TURN_SPEND_PATH,
		wallet,
		request_id,
		"",
		{},
		{"turnId": turn_id},
		{"source": app_slug, "kind": "paid_turn"}
	)

func grant_turn_winnings(wallet: String, turn_id: String, payout_yes: int) -> Dictionary:
	if payout_yes <= 0:
		return {"ok": true, "skipped": "no_payout", "amountYesRaw": "0"}
	if not integration_ready():
		return _failure("Yokefellow winnings settlement is not configured.")
	var amount_raw := _multiply_integer_strings(str(payout_yes), yes_per_payout_raw)
	var request_id := "yes-drop:turn:%s:payout" % turn_id
	return await _execute_action_path(
		PAYOUT_PATH,
		wallet,
		request_id,
		"",
		{"payout_yes": amount_raw},
		{"turnId": turn_id, "payoutYes": payout_yes},
		{"source": app_slug}
	)

func submit_skin_milestone(wallet: String, turn_id: String, milestone_number: int, lifetime_coins_paid_out: int) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow skin settlement is not configured.")
	if catalog.is_empty():
		var catalog_result := await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var request_id := "yes-drop:wallet:%s:skin-payout-100:%d" % [wallet.to_lower(), milestone_number]
	var response := await _execute_action_path(
		SKIN_DROP_PATH,
		wallet,
		request_id,
		"",
		{},
		{
			"turnId": turn_id,
			"milestoneNumber": milestone_number,
			"milestoneEvery": 100,
			"lifetimeCoinsPaidOut": lifetime_coins_paid_out,
		},
		{"source": app_slug, "milestoneBasis": "coins_paid_out"}
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

func submit_toy_caught(wallet: String, turn_id: String, toy_instance_id: String, toy_family: String, power_result: Dictionary = {}) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow toy settlement is not configured.")
	var family := _family_from_loose_text(toy_family)
	if family.is_empty():
		return _failure("The caught toy family is not recognized.")
	if catalog.is_empty():
		var catalog_result := await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	var request_id := "yes-drop:turn:%s:toy:%s:caught" % [turn_id, toy_instance_id]
	var response := await _execute_action_path(
		TOY_DROP_PATH,
		wallet,
		request_id,
		family,
		{},
		{"toyCaught": 1, "turnId": turn_id, "toyFamily": family},
		{
			"source": app_slug,
			"toyInstanceId": toy_instance_id,
			"toyFamily": family,
			"powerResult": power_result.duplicate(true),
		}
	)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var selected_class_id := String(toy_class_id_by_family.get(family, ""))
	response["toyResult"] = {
		"selectedClassId": selected_class_id,
		"classId": selected_class_id,
		"toyFamily": family,
		"classKey": String(toy_class_key_by_family.get(family, "")),
		"classTitle": String(toy_title_by_family.get(family, "%s Toy" % _family_display_name(family))),
		"imageUrl": String(toy_image_url_by_family.get(family, "")),
		"resultType": "minted",
		"mintStatus": "completed",
		"txHash": _first_action_tx_hash(body),
	}
	return response

func _execute_action_path(path_key: String, wallet: String, request_id: String, choice: String, input: Dictionary, metrics: Dictionary, meta: Dictionary) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow clean-room Action Path execution is not configured.")
	var normalized_wallet := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized_wallet):
		return _failure("A valid wallet address is required for Action Path execution.")
	var payload := {
		"wallet": normalized_wallet,
		"requestId": request_id,
		"input": input,
		"metrics": metrics,
		"meta": meta,
	}
	if not choice.strip_edges().is_empty():
		payload["choice"] = choice.strip_edges()
	var response := await _request_json(
		HTTPClient.METHOD_POST,
		"%s/buckets/%s/action-paths/%s/execute" % [sdk_base_url, bucket_id.uri_encode(), path_key.uri_encode()],
		payload,
		request_id,
		{},
		60.0
	)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var execution_value: Variant = body.get("execution", {})
	if execution_value is Dictionary:
		var execution := execution_value as Dictionary
		var status := String(execution.get("status", "")).strip_edges().to_lower()
		if status == "failed":
			return _failure(
				String(execution.get("errorMessage", execution.get("error_message", "Action Path execution failed."))),
				int(response.get("status", 0)),
				body
			)
	return response

func _selected_family_from_action_path_body(body: Dictionary) -> String:
	var detail_value: Variant = body.get("detail", {})
	if not (detail_value is Dictionary):
		return ""
	var detail := detail_value as Dictionary
	var trace_value: Variant = detail.get("trace", [])
	if not (trace_value is Array):
		return ""
	for trace_value_item in trace_value:
		if not (trace_value_item is Dictionary):
			continue
		var trace := trace_value_item as Dictionary
		if String(trace.get("status", "")) != "selected":
			continue
		var trace_detail_value: Variant = trace.get("detail", {})
		if not (trace_detail_value is Dictionary):
			continue
		var trace_detail := trace_detail_value as Dictionary
		var family := _family_from_loose_text(String(trace_detail.get("selectionValue", "")))
		if family.is_empty():
			family = _family_from_loose_text(String(trace_detail.get("branchLabel", "")))
		if not family.is_empty():
			return family
	return ""

func _first_action_tx_hash(body: Dictionary) -> String:
	var detail_value: Variant = body.get("detail", {})
	if not (detail_value is Dictionary):
		return ""
	var actions_value: Variant = (detail_value as Dictionary).get("actions", [])
	if not (actions_value is Array):
		return ""
	for action_value in actions_value:
		if action_value is Dictionary:
			var tx_hash := String((action_value as Dictionary).get("txHash", (action_value as Dictionary).get("tx_hash", ""))).strip_edges()
			if not tx_hash.is_empty():
				return tx_hash
	return ""

func _resolve_catalog(value: Dictionary) -> void:
	bucket_slug = String(value.get("bucketSlug", value.get("bucketId", bucket_id))).strip_edges()
	class_id_by_family.clear()
	class_key_by_family.clear()
	skin_image_url_by_family.clear()
	toy_class_id_by_family.clear()
	toy_class_key_by_family.clear()
	toy_title_by_family.clear()
	toy_image_url_by_family.clear()

	var classes: Variant = value.get("classes", [])
	if not (classes is Array):
		return
	for class_value in classes:
		if not (class_value is Dictionary):
			continue
		var nft_class := class_value as Dictionary
		var class_id := String(nft_class.get("onchainClassId", nft_class.get("id", ""))).strip_edges()
		var class_key := String(nft_class.get("slug", nft_class.get("key", ""))).strip_edges().to_lower()
		var class_title := String(nft_class.get("name", nft_class.get("title", ""))).strip_edges()
		var class_image_url := String(nft_class.get("imageUrl", nft_class.get("image_url", ""))).strip_edges()
		var skin_family := _skin_family_from_class_key(class_key)
		if not skin_family.is_empty():
			class_id_by_family[skin_family] = class_id
			class_key_by_family[skin_family] = class_key
			skin_image_url_by_family[skin_family] = class_image_url
			continue
		var toy_family := _toy_family_from_class(class_key, class_title)
		if toy_family.is_empty():
			continue
		var tier := _toy_tier_from_class(class_key, class_title)
		if tier not in ["", "base", "small"]:
			continue
		toy_class_id_by_family[toy_family] = class_id
		toy_class_key_by_family[toy_family] = class_key
		toy_title_by_family[toy_family] = class_title if not class_title.is_empty() else "%s Toy" % _family_display_name(toy_family)
		toy_image_url_by_family[toy_family] = class_image_url

func _holding_presentation(holding: Dictionary) -> Dictionary:
	var presentation_value: Variant = holding.get("presentation", {})
	return (presentation_value as Dictionary) if presentation_value is Dictionary else {}

func _holding_quantity(holding: Dictionary) -> int:
	var standard := String(holding.get("standard", "")).strip_edges().to_upper()
	if standard == "ERC721":
		return 1 if not String(holding.get("owner", "")).strip_edges().is_empty() else 0
	var quantity_value: Variant = holding.get("quantity", holding.get("balance", 0))
	var quantity_text := String(quantity_value).strip_edges()
	return int(quantity_text) if quantity_text.is_valid_int() else 0

func _toy_showcase_from_holdings(value: Dictionary) -> Array[Dictionary]:
	var grouped: Dictionary = {}
	var holdings_value: Variant = value.get("holdings", [])
	if not (holdings_value is Array):
		return []
	for holding_value in holdings_value as Array:
		if not (holding_value is Dictionary):
			continue
		var holding := holding_value as Dictionary
		var quantity := _holding_quantity(holding)
		if quantity <= 0:
			continue
		var presentation := _holding_presentation(holding)
		var class_key := String(presentation.get("slug", presentation.get("key", ""))).strip_edges()
		var class_title := String(presentation.get("name", presentation.get("title", ""))).strip_edges()
		var family := _toy_family_from_class(class_key, class_title)
		if family.is_empty():
			continue
		var tier := _toy_tier_from_class(class_key, class_title)
		if tier.is_empty() or tier == "base":
			tier = "small"
		var class_id := String(holding.get("classId", presentation.get("onchainClassId", ""))).strip_edges()
		var grouping_key := "%s:%s:%s" % [family, tier, class_id]
		var entry: Dictionary = grouped.get(grouping_key, {}) as Dictionary
		if entry.is_empty():
			entry = {
				"family": family,
				"tier": tier,
				"size": tier,
				"title": class_title if not class_title.is_empty() else "%s Toy" % _family_display_name(family),
				"quantity": 0,
				"imageUrl": String(presentation.get("imageUrl", presentation.get("image_url", ""))).strip_edges(),
				"classId": class_id,
				"classKey": class_key,
				"standard": String(holding.get("standard", "")),
			}
		entry["quantity"] = int(entry.get("quantity", 0)) + quantity
		grouped[grouping_key] = entry
	var result: Array[Dictionary] = []
	for entry_value in grouped.values():
		if entry_value is Dictionary:
			result.append((entry_value as Dictionary).duplicate(true))
	return result

func family_for_class_id(class_id: String) -> String:
	for family_value in class_id_by_family.keys():
		var family := String(family_value)
		if String(class_id_by_family.get(family, "")) == class_id:
			return family
	return ""

func skin_image_url_for_class_id(class_id: String) -> String:
	var family := family_for_class_id(class_id)
	return String(skin_image_url_by_family.get(family, "")).strip_edges()

func toy_image_url_for_class_id(class_id: String) -> String:
	var family := toy_family_for_class_id(class_id)
	return String(toy_image_url_by_family.get(family, "")).strip_edges()

func toy_family_for_class_id(class_id: String) -> String:
	for family_value in toy_class_id_by_family.keys():
		var family := String(family_value)
		if String(toy_class_id_by_family.get(family, "")) == class_id:
			return family
	return ""

func _family_from_class_key(class_key: String) -> String:
	return _skin_family_from_class_key(class_key)

func _skin_family_from_class_key(class_key: String) -> String:
	var normalized := class_key.strip_edges().to_lower()
	if normalized.contains("toy"):
		return ""
	for prefix in ["yes_pusher.", "yes_drop."]:
		if normalized.begins_with(prefix):
			normalized = normalized.trim_prefix(prefix)
	for prefix in ["skin.", "coin_skin."]:
		if normalized.begins_with(prefix):
			normalized = normalized.trim_prefix(prefix)
	match normalized:
		"horseshoe", "four_leaf_clover", "leprechaun", "pot_of_gold", "treasure_chest":
			return normalized
	return ""

func _toy_family_from_class(class_key: String, class_title: String) -> String:
	var text := "%s %s" % [class_key, class_title]
	var normalized := text.strip_edges().to_lower().replace("-", "_").replace(" ", "_").replace(".", "_").replace("/", "_")
	if not normalized.contains("toy"):
		return ""
	return _family_from_loose_text(normalized)

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
	for tier in ["giant", "large", "medium", "small", "base"]:
		if normalized.contains(tier):
			return tier
	return ""

func _family_display_name(family: String) -> String:
	match family:
		"horseshoe": return "Horseshoe"
		"four_leaf_clover": return "Four-Leaf Clover"
		"leprechaun": return "Leprechaun"
		"pot_of_gold": return "Pot of Gold"
		"treasure_chest": return "Treasure Chest"
	return "Toy"

func _load_profile_card(wallet: String) -> Dictionary:
	var origin := _platform_origin()
	if origin.is_empty():
		return {"ok": false, "error": "Yokefellow Profile Card origin is not configured."}
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = 20.0
	var url := "%s/api/profile/card?walletAddress=%s" % [origin, wallet.uri_encode()]
	var start_error := request.request(url, PackedStringArray(["Accept: application/json"]), HTTPClient.METHOD_GET, "")
	if start_error != OK:
		request.queue_free()
		return {"ok": false, "error": "Profile Card request could not start: %s" % error_string(start_error)}
	var completed: Array = await request.request_completed
	request.queue_free()
	var transport_result := int(completed[0])
	var response_code := int(completed[1])
	var response_bytes: PackedByteArray = completed[3]
	var parsed: Variant = JSON.parse_string(response_bytes.get_string_from_utf8())
	var parsed_body: Dictionary = parsed if parsed is Dictionary else {}
	if transport_result != HTTPRequest.RESULT_SUCCESS:
		return {"ok": false, "error": "Profile Card request failed before receiving a response."}
	if response_code == 404:
		return {"ok": true, "card": {}, "missing": true}
	if response_code < 200 or response_code >= 300 or parsed_body.get("ok", true) == false:
		return {"ok": false, "error": _error_message(parsed_body, "Profile Card returned HTTP %d." % response_code)}
	var card_value: Variant = parsed_body.get("card", {})
	return {"ok": true, "card": (card_value as Dictionary).duplicate(true) if card_value is Dictionary else {}}

func _platform_origin() -> String:
	var suffix := "/api/sdk/v1"
	if sdk_base_url.ends_with(suffix):
		return sdk_base_url.left(sdk_base_url.length() - suffix.length())
	return sdk_base_url.trim_suffix("/")

func _request_json(method: int, url: String, body: Dictionary, idempotency_key: String, extra_headers: Dictionary = {}, timeout_seconds: float = 20.0) -> Dictionary:
	var request := HTTPRequest.new()
	add_child(request)
	request.timeout = timeout_seconds
	var headers := PackedStringArray(["Accept: application/json"])
	if method != HTTPClient.METHOD_GET:
		headers.append("Content-Type: application/json")
	if not app_api_key.is_empty():
		headers.append("X-YF-App-Key: %s" % app_api_key)
	if not idempotency_key.is_empty():
		headers.append("X-Idempotency-Key: %s" % idempotency_key)
	for header_name_value in extra_headers.keys():
		var header_name := String(header_name_value).strip_edges()
		var header_value := String(extra_headers.get(header_name_value, "")).strip_edges()
		if not header_name.is_empty() and not header_value.is_empty():
			headers.append("%s: %s" % [header_name, header_value])
	var payload := "" if method == HTTPClient.METHOD_GET else JSON.stringify(body)
	var start_error := request.request(url, headers, method, payload)
	if start_error != OK:
		request.queue_free()
		return _failure("Request could not start: %s" % error_string(start_error))
	var completed: Array = await request.request_completed
	request.queue_free()
	var transport_result := int(completed[0])
	var response_code := int(completed[1])
	var response_bytes: PackedByteArray = completed[3]
	var text := response_bytes.get_string_from_utf8()
	var parsed: Variant = JSON.parse_string(text)
	var parsed_body: Dictionary = parsed if parsed is Dictionary else {}
	if transport_result != HTTPRequest.RESULT_SUCCESS:
		return _failure("Yokefellow request failed before receiving a response.", response_code, parsed_body)
	if response_code < 200 or response_code >= 300 or parsed_body.get("ok", true) == false:
		var message := _error_message(parsed_body, "Yokefellow returned HTTP %d." % response_code)
		return _failure(message, response_code, parsed_body)
	return {"ok": true, "status": response_code, "body": parsed_body}

func _error_message(body: Dictionary, fallback: String) -> String:
	var value: Variant = body.get("error", body.get("message", fallback))
	if value is Dictionary:
		return String(value.get("message", fallback))
	var text := String(value).strip_edges()
	return text if not text.is_empty() else fallback

func _failure(message: String, status: int = 0, body: Dictionary = {}) -> Dictionary:
	integration_error.emit(message)
	return {"ok": false, "error": message, "status": status, "body": body}

func _normalize_sdk_base(value: String) -> String:
	var base := value.strip_edges().trim_suffix("/")
	if base.is_empty():
		return ""
	if base.ends_with("/api/sdk/v1"):
		return base
	return "%s/api/sdk/v1" % base

func _env_or(name: String, fallback: String) -> String:
	var value := OS.get_environment(name).strip_edges()
	return value if not value.is_empty() else fallback

func _env_bool(name: String, fallback: bool) -> bool:
	var value := OS.get_environment(name).strip_edges().to_lower()
	if value.is_empty():
		return fallback
	return value in ["1", "true", "yes", "on"]

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