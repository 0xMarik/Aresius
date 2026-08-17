import { basicSetup, EditorView } from "codemirror";
import { Decoration, DecorationSet } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { http } from "../../http-parser.component";
import { javascript } from '@codemirror/lang-javascript';
import { Minus, Plus } from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useProjectId } from "@/hooks/useProjectId";
import { addParameter, removeParameter, setParameters, setSelectedParameter, setContent, selectFuzzerState, persistFuzzerSession } from '@/store/slices/fuzzerSlice';
import { FuzzerParameter, HighlightRange } from "@/types/fuzzer.type";
import { oneDark } from '@codemirror/theme-one-dark';
import { codeMirrorScrollTheme } from "@/components/codemirror-scroll.theme";
import CoreContextMenu from "@/components/ContextMenu/CoreContextMenu";
import RequestEditorContextMenu from "./RequestEditorContextMenu";
import HttpRequestFormatWarning from "@/components/HttpRequestFormatWarning";
import { toast } from "sonner";

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

// Create decoration for highlighted fuzzer parameters
const createHighlightDecoration = (id: string, isSelected: boolean = false) => Decoration.mark({
    class: `fuzzer-highlight ${isSelected ? 'fuzzer-highlight-selected' : ''}`,
    attributes: {
        style: isSelected
            ? 'padding: 0 3px; background-color: rgba(255, 5, 0, 0.35); color: black; border-radius: 2px; cursor: pointer; border: 2px solid #fbbf24;'
            : 'padding: 0 3px; background-color: rgba(255, 5, 0, 0.3); color: black; border-radius: 2px; cursor: pointer; border: 2px solid transparent;',
        'data-range-id': id
    },
    atomic: true
});

// CodeMirror StateEffect for updating fuzzer parameters inside EditorState
export const setFuzzerParamsEffect = StateEffect.define<{
    parameters: FuzzerParameter[];
    selectedId: string | null;
}>();

// CodeMirror StateField encapsulating parameters, selection, and decorations per-editor instance
export const fuzzerParamsField = StateField.define<{
    parameters: FuzzerParameter[];
    selectedId: string | null;
    decorations: DecorationSet;
}>({
    create() {
        return {
            parameters: [],
            selectedId: null,
            decorations: Decoration.none,
        };
    },
    update(value, tr) {
        let { parameters, selectedId } = value;

        for (const effect of tr.effects) {
            if (effect.is(setFuzzerParamsEffect)) {
                parameters = effect.value.parameters;
                selectedId = effect.value.selectedId;
            }
        }

        if (tr.docChanged && parameters.length > 0) {
            const doc = tr.newDoc;
            const updated: FuzzerParameter[] = [];
            for (const param of parameters) {
                if (!param.highlightRange.isActive) {
                    updated.push(param);
                    continue;
                }
                const oldFrom = param.highlightRange.from;
                const newFrom = tr.changes.mapPos(oldFrom, 1);
                const newTo = newFrom + param.highlightRange.originalText.length;

                let isActive = true;
                if (newTo <= doc.length && newFrom >= 0) {
                    const currentText = doc.sliceString(newFrom, newTo);
                    if (currentText !== param.highlightRange.originalText) {
                        isActive = false;
                    }
                } else {
                    isActive = false;
                }

                const textBefore = doc.sliceString(0, newFrom, "\r\n");
                const textHighlight = doc.sliceString(newFrom, newTo, "\r\n");
                const byteFrom = new TextEncoder().encode(textBefore).length;
                const byteTo = byteFrom + new TextEncoder().encode(textHighlight).length;

                let newHighlight = {
                    ...param.highlightRange,
                    from: newFrom,
                    to: newTo,
                    byteFrom,
                    byteTo,
                    isActive,
                };

                updated.push({
                    ...param,
                    highlightRange: newHighlight,
                });

                if (!newHighlight.isActive && selectedId === param.highlightRange.id) {
                    selectedId = null;
                }
            }
            parameters = updated;
        }

        // Build decorations
        const doc = tr.newDoc;
        const builder = new RangeSetBuilder<Decoration>();
        const activeRanges = parameters
            .filter(p => p.highlightRange.isActive)
            .filter(p => p.highlightRange.to <= doc.length && p.highlightRange.from >= 0)
            .filter(p => doc.sliceString(p.highlightRange.from, p.highlightRange.to) === p.highlightRange.originalText)
            .sort((a, b) => a.highlightRange.from - b.highlightRange.from);

        for (const p of activeRanges) {
            const isSelected = selectedId === p.highlightRange.id;
            const deco = createHighlightDecoration(p.highlightRange.id, isSelected);
            builder.add(p.highlightRange.from, p.highlightRange.to, deco);
        }

        return {
            parameters,
            selectedId,
            decorations: builder.finish(),
        };
    },
    provide: (field) => EditorView.decorations.from(field, (val) => val.decorations),
});

