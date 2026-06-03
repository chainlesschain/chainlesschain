package com.chainlesschain.android.feature.project.editor

/**
 * 关键字提供者
 *
 * 为14种编程语言提供关键字补全
 */
object KeywordProvider {

    /**
     * 获取指定语言的关键字列表
     */
    fun getKeywords(language: String): List<CompletionItem> {
        return when (language.lowercase()) {
            "kotlin", "kt" -> kotlinKeywords
            "java" -> javaKeywords
            "python", "py" -> pythonKeywords
            "javascript", "js" -> javascriptKeywords
            "typescript", "ts" -> typescriptKeywords
            "cpp", "c++" -> cppKeywords
            "c" -> cKeywords
            "go" -> goKeywords
            "rust", "rs" -> rustKeywords
            "swift" -> swiftKeywords
            "dart" -> dartKeywords
            "ruby", "rb" -> rubyKeywords
            "php" -> phpKeywords
            "html" -> htmlKeywords
            else -> emptyList()
        }
    }

    /**
     * 检测文件语言（通过扩展名）
     */
    fun detectLanguage(fileName: String): String {
        val extension = fileName.substringAfterLast('.', "")
        return when (extension.lowercase()) {
            "kt", "kts" -> "kotlin"
            "java" -> "java"
            "py", "pyw" -> "python"
            "js", "mjs" -> "javascript"
            "ts", "tsx" -> "typescript"
            "cpp", "cc", "cxx", "hpp" -> "cpp"
            "c", "h" -> "c"
            "go" -> "go"
            "rs" -> "rust"
            "swift" -> "swift"
            "dart" -> "dart"
            "rb" -> "ruby"
            "php" -> "php"
            "html", "htm" -> "html"
            else -> "unknown"
        }
    }

