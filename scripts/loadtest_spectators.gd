extends SceneTree
# Real Godot 4 websocket spectator soak. Run ONLY against an isolated staging
# machine: godot --headless --path . --script res://scripts/loadtest_spectators.gd -- --ws-url=wss://STAGING --clients=100 --seconds=30
# Uses the same WebSocketMultiplayerPeer as actual Godot game clients.
func _initialize() -> void:
    call_deferred("_run")

func _run() -> void:
    var url := ""
    var count := 100
    var seconds := 30
    for arg in OS.get_cmdline_user_args():
        if arg.begins_with("--ws-url="):
            url = arg.trim_prefix("--ws-url=")
        elif arg.begins_with("--clients="):
            count = int(arg.trim_prefix("--clients="))
        elif arg.begins_with("--seconds="):
            seconds = int(arg.trim_prefix("--seconds="))
    if not (url.begins_with("ws://") or url.begins_with("wss://")) or url.contains("production") or count < 1 or count > 500 or seconds < 5 or seconds > 180:
        push_error("A non-production --ws-url, 1..500 clients and 5..180 seconds are required.")
        quit(2)
        return
    var peers: Array[WebSocketMultiplayerPeer] = []
    var ever_connected: Dictionary = {}
    var dropped := 0
    var creation_errors := 0
    for i in range(count):
        var peer := WebSocketMultiplayerPeer.new()
        peer.inbound_buffer_size = 65536
        peer.outbound_buffer_size = 65536
        var result := peer.create_client(url)
        if result != OK:
            creation_errors += 1
            continue
        peers.append(peer)
    var deadline := Time.get_ticks_msec() + seconds * 1000
    var max_connected := 0
    while Time.get_ticks_msec() < deadline:
        var connected := 0
        for i in range(peers.size()):
            var p := peers[i]
            p.poll()
            var state := p.get_connection_status()
            if state == MultiplayerPeer.CONNECTION_CONNECTED:
                connected += 1
                ever_connected[i] = true
            elif state == MultiplayerPeer.CONNECTION_DISCONNECTED and ever_connected.has(i):
                dropped += 1
                ever_connected.erase(i)
        max_connected = maxi(max_connected, connected)
        await create_timer(0.05).timeout
    for p in peers:
        p.close()
    print(JSON.stringify({
        "clients_requested": count, "clients_created": peers.size(),
        "creation_errors": creation_errors,
        "peak_connected": max_connected,
        "connected_at_end": ever_connected.size(),
        "observed_disconnect_ticks": dropped,
        "duration_seconds": seconds
    }))
    quit(0 if creation_errors == 0 and max_connected == peers.size() else 1)
