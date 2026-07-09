package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link Mentions} @-mention completion logic. */
class MentionsTest {

    private static final List<String> FILES = Arrays.asList(
            "src/app.js", "src/chat/at-mention.js", "lib/app-helper.js", "README.md");

    @Test
    void detectAtTokenAfterSpaceAndAtStart() {
        Mentions.AtToken t = Mentions.detectAtToken("see @src/ap");
        assertNotNull(t);
        assertEquals("src/ap", t.prefix);
        assertEquals(4, t.start);

        Mentions.AtToken t2 = Mentions.detectAtToken("@a");
        assertNotNull(t2);
        assertEquals("a", t2.prefix);
        assertEquals(0, t2.start);
    }

    @Test
    void detectAtTokenRejectsGluedAtAndNonCaretToken() {
        assertNull(Mentions.detectAtToken("user@host"));
        assertNull(Mentions.detectAtToken("done @x "));
    }

    @Test
    void filterFilesRanksBasenamePrefixFirst() {
        List<String> hits = Mentions.filterFiles(FILES, "app", 20);
        assertEquals("src/app.js", hits.get(0));
        assertTrue(hits.contains("lib/app-helper.js"));
        assertFalse(hits.contains("src/chat/at-mention.js"));
    }

    @Test
    void filterFilesSubstringMatchAndCaseInsensitive() {
        assertTrue(Mentions.filterFiles(FILES, "mention", 20).contains("src/chat/at-mention.js"));
        assertTrue(Mentions.filterFiles(FILES, "SRC/APP", 20).contains("src/app.js"));
    }

    @Test
    void filterFilesEmptyPrefixReturnsFirstN() {
        assertEquals(2, Mentions.filterFiles(FILES, "", 2).size());
    }

    @Test
    void filterFilesFolderRanksByLastSegment() {
        assertEquals("src/",
                Mentions.filterFiles(Arrays.asList("src/", "src/app.js"), "src", 10).get(0));
    }

    @Test
    void deriveFoldersReturnsUniqueSortedAncestors() {
        assertEquals(Arrays.asList("a/", "a/b/"),
                Mentions.deriveFolders(Arrays.asList("a/b/c.js", "a/d.js", "top.md"), 50));
    }

    @Test
    void deriveFoldersNormalizesBackslashes() {
        assertEquals(Arrays.asList("x/", "x/y/"),
                Mentions.deriveFolders(Arrays.asList("x\\y\\z.js"), 50));
    }

    @Test
    void deriveFoldersRootOnlyNullAndCap() {
        assertEquals(0, Mentions.deriveFolders(Arrays.asList("README.md"), 50).size());
        assertEquals(0, Mentions.deriveFolders(null, 50).size());
        assertEquals(2,
                Mentions.deriveFolders(Arrays.asList("a/x.js", "b/x.js", "c/x.js"), 2).size());
    }

    @Test
    void ideMentionMatchesByPrefix() {
        assertEquals(2, Mentions.ideMentionMatches("").size());
        assertEquals(Arrays.asList("selection"), Mentions.ideMentionMatches("s"));
        assertEquals(Arrays.asList("diagnostics"), Mentions.ideMentionMatches("d"));
    }

    @Test
    void applyMentionSplicesWithTrailingSpace() {
        Mentions.AtToken at = Mentions.detectAtToken("look @ap");
        Mentions.ApplyResult ap = Mentions.applyMention("look @ap", at, "src/app.js", 8);
        assertEquals("look @src/app.js ", ap.text);
        assertEquals("look @src/app.js ".length(), ap.caret);
    }

    @Test
    void symbolKindLabelMapping() {
        assertEquals("function", Mentions.symbolKindLabel(11));
        assertEquals("class", Mentions.symbolKindLabel(4));
        assertEquals("symbol", Mentions.symbolKindLabel(999));
    }

    @Test
    void formatSymbolItemsSkipsNamelessAndBuildsRelPathLabel() {
        List<Mentions.Symbol> syms = Arrays.asList(
                new Mentions.Symbol("handleClick", 11, "C:\\ws\\src\\ui\\button.ts"),
                new Mentions.Symbol("", 4, "C:\\ws\\x.ts"),
                new Mentions.Symbol("Widget", 4, "C:\\ws\\src\\widget.ts"));
        List<Mentions.MentionItem> items = Mentions.formatSymbolItems(syms, "C:\\ws", 8);
        assertEquals(2, items.size());
        assertEquals("function handleClick · src/ui/button.ts", items.get(0).label);
        assertEquals("src/ui/button.ts", items.get(0).value);
    }

    @Test
    void dedupeMentionItemsKeepsFirstPerValue() {
        List<Mentions.MentionItem> mixed = Arrays.asList(
                Mentions.MentionItem.path("src/app.js"),
                Mentions.MentionItem.symbol("function foo · src/app.js", "src/app.js"),
                Mentions.MentionItem.symbol("class Bar · src/bar.js", "src/bar.js"));
        List<Mentions.MentionItem> deduped = Mentions.dedupeMentionItems(mixed);
        assertEquals(2, deduped.size());
        assertEquals("src/app.js", deduped.get(0).value);
        assertEquals("class Bar · src/bar.js", Mentions.mentionLabel(deduped.get(1)));
        assertEquals("src/bar.js", Mentions.mentionValue(deduped.get(1)));
    }

    @Test
    void formatInsertReferenceLineRanges() {
        assertEquals("@src/app.ts",
                Mentions.formatInsertReference("src/app.ts", 0, 0, 0, 0));
        assertEquals("@src/app.ts#L7",
                Mentions.formatInsertReference("src/app.ts", 6, 2, 6, 9));
        assertEquals("@src/app.ts#L5-10",
                Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 3));
        assertEquals("@src/app.ts#L5-9",
                Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 0));
        assertEquals("@a.txt#L3",
                Mentions.formatInsertReference("a.txt", 2, 0, 3, 0));
    }
}
