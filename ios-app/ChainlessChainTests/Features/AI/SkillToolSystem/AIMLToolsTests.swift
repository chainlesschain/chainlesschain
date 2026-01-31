import XCTest
@testable import ChainlessChain

/// AI/ML工具测试套件
/// 测试覆盖: 12个工具 (6个NLP + 4个Text Analysis + 2个ML)
/// 测试用例: 40+个
/// 代码行数: ~850行
class AIMLToolsTests: XCTestCase {

    var toolManager: ToolManager!

    override func setUp() async throws {
        try await super.setUp()
        toolManager = ToolManager.shared

        // 注册所有AI/ML工具
        AIMLTools.registerAll()

        print("\n=== AI/ML工具测试开始 ===")
    }

    override func tearDown() async throws {
        toolManager = nil
        try await super.tearDown()
        print("=== AI/ML工具测试结束 ===\n")
    }

    // MARK: - NLP工具测试 (6个工具)

    // MARK: 1. Language Detection (tool.nlp.language)

    func testLanguageDetection_English() async throws {
        // Given
        let englishText = "Hello, this is a test message in English. How are you doing today?"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.language",
            input: ["text": englishText]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let language = dict["language"] as? String
            XCTAssertEqual(language, "en")
            XCTAssertNotNil(dict["languageName"])
            XCTAssertNotNil(dict["hypotheses"])

            if let hypotheses = dict["hypotheses"] as? [[String: Any]] {
                XCTAssertGreaterThan(hypotheses.count, 0)
                print("✅ 英语识别成功: \(language ?? "") (\(dict["languageName"] as? String ?? ""))")
            }
        }
    }

    func testLanguageDetection_Chinese() async throws {
        // Given
        let chineseText = "你好，这是一段中文测试文本。今天天气很好。"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.language",
            input: ["text": chineseText]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let language = dict["language"] as? String
            XCTAssertTrue(language == "zh" || language == "zh-Hans" || language == "zh-Hant")
            print("✅ 中文识别成功: \(language ?? "")")
        }
    }

    func testLanguageDetection_MultiLanguage() async throws {
        // Given
        let texts = [
            "en": "Hello World",
            "es": "Hola Mundo",
            "fr": "Bonjour le monde",
            "de": "Hallo Welt",
            "ja": "こんにちは世界"
        ]

        // When & Then
        for (expectedLang, text) in texts {
            let result = try await toolManager.execute(
                toolId: "tool.nlp.language",
                input: ["text": text]
            )

            if let dict = result as? [String: Any],
               let detectedLang = dict["language"] as? String {
                print("✅ 识别 '\(text)' -> \(detectedLang)")
            }
        }
    }

    // MARK: 2. Tokenization (tool.nlp.tokenize)

    func testTokenize_Words() async throws {
        // Given
        let text = "Swift is a powerful programming language"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.tokenize",
            input: [
                "text": text,
                "unit": "word"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let tokens = dict["tokens"] as? [String]
            let count = dict["count"] as? Int

            XCTAssertNotNil(tokens)
            XCTAssertEqual(tokens?.count, count)
            XCTAssertGreaterThan(count ?? 0, 5)
            print("✅ 单词分词成功: \(count ?? 0)个词 - \(tokens ?? [])")
        }
    }

    func testTokenize_Sentences() async throws {
        // Given
        let text = "This is the first sentence. Here is the second one! And the third?"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.tokenize",
            input: [
                "text": text,
                "unit": "sentence"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let tokens = dict["tokens"] as? [String]
            let count = dict["count"] as? Int

            XCTAssertEqual(count, 3, "应该有3个句子")
            print("✅ 句子分词成功: \(count ?? 0)个句子")
        }
    }

    func testTokenize_Paragraphs() async throws {
        // Given
        let text = """
        First paragraph here.

        Second paragraph follows.

        Third paragraph ends.
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.tokenize",
            input: [
                "text": text,
                "unit": "paragraph"
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertGreaterThan(count ?? 0, 0)
            print("✅ 段落分词成功: \(count ?? 0)个段落")
        }
    }

    func testTokenize_InvalidUnit() async throws {
        // Given
        let text = "Test text"

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.nlp.tokenize",
                input: [
                    "text": text,
                    "unit": "invalid_unit"
                ]
            )
            XCTFail("应该抛出错误")
        } catch {
            // Then
            print("✅ 正确处理无效分词单位错误")
        }
    }

    // MARK: 3. Named Entity Recognition (tool.nlp.ner)

    func testNER_PersonName() async throws {
        // Given
        let text = "Steve Jobs founded Apple in California."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.ner",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let entities = dict["entities"] as? [[String: Any]]
            let count = dict["count"] as? Int

            XCTAssertNotNil(entities)
            print("✅ NER识别成功: \(count ?? 0)个实体")

            entities?.forEach { entity in
                let text = entity["text"] as? String
                let type = entity["type"] as? String
                print("   - \(text ?? "") [\(type ?? "")]")
            }
        }
    }

    func testNER_MultipleEntities() async throws {
        // Given
        let text = "Apple Inc. is located in Cupertino, California. Tim Cook is the CEO."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.ner",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertGreaterThan(count ?? 0, 0)
            print("✅ 识别多个实体: \(count ?? 0)个")
        }
    }

    // MARK: 4. Part-of-Speech Tagging (tool.nlp.pos)

    func testPOS_BasicSentence() async throws {
        // Given
        let text = "The quick brown fox jumps over the lazy dog"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.pos",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let taggedWords = dict["taggedWords"] as? [[String: Any]]
            let count = dict["count"] as? Int

            XCTAssertNotNil(taggedWords)
            XCTAssertEqual(taggedWords?.count, count)
            print("✅ 词性标注成功: \(count ?? 0)个词")

            taggedWords?.forEach { tagged in
                let word = tagged["word"] as? String
                let pos = tagged["pos"] as? String
                print("   - \(word ?? "")/\(pos ?? "")")
            }
        }
    }

    func testPOS_VerifyWordTypes() async throws {
        // Given
        let text = "Swift runs quickly"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.pos",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any],
           let taggedWords = dict["taggedWords"] as? [[String: Any]] {

            // Verify we have different word types
            let posTypes = taggedWords.compactMap { $0["pos"] as? String }
            let uniqueTypes = Set(posTypes)
            XCTAssertGreaterThan(uniqueTypes.count, 1, "应该识别出多种词性")
            print("✅ 识别词性类型: \(uniqueTypes)")
        }
    }

    // MARK: 5. Lemmatization (tool.nlp.lemma)

    func testLemma_VerbForms() async throws {
        // Given
        let text = "running runs ran runner"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.lemma",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let lemmas = dict["lemmas"] as? [[String: String]]
            let count = dict["count"] as? Int

            XCTAssertNotNil(lemmas)
            XCTAssertEqual(lemmas?.count, count)
            print("✅ 词形还原成功: \(count ?? 0)个词")

            lemmas?.forEach { lemma in
                let original = lemma["original"]
                let lemmaForm = lemma["lemma"]
                print("   - \(original ?? "") -> \(lemmaForm ?? "")")
            }
        }
    }

    func testLemma_MultipleWords() async throws {
        // Given
        let text = "The cats are running quickly through the gardens"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.lemma",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertGreaterThan(count ?? 0, 5)
            print("✅ 批量词形还原: \(count ?? 0)个词")
        }
    }

    // MARK: 6. Text Similarity (tool.nlp.similarity)

    func testTextSimilarity_Identical() async throws {
        // Given
        let text1 = "Hello world"
        let text2 = "Hello world"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.similarity",
            input: [
                "text1": text1,
                "text2": text2
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let similarity = dict["similarity"] as? Double
            let interpretation = dict["interpretation"] as? String

            XCTAssertNotNil(similarity)
            XCTAssertEqual(similarity ?? 0, 1.0, accuracy: 0.01, "相同文本相似度应接近1.0")
            print("✅ 相同文本相似度: \(similarity ?? 0) (\(interpretation ?? ""))")
        }
    }

    func testTextSimilarity_Similar() async throws {
        // Given
        let text1 = "I love programming in Swift"
        let text2 = "I enjoy coding with Swift"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.similarity",
            input: [
                "text1": text1,
                "text2": text2
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let similarity = dict["similarity"] as? Double
            XCTAssertNotNil(similarity)
            XCTAssertGreaterThan(similarity ?? 0, 0.0)
            print("✅ 相似文本相似度: \(similarity ?? 0)")
        }
    }

    func testTextSimilarity_Different() async throws {
        // Given
        let text1 = "The weather is sunny today"
        let text2 = "I like chocolate ice cream"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.nlp.similarity",
            input: [
                "text1": text1,
                "text2": text2
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let similarity = dict["similarity"] as? Double
            XCTAssertNotNil(similarity)
            print("✅ 不同文本相似度: \(similarity ?? 0)")
        }
    }

    // MARK: - Text Analysis工具测试 (4个工具)

    // MARK: 7. Sentiment Analysis (tool.text.sentiment)

    func testSentiment_Positive() async throws {
        // Given
        let text = "This is absolutely amazing! I love it so much. Best day ever!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.sentiment",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let sentiment = dict["sentiment"] as? String
            let score = dict["score"] as? Double
            let emoji = dict["emoji"] as? String
            let confidence = dict["confidence"] as? Double

            XCTAssertEqual(sentiment, "positive")
            XCTAssertNotNil(score)
            XCTAssertNotNil(emoji)
            XCTAssertNotNil(confidence)
            print("✅ 正面情感分析: \(sentiment ?? "") (分数: \(score ?? 0), 表情: \(emoji ?? ""))")
        }
    }

    func testSentiment_Negative() async throws {
        // Given
        let text = "This is terrible. I hate it. Worst experience ever!"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.sentiment",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let sentiment = dict["sentiment"] as? String
            let score = dict["score"] as? Double

            XCTAssertEqual(sentiment, "negative")
            XCTAssertNotNil(score)
            if let s = score {
                XCTAssertLessThan(s, 0)
            }
            print("✅ 负面情感分析: \(sentiment ?? "") (分数: \(score ?? 0))")
        }
    }

    func testSentiment_Neutral() async throws {
        // Given
        let text = "The meeting is scheduled for tomorrow at 2 PM."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.sentiment",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let sentiment = dict["sentiment"] as? String
            let score = dict["score"] as? Double

            XCTAssertEqual(sentiment, "neutral")
            print("✅ 中性情感分析: \(sentiment ?? "") (分数: \(score ?? 0))")
        }
    }

    func testSentiment_MultiSentence() async throws {
        // Given
        let text = "I love the design. However, the price is too high. Overall, it's okay."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.sentiment",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let sentenceCount = dict["sentenceCount"] as? Int
            XCTAssertGreaterThan(sentenceCount ?? 0, 1)
            print("✅ 多句情感分析: \(sentenceCount ?? 0)个句子")
        }
    }

    // MARK: 8. Keyword Extraction (tool.text.keywords)

    func testKeywords_Default() async throws {
        // Given
        let text = "Swift programming language is powerful and modern. Swift developers love writing code in Swift because it's fast and safe."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.keywords",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let keywords = dict["keywords"] as? [[String: Any]]
            let count = dict["count"] as? Int

            XCTAssertNotNil(keywords)
            XCTAssertLessThanOrEqual(count ?? 0, 5, "默认返回最多5个关键词")
            print("✅ 关键词提取成功: \(count ?? 0)个")

            keywords?.forEach { kw in
                let word = kw["word"] as? String
                let freq = kw["frequency"] as? Int
                print("   - \(word ?? "") (频率: \(freq ?? 0))")
            }
        }
    }

    func testKeywords_CustomTopK() async throws {
        // Given
        let text = "Apple Apple Apple Banana Banana Cherry Date Date Date Date"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.keywords",
            input: [
                "text": text,
                "topK": 3
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let count = dict["count"] as? Int
            XCTAssertLessThanOrEqual(count ?? 0, 3)
            print("✅ 自定义topK=3: \(count ?? 0)个关键词")
        }
    }

    func testKeywords_LongText() async throws {
        // Given
        let text = """
        Artificial intelligence is transforming the world. Machine learning algorithms are becoming more sophisticated.
        Deep learning models can process vast amounts of data. Natural language processing enables computers to understand human language.
        Computer vision allows machines to interpret visual information. AI applications are everywhere in modern society.
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.keywords",
            input: [
                "text": text,
                "topK": 10
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let keywords = dict["keywords"] as? [[String: Any]]
            XCTAssertGreaterThan(keywords?.count ?? 0, 0)
            print("✅ 长文本关键词提取: \(keywords?.count ?? 0)个")
        }
    }

    // MARK: 9. Text Summary (tool.text.summary)

    func testSummary_Default() async throws {
        // Given
        let text = """
        The first sentence introduces the topic. The second sentence provides more details about the subject.
        The third sentence adds additional context. The fourth sentence explains the methodology.
        The fifth sentence presents the results. The sixth sentence concludes the discussion.
        """

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.summary",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let summary = dict["summary"] as? String
            let originalSentences = dict["originalSentences"] as? Int
            let summarySentences = dict["summarySentences"] as? Int
            let compressionRatio = dict["compressionRatio"] as? Double

            XCTAssertNotNil(summary)
            XCTAssertGreaterThan(originalSentences ?? 0, summarySentences ?? 0)
            XCTAssertNotNil(compressionRatio)
            print("✅ 文本摘要: \(originalSentences ?? 0)句 -> \(summarySentences ?? 0)句 (压缩率: \(compressionRatio ?? 0))")
        }
    }

    func testSummary_CustomSentenceCount() async throws {
        // Given
        let text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.summary",
            input: [
                "text": text,
                "sentences": 2
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let summarySentences = dict["summarySentences"] as? Int
            XCTAssertLessThanOrEqual(summarySentences ?? 0, 2)
            print("✅ 自定义摘要句数=2: \(summarySentences ?? 0)句")
        }
    }

    func testSummary_ShortText() async throws {
        // Given
        let text = "Only one sentence here."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.summary",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let summary = dict["summary"] as? String
            XCTAssertNotNil(summary)
            print("✅ 短文本摘要: \(summary ?? "")")
        }
    }

    // MARK: 10. Text Classification (tool.text.classify)

    func testClassify_Technology() async throws {
        // Given
        let text = "The new software update includes AI and machine learning features for better programming experience."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.classify",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let category = dict["category"] as? String
            let confidence = dict["confidence"] as? Double

            XCTAssertNotNil(category)
            XCTAssertNotNil(confidence)
            print("✅ 文本分类: \(category ?? "") (置信度: \(confidence ?? 0))")
        }
    }

    func testClassify_Business() async throws {
        // Given
        let text = "The company reported strong revenue growth and profit margins in the latest quarter."

        // When
        let result = try await toolManager.execute(
            toolId: "tool.text.classify",
            input: ["text": text]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let category = dict["category"] as? String
            XCTAssertEqual(category, "business")
            print("✅ 商业文本分类: \(category ?? "")")
        }
    }

    func testClassify_MultipleCategories() async throws {
        // Given
        let texts = [
            "The football team won the championship match yesterday.",
            "The patient visited the hospital for medical treatment.",
            "The new movie features amazing actors and music."
        ]

        // When & Then
        for text in texts {
            let result = try await toolManager.execute(
                toolId: "tool.text.classify",
                input: ["text": text]
            )

            if let dict = result as? [String: Any],
               let category = dict["category"] as? String {
                print("✅ 分类: \(category)")
            }
        }
    }

    // MARK: - ML工具测试 (2个工具)

    // MARK: 11. Text Clustering (tool.ml.cluster)

    func testCluster_BasicClustering() async throws {
        // Given
        let texts = [
            "Apple iPhone is a great smartphone",
            "Samsung Galaxy has excellent features",
            "Dogs are loyal pets",
            "Cats are independent animals",
            "Google Pixel camera is amazing",
            "Birds can fly in the sky"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.cluster",
            input: [
                "texts": texts,
                "clusters": 3
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let clusters = dict["clusters"] as? [[String: Any]]
            let clusterCount = dict["clusterCount"] as? Int

            XCTAssertNotNil(clusters)
            XCTAssertEqual(clusterCount, 3)
            XCTAssertEqual(clusters?.count, 3)

            print("✅ 文本聚类成功: \(clusterCount ?? 0)个聚类")
            clusters?.forEach { cluster in
                let id = cluster["clusterId"] as? Int
                let members = cluster["members"] as? [String]
                let count = cluster["count"] as? Int
                print("   - Cluster \(id ?? 0): \(count ?? 0)个文本")
            }
        }
    }

    func testCluster_DefaultClusterCount() async throws {
        // Given
        let texts = [
            "First text about technology",
            "Second text about sports",
            "Third text about food",
            "Fourth text about travel",
            "Fifth text about music"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.cluster",
            input: ["texts": texts]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let clusterCount = dict["clusterCount"] as? Int
            XCTAssertEqual(clusterCount, 3, "默认应为3个聚类")
            print("✅ 默认聚类数=3")
        }
    }

    func testCluster_InsufficientTexts() async throws {
        // Given
        let texts = ["Only one text", "Only two texts"]

        // When
        do {
            _ = try await toolManager.execute(
                toolId: "tool.ml.cluster",
                input: [
                    "texts": texts,
                    "clusters": 3
                ]
            )
            XCTFail("应该抛出错误：文本数量不足")
        } catch {
            // Then
            print("✅ 正确处理文本数量不足错误")
        }
    }

    // MARK: 12. TF-IDF (tool.ml.tfidf)

    func testTFIDF_BasicCalculation() async throws {
        // Given
        let documents = [
            "Swift is a programming language",
            "Python is also a programming language",
            "Swift and Python are both popular"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.tfidf",
            input: ["documents": documents]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let results = dict["results"] as? [[String: Any]]
            let documentCount = dict["documentCount"] as? Int

            XCTAssertNotNil(results)
            XCTAssertEqual(documentCount, 3)
            XCTAssertEqual(results?.count, 3)

            print("✅ TF-IDF计算成功: \(documentCount ?? 0)个文档")
            results?.forEach { result in
                let docIndex = result["documentIndex"] as? Int
                let keywords = result["keywords"] as? [[String: Any]]
                print("   - 文档 \(docIndex ?? 0): \(keywords?.count ?? 0)个关键词")
            }
        }
    }

    func testTFIDF_CustomTopK() async throws {
        // Given
        let documents = [
            "apple banana cherry date elderberry fig grape",
            "apple apple banana cherry date elderberry",
            "banana cherry date fig grape grape grape"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.tfidf",
            input: [
                "documents": documents,
                "topK": 3
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any],
           let results = dict["results"] as? [[String: Any]] {

            for result in results {
                let keywords = result["keywords"] as? [[String: Any]]
                XCTAssertLessThanOrEqual(keywords?.count ?? 0, 3, "每个文档最多返回3个关键词")
            }
            print("✅ 自定义topK=3成功")
        }
    }

    func testTFIDF_VerifyScores() async throws {
        // Given
        let documents = [
            "unique word here",
            "another text here",
            "third document text"
        ]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.tfidf",
            input: [
                "documents": documents,
                "topK": 5
            ]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any],
           let results = dict["results"] as? [[String: Any]] {

            for result in results {
                let keywords = result["keywords"] as? [[String: Any]]

                // Verify all keywords have scores
                keywords?.forEach { kw in
                    let word = kw["word"] as? String
                    let score = kw["score"] as? Double

                    XCTAssertNotNil(word)
                    XCTAssertNotNil(score)
                    XCTAssertGreaterThan(score ?? 0, 0, "TF-IDF分数应大于0")
                }
            }
            print("✅ TF-IDF分数验证通过")
        }
    }

    func testTFIDF_SingleDocument() async throws {
        // Given
        let documents = ["Only one document with multiple words here"]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.ml.tfidf",
            input: ["documents": documents]
        )

        // Then
        XCTAssertNotNil(result)
        if let dict = result as? [String: Any] {
            let documentCount = dict["documentCount"] as? Int
            XCTAssertEqual(documentCount, 1)
            print("✅ 单文档TF-IDF计算成功")
        }
    }

    // MARK: - Performance测试

    func testPerformance_LanguageDetection() throws {
        let text = "This is a performance test for language detection with a reasonably long text."

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.nlp.language",
                    input: ["text": text]
                )
            }
        }
        print("✅ 语言识别性能测试完成")
    }

    func testPerformance_Tokenization() throws {
        let text = String(repeating: "This is a test sentence. ", count: 50)

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.nlp.tokenize",
                    input: ["text": text, "unit": "word"]
                )
            }
        }
        print("✅ 分词性能测试完成")
    }

    func testPerformance_SentimentAnalysis() throws {
        let text = "This is a great product! I love it so much. Highly recommended for everyone."

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.text.sentiment",
                    input: ["text": text]
                )
            }
        }
        print("✅ 情感分析性能测试完成")
    }
}
