extends Node
class_name YokefellowServerClient

signal catalog_loaded(catalog: Dictionary)
signal integration_error(message: String)

const DEFAULT_APP_SLUG := "coin-pusher"
const DEFAULT_CREDIT_EVENT := "coin_drop_completed"
const DEFAULT_SPEND_EVENT := "coin_drop_started"
const DEFAULT_SKIN_EVENT := "skin_drop_earned"
const DEFAULT_SKIN_TRIGGER := "yes_pusher.skin_drop"
const DEFAULT_SKIN_OFFERING := "Coin Skin Drop"
const DEFAULT_TOY_EVENT := "toy_caught"
const DEFAULT_TOY_TRIGGER := "yes_pusher.toy_caught"
const DEFAULT_TOY_OFFERING := "Catch a Toy"

var sdk_base_url: String = ""
var bucket_id: String = ""
var app_api_key: String = ""
var app_slug: String = DEFAULT_APP_SLUG
var credit_event_type: String = DEFAULT_CREDIT_EVENT
var spend_event_type: String = DEFAULT_SPEND_EVENT
var skin_event_type: String = DEFAULT_SKIN_EVENT
var skin_trigger_key: String = DEFAULT_SKIN_TRIGGER
var skin_offering_name: String = DEFAULT_SKIN_OFFERING
var toy_event_type: String = DEFAULT_TOY_EVENT
var toy_trigger_key: String = DEFAULT_TOY_TRIGGER
var toy_offering_name: String = DEFAULT_TOY_OFFERING
var turn_price_yes_raw: String = ""
var yes_per_payout_raw: String = "1000000000000000000"
var session_verify_url: String = ""
var allow_unverified_wallets: bool = false
var test_free_turns: bool = false
var instant_mint_url: String = ""
var instant_mint_secret: String = ""

var catalog: Dictionary = {}
var skin_offering_id: String = ""
var skin_fulfillment_mode: String = ""
var toy_offering_id: String = ""
var toy_fulfillment_mode: String = ""
var bucket_slug: String = ""
var class_id_by_family: Dictionary = {}
var class_key_by_family: Dictionary = {}
var skin_image_url_by_family: Dictionary = {}
var toy_class_id_by_family: Dictionary = {}
var toy_class_key_by_family: Dictionary = {}
var toy_output_id_by_family: Dictionary = {}
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
	credit_event_type = _env_or("YES_PUSHER_CREDIT_EVENT_TYPE", DEFAULT_CREDIT_EVENT)
	spend_event_type = _env_or("YES_PUSHER_SPEND_EVENT_TYPE", DEFAULT_SPEND_EVENT)
	skin_event_type = _env_or("YES_PUSHER_SKIN_EVENT_TYPE", DEFAULT_SKIN_EVENT)
	skin_trigger_key = _env_or("YES_PUSHER_SKIN_DROP_TRIGGER_KEY", DEFAULT_SKIN_TRIGGER)
	skin_offering_name = _env_or("YES_PUSHER_SKIN_DROP_OFFERING_NAME", DEFAULT_SKIN_OFFERING)
	toy_event_type = _env_or("YES_PUSHER_TOY_EVENT_TYPE", DEFAULT_TOY_EVENT)
	toy_trigger_key = _env_or("YES_PUSHER_TOY_TRIGGER_KEY", DEFAULT_TOY_TRIGGER)
	toy_offering_name = _env_or("YES_PUSHER_TOY_OFFERING_NAME", DEFAULT_TOY_OFFERING)
	turn_price_yes_raw = OS.get_environment("YES_PUSHER_TURN_PRICE_YES_RAW").strip_edges()
	yes_per_payout_raw = _env_or("YES_PUSHER_YES_PER_PAYOUT_RAW", "1000000000000000000")
	session_verify_url = OS.get_environment("YF_SESSION_VERIFY_URL").strip_edges().trim_suffix("/")
	allow_unverified_wallets = _env_bool("YES_PUSHER_ALLOW_UNVERIFIED_WALLETS", false)
	test_free_turns = _env_bool("YES_PUSHER_TEST_FREE_TURNS", false)
	instant_mint_url = OS.get_environment("YF_INSTANT_MINT_URL").strip_edges()
	instant_mint_secret = OS.get_environment("YF_INSTANT_MINT_SECRET").strip_edges()

