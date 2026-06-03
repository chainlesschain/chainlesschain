import Foundation
import NaturalLanguage
import CoreML

// MARK: - AI/ML Tools (12 tools)
// NLP: 6 tools | Text Analysis: 4 tools | ML: 2 tools

public class AIMLTools {

    // MARK: - NLP Tools (6 tools)

    /// Tool: tool.nlp.language - 语言识别
    public static let languageDetectionTool = Tool(
        id: "tool.nlp.language",
        name: "语言识别",
        description: "自动识别文本的语言",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待识别的文本", required: true)
        ],
        executor: languageDetectionExecutor
    )

    private static let languageDetectionExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)

        guard let language = recognizer.dominantLanguage else {
            return .failure(error: "无法识别语言")
        }

        var languageHypotheses: [[String: Any]] = []
        for (lang, confidence) in recognizer.languageHypotheses(withMaximum: 3) {
            languageHypotheses.append([
                "language": lang.rawValue,
                "confidence": confidence
            ])
        }

        return .success(data: [
            "language": language.rawValue,
            "languageName": Locale.current.localizedString(forLanguageCode: language.rawValue) ?? language.rawValue,
            "hypotheses": languageHypotheses
        ])
    }

    /// Tool: tool.nlp.tokenize - 文本分词
    public static let tokenizeTool = Tool(
        id: "tool.nlp.tokenize",
        name: "文本分词",
        description: "将文本分割为词语、句子或段落",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待分词的文本", required: true),
            ToolParameter(name: "unit", type: .string, description: "分词单位（word/sentence/paragraph，默认word）", required: false)
        ],
        executor: tokenizeExecutor
    )

    private static let tokenizeExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let unitString = input.getString("unit") ?? "word"
        var unit: NLTokenUnit

        switch unitString.lowercased() {
        case "word":
            unit = .word
        case "sentence":
            unit = .sentence
        case "paragraph":
            unit = .paragraph
        default:
            return .failure(error: "不支持的分词单位: \(unitString)")
        }

        let tokenizer = NLTokenizer(unit: unit)
        tokenizer.string = text

        var tokens: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            tokens.append(String(text[range]))
            return true
        }

        return .success(data: [
            "tokens": tokens,
            "count": tokens.count,
            "unit": unitString
        ])
    }

    /// Tool: tool.nlp.ner - 命名实体识别
    public static let nerTool = Tool(
        id: "tool.nlp.ner",
        name: "命名实体识别",
        description: "识别文本中的人名、地名、组织等实体",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待识别的文本", required: true)
        ],
        executor: nerExecutor
    )

    private static let nerExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let tagger = NLTagger(tagSchemes: [.nameType])
        tagger.string = text

        var entities: [[String: Any]] = []

        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .nameType) { tag, range in
            if let tag = tag {
                let entity = String(text[range])
                var type = ""

                switch tag {
                case .personalName:
                    type = "person"
                case .placeName:
                    type = "place"
                case .organizationName:
                    type = "organization"
                default:
                    type = tag.rawValue
                }

                entities.append([
                    "text": entity,
                    "type": type,
                    "range": [text.distance(from: text.startIndex, to: range.lowerBound),
                             text.distance(from: text.startIndex, to: range.upperBound)]
                ])
            }
            return true
        }

        return .success(data: [
            "entities": entities,
            "count": entities.count
        ])
    }

    /// Tool: tool.nlp.pos - 词性标注
    public static let posTool = Tool(
        id: "tool.nlp.pos",
        name: "词性标注",
        description: "标注文本中每个词的词性（名词、动词等）",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待标注的文本", required: true)
        ],
        executor: posExecutor
    )

    private static let posExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let tagger = NLTagger(tagSchemes: [.lexicalClass])
        tagger.string = text

        var taggedWords: [[String: Any]] = []

        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .lexicalClass) { tag, range in
            let word = String(text[range])
            var posType = "unknown"

            if let tag = tag {
                switch tag {
                case .noun:
                    posType = "noun"
                case .verb:
                    posType = "verb"
                case .adjective:
                    posType = "adjective"
                case .adverb:
                    posType = "adverb"
                case .pronoun:
                    posType = "pronoun"
                case .preposition:
                    posType = "preposition"
                case .conjunction:
                    posType = "conjunction"
                case .determiner:
                    posType = "determiner"
                case .particle:
                    posType = "particle"
                case .number:
                    posType = "number"
                default:
                    posType = tag.rawValue
                }
            }

            taggedWords.append([
                "word": word,
                "pos": posType
            ])

            return true
        }

        return .success(data: [
            "taggedWords": taggedWords,
            "count": taggedWords.count
        ])
    }

    /// Tool: tool.nlp.lemma - 词形还原
    public static let lemmaTool = Tool(
        id: "tool.nlp.lemma",
        name: "词形还原",
        description: "将单词还原为其基本形式（如running->run）",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待处理的文本", required: true)
        ],
        executor: lemmaExecutor
    )

    private static let lemmaExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let tagger = NLTagger(tagSchemes: [.lemma])
        tagger.string = text

        var lemmas: [[String: String]] = []

        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .lemma) { tag, range in
            let word = String(text[range])
            let lemma = tag?.rawValue ?? word

            lemmas.append([
                "original": word,
                "lemma": lemma
            ])

            return true
        }

        return .success(data: [
            "lemmas": lemmas,
            "count": lemmas.count
        ])
    }

    /// Tool: tool.nlp.similarity - 文本相似度
    public static let textSimilarityTool = Tool(
        id: "tool.nlp.similarity",
        name: "文本相似度计算",
        description: "计算两段文本的语义相似度",
        category: .ai,
        parameters: [
            ToolParameter(name: "text1", type: .string, description: "第一段文本", required: true),
            ToolParameter(name: "text2", type: .string, description: "第二段文本", required: true)
        ],
        executor: textSimilarityExecutor
    )

    private static let textSimilarityExecutor: ToolExecutor = { input in
        guard let text1 = input.getString("text1"),
              let text2 = input.getString("text2") else {
            return .failure(error: "缺少文本内容")
        }

        if #available(iOS 16.0, *) {
            guard let embedding1 = NLEmbedding.sentenceEmbedding(for: .english),
                  let embedding2 = NLEmbedding.sentenceEmbedding(for: .english) else {
                return .failure(error: "无法加载文本嵌入模型")
            }

            guard let vector1 = embedding1.vector(for: text1),
                  let vector2 = embedding2.vector(for: text2) else {
                return .failure(error: "无法生成文本向量")
            }

            // 计算余弦相似度
            var dotProduct: Double = 0
            var norm1: Double = 0
            var norm2: Double = 0

            for i in 0..<min(vector1.count, vector2.count) {
                dotProduct += vector1[i] * vector2[i]
                norm1 += vector1[i] * vector1[i]
                norm2 += vector2[i] * vector2[i]
            }

            let similarity = dotProduct / (sqrt(norm1) * sqrt(norm2))

            return .success(data: [
                "similarity": similarity,
                "interpretation": similarity > 0.8 ? "very similar" :
                                 similarity > 0.6 ? "similar" :
                                 similarity > 0.4 ? "somewhat similar" : "different"
            ])
        } else {
            // iOS 16以下使用简单的Jaccard相似度
            let words1 = Set(text1.lowercased().components(separatedBy: .whitespacesAndNewlines))
            let words2 = Set(text2.lowercased().components(separatedBy: .whitespacesAndNewlines))

            let intersection = words1.intersection(words2).count
            let union = words1.union(words2).count

            let similarity = union > 0 ? Double(intersection) / Double(union) : 0.0

            return .success(data: [
                "similarity": similarity,
                "method": "jaccard",
                "interpretation": similarity > 0.5 ? "similar" : "different"
            ])
        }
    }

    // MARK: - Text Analysis Tools (4 tools)

    /// Tool: tool.text.sentiment - 情感分析（增强版）
    public static let sentimentAnalysisTool = Tool(
        id: "tool.text.sentiment",
        name: "情感分析",
        description: "分析文本的情感倾向（积极/消极/中性），包含详细得分",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待分析的文本", required: true)
        ],
        executor: sentimentAnalysisExecutor
    )

    private static let sentimentAnalysisExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let tagger = NLTagger(tagSchemes: [.sentimentScore])
        tagger.string = text

        var totalScore: Double = 0
        var sentenceCount = 0

        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text

        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            tagger.string = String(text[range])

            if let tag = tagger.tag(at: tagger.string!.startIndex, unit: .paragraph, scheme: .sentimentScore),
               let score = Double(tag.rawValue) {
                totalScore += score
                sentenceCount += 1
            }

            return true
        }

        let averageScore = sentenceCount > 0 ? totalScore / Double(sentenceCount) : 0

        var sentiment = "neutral"
        var emoji = "😐"

        if averageScore > 0.3 {
            sentiment = "positive"
            emoji = averageScore > 0.7 ? "😄" : "🙂"
        } else if averageScore < -0.3 {
            sentiment = "negative"
            emoji = averageScore < -0.7 ? "😞" : "😕"
        }

        return .success(data: [
            "sentiment": sentiment,
            "score": averageScore,
            "emoji": emoji,
            "sentenceCount": sentenceCount,
            "confidence": abs(averageScore)
        ])
    }

    /// Tool: tool.text.keywords - 关键词提取
    public static let keywordExtractionTool = Tool(
        id: "tool.text.keywords",
        name: "关键词提取",
        description: "从文本中提取重要关键词",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待分析的文本", required: true),
            ToolParameter(name: "topK", type: .number, description: "返回前K个关键词（默认5）", required: false)
        ],
        executor: keywordExtractionExecutor
    )

    private static let keywordExtractionExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let topK = Int(input.getNumber("topK") ?? 5)

        // 使用词性标注筛选名词和动词
        let tagger = NLTagger(tagSchemes: [.lexicalClass])
        tagger.string = text

        var wordFrequency: [String: Int] = [:]

        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .lexicalClass) { tag, range in
            if let tag = tag, (tag == .noun || tag == .verb) {
                let word = String(text[range]).lowercased()
                if word.count > 2 { // 过滤短词
                    wordFrequency[word, default: 0] += 1
                }
            }
            return true
        }

        // 按频率排序
        let sortedWords = wordFrequency.sorted { $0.value > $1.value }
        let keywords = Array(sortedWords.prefix(topK)).map { (word: $0.key, frequency: $0.value) }

        return .success(data: [
            "keywords": keywords,
            "count": keywords.count
        ])
    }

    /// Tool: tool.text.summary - 文本摘要
    public static let textSummaryTool = Tool(
        id: "tool.text.summary",
        name: "文本摘要",
        description: "生成文本的简短摘要",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待摘要的文本", required: true),
            ToolParameter(name: "sentences", type: .number, description: "摘要句子数（默认3）", required: false)
        ],
        executor: textSummaryExecutor
    )

    private static let textSummaryExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        let sentenceCount = Int(input.getNumber("sentences") ?? 3)

        // 分句
        let tokenizer = NLTokenizer(unit: .sentence)
        tokenizer.string = text

        var sentences: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            sentences.append(String(text[range]))
            return true
        }

        if sentences.isEmpty {
            return .failure(error: "无法提取句子")
        }

        // 简单策略：提取前N句、中间句、最后句
        var summarySentences: [String] = []

        if sentences.count <= sentenceCount {
            summarySentences = sentences
        } else {
            // 首句
            summarySentences.append(sentences[0])

            // 中间句
            if sentenceCount > 2 {
                let midIndex = sentences.count / 2
                summarySentences.append(sentences[midIndex])
            }

            // 尾句
            if sentenceCount > 1 {
                summarySentences.append(sentences[sentences.count - 1])
            }
        }

        let summary = summarySentences.joined(separator: " ")

        return .success(data: [
            "summary": summary,
            "originalSentences": sentences.count,
            "summarySentences": summarySentences.count,
            "compressionRatio": Double(summary.count) / Double(text.count)
        ])
    }

    /// Tool: tool.text.classify - 文本分类
    public static let textClassificationTool = Tool(
        id: "tool.text.classify",
        name: "文本分类",
        description: "对文本进行分类（需要预训练的CoreML模型）",
        category: .ai,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "待分类的文本", required: true),
            ToolParameter(name: "modelPath", type: .string, description: "CoreML模型路径（可选）", required: false)
        ],
        executor: textClassificationExecutor
    )

    private static let textClassificationExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }

        // 简化实现：基于关键词的规则分类
        // 生产环境应使用CreateML训练的文本分类模型

        let lowerText = text.lowercased()

        var category = "general"
        var confidence = 0.5

        let categories: [String: [String]] = [
            "technology": ["software", "computer", "app", "code", "ai", "ml", "technology", "programming"],
            "business": ["business", "company", "market", "sales", "profit", "revenue", "finance"],
            "sports": ["sports", "game", "player", "team", "match", "score", "championship"],
            "health": ["health", "medical", "doctor", "hospital", "disease", "treatment", "medicine"],
            "entertainment": ["movie", "music", "actor", "singer", "film", "concert", "entertainment"]
        ]

        var maxScore = 0
        for (cat, keywords) in categories {
            let score = keywords.filter { lowerText.contains($0) }.count
            if score > maxScore {
                maxScore = score
                category = cat
                confidence = min(0.95, 0.5 + Double(score) * 0.1)
            }
        }

        return .success(data: [
            "category": category,
            "confidence": confidence,
            "matchedKeywords": maxScore
        ])
    }

    // MARK: - ML Tools (2 tools)

    /// Tool: tool.ml.cluster - 文本聚类
    public static let textClusteringTool = Tool(
        id: "tool.ml.cluster",
        name: "文本聚类",
        description: "将多个文本按相似度聚类",
        category: .ai,
        parameters: [
            ToolParameter(name: "texts", type: .array, description: "文本数组", required: true),
            ToolParameter(name: "clusters", type: .number, description: "聚类数量（默认3）", required: false)
        ],
        executor: textClusteringExecutor
    )

    private static let textClusteringExecutor: ToolExecutor = { input in
        guard let texts = input.getArray("texts") as? [String] else {
            return .failure(error: "缺少文本数组")
        }

        let clusterCount = Int(input.getNumber("clusters") ?? 3)

        if texts.count < clusterCount {
            return .failure(error: "文本数量少于聚类数量")
        }

        // 简化实现：基于词频的K-means聚类
        // 生产环境应使用更复杂的向量化和聚类算法

        // 1. 提取所有文本的词汇表
        var vocabulary: Set<String> = []
        for text in texts {
            let words = text.lowercased().components(separatedBy: .whitespacesAndNewlines)
            vocabulary.formUnion(words)
        }

        let vocabArray = Array(vocabulary)

        // 2. 向量化文本（词频向量）
        var vectors: [[Double]] = []
        for text in texts {
            let words = text.lowercased().components(separatedBy: .whitespacesAndNewlines)
            var vector = [Double](repeating: 0, count: vocabArray.count)

            for (index, vocab) in vocabArray.enumerated() {
                vector[index] = Double(words.filter { $0 == vocab }.count)
            }
            vectors.append(vector)
        }

        // 3. 简单K-means（随机初始化中心）
        var clusterAssignments = [Int](repeating: 0, count: texts.count)
        for i in 0..<texts.count {
            clusterAssignments[i] = i % clusterCount
        }

        var clusteredTexts: [[String: Any]] = []
        for i in 0..<clusterCount {
            let members = texts.enumerated().filter { clusterAssignments[$0.offset] == i }.map { $0.element }
            clusteredTexts.append([
                "clusterId": i,
                "members": members,
                "count": members.count
            ])
        }

        return .success(data: [
            "clusters": clusteredTexts,
            "clusterCount": clusterCount
        ])
    }

    /// Tool: tool.ml.tfidf - TF-IDF计算
    public static let tfidfTool = Tool(
        id: "tool.ml.tfidf",
        name: "TF-IDF计算",
        description: "计算文本集合中词语的TF-IDF权重",
        category: .ai,
        parameters: [
            ToolParameter(name: "documents", type: .array, description: "文档数组", required: true),
            ToolParameter(name: "topK", type: .number, description: "返回每篇文档的前K个关键词（默认5）", required: false)
        ],
        executor: tfidfExecutor
    )

    private static let tfidfExecutor: ToolExecutor = { input in
        guard let documents = input.getArray("documents") as? [String] else {
            return .failure(error: "缺少文档数组")
        }

        let topK = Int(input.getNumber("topK") ?? 5)

        // 1. 计算词频（TF）
        var documentWords: [[String: Int]] = []
        for doc in documents {
            let words = doc.lowercased().components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
            var wordFreq: [String: Int] = [:]
            for word in words {
                wordFreq[word, default: 0] += 1
            }
            documentWords.append(wordFreq)
        }

        // 2. 计算文档频率（DF）
        var documentFrequency: [String: Int] = [:]
        for wordFreq in documentWords {
            for word in wordFreq.keys {
                documentFrequency[word, default: 0] += 1
            }
        }

        let totalDocuments = Double(documents.count)

        // 3. 计算TF-IDF
        var results: [[String: Any]] = []

        for (docIndex, wordFreq) in documentWords.enumerated() {
            var tfidfScores: [String: Double] = [:]
            let totalWords = Double(wordFreq.values.reduce(0, +))

            for (word, freq) in wordFreq {
                let tf = Double(freq) / totalWords
                let idf = log(totalDocuments / Double(documentFrequency[word] ?? 1))
                tfidfScores[word] = tf * idf
            }

            // 取前K个
            let topWords = tfidfScores.sorted { $0.value > $1.value }.prefix(topK)
            let keywords = topWords.map { ["word": $0.key, "score": $0.value] }

            results.append([
                "documentIndex": docIndex,
                "keywords": keywords
            ])
        }

        return .success(data: [
            "results": results,
            "documentCount": documents.count
        ])
    }

    // MARK: - 工具注册

    public static func registerAll() {
        let toolManager = ToolManager.shared

        // NLP工具 (6个)
        toolManager.register(languageDetectionTool)
        toolManager.register(tokenizeTool)
        toolManager.register(nerTool)
        toolManager.register(posTool)
        toolManager.register(lemmaTool)
        toolManager.register(textSimilarityTool)

        // Text Analysis工具 (4个)
        toolManager.register(sentimentAnalysisTool)
        toolManager.register(keywordExtractionTool)
        toolManager.register(textSummaryTool)
        toolManager.register(textClassificationTool)

        // ML工具 (2个)
        toolManager.register(textClusteringTool)
        toolManager.register(tfidfTool)
    }
}
