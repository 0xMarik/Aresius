import { Extension } from '@codemirror/state';
import { basicSetup, EditorView } from 'codemirror';
import { http } from '@/components/http-parser.component';
import { oneDark } from '@codemirror/theme-one-dark';
import { getCodeMirrorScrollTheme } from '@/components/codemirror-scroll.theme';

export const fullHeightTheme = EditorView.theme({
    '&': {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
    },
    '.cm-scroller': {
        flex: 1,
        overflow: 'auto',
    },
});

export function getCommonEditorExtensions(
    isDark: boolean,
    isPretty: boolean = true,
    additionalExtensions: Extension[] = []
): Extension[] {
    return [
        basicSetup,
        http({ enableFolding: isPretty }),
        ...(isDark ? [oneDark] : []),
        fullHeightTheme,
        getCodeMirrorScrollTheme(isDark),
        EditorView.lineWrapping,
        ...additionalExtensions,
    ];
}