// Transaction filter to block edits in any active read-only region
const readOnlyTransactionFilter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    const fState = tr.startState.field(fuzzerParamsField, false);
    if (!fState || fState.parameters.length === 0) return tr;

    let hasConflict = false;
    tr.changes.iterChanges((fromA: number, toA: number) => {
        for (const range of fState.parameters) {
            if (range.highlightRange.isActive && !(toA <= range.highlightRange.from || fromA >= range.highlightRange.to)) {
                hasConflict = true;
                break;
            }
        }
    });

    if (hasConflict) {
        return [];
    }
    return tr;
});

// DOM click event handler for selecting highlight parameters
const fuzzerDomHandlers = (onSelectParam: (id: string | null) => void) => EditorView.domEventHandlers({
    click(event, view) {
        const target = event.target as HTMLElement;
        const highlightElement = target.closest('.fuzzer-highlight');
        if (highlightElement) {
            const rangeId = highlightElement.getAttribute('data-range-id');
            if (rangeId) {
                const fState = view.state.field(fuzzerParamsField, false);
                const range = fState?.parameters.find(r => r.highlightRange.id === rangeId);
                if (range?.highlightRange && range.highlightRange.isActive) {
                    const newSelectedId = fState?.selectedId === rangeId ? null : rangeId;
                    onSelectParam(newSelectedId);
                    return true;
                }
            }
        }
        return false;
    }
});

