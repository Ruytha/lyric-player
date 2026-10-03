// Lyric Player's iOS side: what the Music app (Apple Music) is playing, so
// the player can show its lyrics in time, and play / pause / skip / seek for
// it. Sends the same messages as the desktop app's helpers, as the
// "nowPlaying" event. iOS asks once for access to Apple Music.
//
// Only the Music app can be followed: iOS doesn't let apps see what other
// apps (Spotify, browsers) are playing.

import Foundation
import Capacitor
import MediaPlayer
import UIKit

@objc(LyricNativePlugin)
public class LyricNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LyricNativePlugin"
    public let jsName = "LyricNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
    ]

    private let player = MPMusicPlayerController.systemMusicPlayer
    private var timer: Timer?
    private var observing = false
    private var last: [String: Any]?
    private var thumbTrack: String?
    private var thumb: String?

    @objc func startNowPlaying(_ call: CAPPluginCall) {
        MPMediaLibrary.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    call.resolve(["allowed": false])
                    return
                }
                self.begin()
                call.resolve(["allowed": true])
            }
        }
    }

    @objc func stopNowPlaying(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.end()
            call.resolve()
        }
    }

    @objc func command(_ call: CAPPluginCall) {
        let cmd = call.getString("cmd") ?? ""
        let value = call.getDouble("value") ?? 0
        DispatchQueue.main.async {
            switch cmd {
            case "toggle":
                if self.player.playbackState == .playing { self.player.pause() } else { self.player.play() }
            case "play": self.player.play()
            case "pause": self.player.pause()
            case "next": self.player.skipToNextItem()
            case "prev": self.player.skipToPreviousItem()
            case "seek": self.player.currentPlaybackTime = max(0, value)
            default:
                call.reject("unknown command")
                return
            }
            // Report the change right away rather than at the next tick.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.send(force: true) }
            call.resolve()
        }
    }

    // MARK: - Following

    private func begin() {
        guard !observing else { send(force: true); return }
        observing = true
        player.beginGeneratingPlaybackNotifications()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(changed), name: .MPMusicPlayerControllerNowPlayingItemDidChange, object: player)
        nc.addObserver(self, selector: #selector(changed), name: .MPMusicPlayerControllerPlaybackStateDidChange, object: player)
        nc.addObserver(self, selector: #selector(changed), name: UIApplication.didBecomeActiveNotification, object: nil)
        // Once a second, to catch seeking in the Music app and keep the position honest.
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.send(force: false) }
        send(force: true)
    }

    private func end() {
        guard observing else { return }
        observing = false
        timer?.invalidate()
        timer = nil
        player.endGeneratingPlaybackNotifications()
        NotificationCenter.default.removeObserver(self)
        last = nil
    }

    @objc private func changed() {
        send(force: true)
    }

    private func send(force: Bool) {
        guard let item = player.nowPlayingItem, let title = item.title, !title.isEmpty else {
            if force || last?["none"] == nil {
                last = ["none": true]
                notifyListeners("nowPlaying", data: ["none": true])
            }
            return
        }
        let status: String
        switch player.playbackState {
        case .playing, .seekingForward, .seekingBackward: status = "Playing"
        case .stopped: status = "Stopped"
        default: status = "Paused"
        }
        let rawPosition = player.currentPlaybackTime
        let position = rawPosition.isFinite ? max(0, rawPosition) : 0
        let now = Date().timeIntervalSince1970 * 1000
        let artist = item.artist ?? ""
        let album = item.albumTitle ?? ""
        let track = "Apple Music|\(item.persistentID)|\(title)|\(artist)"

        // The cover once per song (it's large).
        if thumbTrack != track {
            thumbTrack = track
            thumb = nil
            if let image = item.artwork?.image(at: CGSize(width: 300, height: 300)),
               let data = image.jpegData(compressionQuality: 0.82) {
                thumb = "data:image/jpeg;base64," + data.base64EncodedString()
            }
        }

        // Only when something changed, or the position drifted from where it should be.
        if !force, let l = last, l["track"] as? String == track, l["status"] as? String == status,
           let lp = l["position"] as? Double, let lu = l["updated"] as? Double {
            let expected = lp + (status == "Playing" ? (now - lu) / 1000 : 0)
            if abs(expected - position) < 0.35 { return }
        }

        var s: [String: Any] = [
            "app": "Apple Music",
            "title": title,
            "artist": artist,
            "album": album,
            "albumArtist": item.albumArtist ?? "",
            "status": status,
            "rate": 1,
            "position": position,
            "duration": item.playbackDuration,
            "updated": now,
            "canSeek": true,
            "canNext": true,
            "canPrev": true,
            "track": track,
        ]
        if let thumb = thumb { s["thumb"] = thumb }
        last = s
        notifyListeners("nowPlaying", data: s)
    }

    deinit {
        timer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }
}