func integration_ready() -> bool:
	return not sdk_base_url.is_empty() and not bucket_id.is_empty() and not app_api_key.is_empty()

func paid_turns_ready() -> bool:
	if test_free_turns:
		return true
	return integration_ready() and _positive_integer_string(turn_price_yes_raw)

func load_catalog(wallet: String = "") -> Dictionary:
	if sdk_base_url.is_empty() or bucket_id.is_empty():
		return _failure("Yokefellow catalog is not configured.")
	var url := "%s/buckets/%s/catalog" % [sdk_base_url, bucket_id.uri_encode()]
	var normalized_wallet := wallet.strip_edges().to_lower()
	if _is_wallet(normalized_wallet):
		url += "?wallet=%s" % normalized_wallet.uri_encode()
	var response := await _request_json(HTTPClient.METHOD_GET, url, {}, "")
	if not bool(response.get("ok", false)):
		return response
	catalog = response.get("body", {}) as Dictionary
	_resolve_catalog(catalog)
	catalog_loaded.emit(catalog)
	return response

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
	var response := await load_wallet_entitlements(wallet)
	if not bool(response.get("ok", false)):
		return response
	var body := response.get("body", {}) as Dictionary
	var families: Array[String] = []
	var wallet_state: Dictionary = {}
	var wallet_state_value: Variant = body.get("walletState", {})
	if wallet_state_value is Dictionary:
		wallet_state = wallet_state_value as Dictionary
	var owned_mints: Variant = wallet_state.get("ownedMints", [])
	if owned_mints is Array:
		for mint_value in owned_mints:
			if not (mint_value is Dictionary):
				continue
			var mint := mint_value as Dictionary
			var family := _family_from_class_key(String(mint.get("classSlug", "")))
			if not family.is_empty() and not families.has(family):
				families.append(family)
	return {"ok": true, "families": families, "body": body}

func load_wallet_entitlements(wallet: String) -> Dictionary:
	if sdk_base_url.is_empty() or bucket_id.is_empty():
		return _failure("Yokefellow wallet entitlements are not configured.")
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	var url := "%s/wallets/%s/entitlements?bucketId=%s" % [
		sdk_base_url,
		normalized.uri_encode(),
		bucket_id.uri_encode(),
	]
	return await _request_json(HTTPClient.METHOD_GET, url, {}, "")

