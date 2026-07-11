package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SemanticTools;
import com.intellij.lang.LanguageDocumentation;
import com.intellij.lang.documentation.DocumentationProvider;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.module.Module;
import com.intellij.openapi.module.ModuleManager;
import com.intellij.openapi.project.IndexNotReadyException;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.projectRoots.Sdk;
import com.intellij.openapi.roots.LibraryOrderEntry;
import com.intellij.openapi.roots.ModuleOrderEntry;
import com.intellij.openapi.roots.ModuleRootManager;
import com.intellij.openapi.roots.OrderEntry;
import com.intellij.openapi.roots.ProjectRootManager;
import com.intellij.openapi.util.Computable;
import com.intellij.openapi.util.TextRange;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiElement;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiManager;
import com.intellij.psi.PsiNameIdentifierOwner;
import com.intellij.psi.PsiNamedElement;
import com.intellij.psi.PsiPolyVariantReference;
import com.intellij.psi.PsiRecursiveElementWalkingVisitor;
import com.intellij.psi.PsiReference;
import com.intellij.psi.ResolveResult;
import com.intellij.psi.search.GlobalSearchScope;
import com.intellij.psi.search.searches.ReferencesSearch;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * IntelliJ implementation of {@link SemanticTools.SemanticFacade}: the glue
 * that answers the semantic bridge tools (getHover / goToDefinition /
 * findReferences / renamePreview / getCallHierarchy / getSymbolInfo /
 * getProjectModel) with real PSI. All PSI access runs inside a read action —
 * the MCP server calls from its pooled threads, mirroring how
 * {@link IntellijEditorFacade#getDiagnostics} handles threading. Strictly
 * read-only: no write action is ever taken here (renamePreview is served from
 * reference COUNTS, never a refactoring).
 *
 * Java-PSI specifics (method kinds, call hierarchy) live behind
 * Throwable-guarded calls into {@link JavaSupport}: com.intellij.java is a
 * compile-time-only dependency (see build.gradle.kts), so on non-Java IDEs
 * those classes are absent and the tools degrade with a `reason` instead of
 * failing to load.
 */
public final class PsiSemanticFacade implements SemanticTools.SemanticFacade {

    private static final int MAX_PREVIEW_CHARS = 200;
    private static final String INDEXING_REASON =
            "the IDE is still indexing (dumb mode) — retry in a moment";

    private final Project project;

    public PsiSemanticFacade(Project project) {
        this.project = project;
    }

    // ── SemanticFacade ──────────────────────────────────────────────────────

    @Override
    public Map<String, Object> hover(String path, int line, int column) {
        return mapCall(() -> {
            Ctx c = ctx(path, line, column);
            if (c.target == null) return null;
            String html = null;
            try {
                // Non-deprecated lookup: the language's registered documentation
                // providers (DocumentationManager is scheduled for removal).
                for (DocumentationProvider provider
                        : LanguageDocumentation.INSTANCE.allForLanguage(c.target.getLanguage())) {
                    html = provider.generateDoc(c.target, c.leaf);
                    if (html != null && !html.trim().isEmpty()) break;
                }
            } catch (Throwable ignored) {
                // provider drift / language without docs — fall through to signature
            }
            if (html == null || html.trim().isEmpty()) {
                html = declarationPreview(c.target);
            }
            if (html == null || html.trim().isEmpty()) return null;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("text", html);
            String name = elementName(c.target);
            if (name != null) out.put("symbol", name);
            return out;
        });
    }

    @Override
    public List<Map<String, Object>> definitions(String path, int line, int column) {
        return listCall(() -> {
            Ctx c = ctx(path, line, column);
            List<Map<String, Object>> out = new ArrayList<>();
            Set<PsiElement> seen = new LinkedHashSet<>();
            PsiReference ref = c.psiFile.findReferenceAt(c.offset);
            if (ref instanceof PsiPolyVariantReference) {
                for (ResolveResult rr : ((PsiPolyVariantReference) ref).multiResolve(false)) {
                    addDefinition(rr.getElement(), seen, out);
                }
            } else if (ref != null) {
                addDefinition(ref.resolve(), seen, out);
            }
            if (out.isEmpty()) {
                // Cursor on the declaration itself → it is its own definition.
                addDefinition(declarationAt(c), seen, out);
            }
            return out;
        });
    }

    @Override
    public List<Map<String, Object>> references(String path, int line, int column, int collectBound) {
        return listCall(() -> {
            Ctx c = ctx(path, line, column);
            List<Map<String, Object>> out = new ArrayList<>();
            if (c.target == null) return out;
            final int bound = Math.max(1, collectBound);
            ReferencesSearch.search(c.target).forEach(r -> {
                Map<String, Object> loc = referenceLocation(r);
                if (loc != null) out.add(loc);
                return out.size() < bound; // false stops the search — bounded work
            });
            return out;
        });
    }

    @Override
    public Map<String, Object> symbolInfo(String path, int line, int column) {
        return mapCall(() -> {
            Ctx c = ctx(path, line, column);
            if (c.target == null) return null;
            String name = elementName(c.target);
            if (name == null) return null;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("name", name);

            String kind = null;
            String containingClass = null;
            String packageName = null;
            try {
                String[] java = JavaSupport.describe(c.target);
                if (java != null) {
                    kind = java[0];
                    containingClass = java[1];
                    packageName = java[2];
                }
            } catch (Throwable ignored) {
                // Java PSI absent (non-Java IDE) — generic fallback below
            }
            if (kind == null) kind = genericKind(c.target);
            out.put("kind", kind);
            if (containingClass != null) out.put("containingClass", containingClass);
            if (packageName != null && !packageName.isEmpty()) out.put("package", packageName);

            PsiFile declFile = c.target.getContainingFile();
            String declPath = declFile == null || declFile.getVirtualFile() == null
                    ? null : declFile.getVirtualFile().getPath();
            out.put("owner", containingClass != null ? containingClass : declPath);
            Map<String, Object> loc = elementLocation(c.target);
            if (loc != null) {
                out.put("file", loc.get("file"));
                out.put("line", loc.get("line"));
            }
            out.put("language", c.target.getLanguage().getID());
            return out;
        });
    }

    @Override
    public Map<String, Object> callHierarchy(String path, int line, int column, int collectBound) {
        return mapCall(() -> {
            Ctx c = ctx(path, line, column);
            if (c.target == null) {
                return reasonMap("no symbol at this position");
            }
            try {
                Map<String, Object> res = JavaSupport.callHierarchy(project, this, c.target,
                        Math.max(1, collectBound));
                if (res != null) return res;
                return reasonMap("call hierarchy is supported for Java/JVM methods only — "
                        + "the symbol here is not a method");
            } catch (IndexNotReadyException dumb) {
                throw dumb; // handled by mapCall
            } catch (Throwable absent) {
                return reasonMap("call hierarchy requires the Java plugin, "
                        + "which is not available in this IDE");
            }
        });
    }

    @Override
    public Map<String, Object> projectModel() {
        return mapCall(() -> {
            Map<String, Object> out = new LinkedHashMap<>();
            Sdk sdk = ProjectRootManager.getInstance(project).getProjectSdk();
            if (sdk == null) {
                out.put("jdk", null);
            } else {
                String v = sdk.getVersionString();
                out.put("jdk", v == null ? sdk.getName() : sdk.getName() + " (" + v + ")");
            }
            List<Map<String, Object>> modules = new ArrayList<>();
            for (Module m : ModuleManager.getInstance(project).getModules()) {
                Map<String, Object> mm = new LinkedHashMap<>();
                mm.put("name", m.getName());
                ModuleRootManager roots = ModuleRootManager.getInstance(m);
                List<String> sourceRoots = new ArrayList<>();
                for (VirtualFile vf : roots.getSourceRoots()) sourceRoots.add(vf.getPath());
                mm.put("sourceRoots", sourceRoots);
                List<String> deps = new ArrayList<>();
                for (OrderEntry e : roots.getOrderEntries()) {
                    if (e instanceof ModuleOrderEntry) {
                        deps.add("module " + ((ModuleOrderEntry) e).getModuleName());
                    } else if (e instanceof LibraryOrderEntry) {
                        String n = e.getPresentableName();
                        if (n != null && !n.isEmpty()) deps.add(n);
                    }
                }
                mm.put("dependencies", deps);
                modules.add(mm);
            }
            out.put("modules", modules);
            return out;
        });
    }

    // ── read-action plumbing (mirrors getDiagnostics' threading) ───────────

    /** Run a map-returning lookup in a read action; dumb mode → reason map. */
    private Map<String, Object> mapCall(Computable<Map<String, Object>> body) {
        try {
            return ApplicationManager.getApplication().runReadAction(body);
        } catch (IndexNotReadyException dumb) {
            return reasonMap(INDEXING_REASON);
        }
    }

    /** Run a list-returning lookup in a read action; dumb mode → friendly error. */
    private List<Map<String, Object>> listCall(Computable<List<Map<String, Object>>> body) {
        try {
            return ApplicationManager.getApplication().runReadAction(body);
        } catch (IndexNotReadyException dumb) {
            throw new IllegalStateException(INDEXING_REASON);
        }
    }

    private static Map<String, Object> reasonMap(String reason) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("callers", new ArrayList<>());
        out.put("callees", new ArrayList<>());
        out.put("reason", reason);
        return out;
    }

    // ── position → PSI context ──────────────────────────────────────────────

    /** Resolved lookup context. Built inside the read action. */
    private static final class Ctx {
        PsiFile psiFile;
        Document doc;
        int offset;
        PsiElement leaf;
        PsiElement target; // resolved reference target or declaration; may be null
    }

    /**
     * Resolve path + 1-based line/column to a PSI context. Caller errors
     * (missing file, line beyond EOF) throw IllegalArgumentException — the MCP
     * layer surfaces the message as an isError tool result.
     */
    private Ctx ctx(String path, int line, int column) {
        VirtualFile vf = resolveFile(path);
        if (vf == null) {
            throw new IllegalArgumentException("file not found: " + path);
        }
        PsiFile psiFile = PsiManager.getInstance(project).findFile(vf);
        if (psiFile == null) {
            throw new IllegalArgumentException("no PSI for file (binary or excluded?): " + path);
        }
        Document doc = FileDocumentManager.getInstance().getDocument(vf);
        if (doc == null) {
            throw new IllegalArgumentException("no document for file: " + path);
        }
        int lineCount = Math.max(doc.getLineCount(), 1);
        if (line > lineCount) {
            throw new IllegalArgumentException(
                    "line " + line + " is beyond the end of " + path + " (" + lineCount
                            + " lines; line/column are 1-based)");
        }
        Ctx c = new Ctx();
        c.psiFile = psiFile;
        c.doc = doc;
        if (doc.getLineCount() == 0) {
            c.offset = 0;
        } else {
            int li = line - 1;
            int lineStart = doc.getLineStartOffset(li);
            int lineEnd = doc.getLineEndOffset(li);
            c.offset = lineStart + Math.min(Math.max(column - 1, 0), Math.max(lineEnd - lineStart, 0));
        }
        c.leaf = psiFile.findElementAt(c.offset);
        PsiReference ref = psiFile.findReferenceAt(c.offset);
        PsiElement target = ref == null ? null : ref.resolve();
        if (target == null) target = declarationAt(c);
        if (target != null) target = target.getNavigationElement();
        c.target = target;
        return c;
    }

    /** The agent sends OS-native paths; VFS wants forward slashes. Relative
     *  paths resolve against the project base dir. */
    private VirtualFile resolveFile(String path) {
        String p = path.replace('\\', '/');
        boolean absolute = p.startsWith("/") || (p.length() > 1 && p.charAt(1) == ':');
        if (!absolute) {
            String base = project.getBasePath();
            if (base != null) p = base.replace('\\', '/') + "/" + p;
        }
        VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(p);
        if (vf == null) vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(p);
        return vf;
    }

    /** The named declaration whose name identifier spans the offset, if any. */
    private static PsiElement declarationAt(Ctx c) {
        PsiElement e = c.leaf;
        while (e != null && !(e instanceof PsiFile)) {
            if (e instanceof PsiNameIdentifierOwner) {
                PsiElement id = ((PsiNameIdentifierOwner) e).getNameIdentifier();
                TextRange r = id == null ? null : id.getTextRange();
                if (r != null && r.containsOffset(c.offset)) return e;
            }
            e = e.getParent();
        }
        return null;
    }

    // ── location / shaping helpers (all called under the read lock) ────────

    private void addDefinition(PsiElement element, Set<PsiElement> seen,
                               List<Map<String, Object>> out) {
        if (element == null) return;
        PsiElement nav = element.getNavigationElement();
        if (nav == null) nav = element;
        if (!seen.add(nav)) return;
        Map<String, Object> loc = elementLocation(nav);
        if (loc != null) out.add(loc);
    }

    /** { file, line, column, preview } for a declaration element, 1-based. */
    Map<String, Object> elementLocation(PsiElement element) {
        if (element == null) return null;
        PsiFile file = element.getContainingFile();
        VirtualFile vf = file == null ? null : file.getVirtualFile();
        if (vf == null) return null;
        Document doc = FileDocumentManager.getInstance().getDocument(vf);
        return locationAt(vf, doc, element.getTextOffset());
    }

    /** Location of a usage, anchored at the reference's own text range. */
    private Map<String, Object> referenceLocation(PsiReference ref) {
        PsiElement el = ref.getElement();
        PsiFile file = el.getContainingFile();
        VirtualFile vf = file == null ? null : file.getVirtualFile();
        if (vf == null) return null;
        Document doc = FileDocumentManager.getInstance().getDocument(vf);
        int offset = el.getTextRange() == null ? el.getTextOffset()
                : el.getTextRange().getStartOffset() + ref.getRangeInElement().getStartOffset();
        return locationAt(vf, doc, offset);
    }

    private static Map<String, Object> locationAt(VirtualFile vf, Document doc, int offset) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("file", vf.getPath());
        if (doc == null || doc.getTextLength() == 0) {
            out.put("line", 1L);
            out.put("column", 1L);
            return out;
        }
        int off = Math.min(Math.max(offset, 0), doc.getTextLength() - 1);
        int line = doc.getLineNumber(off);
        int lineStart = doc.getLineStartOffset(line);
        out.put("line", (long) (line + 1));
        out.put("column", (long) (off - lineStart + 1));
        String preview = doc.getText(new TextRange(lineStart, doc.getLineEndOffset(line))).trim();
        if (preview.length() > MAX_PREVIEW_CHARS) {
            preview = preview.substring(0, MAX_PREVIEW_CHARS) + "…";
        }
        if (!preview.isEmpty()) out.put("preview", preview);
        return out;
    }

    private static String elementName(PsiElement element) {
        if (element instanceof PsiNamedElement) {
            String n = ((PsiNamedElement) element).getName();
            if (n != null && !n.isEmpty()) return n;
        }
        return null;
    }

    /** Fallback hover: the declaration's first line (signature-ish). */
    private static String declarationPreview(PsiElement element) {
        try {
            String text = element.getText();
            if (text == null) return null;
            int brace = text.indexOf('{');
            if (brace > 0) text = text.substring(0, brace);
            text = text.trim();
            int nl = text.indexOf('\n');
            String firstLines = text;
            if (nl > 0 && text.length() > 400) firstLines = text.substring(0, Math.min(400, text.length()));
            return firstLines.isEmpty() ? null : firstLines;
        } catch (Throwable t) {
            return null;
        }
    }

    /** Language-agnostic kind: "PsiMethodImpl" → "method"-ish class name. */
    private static String genericKind(PsiElement element) {
        String cls = element.getClass().getSimpleName();
        if (cls.startsWith("Psi")) cls = cls.substring(3);
        if (cls.endsWith("Impl")) cls = cls.substring(0, cls.length() - 4);
        return cls.isEmpty() ? "element" : Character.toLowerCase(cls.charAt(0)) + cls.substring(1);
    }

    // ── Java-PSI specifics (classes may be absent on non-Java IDEs) ────────

    /**
     * All references to com.intellij.java PSI classes are confined here, and
     * every call site wraps in try/catch(Throwable): the dependency is
     * compile-time only (same pattern as ChatMentionPopups' symbol scan).
     */
    private static final class JavaSupport {
        private JavaSupport() {}

        /** [kind, containingClassQualifiedName, packageName] — entries may be null. */
        static String[] describe(PsiElement t) {
            String kind = null;
            String containing = null;
            String pkg = null;
            if (t instanceof com.intellij.psi.PsiMethod) {
                kind = ((com.intellij.psi.PsiMethod) t).isConstructor() ? "constructor" : "method";
            } else if (t instanceof com.intellij.psi.PsiClass) {
                com.intellij.psi.PsiClass c = (com.intellij.psi.PsiClass) t;
                kind = c.isInterface() ? "interface"
                        : c.isEnum() ? "enum"
                        : c.isAnnotationType() ? "annotation" : "class";
            } else if (t instanceof com.intellij.psi.PsiField) {
                kind = "field";
            } else if (t instanceof com.intellij.psi.PsiParameter) {
                kind = "parameter";
            } else if (t instanceof com.intellij.psi.PsiLocalVariable) {
                kind = "local variable";
            }
            if (t instanceof com.intellij.psi.PsiMember) {
                com.intellij.psi.PsiClass c = ((com.intellij.psi.PsiMember) t).getContainingClass();
                if (c != null) containing = c.getQualifiedName();
            }
            PsiFile f = t.getContainingFile();
            if (f instanceof com.intellij.psi.PsiClassOwner) {
                pkg = ((com.intellij.psi.PsiClassOwner) f).getPackageName();
            }
            return new String[] { kind, containing, pkg };
        }

        /**
         * One level of callers/callees for a Java method, each direction
         * bounded. Returns null when the element is not a PsiMethod (the
         * facade degrades with a reason).
         */
        static Map<String, Object> callHierarchy(Project project, PsiSemanticFacade facade,
                                                 PsiElement target, int bound) {
            if (!(target instanceof com.intellij.psi.PsiMethod)) return null;
            com.intellij.psi.PsiMethod method = (com.intellij.psi.PsiMethod) target;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("symbol", methodLabel(method));

            // Callers: usages of the method, grouped by their containing method.
            List<Map<String, Object>> callers = new ArrayList<>();
            Set<com.intellij.psi.PsiMethod> seenCallers = new LinkedHashSet<>();
            com.intellij.psi.search.searches.MethodReferencesSearch
                    .search(method, GlobalSearchScope.projectScope(project), true)
                    .forEach(ref -> {
                        com.intellij.psi.PsiMethod caller =
                                com.intellij.psi.util.PsiTreeUtil.getParentOfType(
                                        ref.getElement(), com.intellij.psi.PsiMethod.class);
                        if (caller != null && seenCallers.add(caller)) {
                            callers.add(node(facade, caller));
                        }
                        return callers.size() < bound;
                    });
            out.put("callers", callers);

            // Callees: calls inside the method body, first level, deduped.
            List<Map<String, Object>> callees = new ArrayList<>();
            Set<com.intellij.psi.PsiMethod> seenCallees = new LinkedHashSet<>();
            method.accept(new PsiRecursiveElementWalkingVisitor() {
                @Override public void visitElement(PsiElement el) {
                    if (callees.size() >= bound) return; // stop descending once full
                    super.visitElement(el);
                    if (el instanceof com.intellij.psi.PsiCallExpression) {
                        com.intellij.psi.PsiMethod callee =
                                ((com.intellij.psi.PsiCallExpression) el).resolveMethod();
                        if (callee != null && seenCallees.add(callee) && callees.size() < bound) {
                            callees.add(node(facade, callee));
                        }
                    }
                }
            });
            out.put("callees", callees);
            return out;
        }

        private static Map<String, Object> node(PsiSemanticFacade facade,
                                                com.intellij.psi.PsiMethod m) {
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("name", methodLabel(m));
            Map<String, Object> loc = facade.elementLocation(m);
            if (loc != null) {
                n.put("file", loc.get("file"));
                n.put("line", loc.get("line"));
            }
            return n;
        }

        private static String methodLabel(com.intellij.psi.PsiMethod m) {
            com.intellij.psi.PsiClass c = m.getContainingClass();
            String ownerName = c == null ? null : c.getQualifiedName();
            if (ownerName == null && c != null) ownerName = c.getName();
            return ownerName == null ? m.getName() : ownerName + "#" + m.getName();
        }
    }
}