    // Kotlin关键字
    private val kotlinKeywords = listOf(
        CompletionItem("abstract", CompletionItemType.KEYWORD, "abstract class/function modifier"),
        CompletionItem("actual", CompletionItemType.KEYWORD, "actual implementation in multiplatform"),
        CompletionItem("annotation", CompletionItemType.KEYWORD, "annotation class"),
        CompletionItem("as", CompletionItemType.KEYWORD, "type cast operator"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break loop"),
        CompletionItem("by", CompletionItemType.KEYWORD, "delegation"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("companion", CompletionItemType.KEYWORD, "companion object"),
        CompletionItem("const", CompletionItemType.KEYWORD, "compile-time constant"),
        CompletionItem("constructor", CompletionItemType.KEYWORD, "constructor"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue loop"),
        CompletionItem("crossinline", CompletionItemType.KEYWORD, "crossinline modifier"),
        CompletionItem("data", CompletionItemType.KEYWORD, "data class"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum class"),
        CompletionItem("expect", CompletionItemType.KEYWORD, "expect declaration"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("final", CompletionItemType.KEYWORD, "final modifier"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("fun", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("get", CompletionItemType.KEYWORD, "property getter"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import declaration"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("infix", CompletionItemType.KEYWORD, "infix function"),
        CompletionItem("init", CompletionItemType.KEYWORD, "init block"),
        CompletionItem("inline", CompletionItemType.KEYWORD, "inline function"),
        CompletionItem("inner", CompletionItemType.KEYWORD, "inner class"),
        CompletionItem("interface", CompletionItemType.KEYWORD, "interface declaration"),
        CompletionItem("internal", CompletionItemType.KEYWORD, "internal visibility"),
        CompletionItem("is", CompletionItemType.KEYWORD, "type check operator"),
        CompletionItem("lateinit", CompletionItemType.KEYWORD, "lateinit var"),
        CompletionItem("noinline", CompletionItemType.KEYWORD, "noinline parameter"),
        CompletionItem("null", CompletionItemType.KEYWORD, "null value"),
        CompletionItem("object", CompletionItemType.KEYWORD, "object declaration"),
        CompletionItem("open", CompletionItemType.KEYWORD, "open class/function"),
        CompletionItem("operator", CompletionItemType.KEYWORD, "operator function"),
        CompletionItem("out", CompletionItemType.KEYWORD, "out variance"),
        CompletionItem("override", CompletionItemType.KEYWORD, "override function"),
        CompletionItem("package", CompletionItemType.KEYWORD, "package declaration"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private visibility"),
        CompletionItem("protected", CompletionItemType.KEYWORD, "protected visibility"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public visibility"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("sealed", CompletionItemType.KEYWORD, "sealed class"),
        CompletionItem("set", CompletionItemType.KEYWORD, "property setter"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super reference"),
        CompletionItem("suspend", CompletionItemType.KEYWORD, "suspend function"),
        CompletionItem("tailrec", CompletionItemType.KEYWORD, "tail-recursive function"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this reference"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("typealias", CompletionItemType.KEYWORD, "type alias"),
        CompletionItem("val", CompletionItemType.KEYWORD, "immutable variable"),
        CompletionItem("var", CompletionItemType.KEYWORD, "mutable variable"),
        CompletionItem("vararg", CompletionItemType.KEYWORD, "variable arguments"),
        CompletionItem("when", CompletionItemType.KEYWORD, "when expression"),
        CompletionItem("where", CompletionItemType.KEYWORD, "where clause"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // Java关键字
    private val javaKeywords = listOf(
        CompletionItem("abstract", CompletionItemType.KEYWORD, "abstract modifier"),
        CompletionItem("assert", CompletionItemType.KEYWORD, "assertion"),
        CompletionItem("boolean", CompletionItemType.KEYWORD, "boolean type"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("byte", CompletionItemType.KEYWORD, "byte type"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("char", CompletionItemType.KEYWORD, "character type"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant (unused)"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("double", CompletionItemType.KEYWORD, "double type"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum type"),
        CompletionItem("extends", CompletionItemType.KEYWORD, "class inheritance"),
        CompletionItem("final", CompletionItemType.KEYWORD, "final modifier"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("float", CompletionItemType.KEYWORD, "float type"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("goto", CompletionItemType.KEYWORD, "goto (unused)"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("implements", CompletionItemType.KEYWORD, "interface implementation"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import statement"),
        CompletionItem("instanceof", CompletionItemType.KEYWORD, "type check"),
        CompletionItem("int", CompletionItemType.KEYWORD, "integer type"),
        CompletionItem("interface", CompletionItemType.KEYWORD, "interface declaration"),
        CompletionItem("long", CompletionItemType.KEYWORD, "long type"),
        CompletionItem("native", CompletionItemType.KEYWORD, "native modifier"),
        CompletionItem("new", CompletionItemType.KEYWORD, "object creation"),
        CompletionItem("null", CompletionItemType.KEYWORD, "null value"),
        CompletionItem("package", CompletionItemType.KEYWORD, "package declaration"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private visibility"),
        CompletionItem("protected", CompletionItemType.KEYWORD, "protected visibility"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public visibility"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("short", CompletionItemType.KEYWORD, "short type"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static modifier"),
        CompletionItem("strictfp", CompletionItemType.KEYWORD, "strict floating point"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super reference"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("synchronized", CompletionItemType.KEYWORD, "synchronized block"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this reference"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("throws", CompletionItemType.KEYWORD, "throws declaration"),
        CompletionItem("transient", CompletionItemType.KEYWORD, "transient modifier"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("void", CompletionItemType.KEYWORD, "void return type"),
        CompletionItem("volatile", CompletionItemType.KEYWORD, "volatile modifier"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // Python关键字
    private val pythonKeywords = listOf(
        CompletionItem("and", CompletionItemType.KEYWORD, "logical and"),
        CompletionItem("as", CompletionItemType.KEYWORD, "alias"),
        CompletionItem("assert", CompletionItemType.KEYWORD, "assertion"),
        CompletionItem("async", CompletionItemType.KEYWORD, "async function"),
        CompletionItem("await", CompletionItemType.KEYWORD, "await expression"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break loop"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class definition"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue loop"),
        CompletionItem("def", CompletionItemType.KEYWORD, "function definition"),
        CompletionItem("del", CompletionItemType.KEYWORD, "delete object"),
        CompletionItem("elif", CompletionItemType.KEYWORD, "else if"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("except", CompletionItemType.KEYWORD, "exception handler"),
        CompletionItem("False", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("from", CompletionItemType.KEYWORD, "from import"),
        CompletionItem("global", CompletionItemType.KEYWORD, "global variable"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import module"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("is", CompletionItemType.KEYWORD, "identity check"),
        CompletionItem("lambda", CompletionItemType.KEYWORD, "lambda function"),
        CompletionItem("None", CompletionItemType.KEYWORD, "none value"),
        CompletionItem("nonlocal", CompletionItemType.KEYWORD, "nonlocal variable"),
        CompletionItem("not", CompletionItemType.KEYWORD, "logical not"),
        CompletionItem("or", CompletionItemType.KEYWORD, "logical or"),
        CompletionItem("pass", CompletionItemType.KEYWORD, "pass statement"),
        CompletionItem("raise", CompletionItemType.KEYWORD, "raise exception"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("True", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop"),
        CompletionItem("with", CompletionItemType.KEYWORD, "context manager"),
        CompletionItem("yield", CompletionItemType.KEYWORD, "yield value")
    )

    // JavaScript关键字
    private val javascriptKeywords = listOf(
        CompletionItem("async", CompletionItemType.KEYWORD, "async function"),
        CompletionItem("await", CompletionItemType.KEYWORD, "await expression"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("debugger", CompletionItemType.KEYWORD, "debugger breakpoint"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case/export"),
        CompletionItem("delete", CompletionItemType.KEYWORD, "delete property"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("export", CompletionItemType.KEYWORD, "export module"),
        CompletionItem("extends", CompletionItemType.KEYWORD, "class inheritance"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("function", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import module"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("instanceof", CompletionItemType.KEYWORD, "instanceof operator"),
        CompletionItem("let", CompletionItemType.KEYWORD, "block-scoped variable"),
        CompletionItem("new", CompletionItemType.KEYWORD, "create object"),
        CompletionItem("null", CompletionItemType.KEYWORD, "null value"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static member"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super reference"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this reference"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("typeof", CompletionItemType.KEYWORD, "typeof operator"),
        CompletionItem("var", CompletionItemType.KEYWORD, "variable declaration"),
        CompletionItem("void", CompletionItemType.KEYWORD, "void operator"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop"),
        CompletionItem("with", CompletionItemType.KEYWORD, "with statement"),
        CompletionItem("yield", CompletionItemType.KEYWORD, "yield value")
    )

    // TypeScript关键字 (extends JavaScript)
    private val typescriptKeywords = javascriptKeywords + listOf(
        CompletionItem("abstract", CompletionItemType.KEYWORD, "abstract modifier"),
        CompletionItem("as", CompletionItemType.KEYWORD, "type assertion"),
        CompletionItem("declare", CompletionItemType.KEYWORD, "ambient declaration"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("implements", CompletionItemType.KEYWORD, "implements interface"),
        CompletionItem("interface", CompletionItemType.KEYWORD, "interface declaration"),
        CompletionItem("namespace", CompletionItemType.KEYWORD, "namespace declaration"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private modifier"),
        CompletionItem("protected", CompletionItemType.KEYWORD, "protected modifier"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public modifier"),
        CompletionItem("readonly", CompletionItemType.KEYWORD, "readonly modifier"),
        CompletionItem("type", CompletionItemType.KEYWORD, "type alias")
    )

    // C++关键字
    private val cppKeywords = listOf(
        CompletionItem("alignas", CompletionItemType.KEYWORD, "alignment specifier"),
        CompletionItem("alignof", CompletionItemType.KEYWORD, "alignment query"),
        CompletionItem("auto", CompletionItemType.KEYWORD, "automatic type deduction"),
        CompletionItem("bool", CompletionItemType.KEYWORD, "boolean type"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("char", CompletionItemType.KEYWORD, "character type"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("constexpr", CompletionItemType.KEYWORD, "compile-time constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("decltype", CompletionItemType.KEYWORD, "decltype specifier"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case/constructor"),
        CompletionItem("delete", CompletionItemType.KEYWORD, "delete operator"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("double", CompletionItemType.KEYWORD, "double type"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("explicit", CompletionItemType.KEYWORD, "explicit constructor"),
        CompletionItem("export", CompletionItemType.KEYWORD, "module export"),
        CompletionItem("extern", CompletionItemType.KEYWORD, "external linkage"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("float", CompletionItemType.KEYWORD, "float type"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("friend", CompletionItemType.KEYWORD, "friend declaration"),
        CompletionItem("goto", CompletionItemType.KEYWORD, "goto statement"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("inline", CompletionItemType.KEYWORD, "inline function"),
        CompletionItem("int", CompletionItemType.KEYWORD, "integer type"),
        CompletionItem("long", CompletionItemType.KEYWORD, "long type"),
        CompletionItem("mutable", CompletionItemType.KEYWORD, "mutable member"),
        CompletionItem("namespace", CompletionItemType.KEYWORD, "namespace declaration"),
        CompletionItem("new", CompletionItemType.KEYWORD, "new operator"),
        CompletionItem("noexcept", CompletionItemType.KEYWORD, "noexcept specifier"),
        CompletionItem("nullptr", CompletionItemType.KEYWORD, "null pointer"),
        CompletionItem("operator", CompletionItemType.KEYWORD, "operator overload"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private access"),
        CompletionItem("protected", CompletionItemType.KEYWORD, "protected access"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public access"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("short", CompletionItemType.KEYWORD, "short type"),
        CompletionItem("signed", CompletionItemType.KEYWORD, "signed type"),
        CompletionItem("sizeof", CompletionItemType.KEYWORD, "sizeof operator"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static modifier"),
        CompletionItem("struct", CompletionItemType.KEYWORD, "struct declaration"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("template", CompletionItemType.KEYWORD, "template declaration"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this pointer"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("typedef", CompletionItemType.KEYWORD, "type definition"),
        CompletionItem("typeid", CompletionItemType.KEYWORD, "type identification"),
        CompletionItem("typename", CompletionItemType.KEYWORD, "typename keyword"),
        CompletionItem("union", CompletionItemType.KEYWORD, "union declaration"),
        CompletionItem("unsigned", CompletionItemType.KEYWORD, "unsigned type"),
        CompletionItem("using", CompletionItemType.KEYWORD, "using declaration"),
        CompletionItem("virtual", CompletionItemType.KEYWORD, "virtual function"),
        CompletionItem("void", CompletionItemType.KEYWORD, "void type"),
        CompletionItem("volatile", CompletionItemType.KEYWORD, "volatile qualifier"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // C关键字 (subset of C++)
    private val cKeywords = listOf(
        CompletionItem("auto", CompletionItemType.KEYWORD, "auto storage class"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("char", CompletionItemType.KEYWORD, "character type"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("double", CompletionItemType.KEYWORD, "double type"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("extern", CompletionItemType.KEYWORD, "external linkage"),
        CompletionItem("float", CompletionItemType.KEYWORD, "float type"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("goto", CompletionItemType.KEYWORD, "goto statement"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("inline", CompletionItemType.KEYWORD, "inline function"),
        CompletionItem("int", CompletionItemType.KEYWORD, "integer type"),
        CompletionItem("long", CompletionItemType.KEYWORD, "long type"),
        CompletionItem("register", CompletionItemType.KEYWORD, "register storage class"),
        CompletionItem("restrict", CompletionItemType.KEYWORD, "restrict pointer"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("short", CompletionItemType.KEYWORD, "short type"),
        CompletionItem("signed", CompletionItemType.KEYWORD, "signed type"),
        CompletionItem("sizeof", CompletionItemType.KEYWORD, "sizeof operator"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static modifier"),
        CompletionItem("struct", CompletionItemType.KEYWORD, "struct declaration"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("typedef", CompletionItemType.KEYWORD, "type definition"),
        CompletionItem("union", CompletionItemType.KEYWORD, "union declaration"),
        CompletionItem("unsigned", CompletionItemType.KEYWORD, "unsigned type"),
        CompletionItem("void", CompletionItemType.KEYWORD, "void type"),
        CompletionItem("volatile", CompletionItemType.KEYWORD, "volatile qualifier"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // Go关键字
    private val goKeywords = listOf(
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("chan", CompletionItemType.KEYWORD, "channel type"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("defer", CompletionItemType.KEYWORD, "defer statement"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("fallthrough", CompletionItemType.KEYWORD, "fallthrough to next case"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("func", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("go", CompletionItemType.KEYWORD, "goroutine"),
        CompletionItem("goto", CompletionItemType.KEYWORD, "goto statement"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import package"),
        CompletionItem("interface", CompletionItemType.KEYWORD, "interface type"),
        CompletionItem("map", CompletionItemType.KEYWORD, "map type"),
        CompletionItem("package", CompletionItemType.KEYWORD, "package declaration"),
        CompletionItem("range", CompletionItemType.KEYWORD, "range iteration"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("select", CompletionItemType.KEYWORD, "select statement"),
        CompletionItem("struct", CompletionItemType.KEYWORD, "struct type"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("type", CompletionItemType.KEYWORD, "type definition"),
        CompletionItem("var", CompletionItemType.KEYWORD, "variable declaration")
    )

    // Rust关键字
    private val rustKeywords = listOf(
        CompletionItem("as", CompletionItemType.KEYWORD, "type cast"),
        CompletionItem("async", CompletionItemType.KEYWORD, "async function"),
        CompletionItem("await", CompletionItemType.KEYWORD, "await expression"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break loop"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue loop"),
        CompletionItem("crate", CompletionItemType.KEYWORD, "crate root"),
        CompletionItem("dyn", CompletionItemType.KEYWORD, "dynamic dispatch"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("extern", CompletionItemType.KEYWORD, "external linkage"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("fn", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("impl", CompletionItemType.KEYWORD, "implementation block"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in expression"),
        CompletionItem("let", CompletionItemType.KEYWORD, "variable binding"),
        CompletionItem("loop", CompletionItemType.KEYWORD, "infinite loop"),
        CompletionItem("match", CompletionItemType.KEYWORD, "match expression"),
        CompletionItem("mod", CompletionItemType.KEYWORD, "module declaration"),
        CompletionItem("move", CompletionItemType.KEYWORD, "move closure"),
        CompletionItem("mut", CompletionItemType.KEYWORD, "mutable binding"),
        CompletionItem("pub", CompletionItemType.KEYWORD, "public visibility"),
        CompletionItem("ref", CompletionItemType.KEYWORD, "reference pattern"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("Self", CompletionItemType.KEYWORD, "self type"),
        CompletionItem("self", CompletionItemType.KEYWORD, "self reference"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static item"),
        CompletionItem("struct", CompletionItemType.KEYWORD, "struct declaration"),
        CompletionItem("super", CompletionItemType.KEYWORD, "parent module"),
        CompletionItem("trait", CompletionItemType.KEYWORD, "trait declaration"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("type", CompletionItemType.KEYWORD, "type alias"),
        CompletionItem("unsafe", CompletionItemType.KEYWORD, "unsafe block"),
        CompletionItem("use", CompletionItemType.KEYWORD, "import declaration"),
        CompletionItem("where", CompletionItemType.KEYWORD, "where clause"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // Swift关键字
    private val swiftKeywords = listOf(
        CompletionItem("associatedtype", CompletionItemType.KEYWORD, "associated type"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("defer", CompletionItemType.KEYWORD, "defer statement"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do block"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("extension", CompletionItemType.KEYWORD, "extension"),
        CompletionItem("fallthrough", CompletionItemType.KEYWORD, "fallthrough case"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("func", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("guard", CompletionItemType.KEYWORD, "guard statement"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import module"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("init", CompletionItemType.KEYWORD, "initializer"),
        CompletionItem("inout", CompletionItemType.KEYWORD, "inout parameter"),
        CompletionItem("internal", CompletionItemType.KEYWORD, "internal access"),
        CompletionItem("let", CompletionItemType.KEYWORD, "constant binding"),
        CompletionItem("nil", CompletionItemType.KEYWORD, "nil value"),
        CompletionItem("operator", CompletionItemType.KEYWORD, "operator declaration"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private access"),
        CompletionItem("protocol", CompletionItemType.KEYWORD, "protocol declaration"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public access"),
        CompletionItem("repeat", CompletionItemType.KEYWORD, "repeat-while loop"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("Self", CompletionItemType.KEYWORD, "self type"),
        CompletionItem("self", CompletionItemType.KEYWORD, "self reference"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static member"),
        CompletionItem("struct", CompletionItemType.KEYWORD, "struct declaration"),
        CompletionItem("subscript", CompletionItemType.KEYWORD, "subscript"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super reference"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw error"),
        CompletionItem("throws", CompletionItemType.KEYWORD, "throwing function"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try expression"),
        CompletionItem("typealias", CompletionItemType.KEYWORD, "type alias"),
        CompletionItem("var", CompletionItemType.KEYWORD, "variable binding"),
        CompletionItem("where", CompletionItemType.KEYWORD, "where clause"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop")
    )

    // Dart关键字
    private val dartKeywords = listOf(
        CompletionItem("abstract", CompletionItemType.KEYWORD, "abstract class"),
        CompletionItem("as", CompletionItemType.KEYWORD, "type cast"),
        CompletionItem("assert", CompletionItemType.KEYWORD, "assertion"),
        CompletionItem("async", CompletionItemType.KEYWORD, "async function"),
        CompletionItem("await", CompletionItemType.KEYWORD, "await expression"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("const", CompletionItemType.KEYWORD, "compile-time constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("enum", CompletionItemType.KEYWORD, "enum declaration"),
        CompletionItem("extends", CompletionItemType.KEYWORD, "class inheritance"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("final", CompletionItemType.KEYWORD, "final variable"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("implements", CompletionItemType.KEYWORD, "interface implementation"),
        CompletionItem("import", CompletionItemType.KEYWORD, "import library"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("is", CompletionItemType.KEYWORD, "type check"),
        CompletionItem("late", CompletionItemType.KEYWORD, "late initialization"),
        CompletionItem("new", CompletionItemType.KEYWORD, "create object"),
        CompletionItem("null", CompletionItemType.KEYWORD, "null value"),
        CompletionItem("on", CompletionItemType.KEYWORD, "on clause"),
        CompletionItem("rethrow", CompletionItemType.KEYWORD, "rethrow exception"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super reference"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this reference"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("var", CompletionItemType.KEYWORD, "variable declaration"),
        CompletionItem("void", CompletionItemType.KEYWORD, "void type"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop"),
        CompletionItem("with", CompletionItemType.KEYWORD, "mixin application")
    )

    // Ruby关键字
    private val rubyKeywords = listOf(
        CompletionItem("alias", CompletionItemType.KEYWORD, "method alias"),
        CompletionItem("and", CompletionItemType.KEYWORD, "logical and"),
        CompletionItem("begin", CompletionItemType.KEYWORD, "begin block"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break loop"),
        CompletionItem("case", CompletionItemType.KEYWORD, "case statement"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class definition"),
        CompletionItem("def", CompletionItemType.KEYWORD, "method definition"),
        CompletionItem("defined?", CompletionItemType.KEYWORD, "defined check"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do block"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("elsif", CompletionItemType.KEYWORD, "elsif branch"),
        CompletionItem("end", CompletionItemType.KEYWORD, "end block"),
        CompletionItem("ensure", CompletionItemType.KEYWORD, "ensure block"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("in", CompletionItemType.KEYWORD, "in operator"),
        CompletionItem("module", CompletionItemType.KEYWORD, "module definition"),
        CompletionItem("next", CompletionItemType.KEYWORD, "next iteration"),
        CompletionItem("nil", CompletionItemType.KEYWORD, "nil value"),
        CompletionItem("not", CompletionItemType.KEYWORD, "logical not"),
        CompletionItem("or", CompletionItemType.KEYWORD, "logical or"),
        CompletionItem("redo", CompletionItemType.KEYWORD, "redo iteration"),
        CompletionItem("rescue", CompletionItemType.KEYWORD, "exception handler"),
        CompletionItem("retry", CompletionItemType.KEYWORD, "retry block"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("self", CompletionItemType.KEYWORD, "self reference"),
        CompletionItem("super", CompletionItemType.KEYWORD, "super call"),
        CompletionItem("then", CompletionItemType.KEYWORD, "then keyword"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("undef", CompletionItemType.KEYWORD, "undefine method"),
        CompletionItem("unless", CompletionItemType.KEYWORD, "unless condition"),
        CompletionItem("until", CompletionItemType.KEYWORD, "until loop"),
        CompletionItem("when", CompletionItemType.KEYWORD, "case when"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop"),
        CompletionItem("yield", CompletionItemType.KEYWORD, "yield to block")
    )

    // PHP关键字
    private val phpKeywords = listOf(
        CompletionItem("abstract", CompletionItemType.KEYWORD, "abstract class"),
        CompletionItem("and", CompletionItemType.KEYWORD, "logical and"),
        CompletionItem("array", CompletionItemType.KEYWORD, "array"),
        CompletionItem("as", CompletionItemType.KEYWORD, "as keyword"),
        CompletionItem("break", CompletionItemType.KEYWORD, "break statement"),
        CompletionItem("callable", CompletionItemType.KEYWORD, "callable type"),
        CompletionItem("case", CompletionItemType.KEYWORD, "switch case"),
        CompletionItem("catch", CompletionItemType.KEYWORD, "catch exception"),
        CompletionItem("class", CompletionItemType.KEYWORD, "class declaration"),
        CompletionItem("const", CompletionItemType.KEYWORD, "constant"),
        CompletionItem("continue", CompletionItemType.KEYWORD, "continue statement"),
        CompletionItem("declare", CompletionItemType.KEYWORD, "declare block"),
        CompletionItem("default", CompletionItemType.KEYWORD, "default case"),
        CompletionItem("do", CompletionItemType.KEYWORD, "do-while loop"),
        CompletionItem("echo", CompletionItemType.KEYWORD, "echo output"),
        CompletionItem("else", CompletionItemType.KEYWORD, "else branch"),
        CompletionItem("elseif", CompletionItemType.KEYWORD, "elseif branch"),
        CompletionItem("empty", CompletionItemType.KEYWORD, "empty check"),
        CompletionItem("extends", CompletionItemType.KEYWORD, "class inheritance"),
        CompletionItem("false", CompletionItemType.KEYWORD, "boolean false"),
        CompletionItem("final", CompletionItemType.KEYWORD, "final modifier"),
        CompletionItem("finally", CompletionItemType.KEYWORD, "finally block"),
        CompletionItem("fn", CompletionItemType.KEYWORD, "arrow function"),
        CompletionItem("for", CompletionItemType.KEYWORD, "for loop"),
        CompletionItem("foreach", CompletionItemType.KEYWORD, "foreach loop"),
        CompletionItem("function", CompletionItemType.KEYWORD, "function declaration"),
        CompletionItem("global", CompletionItemType.KEYWORD, "global variable"),
        CompletionItem("if", CompletionItemType.KEYWORD, "if condition"),
        CompletionItem("implements", CompletionItemType.KEYWORD, "interface implementation"),
        CompletionItem("include", CompletionItemType.KEYWORD, "include file"),
        CompletionItem("instanceof", CompletionItemType.KEYWORD, "instanceof operator"),
        CompletionItem("interface", CompletionItemType.KEYWORD, "interface declaration"),
        CompletionItem("isset", CompletionItemType.KEYWORD, "isset check"),
        CompletionItem("list", CompletionItemType.KEYWORD, "list assignment"),
        CompletionItem("namespace", CompletionItemType.KEYWORD, "namespace declaration"),
        CompletionItem("new", CompletionItemType.KEYWORD, "create object"),
        CompletionItem("null", CompletionItemType.KEYWORD, "null value"),
        CompletionItem("or", CompletionItemType.KEYWORD, "logical or"),
        CompletionItem("private", CompletionItemType.KEYWORD, "private access"),
        CompletionItem("protected", CompletionItemType.KEYWORD, "protected access"),
        CompletionItem("public", CompletionItemType.KEYWORD, "public access"),
        CompletionItem("require", CompletionItemType.KEYWORD, "require file"),
        CompletionItem("return", CompletionItemType.KEYWORD, "return statement"),
        CompletionItem("static", CompletionItemType.KEYWORD, "static member"),
        CompletionItem("switch", CompletionItemType.KEYWORD, "switch statement"),
        CompletionItem("this", CompletionItemType.KEYWORD, "this reference"),
        CompletionItem("throw", CompletionItemType.KEYWORD, "throw exception"),
        CompletionItem("trait", CompletionItemType.KEYWORD, "trait declaration"),
        CompletionItem("true", CompletionItemType.KEYWORD, "boolean true"),
        CompletionItem("try", CompletionItemType.KEYWORD, "try block"),
        CompletionItem("unset", CompletionItemType.KEYWORD, "unset variable"),
        CompletionItem("use", CompletionItemType.KEYWORD, "use declaration"),
        CompletionItem("var", CompletionItemType.KEYWORD, "variable declaration"),
        CompletionItem("while", CompletionItemType.KEYWORD, "while loop"),
        CompletionItem("yield", CompletionItemType.KEYWORD, "generator yield")
    )

    // HTML标签
    private val htmlKeywords = listOf(
        CompletionItem("html", CompletionItemType.TAG, "HTML root element"),
        CompletionItem("head", CompletionItemType.TAG, "document head"),
        CompletionItem("body", CompletionItemType.TAG, "document body"),
        CompletionItem("div", CompletionItemType.TAG, "division container"),
        CompletionItem("span", CompletionItemType.TAG, "inline container"),
        CompletionItem("p", CompletionItemType.TAG, "paragraph"),
        CompletionItem("a", CompletionItemType.TAG, "anchor link"),
        CompletionItem("img", CompletionItemType.TAG, "image"),
        CompletionItem("ul", CompletionItemType.TAG, "unordered list"),
        CompletionItem("ol", CompletionItemType.TAG, "ordered list"),
        CompletionItem("li", CompletionItemType.TAG, "list item"),
        CompletionItem("h1", CompletionItemType.TAG, "heading 1"),
        CompletionItem("h2", CompletionItemType.TAG, "heading 2"),
        CompletionItem("h3", CompletionItemType.TAG, "heading 3"),
        CompletionItem("h4", CompletionItemType.TAG, "heading 4"),
        CompletionItem("h5", CompletionItemType.TAG, "heading 5"),
        CompletionItem("h6", CompletionItemType.TAG, "heading 6"),
        CompletionItem("button", CompletionItemType.TAG, "button"),
        CompletionItem("input", CompletionItemType.TAG, "input field"),
        CompletionItem("form", CompletionItemType.TAG, "form"),
        CompletionItem("table", CompletionItemType.TAG, "table"),
        CompletionItem("tr", CompletionItemType.TAG, "table row"),
        CompletionItem("td", CompletionItemType.TAG, "table cell"),
        CompletionItem("th", CompletionItemType.TAG, "table header"),
        CompletionItem("script", CompletionItemType.TAG, "script"),
        CompletionItem("style", CompletionItemType.TAG, "style"),
        CompletionItem("link", CompletionItemType.TAG, "external resource link"),
        CompletionItem("meta", CompletionItemType.TAG, "metadata"),
        CompletionItem("title", CompletionItemType.TAG, "document title")
    )
}

/**
 * 补全项
 */
data class CompletionItem(
    val label: String,
    val type: CompletionItemType,
    val description: String = "",
    val insertText: String = label,
    val priority: Int = 0
)

/**
 * 补全项类型
 */
enum class CompletionItemType {
    KEYWORD,
    SNIPPET,
    VARIABLE,
    FUNCTION,
    CLASS,
    TAG
}
