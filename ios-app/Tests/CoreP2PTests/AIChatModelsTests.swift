import XCTest
@testable import CoreP2P

/// Phase 5.1 — `AIChatModels` Codable + envelope parse 单测。
///
/// 5 tests：
/// 1. ChatMessage.decodeItem round-trip
/// 2. Conversation.decodeItem round-trip
/// 3. ChatStreamDelta.parseFromEnvelope happy + reject 错误 envelope/event
/// 4. ChatStreamEnd.parseFromEnvelope happy + reject
/// 5. ChatStreamError.parseFromEnvelope happy + reject
final class AIChatModelsTests: XCTestCase {

    func testChatMessageDecodeItem() {
        let dict: [String: Any] = [
            "id": "m-001",
            "role": "assistant",
            "content": "Hello, world.",
            "createdAt": 1715760000000,
            "modelUsed": "claude-opus-4-7"
        ]
        let msg = ChatMessage.decodeItem(dict)
        XCTAssertNotNil(msg)
        XCTAssertEqual(msg?.id, "m-001")
        XCTAssertEqual(msg?.role, .assistant)
        XCTAssertEqual(msg?.content, "Hello, world.")
        XCTAssertEqual(msg?.createdAt, 1715760000000)
        XCTAssertEqual(msg?.modelUsed, "claude-opus-4-7")
        XCTAssertFalse(msg?.isStreaming ?? true)

        // 缺字段 → nil
        XCTAssertNil(ChatMessage.decodeItem(["id": "x"]))
        // 未知 role → nil（role 解析失败）
        XCTAssertNil(ChatMessage.decodeItem([
            "id": "x", "role": "bot", "content": "y", "createdAt": 0
        ]))

        // createdAt 容错 Double / Int
        let altDict: [String: Any] = [
            "id": "m-002", "role": "user", "content": "hi",
            "createdAt": Double(1715760000000)
        ]
        XCTAssertEqual(ChatMessage.decodeItem(altDict)?.createdAt, 1715760000000)
    }

    func testConversationDecodeItem() {
        let dict: [String: Any] = [
            "id": "c-001",
            "title": "Brainstorming session",
            "model": "gpt-4",
            "messageCount": 12,
            "lastMessageAt": 1715761000000,
            "createdAt": 1715760000000,
            "archived": false
        ]
        let conv = Conversation.decodeItem(dict)
        XCTAssertNotNil(conv)
        XCTAssertEqual(conv?.id, "c-001")
        XCTAssertEqual(conv?.title, "Brainstorming session")
        XCTAssertEqual(conv?.model, "gpt-4")
        XCTAssertEqual(conv?.messageCount, 12)
        XCTAssertEqual(conv?.lastMessageAt, 1715761000000)
        XCTAssertFalse(conv?.archived ?? true)

        // 缺 title → nil
        XCTAssertNil(Conversation.decodeItem(["id": "x"]))

        // 最小字段（无 model / lastMessageAt） → default 填充
        let minimal = Conversation.decodeItem([
            "id": "c-002", "title": "Untitled", "createdAt": 0
        ])
        XCTAssertEqual(minimal?.messageCount, 0)
        XCTAssertNil(minimal?.lastMessageAt)
        XCTAssertNil(minimal?.model)
        XCTAssertFalse(minimal?.archived ?? true)
    }

    func testChatStreamDeltaParseFromEnvelope() {
        // happy
        let raw = #"""
        {"type":"chainlesschain:event","payload":{"event":"ai.chat.delta","streamId":"s-1","content":" world","chunkIdx":3,"totalChunks":null}}
        """#
        let delta = ChatStreamDelta.parseFromEnvelope(raw)
        XCTAssertNotNil(delta)
        XCTAssertEqual(delta?.streamId, "s-1")
        XCTAssertEqual(delta?.content, " world")
        XCTAssertEqual(delta?.chunkIdx, 3)
        XCTAssertNil(delta?.totalChunks)

        // 错误 envelope type
        XCTAssertNil(ChatStreamDelta.parseFromEnvelope(
            #"{"type":"chainlesschain:command:response","payload":{"id":"x","result":{}}}"#
        ))
        // 错误 event 名
        XCTAssertNil(ChatStreamDelta.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.end","streamId":"s","finishReason":"stop","finalText":"x","messageId":"m"}}"#
        ))
        // 缺 streamId
        XCTAssertNil(ChatStreamDelta.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.delta","content":"x","chunkIdx":0}}"#
        ))
        // chunkIdx 是 Double
        let rawDouble = #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.delta","streamId":"s-2","content":"x","chunkIdx":7.0}}"#
        XCTAssertEqual(ChatStreamDelta.parseFromEnvelope(rawDouble)?.chunkIdx, 7)
    }

    func testChatStreamEndParseFromEnvelope() {
        let raw = #"""
        {"type":"chainlesschain:event","payload":{"event":"ai.chat.end","streamId":"s-1","finishReason":"stop","finalText":"Hello world","messageId":"m-9"}}
        """#
        let end = ChatStreamEnd.parseFromEnvelope(raw)
        XCTAssertNotNil(end)
        XCTAssertEqual(end?.streamId, "s-1")
        XCTAssertEqual(end?.finishReason, "stop")
        XCTAssertEqual(end?.finalText, "Hello world")
        XCTAssertEqual(end?.messageId, "m-9")

        // 错误 envelope
        XCTAssertNil(ChatStreamEnd.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"terminal.stdout","sessionId":"s","data":"x","seq":1}}"#
        ))
        // 缺 streamId
        XCTAssertNil(ChatStreamEnd.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.end","finishReason":"stop"}}"#
        ))
        // 默认值兜底（缺 finishReason / finalText / messageId 但 streamId 在）
        let minimal = ChatStreamEnd.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.end","streamId":"s-2"}}"#
        )
        XCTAssertEqual(minimal?.finishReason, "stop")
        XCTAssertEqual(minimal?.finalText, "")
        XCTAssertEqual(minimal?.messageId, "")
    }

    func testChatStreamErrorParseFromEnvelope() {
        let raw = #"""
        {"type":"chainlesschain:event","payload":{"event":"ai.chat.error","streamId":"s-1","error":"LLM provider timeout"}}
        """#
        let err = ChatStreamError.parseFromEnvelope(raw)
        XCTAssertNotNil(err)
        XCTAssertEqual(err?.streamId, "s-1")
        XCTAssertEqual(err?.error, "LLM provider timeout")

        // 错 event name
        XCTAssertNil(ChatStreamError.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.delta","streamId":"s","content":"x","chunkIdx":0}}"#
        ))
        // 缺 streamId
        XCTAssertNil(ChatStreamError.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.error","error":"x"}}"#
        ))
        // 默认 error 兜底
        let minimal = ChatStreamError.parseFromEnvelope(
            #"{"type":"chainlesschain:event","payload":{"event":"ai.chat.error","streamId":"s-2"}}"#
        )
        XCTAssertEqual(minimal?.error, "unknown error")
    }
}
