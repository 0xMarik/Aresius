import { EditorView } from "codemirror";

export const getCodeMirrorScrollTheme = (isDark = true) =>
    EditorView.theme({
        ".cm-scroller": {
            scrollbarWidth: "thin",
            scrollbarColor: isDark
                ? "rgba(255, 255, 255, 0.3) transparent"
                : "rgba(0, 0, 0, 0.25) transparent",
        },
        ".cm-scroller::-webkit-scrollbar": {
            width: "8px",
            height: "8px",
        },
        ".cm-scroller::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
        },
        ".cm-scroller::-webkit-scrollbar-thumb": {
            backgroundColor: isDark
                ? "rgba(255, 255, 255, 0.25)"
                : "rgba(0, 0, 0, 0.25)",
            borderRadius: "9999px",
            border: "2px solid transparent",
            backgroundClip: "padding-box",
        },
        ".cm-scroller::-webkit-scrollbar-thumb:hover": {
            backgroundColor: isDark
                ? "rgba(255, 255, 255, 0.5)"
                : "rgba(0, 0, 0, 0.45)",
        },
    });

export const codeMirrorScrollTheme = EditorView.theme({
    ".cm-scroller": {
        scrollbarWidth: "thin",
        scrollbarColor: "hsl(var(--muted-foreground) / 0.4) transparent",
    },
    ".cm-scroller::-webkit-scrollbar": {
        width: "8px",
        height: "8px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
        backgroundColor: "transparent",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
        backgroundColor: "hsl(var(--muted-foreground) / 0.3)",
        borderRadius: "9999px",
        border: "2px solid transparent",
        backgroundClip: "padding-box",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
        backgroundColor: "hsl(var(--muted-foreground) / 0.6)",
    },
});
