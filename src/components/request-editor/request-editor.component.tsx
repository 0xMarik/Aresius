import { basicSetup, EditorView } from "codemirror";
import { Decoration, keymap, ViewPlugin } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { EditorState, SelectionRange } from '@codemirror/state';
import { http } from "../http-parser.component";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from '@codemirror/lang-javascript';
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { RangeSetBuilder } from "@codemirror/state";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { addParameter, removeParameter, setParameters, setSelectedParameter, setContent } from '@/store/slices/fuzzerSlice'
import { FuzzerParameter } from "@/types/fuzzer.type";

const fullHeightTheme = EditorView.theme({
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



interface HighlightRange {
    from: number;
    to: number;
    originalText: string;
    isActive: boolean;
    id: string; // Unique identifier for each range
}

// Create decoration with click handler and index
const createHighlightDecoration = (id: string, isSelected: boolean = false) => Decoration.mark({
    class: `fuzzer-highlight ${isSelected ? 'fuzzer-highlight-selected' : ''}`,
    attributes: {
        style: isSelected
            ? 'padding: 0 2px; background-color: rgba(255, 5, 0, 0.3); color: black; border-radius: 2px; cursor: pointer; border: 2px solid #fbbf24;'
            : 'padding: 0 2px; background-color: rgba(255, 5, 0, 0.3); color: black; border-radius: 2px; cursor: pointer;',
        'data-range-id': id
    },
    atomic: true
});

// Global state for ranges - will be managed by React state
let globalRanges: FuzzerParameter[] = [];
let selectedRangeId: string | null = null;
let onRangesUpdate: ((ranges: FuzzerParameter[]) => void) | null = null;
let onSelectionUpdate: ((selectedId: string | null) => void) | null = null;
let onHighlightClick: ((id: string, range: HighlightRange) => void) | null = null;

// Transaction filter to block edits in any active read-only region
const readOnlyTransactionFilter = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || globalRanges.length === 0) {
        return tr;
    }

    // Check if any changes conflict with active read-only regions
    let hasConflict = false;
    tr.changes.iterChanges((fromA: number, toA: number) => {
        for (const range of globalRanges) {
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

const fuzzerHighlighter = ViewPlugin.fromClass(class {
    decorations: any;

    constructor(view: any) {
        this.decorations = this.buildDecorations(view);
        this.setupClickHandler(view);
    }

    setupClickHandler(view: any) {
        // Add click event listener to the editor
        view.dom.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;

            // Check if clicked element or its parent has the highlight class
            let highlightElement = target.closest('.fuzzer-highlight');

            if (highlightElement) {
                const rangeId = highlightElement.getAttribute('data-range-id');
                if (rangeId) {
                    const range = globalRanges.find(r => r.highlightRange.id === rangeId);
                    console.log({ range });
                    if (range?.highlightRange && range.highlightRange.isActive) {
                        // Toggle selection
                        const newSelectedId = selectedRangeId === rangeId ? null : rangeId;
                        selectedRangeId = newSelectedId;

                        // Update selection state
                        if (onSelectionUpdate) {
                            onSelectionUpdate(newSelectedId);
                        }

                        // Call the click handler
                        if (onHighlightClick) {
                            onHighlightClick(rangeId, range.highlightRange);
                        }

                        // Trigger redraw to update decorations
                        view.dispatch({ effects: [] });
                    }
                }
            }
            // REMOVED: The else block that was deselecting when clicking outside highlights
            // This allows the selection to persist when clicking on regular text
        });
    }

    update(update: any) {
        if (update.docChanged && globalRanges.length > 0) {
            const doc = update.view.state.doc;
            let hasChanges = false;
            const updatedRanges: FuzzerParameter[] = [];

            // Update each range
            for (const range of globalRanges) {
                if (!range.highlightRange.isActive) {
                    updatedRanges.push(range);
                    continue;
                }

                const oldFrom = range.highlightRange.from;
                const oldTo = range.highlightRange.to;
                const wasActive = range.highlightRange.isActive;

                // Map the range position
                const newFrom = update.changes.mapPos(range.highlightRange.from, 1);
                const newTo = newFrom + range.highlightRange.originalText.length;

                // Create new highlight range object
                let newHighlightRange = {
                    ...range.highlightRange,
                    from: newFrom,
                    to: newTo
                };

                // Check if range is still valid and text matches
                if (newTo <= doc.length && newFrom >= 0) {
                    const currentText = doc.sliceString(newFrom, newTo);
                    if (currentText !== range.highlightRange.originalText) {
                        newHighlightRange = {
                            ...newHighlightRange,
                            isActive: false
                        };
                        hasChanges = true;
                    }
                } else {
                    newHighlightRange = {
                        ...newHighlightRange,
                        isActive: false
                    };
                    hasChanges = true;
                }

                // Check if position changed or became inactive
                if (oldFrom !== newFrom || oldTo !== newTo || wasActive !== newHighlightRange.isActive) {
                    hasChanges = true;
                }

                // Create new range object with updated highlight range
                const updatedRange = {
                    ...range,
                    highlightRange: newHighlightRange
                };

                updatedRanges.push(updatedRange);

                // If selected range became inactive, clear selection
                if (!newHighlightRange.isActive && selectedRangeId === range.highlightRange.id) {
                    selectedRangeId = null;
                    if (onSelectionUpdate) {
                        onSelectionUpdate(null);
                    }
                }
            }

            // Update global ranges with new array
            if (hasChanges) {
                globalRanges = updatedRanges;

                // Notify React state if there were changes
                if (onRangesUpdate) {
                    onRangesUpdate([...globalRanges]);
                }
            }
        }

        this.decorations = this.buildDecorations(update.view);
    }

    buildDecorations(view: any) {
        const doc = view.state.doc;
        const builder = new RangeSetBuilder();

        // Sort ranges by position to ensure proper order for RangeSetBuilder
        const activeRanges = globalRanges
            .filter(range => range.highlightRange.isActive)
            .filter(range => range.highlightRange.to <= doc.length && range.highlightRange.from >= 0)
            .filter(range => {
                const currentText = doc.sliceString(range.highlightRange.from, range.highlightRange.to);
                return currentText === range.highlightRange.originalText;
            })
            .sort((a, b) => a.highlightRange.from - b.highlightRange.from);

        // Add decorations for each active range
        for (const range of activeRanges) {
            const isSelected = selectedRangeId === range.highlightRange.id;
            const decoration = createHighlightDecoration(range.highlightRange.id, isSelected);
            builder.add(range.highlightRange.from, range.highlightRange.to, decoration);
        }

        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

interface RequestEditorProps {
    rawRequest: string;
    activeSessionIndex?: number;
}

const RequestEditor: React.FC<RequestEditorProps> = ({ rawRequest }) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    const { activeSessionIndex, fuzzerSessions } = useAppSelector(state => state.fuzzerstate);
    const dispatch = useAppDispatch();

    if (activeSessionIndex === null) return <h1>No session</h1>;
    const currentFuzzerSession = fuzzerSessions[activeSessionIndex];
    if (currentFuzzerSession === undefined) return <h1>Session not found</h1>;

    // State for managing highlight ranges
    // const [highlightRanges, setHighlightRanges] = useState<HighlightRange[]>([]);

    // State for selected range
    // const [selectedRange, setSelectedRange] = useState<string | null>(null);

    // Sync state with global ranges
    useEffect(() => {
        globalRanges = currentFuzzerSession.payload.parameters;
        selectedRangeId = currentFuzzerSession.selectedHighlightId;

        // Set up the callback to update React state when ranges change
        onRangesUpdate = (updatedRanges: FuzzerParameter[]) => {
            // setHighlightRanges(updatedRanges);
            dispatch(setParameters({ parameters: updatedRanges }));
        };

        // Set up the callback to update selection state
        onSelectionUpdate = (selectedId: string | null) => {
            // setSelectedRange(selectedId);
            dispatch(setSelectedParameter({ parameterId: selectedId }))
        };

        // Set up click handler
        onHighlightClick = (id: string, range: HighlightRange) => {
            console.log(`Clicked on highlight ${id}:`, range);
            // You can handle click events here
        };

        // Trigger a redraw if editor exists
        if (viewRef.current) {
            viewRef.current.dispatch({ effects: [] });
        }
    }, [currentFuzzerSession.payload.parameters, currentFuzzerSession.selectedHighlightId]);

    // Function to add a new highlight range
    const addHighlightRange = (from: number, to: number) => {
        if (!viewRef.current) return;

        const doc = viewRef.current.state.doc;
        if (from >= 0 && to <= doc.length && from < to) {
            const originalText = doc.sliceString(from, to);
            const newRange: HighlightRange = {
                id: `range-${Date.now()}-${Math.random()}`,
                from,
                to,
                originalText,
                isActive: true
            };

            // setHighlightRanges(prev => [...prev, newRange]);
            dispatch(addParameter({ highlightRange: newRange }))
        }
    };

    // Function to remove a highlight range by id
    const removeHighlightRange = (id: string) => {
        console.log({ id })
        dispatch(removeParameter({ paramId: id }));
        // Clear selection if the removed range was selected
        if (currentFuzzerSession.selectedHighlightId === id) {
            dispatch(setSelectedParameter({ parameterId: null }))
        }
    };

    // Function to clear all highlight ranges
    const clearAllHighlights = () => {
        dispatch(setParameters({ parameters: [] }));
        dispatch(setSelectedParameter({ parameterId: null }))
    };

    // Function to add highlight for current selection
    const handleAddParameter = () => {
        if (!viewRef.current) return;

        const selection = viewRef.current.state.selection.main;
        if (!selection.empty) {
            addHighlightRange(selection.from, selection.to);
        }
    };

    // Function to remove the currently selected highlight
    const handleRemoveSelected = () => {
        if (currentFuzzerSession.selectedHighlightId) {
            console.log('Removing selected range:', currentFuzzerSession.selectedHighlightId);
            removeHighlightRange(currentFuzzerSession.selectedHighlightId);
        } else {
            console.log('No range selected for removal');
        }
    };

    // Update editor content when Redux state changes
    useEffect(() => {
        if (viewRef.current && currentFuzzerSession.payload.rawRequest !== undefined) {
            const currentDoc = viewRef.current.state.doc.toString();
            if (currentDoc !== currentFuzzerSession.payload.rawRequest) {
                viewRef.current.dispatch({
                    changes: {
                        from: 0,
                        to: currentDoc.length,
                        insert: currentFuzzerSession.payload.rawRequest
                    }
                });
            }
        }
    }, [currentFuzzerSession.payload.rawRequest]);

    useEffect(() => {
        if (!editorRef.current) return;

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                console.log('Code changed:', code);
                // Update Redux state with new content
                dispatch(setContent({ rawRequest: code }));
            }
            if (update.selectionSet) {
                const selection = update.state.selection.main;
                if (!selection.empty) {
                    // User has selected text
                    const from = selection.from;
                    const to = selection.to;
                    const selectedText = update.state.doc.sliceString(from, to);

                    console.log(from, to, selectedText);
                }
            }
        });

        const state = EditorState.create({
            doc: currentFuzzerSession.payload.rawRequest || rawRequest,
            extensions: [
                basicSetup,
                http(),
                javascript(),
                // oneDark,
                fullHeightTheme,
                updateListener,
                fuzzerHighlighter,
                readOnlyTransactionFilter,
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        // Initialize with some example ranges after the editor is created
        // const doc = view.state.doc;
        // if (doc.length > 5) { // Only if document has enough content
        //     console.log('Setting initial parameters');
        //     const initialRanges: FuzzerParameter[] = [
        //         {
        //             highlightRange: {
        //                 id: 'range-1',
        //                 from: 0,
        //                 to: 3,
        //                 originalText: 'GET',
        //                 isActive: true
        //             }, // Default highlight range ID
        //             // id: 'param-1',
        //             // name: 'FUZZ_1',
        //             payloadSource: "manual" as const,
        //             // replacedValue: '',
        //             values: ['/page', '/', '/home', '/about', '/contact', '/products', '/services', '/blog', '/faq', '/terms', '/privacy', '/help', '/support', '/login', '/register', '/dashboard', '/profile',]
        //         }
        //     ].filter(range => range.highlightRange.originalText.length > 0 && range.highlightRange.from < range.highlightRange.to);

        //     if (initialRanges.length > 0) {
        //         console.log('Setting initial parameters:', initialRanges);
        //         dispatch(setParameters({ parameters: initialRanges }));
        //     }
        // }

        return () => {
            view.destroy();
        };
    }, []); // Only create editor once

    return (
        <>
            <div className="h-full flex flex-col gap-1 ">
                <div className="flex items-center h-12 border rounded gap-2 px-2">
                    <Badge variant="secondary" className="text-xs">
                        Session {activeSessionIndex + 1}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        HTTP
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        Total: {currentFuzzerSession.payload.parameters.length}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        Active: {currentFuzzerSession.payload.parameters.filter(r => r.highlightRange.isActive).length}
                    </Badge>
                    {currentFuzzerSession.selectedHighlightId && (
                        <Badge variant="default" className="text-xs bg-yellow-500">
                            Selected: {currentFuzzerSession.payload.parameters.find(r => r.highlightRange.id === currentFuzzerSession.selectedHighlightId)?.highlightRange.originalText || currentFuzzerSession.selectedHighlightId}
                        </Badge>
                    )}
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
                        title="Select text to add as fuzz parameter"
                        onClick={handleAddParameter}
                    >
                        <Plus />
                    </Button>
                </div>
                <div
                    ref={editorRef}
                    className="h-full max-h-full border rounded overflow-auto" />
            </div>
        </>
    );
};

export default RequestEditor;