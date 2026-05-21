package com.chainlesschain.android.core.e2ee.util

import com.chainlesschain.android.core.e2ee.crypto.Ed25519KeyPair
import com.chainlesschain.android.core.e2ee.crypto.X25519KeyPair
import com.chainlesschain.android.core.e2ee.protocol.PreKeyBundle
import com.chainlesschain.android.core.e2ee.protocol.X3DHKeyExchange
import com.chainlesschain.android.core.e2ee.session.E2EESession
import com.chainlesschain.android.core.e2ee.session.InitialMessage

/**
 * X3DH Alice/Bob simulator for E2EE integration tests.
 *
 * Replaces the deprecated `(peerId, sharedSecret, isInitiator)` overload of
 * PersistentSessionManager.createSession with a proper two-party X3DH dance
 * built directly on E2EESession.initializeAsInitiator/Responder — these
 * companion factories are state-less and don't require PSM / Hilt / per-peer
 * SessionStorage isolation.
 *
 * Production code still goes through PersistentSessionManager; this is purely
 * an instrumented-test helper for the 7 E2EE stubs that originally tested the
 * Alice↔Bob handshake. PSM-specific scenarios (persistence, queue, delete)
 * can still use the injected sessionManager for Alice and a raw [X3DHParty]
 * for Bob — see E2EEIntegrationTest for the pattern.
 */
class X3DHParty(val peerId: String) {
    val identityKey: X25519KeyPair = X25519KeyPair.generate()
    val signingKey: Ed25519KeyPair = Ed25519KeyPair.generate()
    val signedPreKey: X25519KeyPair = X25519KeyPair.generate()
    val oneTimePreKey: X25519KeyPair = X25519KeyPair.generate()

    val preKeyBundle: PreKeyBundle by lazy {
        X3DHKeyExchange.generatePreKeyBundle(
            identityKey,
            signingKey,
            signedPreKey,
            oneTimePreKey
        )
    }
}

/**
 * Result of a complete Alice↔Bob X3DH handshake — both sessions are ready
 * to encrypt/decrypt against each other.
 */
data class X3DHSimulation(
    val alice: X3DHParty,
    val bob: X3DHParty,
    val aliceSession: E2EESession,
    val bobSession: E2EESession,
    val initialMessage: InitialMessage
)

/**
 * Wire Alice (initiator) and Bob (responder) via X3DH. Both [E2EESession]
 * instances returned are pre-handshaked and can immediately exchange
 * encrypted messages.
 *
 * Note: PSM.acceptSession passes `null` for the responder's one-time pre-key
 * (production bug — see PSM.consumeOneTimePreKey(null) on line ~277). This
 * simulator passes the correct OPK so X3DH math actually completes the
 * 4-DH path; tests targeting PSM responder behavior should call
 * sessionManager.acceptSession() instead of this helper.
 */
fun simulateX3DHHandshake(
    aliceId: String = "alice",
    bobId: String = "bob"
): X3DHSimulation {
    val alice = X3DHParty(aliceId)
    val bob = X3DHParty(bobId)

    val (aliceSession, initialMessage) = E2EESession.initializeAsInitiator(
        peerId = bobId,
        senderIdentityKeyPair = alice.identityKey,
        receiverPreKeyBundle = bob.preKeyBundle
    )

    val bobSession = E2EESession.initializeAsResponder(
        peerId = aliceId,
        receiverIdentityKeyPair = bob.identityKey,
        receiverSignedPreKeyPair = bob.signedPreKey,
        receiverOneTimePreKeyPair = bob.oneTimePreKey,
        initialMessage = initialMessage
    )

    return X3DHSimulation(
        alice = alice,
        bob = bob,
        aliceSession = aliceSession,
        bobSession = bobSession,
        initialMessage = initialMessage
    )
}