func load_profile_card(wallet: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return _failure("A valid wallet address is required.")
	var origin := _public_api_origin()
	if origin.is_empty():
		return _failure("Yokefellow Profile Card API is not configured.")
	var response := await _request_json(
		HTTPClient.METHOD_GET,
		"%s/api/profile/card?walletAddress=%s" % [origin, normalized.uri_encode()],
		{},
		""
	)
	if not bool(response.get("ok", false)):
		return response
	var body: Dictionary = response.get("body", {}) as Dictionary
	var card_value: Variant = body.get("card", {})
	if not (card_value is Dictionary):
		return _failure("Yokefellow returned no Profile Card for this wallet.", int(response.get("status", 0)), body)
	var card := card_value as Dictionary
	if String(card.get("version", "")) != "profile_card.v1":
		return _failure("YES DROP only supports Yokefellow profile_card.v1.", int(response.get("status", 0)), body)
	return {"ok": true, "card": card.duplicate(true), "body": body}


func load_player_presentation(wallet: String) -> Dictionary:
	var normalized := wallet.strip_edges().to_lower()
	if not _is_wallet(normalized):
		return {"ok": false, "wallet": normalized, "profile": {}, "toys": [], "errors": ["Invalid wallet."]}

	var errors: Array[String] = []
	var profile: Dictionary = {}
	var profile_result: Dictionary = await load_profile_card(normalized)
	if bool(profile_result.get("ok", false)):
		var profile_value: Variant = profile_result.get("card", {})
		if profile_value is Dictionary:
			profile = (profile_value as Dictionary).duplicate(true)
	else:
		errors.append(String(profile_result.get("error", "Profile Card could not be loaded.")))

	var toys: Array = []
	var entitlement_result: Dictionary = await load_wallet_entitlements(normalized)
	if bool(entitlement_result.get("ok", false)):
		toys = _toy_showcase_from_entitlements(entitlement_result)
	else:
		errors.append(String(entitlement_result.get("error", "Toy ownership could not be loaded.")))

	return {
		"ok": not profile.is_empty() or not toys.is_empty(),
		"wallet": normalized,
		"profile": profile,
		"toys": toys,
		"errors": errors,
	}


func _toy_showcase_from_entitlements(entitlement_result: Dictionary) -> Array:
	var body: Dictionary = entitlement_result.get("body", {}) as Dictionary
	var wallet_state_value: Variant = body.get("walletState", {})
	if not (wallet_state_value is Dictionary):
		return []
	var wallet_state := wallet_state_value as Dictionary
	var owned_value: Variant = wallet_state.get("ownedMints", [])
	if not (owned_value is Array):
		return []

	var grouped: Dictionary = {}
	for mint_value in owned_value:
		if not (mint_value is Dictionary):
			continue
		var mint := mint_value as Dictionary
		var status := String(mint.get("status", "current")).strip_edges().to_lower()
		if not status.is_empty() and status != "current":
			continue
		var class_slug := String(mint.get("classSlug", "")).strip_edges()
		var class_name := String(mint.get("className", "")).strip_edges()
		var family := _toy_family_from_class(class_slug, class_name)
		if family.is_empty():
			continue
		var tier := _toy_tier_from_class(class_slug, class_name)
		if tier in ["", "base"]:
			tier = "small"
		if tier not in ["small", "medium", "large"]:
			continue
		var quantity := maxi(1, int(mint.get("quantity", 1)))
		var key := "%s:%s" % [family, tier]
		var image_url := ""
		var meta_value: Variant = mint.get("meta", {})
		if meta_value is Dictionary:
			image_url = String((meta_value as Dictionary).get("imageUrl", "")).strip_edges()
		if not grouped.has(key):
			grouped[key] = {
				"family": family,
				"tier": tier,
				"title": class_name if not class_name.is_empty() else "%s %s Toy" % [tier.capitalize(), _family_display_name(family)],
				"quantity": 0,
				"imageUrl": image_url,
				"classId": String(mint.get("classId", "")),
				"classSlug": class_slug,
				"collectionName": String(mint.get("collectionName", "")),
			}
		var item := grouped[key] as Dictionary
		item["quantity"] = int(item.get("quantity", 0)) + quantity
		if String(item.get("imageUrl", "")).is_empty() and not image_url.is_empty():
			item["imageUrl"] = image_url
		grouped[key] = item

	var result: Array = []
	for value in grouped.values():
		if value is Dictionary:
			result.append((value as Dictionary).duplicate(true))
	return result

func spend_turn_credit(wallet: String, turn_id: String) -> Dictionary:
	if test_free_turns:
		return {"ok": true, "freeTestTurn": true, "amountYesRaw": "0"}
	if not paid_turns_ready():
		return _failure("Paid turns are blocked until YES_PUSHER_TURN_PRICE_YES_RAW and the Yokefellow app connection are configured.")
	var external_ref := "yes-pusher:turn:%s:spend" % turn_id
	return await _request_json(
		HTTPClient.METHOD_POST,
		"%s/buckets/%s/credit-spends" % [sdk_base_url, bucket_id.uri_encode()],
		{
			"wallet": wallet,
			"amountYesRaw": turn_price_yes_raw,
			"eventType": spend_event_type,
			"externalRef": external_ref,
			"source": app_slug,
		},
		external_ref
	)

func grant_turn_winnings(wallet: String, turn_id: String, payout_yes: int) -> Dictionary:
	if payout_yes <= 0:
		return {"ok": true, "skipped": "no_payout", "amountYesRaw": "0"}
	if not integration_ready():
		return _failure("Yokefellow winnings settlement is not configured.")
	var amount_raw := _multiply_integer_strings(str(payout_yes), yes_per_payout_raw)
	var external_ref := "yes-pusher:turn:%s:winnings" % turn_id
	return await _request_json(
		HTTPClient.METHOD_POST,
		"%s/buckets/%s/credit-grants" % [sdk_base_url, bucket_id.uri_encode()],
		{
			"wallet": wallet,
			"amountYesRaw": amount_raw,
			"eventType": credit_event_type,
			"externalRef": external_ref,
			"source": app_slug,
		},
		external_ref
	)

func submit_skin_milestone(wallet: String, turn_id: String, milestone_number: int, lifetime_coins_paid_out: int) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow skin settlement is not configured.")
	if skin_offering_id.is_empty():
		var catalog_result := await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	if skin_offering_id.is_empty():
		return _failure("The live Coin Skin Drop offering could not be resolved from this bucket.")
	var external_ref := "yes-pusher:wallet:%s:skin-payout-100:%d" % [wallet.to_lower(), milestone_number]
	var response := await _request_json(
		HTTPClient.METHOD_POST,
		"%s/buckets/%s/offering-events" % [sdk_base_url, bucket_id.uri_encode()],
		{
			"wallet": wallet,
			"appSlug": app_slug,
			"eventType": skin_event_type,
			"offeringId": skin_offering_id,
			"metrics": {
				"turnId": turn_id,
				"milestoneNumber": milestone_number,
				"milestoneEvery": 100,
				"lifetimeCoinsPaidOut": lifetime_coins_paid_out,
				"milestoneBasis": "coins_paid_out",
			},
			"meta": {
				"triggerKey": skin_trigger_key,
				"offeringName": skin_offering_name,
				"externalRef": external_ref,
			},
		},
		external_ref
	)
	if not bool(response.get("ok", false)):
		return response
	var response_body := response.get("body", {}) as Dictionary
	var results_value: Variant = response_body.get("results", [])
	if not (results_value is Array):
		return _failure("Yokefellow accepted the skin event but returned no result details.", int(response.get("status", 0)), response_body)
	for result_value in results_value:
		if not (result_value is Dictionary):
			continue
		var result := result_value as Dictionary
		if not bool(result.get("matched", false)):
			continue
		if String(result.get("resultType", "")) == "failed":
			return _failure(String(result.get("error", "The Coin Skin Drop result failed.")), int(response.get("status", 0)), response_body)
		var selected_class_id := String(result.get("selectedClassId", result.get("classId", "")))
		if selected_class_id.is_empty():
			continue
		if skin_fulfillment_mode == "instant":
			var mint_job_id := String(result.get("mintJobId", ""))
			if mint_job_id.is_empty():
				return _failure("The instant Coin Skin Drop did not return a mint job identifier.", int(response.get("status", 0)), response_body)
			if instant_mint_url.is_empty() or instant_mint_secret.is_empty():
				return _failure("This offering is Instant, but the Coin Pusher instant minter is not configured.", int(response.get("status", 0)), response_body)
			var instant_result := await _request_json(
				HTTPClient.METHOD_POST,
				instant_mint_url,
				{
					"jobId": mint_job_id,
					"bucketId": bucket_id,
					"bucketSlug": bucket_slug,
					"wallet": wallet,
					"classId": selected_class_id,
				},
				"",
				{"X-Yes-Pusher-Mint-Secret": instant_mint_secret},
				120.0
			)
			if not bool(instant_result.get("ok", false)):
				return instant_result
			var instant_body: Dictionary = {}
			var instant_body_value: Variant = instant_result.get("body", {})
			if instant_body_value is Dictionary:
				instant_body = instant_body_value as Dictionary
			if not bool(instant_body.get("completed", false)):
				return _failure(String(instant_body.get("error", "The NFT reached the instant minter but completion was not confirmed.")), int(instant_result.get("status", 0)), instant_body)
			var completed_result := result.duplicate(true)
			completed_result["resultType"] = "minted"
			completed_result["mintStatus"] = "completed"
			completed_result["txHash"] = String(instant_body.get("txHash", ""))
			completed_result["tokenId"] = String(instant_body.get("tokenId", ""))
			completed_result["imageUrl"] = skin_image_url_for_class_id(selected_class_id)
			response["skinResult"] = completed_result
			return response
		var queued_result := result.duplicate(true)
		queued_result["imageUrl"] = skin_image_url_for_class_id(selected_class_id)
		response["skinResult"] = queued_result
		return response
	return _failure("The skin milestone was recorded but did not produce a Coin Skin Drop result.", int(response.get("status", 0)), response_body)

func submit_toy_caught(wallet: String, turn_id: String, toy_instance_id: String, toy_family: String, power_result: Dictionary = {}) -> Dictionary:
	if not integration_ready():
		return _failure("Yokefellow toy settlement is not configured.")
	var family := _family_from_loose_text(toy_family)
	if family.is_empty():
		return _failure("The caught toy family is not recognized.")
	if toy_offering_id.is_empty() or String(toy_output_id_by_family.get(family, "")).is_empty():
		var catalog_result := await load_catalog(wallet)
		if not bool(catalog_result.get("ok", false)):
			return catalog_result
	if toy_offering_id.is_empty():
		return _failure("The live Catch a Toy offering could not be resolved from this bucket.")
	var selected_output_id := String(toy_output_id_by_family.get(family, "")).strip_edges()
	if selected_output_id.is_empty():
		return _failure("Catch a Toy has no Small %s output attached." % _family_display_name(family))
	var external_ref := "yes-pusher:turn:%s:toy:%s:caught" % [turn_id, toy_instance_id]
	var response := await _request_json(
		HTTPClient.METHOD_POST,
		"%s/buckets/%s/offering-events" % [sdk_base_url, bucket_id.uri_encode()],
		{
			"wallet": wallet,
			"appSlug": app_slug,
			"eventType": toy_event_type,
			"offeringId": toy_offering_id,
			"selectedOutputId": selected_output_id,
			"metrics": {
				"toyCaught": 1,
				"turnId": turn_id,
				"toyFamily": family,
			},
			"meta": {
				"triggerKey": toy_trigger_key,
				"offeringName": toy_offering_name,
				"externalRef": external_ref,
				"toyInstanceId": toy_instance_id,
				"toyFamily": family,
				"powerResult": power_result.duplicate(true),
			},
		},
		external_ref
	)
	if not bool(response.get("ok", false)):
		return response
	var response_body := response.get("body", {}) as Dictionary
	var results_value: Variant = response_body.get("results", [])
	if not (results_value is Array):
		return _failure("Yokefellow accepted the toy catch but returned no result details.", int(response.get("status", 0)), response_body)
	for result_value in results_value:
		if not (result_value is Dictionary):
			continue
		var result := result_value as Dictionary
		if not bool(result.get("matched", false)):
			continue
		if String(result.get("resultType", "")) == "failed":
			return _failure(String(result.get("error", "The Catch a Toy result failed.")), int(response.get("status", 0)), response_body)
		var selected_class_id := String(result.get("selectedClassId", result.get("classId", ""))).strip_edges()
		if selected_class_id.is_empty():
			continue
		var completed_result := result.duplicate(true)
		completed_result["toyFamily"] = family
		completed_result["classKey"] = String(toy_class_key_by_family.get(family, ""))
		completed_result["classTitle"] = String(toy_title_by_family.get(family, "%s Toy" % _family_display_name(family)))
		completed_result["imageUrl"] = String(toy_image_url_by_family.get(family, ""))
		if toy_fulfillment_mode == "instant":
			var mint_job_id := String(result.get("mintJobId", ""))
			if mint_job_id.is_empty():
				return _failure("The instant Catch a Toy result did not return a mint job identifier.", int(response.get("status", 0)), response_body)
			if instant_mint_url.is_empty() or instant_mint_secret.is_empty():
				return _failure("Catch a Toy is Instant, but the Coin Pusher instant minter is not configured.", int(response.get("status", 0)), response_body)
			var instant_result := await _request_json(
				HTTPClient.METHOD_POST,
				instant_mint_url,
				{
					"jobId": mint_job_id,
					"bucketId": bucket_id,
					"bucketSlug": bucket_slug,
					"wallet": wallet,
					"classId": selected_class_id,
				},
				"",
				{"X-Yes-Pusher-Mint-Secret": instant_mint_secret},
				120.0
			)
			if not bool(instant_result.get("ok", false)):
				return instant_result
			var instant_body: Dictionary = {}
			var instant_body_value: Variant = instant_result.get("body", {})
			if instant_body_value is Dictionary:
				instant_body = instant_body_value as Dictionary
			if not bool(instant_body.get("completed", false)):
				return _failure(String(instant_body.get("error", "The toy NFT reached the instant minter but completion was not confirmed.")), int(instant_result.get("status", 0)), instant_body)
			completed_result["resultType"] = "minted"
			completed_result["mintStatus"] = "completed"
			completed_result["txHash"] = String(instant_body.get("txHash", ""))
			completed_result["tokenId"] = String(instant_body.get("tokenId", ""))
		response["toyResult"] = completed_result
		return response
	return _failure("The toy catch was recorded but did not produce the selected Catch a Toy result.", int(response.get("status", 0)), response_body)

func _resolve_catalog(value: Dictionary) -> void:
	skin_offering_id = ""
	skin_fulfillment_mode = ""
	toy_offering_id = ""
	toy_fulfillment_mode = ""
	bucket_slug = String(value.get("bucketSlug", value.get("bucketId", bucket_id))).strip_edges()
	class_id_by_family.clear()
	class_key_by_family.clear()
	skin_image_url_by_family.clear()
	toy_class_id_by_family.clear()
	toy_class_key_by_family.clear()
	toy_output_id_by_family.clear()
	toy_title_by_family.clear()
	toy_image_url_by_family.clear()

	var toy_descriptor_by_class_id: Dictionary = {}
	var classes: Variant = value.get("classes", [])
	if classes is Array:
		for class_value in classes:
			if not (class_value is Dictionary):
				continue
			var nft_class := class_value as Dictionary
			var class_id := String(nft_class.get("id", "")).strip_edges()
			var class_key := String(nft_class.get("slug", "")).strip_edges().to_lower()
			var class_title := String(nft_class.get("name", "")).strip_edges()
			var class_image_url := String(nft_class.get("imageUrl", "")).strip_edges()
			var skin_family := _skin_family_from_class_key(class_key)
			if not skin_family.is_empty():
				class_id_by_family[skin_family] = class_id
				class_key_by_family[skin_family] = class_key
				skin_image_url_by_family[skin_family] = class_image_url
			var toy_family := _toy_family_from_class(class_key, class_title)
			if toy_family.is_empty():
				continue
			var tier := _toy_tier_from_class(class_key, class_title)
			toy_descriptor_by_class_id[class_id] = {
				"family": toy_family,
				"tier": tier,
				"classKey": class_key,
				"title": class_title,
				"imageUrl": class_image_url,
			}

	var toy_offering: Dictionary = {}
	var offerings: Variant = value.get("offerings", [])
	if offerings is Array:
		for offering_value in offerings:
			if not (offering_value is Dictionary):
				continue
			var offering := offering_value as Dictionary
			var title := String(offering.get("title", "")).strip_edges()
			var meta: Dictionary = offering.get("meta", {}) if offering.get("meta", {}) is Dictionary else {}
			var binding := String(meta.get("appBindingKey", "")).strip_edges()
			var active := bool(offering.get("active", false)) or String(offering.get("status", "")) == "live"
			if not active:
				continue
			if skin_offering_id.is_empty() and (title == skin_offering_name or binding == skin_trigger_key):
				skin_offering_id = String(offering.get("id", "")).strip_edges()
				skin_fulfillment_mode = String(offering.get("fulfillmentMode", "")).strip_edges().to_lower()
			if toy_offering_id.is_empty() and (title == toy_offering_name or binding == toy_trigger_key):
				toy_offering_id = String(offering.get("id", "")).strip_edges()
				toy_fulfillment_mode = String(offering.get("fulfillmentMode", "")).strip_edges().to_lower()
				toy_offering = offering

	var outputs: Variant = toy_offering.get("outputs", [])
	if outputs is Array:
		for output_value in outputs:
			if not (output_value is Dictionary):
				continue
			var output := output_value as Dictionary
			var output_id := String(output.get("id", "")).strip_edges()
			var output_class_id := String(output.get("itemClassId", "")).strip_edges()
			var descriptor: Dictionary = {}
			var descriptor_value: Variant = toy_descriptor_by_class_id.get(output_class_id, {})
			if descriptor_value is Dictionary:
				descriptor = descriptor_value as Dictionary
			var family := String(descriptor.get("family", ""))
			var tier := String(descriptor.get("tier", ""))
			if family.is_empty():
				family = _toy_family_from_class("", String(output.get("itemClassName", output.get("label", ""))))
				tier = _toy_tier_from_class("", String(output.get("itemClassName", output.get("label", ""))))
			if family.is_empty() or tier not in ["", "base", "small"] or output_id.is_empty():
				continue
			toy_output_id_by_family[family] = output_id
			toy_class_id_by_family[family] = output_class_id
			toy_class_key_by_family[family] = String(descriptor.get("classKey", ""))
			toy_title_by_family[family] = String(descriptor.get("title", output.get("itemClassName", "%s Toy" % _family_display_name(family))))
			toy_image_url_by_family[family] = String(descriptor.get("imageUrl", output.get("imageUrl", ""))).strip_edges()

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
	if normalized.contains("_l3") or normalized.ends_with("l3") or normalized.contains("level_3") or normalized.contains("level3"):
		return "large"
	if normalized.contains("_l2") or normalized.ends_with("l2") or normalized.contains("level_2") or normalized.contains("level2"):
		return "medium"
	if normalized.contains("_l1") or normalized.ends_with("l1") or normalized.contains("level_1") or normalized.contains("level1"):
		return "small"
	for tier in ["giant", "large", "medium", "small", "base"]:
		if normalized.contains(tier):
			return "small" if tier == "base" else tier
	return ""

func _family_display_name(family: String) -> String:
	match family:
		"horseshoe": return "Horseshoe"
		"four_leaf_clover": return "Four-Leaf Clover"
		"leprechaun": return "Leprechaun"
		"pot_of_gold": return "Pot of Gold"
		"treasure_chest": return "Treasure Chest"
	return "Toy"

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

func _public_api_origin() -> String:
	var base := sdk_base_url.strip_edges().trim_suffix("/")
	if base.ends_with("/api/sdk/v1"):
		return base.trim_suffix("/api/sdk/v1")
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
