import Foundation

/// Base58 encoder/decoder (Bitcoin alphabet) — 用于 did:key: multibase z-prefix
/// 编码 Ed25519 公钥（multicodec 0xed 0x01 + 32B pubkey）。
///
/// 实现参考：BIP-0058 风格 base58btc。Pure Swift，无外部依赖。
public enum Base58 {
    private static let alphabet: [Character] = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    private static let alphabetMap: [Character: UInt8] = {
        var map = [Character: UInt8]()
        for (i, c) in alphabet.enumerated() { map[c] = UInt8(i) }
        return map
    }()

    /// encode raw bytes → base58 string
    public static func encode(_ data: Data) -> String {
        if data.isEmpty { return "" }

        // 数前导 0 字节（变成前导 '1'）
        var zeros = 0
        for b in data {
            if b == 0 { zeros += 1 } else { break }
        }

        // big-endian base-58 conversion
        var bytes = [UInt8](data)
        var b58: [UInt8] = []
        var startAt = zeros
        while startAt < bytes.count {
            var carry: Int = 0
            for i in startAt..<bytes.count {
                let v = Int(bytes[i]) + carry * 256
                bytes[i] = UInt8(v / 58)
                carry = v % 58
            }
            b58.append(UInt8(carry))
            // 跳过已变 0 的高位
            while startAt < bytes.count && bytes[startAt] == 0 { startAt += 1 }
        }

        var result = String(repeating: "1", count: zeros)
        for d in b58.reversed() {
            result.append(alphabet[Int(d)])
        }
        return result
    }

    /// decode base58 string → raw bytes, returns nil on invalid char
    public static func decode(_ string: String) -> Data? {
        if string.isEmpty { return Data() }

        var zeros = 0
        for c in string {
            if c == "1" { zeros += 1 } else { break }
        }

        // base-58 → base-256 conversion
        var b256 = [UInt8]()
        for c in string {
            guard let digit = alphabetMap[c] else { return nil }
            var carry = Int(digit)
            for i in 0..<b256.count {
                let v = Int(b256[i]) * 58 + carry
                b256[i] = UInt8(v & 0xff)
                carry = v >> 8
            }
            while carry > 0 {
                b256.append(UInt8(carry & 0xff))
                carry >>= 8
            }
        }

        var result = Data(count: zeros)
        result.append(contentsOf: b256.reversed())
        return result
    }
}
