import Foundation

/// A source of a vendor push token for Remote Session wake-ups — the iOS mirror
/// of the Android `RemoteSessionPushTokenProvider`. Each provider knows its own
/// [provider] tag (echoed to the host so it can pick the matching sender) and
/// resolves a token best-effort, returning nil when its channel is unavailable.
///
/// Non-throwing by design: a provider that fails (permission denied, token not
/// yet issued) returns nil rather than throwing, so the resolver never has to
/// try/catch — the Swift idiom for the Android "provider that throws is skipped".
public protocol RemoteSessionPushTokenProvider: Sendable {
    /// Tag stored alongside the token and sent to the host (e.g. "apns").
    var provider: String { get }

    /// Best-effort token fetch; any failure / unavailable channel → nil.
    func token() async -> String?
}

/// Sources the device's APNs token for Remote Session push wake-ups.
///
/// APNs is the only native iOS push channel, so it is the primary (and usually
/// sole) provider — but the resolver stays provider-agnostic so a future channel
/// (VoIP/PushKit, or a web-push relay fallback) can be added, mirroring Android's
/// multi-provider design. CoreP2P cannot reference the app-target
/// `PushNotificationManager`, so the token is read through an injected source
/// closure (the app wires it to `PushNotificationManager.shared.deviceToken` /
/// `UserDefaults` "device_push_token"). The provider tag "apns" matches the
/// desktop APNs sender (`CHAINLESSCHAIN_REMOTE_SESSION_PUSH_PROVIDER=apns`).
public struct APNsPushTokenProvider: RemoteSessionPushTokenProvider {
    public let provider = "apns"
    private let source: @Sendable () async -> String?

    public init(source: @escaping @Sendable () async -> String?) {
        self.source = source
    }

    public func token() async -> String? {
        guard let value = await source(),
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return nil
        }
        return value
    }
}

/// Resolves the first available push token across an ordered provider list — the
/// iOS mirror of the Android `RemoteSessionPushTokenResolver`.
///
/// The first provider that yields a non-blank token wins; a provider returning
/// nil is skipped so one unavailable channel never blocks the others. Returns nil
/// only when every provider is unavailable, in which case the host falls back to
/// relay + local notifications.
public struct RemoteSessionPushTokenResolver: Sendable {
    public struct Resolved: Sendable, Equatable {
        public let token: String
        public let provider: String

        public init(token: String, provider: String) {
            self.token = token
            self.provider = provider
        }
    }

    private let providers: [any RemoteSessionPushTokenProvider]

    public init(providers: [any RemoteSessionPushTokenProvider]) {
        self.providers = providers
    }

    public func resolve() async -> Resolved? {
        for source in providers {
            guard let token = await source.token(),
                  !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                continue
            }
            return Resolved(token: token, provider: source.provider)
        }
        return nil
    }
}