const RequestEditor: React.FC = () => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    const projectId = useProjectId();
    const { activeSessionIndex, fuzzerSessions } = useAppSelector(selectFuzzerState(projectId));
    const dispatch = useAppDispatch();

    if (activeSessionIndex === null) return <h1>No session</h1>;
    const currentFuzzerSession = fuzzerSessions[activeSessionIndex];
    if (currentFuzzerSession === undefined) return <h1>Session not found</h1>;

    // Synchronize Redux parameters and selectedHighlightId to CodeMirror state
    useEffect(() => {
        if (viewRef.current) {
            const view = viewRef.current;
            const currentFState = view.state.field(fuzzerParamsField, false);
            if (
                currentFState &&
                (currentFState.parameters !== currentFuzzerSession.fuzzConfig.parameters ||
                 currentFState.selectedId !== currentFuzzerSession.selectedHighlightId)
            ) {
                view.dispatch({
                    effects: setFuzzerParamsEffect.of({
                        parameters: currentFuzzerSession.fuzzConfig.parameters,
                        selectedId: currentFuzzerSession.selectedHighlightId,
                    })
                });
            }
        }
    }, [currentFuzzerSession.fuzzConfig.parameters, currentFuzzerSession.selectedHighlightId]);

    // Function to add a new highlight range
    const addHighlightRange = (from: number, to: number) => {
        if (!viewRef.current || !projectId || activeSessionIndex === null) return;
        const state = viewRef.current.state;
        if (from >= 0 && to <= state.doc.length && from < to) {
            const originalText = state.sliceDoc(from, to);
            const textBefore = state.doc.sliceString(0, from, "\r\n");
            const textHighlight = state.doc.sliceString(from, to, "\r\n");
            const byteFrom = new TextEncoder().encode(textBefore).length;
            const byteTo = byteFrom + new TextEncoder().encode(textHighlight).length;

            const newRange: HighlightRange = {
                id: `range-${Date.now()}-${Math.random()}`,
                byteFrom,
                byteTo,
                from,
                to,
                originalText,
                isActive: true
            };
            dispatch(addParameter({ highlightRange: newRange, projectId }));
            dispatch(setSelectedParameter({ parameterId: newRange.id, projectId }));
            dispatch(persistFuzzerSession(projectId, activeSessionIndex));
        }
    };

    // Function to remove a highlight range by id
    const removeHighlightRange = (id: string) => {
        if (!projectId || activeSessionIndex === null) return;
        dispatch(removeParameter({ paramId: id, projectId }));
        if (currentFuzzerSession.selectedHighlightId === id) {
            dispatch(setSelectedParameter({ parameterId: null, projectId }));
        }
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
    };

    // Function to clear all highlight ranges
    const clearAllHighlights = () => {
        if (!projectId || activeSessionIndex === null) return;
        dispatch(setParameters({ parameters: [], projectId }));
        dispatch(setSelectedParameter({ parameterId: null, projectId }));
        dispatch(persistFuzzerSession(projectId, activeSessionIndex));
    };

    // Function to add highlight for current selection or insert a space parameter if no selection
    const handleAddParameter = () => {
        if (!viewRef.current || !projectId || activeSessionIndex === null) return;
        const view = viewRef.current;
        const selection = view.state.selection.main;
        const fState = view.state.field(fuzzerParamsField, false);
        const params = fState?.parameters ?? currentFuzzerSession.fuzzConfig.parameters;

        if (!selection.empty) {
            addHighlightRange(selection.from, selection.to);
        } else {
            const pos = selection.from;

            // Check if cursor is strictly inside an existing active highlight range
            const isInsideActiveRange = params.some(
                r => r.highlightRange.isActive && pos > r.highlightRange.from && pos < r.highlightRange.to
            );
            if (isInsideActiveRange) {
                toast.error("Cannot add payload inside an existing parameter", { position: 'top-center' });
                return;
            }

            // Insert a space at current cursor position
            view.dispatch({
                changes: { from: pos, insert: " " },
                selection: { anchor: pos + 1 }
            });

            // After dispatch, view.state has the updated doc with the inserted space at pos
            addHighlightRange(pos, pos + 1);
        }
    };

    // Function to remove the currently selected highlight
    const handleRemoveSelected = () => {
        if (currentFuzzerSession.selectedHighlightId) {
            removeHighlightRange(currentFuzzerSession.selectedHighlightId);
        }
    };

    // Initialize EditorView for active session
    useEffect(() => {
        if (!editorRef.current) return;

        if (viewRef.current) {
            viewRef.current.destroy();
            viewRef.current = null;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const state = update.state;
                const doc = state.doc;
                const code = doc.sliceString(0, doc.length, "\r\n");
                if (projectId) dispatch(setContent({ rawRequest: code, projectId }));

                // If parameters shifted due to document edits, update Redux
                const fState = update.state.field(fuzzerParamsField, false);
                const prevFState = update.startState.field(fuzzerParamsField, false);
                if (fState && prevFState && fState.parameters !== prevFState.parameters) {
                    if (projectId) dispatch(setParameters({ parameters: fState.parameters, projectId }));
                }
            }
        });

        const initialBuilder = new RangeSetBuilder<Decoration>();
        const activeRanges = currentFuzzerSession.fuzzConfig.parameters
            .filter(p => p.highlightRange.isActive)
            .filter(p => p.highlightRange.to <= currentFuzzerSession.fuzzConfig.rawRequest.length && p.highlightRange.from >= 0)
            .sort((a, b) => a.highlightRange.from - b.highlightRange.from);

        for (const p of activeRanges) {
            const isSelected = currentFuzzerSession.selectedHighlightId === p.highlightRange.id;
            initialBuilder.add(p.highlightRange.from, p.highlightRange.to, createHighlightDecoration(p.highlightRange.id, isSelected));
        }

        const state = EditorState.create({
            doc: currentFuzzerSession.fuzzConfig.rawRequest,
            extensions: [
                basicSetup,
                http(),
                EditorView.lineWrapping,
                javascript(),
                oneDark,
                fullHeightTheme,
                codeMirrorScrollTheme,
                fuzzerParamsField.init(() => ({
                    parameters: currentFuzzerSession.fuzzConfig.parameters,
                    selectedId: currentFuzzerSession.selectedHighlightId,
                    decorations: initialBuilder.finish(),
                })),
                readOnlyTransactionFilter,
                fuzzerDomHandlers((newId) => {
                    if (projectId) {
                        dispatch(setSelectedParameter({ parameterId: newId, projectId }));
                    }
                }),
                updateListener,
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            if (view) {
                view.destroy();
            }
        };
    }, [activeSessionIndex]);

    return (
        <>
            <div className="h-full flex flex-col gap-1 ">
                <div className="flex items-center h-12 gap-2 px-2">
                    <Badge variant="secondary" className="text-xs">
                        Session {activeSessionIndex + 1}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        HTTP
                    </Badge>
                    <HttpRequestFormatWarning rawRequest={currentFuzzerSession.fuzzConfig.rawRequest} />
                    <Button
                        className="h-[2rem]"
                        onClick={clearAllHighlights}
                    >
                        Clear Fuzzes
                    </Button>
                    <Button
                        size="icon"
                        className="size-8"
                        title={currentFuzzerSession.selectedHighlightId ? "Remove selected highlight" : "Select a highlight first"}
                        onClick={handleRemoveSelected}
                        disabled={!currentFuzzerSession.selectedHighlightId}
                    >
                        <Minus />
                    </Button>
                    <Button
                        size="icon"
                        className="size-8"
                        title="Add fuzz parameter (or insert space parameter at cursor)"
                        onClick={handleAddParameter}
                    >
                        <Plus />
                    </Button>
                </div>
                <CoreContextMenu triggerClassName="bg-background w-full h-full"
                    renderContextMenu={() => (<RequestEditorContextMenu viewRef={viewRef} onAddParameter={handleAddParameter} />)}>
                    <div
                        ref={editorRef}
                        className="h-full overflow-auto" />
                </CoreContextMenu>
            </div>
        </>
    );
};

export default RequestEditor;
