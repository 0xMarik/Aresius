import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EditorState, Annotation } from '@codemirror/state';
import { EditorView } from 'codemirror';
import { useTheme } from '@/components/theme-provider';
import { getCommonEditorExtensions } from '@/components/Replayer/editorUtils';
import { Play, RotateCcw, Sparkles, Check, ArrowRight } from 'lucide-react';
import { MatchReplaceRule } from './types';
import { applyRuleToHttpRequest, applyRulesToHttpRequest } from './matchReplaceUtils';
import { INITIAL_DUMMY_REQUEST, INITIAL_DUMMY_RESPONSE } from './dummyData';

const externalUpdateAnnotation = Annotation.define<boolean>();

interface RuleTesterPaneProps {
    activeRule: MatchReplaceRule | null;
    allRules: MatchReplaceRule[];
}

export const RuleTesterPane: React.FC<RuleTesterPaneProps> = ({
    activeRule,
    allRules,
}) => {
    const { theme } = useTheme();
    const isDark =
        theme === 'dark' ||
        (theme === 'system' &&
            typeof window !== 'undefined' &&
            window.matchMedia('(prefers-color-scheme: dark)').matches);

    const isResponseRule = activeRule?.type?.startsWith('response_');
    const defaultSample = isResponseRule ? INITIAL_DUMMY_RESPONSE : INITIAL_DUMMY_REQUEST;

    const [sampleType, setSampleType] = useState<'request' | 'response'>(
        isResponseRule ? 'response' : 'request'
    );
    const [beforeDoc, setBeforeDoc] = useState<string>(defaultSample);
    const [afterDoc, setAfterDoc] = useState<string | null>(null);
    const [isTestRun, setIsTestRun] = useState<boolean>(false);

    const beforeEditorRef = useRef<HTMLDivElement | null>(null);
    const afterEditorRef = useRef<HTMLDivElement | null>(null);
    const beforeViewRef = useRef<EditorView | null>(null);
    const afterViewRef = useRef<EditorView | null>(null);

    // Function to compute replaced request/response
    const computeReplaced = (input: string) => {
        if (!activeRule) {
            return applyRulesToHttpRequest(input, allRules);
        }
        return applyRuleToHttpRequest(input, activeRule);
    };

    // Run test / transformation manually on click
    const handleRunTest = () => {
        const result = computeReplaced(beforeDoc);
        setAfterDoc(result);
        setIsTestRun(true);
        setTimeout(() => setIsTestRun(false), 1000);
    };

    // Reset before doc to default and clear after doc
    const handleReset = () => {
        const initial = sampleType === 'response' ? INITIAL_DUMMY_RESPONSE : INITIAL_DUMMY_REQUEST;
        setBeforeDoc(initial);
        setAfterDoc(null);
    };

    // Switch sample type explicitly via selector
    const handleSwitchSampleType = (type: 'request' | 'response') => {
        setSampleType(type);
        const initial = type === 'response' ? INITIAL_DUMMY_RESPONSE : INITIAL_DUMMY_REQUEST;
        setBeforeDoc(initial);
        setAfterDoc(null);
    };

    // CodeMirror setup for BEFORE editor (Editable)
    useEffect(() => {
        if (!beforeEditorRef.current) return;

        if (beforeViewRef.current) {
            beforeViewRef.current.destroy();
            beforeViewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const isExternal = update.transactions.some((tr) =>
                    tr.annotation(externalUpdateAnnotation)
                );
                if (!isExternal) {
                    const code = update.state.doc.sliceString(0, update.state.doc.length, '\r\n');
                    setBeforeDoc(code);
                    // Clear afterDoc to show the empty placeholder prompt when user edits before text
                    setAfterDoc(null);
                }
            }
        });

        const state = EditorState.create({
            doc: beforeDoc,
            extensions: getCommonEditorExtensions(isDark, false, [updateListener]),
        });

        const view = new EditorView({
            state,
            parent: beforeEditorRef.current,
        });

        beforeViewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [isDark]);

    // Update before editor document when reset externally
    useEffect(() => {
        if (!beforeViewRef.current) return;
        const view = beforeViewRef.current;
        const currentDoc = view.state.doc.sliceString(0, view.state.doc.length, '\r\n');

        if (currentDoc !== beforeDoc) {
            const currentSelection = view.state.selection;
            const newLen = beforeDoc.length;
            const safeAnchor = Math.min(currentSelection.main.anchor, newLen);
            const safeHead = Math.min(currentSelection.main.head, newLen);

            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: beforeDoc },
                selection: { anchor: safeAnchor, head: safeHead },
                annotations: externalUpdateAnnotation.of(true),
            });
        }
    }, [beforeDoc]);

    // CodeMirror setup for AFTER viewer (Read-only)
    useEffect(() => {
        if (!afterEditorRef.current || afterDoc === null) {
            if (afterViewRef.current) {
                afterViewRef.current.destroy();
                afterViewRef.current = null;
            }
            return;
        }

        if (afterViewRef.current) {
            afterViewRef.current.destroy();
            afterViewRef.current = null;
        }

        const state = EditorState.create({
            doc: afterDoc,
            extensions: getCommonEditorExtensions(isDark, false, [
                EditorState.readOnly.of(true),
            ]),
        });

        const view = new EditorView({
            state,
            parent: afterEditorRef.current,
        });

        afterViewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [isDark, afterDoc]);

    // Detect if changes were made
    const hasModifications = useMemo(() => {
        if (afterDoc === null) return null;
        return beforeDoc !== afterDoc;
    }, [beforeDoc, afterDoc]);

    return (
        <div className="flex flex-col h-full bg-card min-h-0 overflow-hidden border-t border-border/40">
            {/* Common Header */}
            <div className="flex items-center justify-between px-3 h-11 bg-card/60 border-b border-border/40 shrink-0 select-none">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                        Test Match & Replace
                    </span>

                    {/* Sample type selector */}
                    <div className="flex items-center bg-muted/40 p-0.5 rounded-md border border-border/40 ml-2">
                        <button
                            type="button"
                            onClick={() => handleSwitchSampleType('request')}
                            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                                sampleType === 'request'
                                    ? 'bg-background text-foreground font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Request POC
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSwitchSampleType('response')}
                            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
                                sampleType === 'response'
                                    ? 'bg-background text-foreground font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            Response POC
                        </button>
                    </div>

                    {hasModifications === true && (
                        <Badge variant="outline" className="text-[9px] h-4.5 px-1.5 border-emerald-500/40 text-emerald-500 bg-emerald-500/10 font-mono">
                            Match Replaced
                        </Badge>
                    )}
                    {hasModifications === false && (
                        <Badge variant="outline" className="text-[9px] h-4.5 px-1.5 border-border text-muted-foreground/70 font-mono">
                            No match in sample
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="h-7 text-xs font-mono gap-1 text-muted-foreground hover:text-foreground"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Reset
                    </Button>

                    <Button
                        onClick={handleRunTest}
                        size="sm"
                        className="h-7 text-xs font-semibold gap-1.5 px-3 bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
                    >
                        {isTestRun ? (
                            <>
                                <Check className="w-3.5 h-3.5" />
                                Tested
                            </>
                        ) : (
                            <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                Test
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Split Before / After Editors */}
            <ResizablePanelGroup direction="horizontal" autoSaveId="aresius-match-replace-rule-tester" className="flex-1 min-h-0">
                {/* Left: Before Editor */}
                <ResizablePanel defaultSize={50} minSize={25}>
                    <div className="flex flex-col h-full min-h-0 bg-card">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    Before
                                </span>
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-border/60 text-muted-foreground/70 font-mono">
                                    Editable {sampleType === 'response' ? 'Response' : 'Request'}
                                </Badge>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0">
                            <div ref={beforeEditorRef} className="h-full w-full bg-card" />
                        </div>
                    </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right: After Viewer */}
                <ResizablePanel defaultSize={50} minSize={25}>
                    <div className="flex flex-col h-full min-h-0 bg-card">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/30 shrink-0 select-none">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    After
                                </span>
                                <Badge variant="outline" className="text-[9px] h-4 px-1 border-border/60 text-muted-foreground/70 font-mono">
                                    Transformed Output
                                </Badge>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 relative">
                            {afterDoc === null ? (
                                <div className="flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground select-none">
                                    <div className="flex items-center justify-center w-11 h-11 rounded-full bg-muted/50 mb-3 border border-border/50">
                                        <ArrowRight className="w-5 h-5 text-primary" />
                                    </div>
                                    <p className="text-xs font-semibold text-foreground">Click Test to view replacement</p>
                                    <p className="text-[11px] text-muted-foreground mt-1 max-w-[280px]">
                                        Edit the request/response on the left, then click <span className="font-semibold text-foreground">Test</span> to preview the transformed result.
                                    </p>
                                    <Button
                                        onClick={handleRunTest}
                                        size="sm"
                                        variant="outline"
                                        className="mt-3.5 h-7 text-xs gap-1.5 font-medium"
                                    >
                                        <Play className="w-3.5 h-3.5 fill-current text-primary" />
                                        Test Now
                                    </Button>
                                </div>
                            ) : (
                                <div ref={afterEditorRef} className="h-full w-full bg-card" />
                            )}
                        </div>
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
};
