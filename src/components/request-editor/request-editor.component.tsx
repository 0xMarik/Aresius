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

interface RequestEditorProps {
    rawRequest: string;
    activeSessionIndex: number;
}

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
let globalRanges: HighlightRange[] = [];
let selectedRangeId: string | null = null;
let onRangesUpdate: ((ranges: HighlightRange[]) => void) | null = null;
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
            if (range.isActive && !(toA <= range.from || fromA >= range.to)) {
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
                    const range = globalRanges.find(r => r.id === rangeId);
                    if (range && range.isActive) {
                        // Toggle selection
                        const newSelectedId = selectedRangeId === rangeId ? null : rangeId;
                        selectedRangeId = newSelectedId;

                        // Update selection state
                        if (onSelectionUpdate) {
                            onSelectionUpdate(newSelectedId);
                        }

                        // Call the click handler
                        if (onHighlightClick) {
                            onHighlightClick(rangeId, range);
                        }

                        // Trigger redraw to update decorations
                        view.dispatch({ effects: [] });
                    }
                }
            } else {
                // Clicked outside highlights, deselect
                if (selectedRangeId !== null) {
                    selectedRangeId = null;
                    if (onSelectionUpdate) {
                        onSelectionUpdate(null);
                    }
                    view.dispatch({ effects: [] });
                }
            }
        });
    }

    update(update: any) {
        if (update.docChanged && globalRanges.length > 0) {
            const doc = update.view.state.doc;
            let hasChanges = false;

            // Update each range
            for (const range of globalRanges) {
                if (!range.isActive) continue;

                const oldFrom = range.from;
                const oldTo = range.to;
                const wasActive = range.isActive;

                // Map the range position
                range.from = update.changes.mapPos(range.from, 1);
                range.to = range.from + range.originalText.length;

                // Check if range is still valid and text matches
                if (range.to <= doc.length && range.from >= 0) {
                    const currentText = doc.sliceString(range.from, range.to);
                    if (currentText !== range.originalText) {
                        range.isActive = false;
                        hasChanges = true;
                    }
                } else {
                    range.isActive = false;
                    hasChanges = true;
                }

                // Check if position changed or became inactive
                if (oldFrom !== range.from || oldTo !== range.to || wasActive !== range.isActive) {
                    hasChanges = true;
                }

                // If selected range became inactive, clear selection
                if (!range.isActive && selectedRangeId === range.id) {
                    selectedRangeId = null;
                    if (onSelectionUpdate) {
                        onSelectionUpdate(null);
                    }
                }
            }

            // Notify React state if there were changes
            if (hasChanges && onRangesUpdate) {
                onRangesUpdate([...globalRanges]);
            }
        }

        this.decorations = this.buildDecorations(update.view);
    }

    buildDecorations(view: any) {
        const doc = view.state.doc;
        const builder = new RangeSetBuilder();

        // Sort ranges by position to ensure proper order for RangeSetBuilder
        const activeRanges = globalRanges
            .filter(range => range.isActive)
            .filter(range => range.to <= doc.length && range.from >= 0)
            .filter(range => {
                const currentText = doc.sliceString(range.from, range.to);
                return currentText === range.originalText;
            })
            .sort((a, b) => a.from - b.from);

        // Add decorations for each active range
        for (const range of activeRanges) {
            const isSelected = selectedRangeId === range.id;
            const decoration = createHighlightDecoration(range.id, isSelected);
            builder.add(range.from, range.to, decoration);
        }

        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

const RequestEditor: React.FC<RequestEditorProps> = ({ rawRequest, activeSessionIndex }) => {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    // State for managing highlight ranges
    const [highlightRanges, setHighlightRanges] = useState<HighlightRange[]>([]);

    // State for selected range
    const [selectedRange, setSelectedRange] = useState<string | null>(null);

    // Sync state with global ranges
    useEffect(() => {
        globalRanges = highlightRanges;
        selectedRangeId = selectedRange;

        // Set up the callback to update React state when ranges change
        onRangesUpdate = (updatedRanges: HighlightRange[]) => {
            setHighlightRanges(updatedRanges);
        };

        // Set up the callback to update selection state
        onSelectionUpdate = (selectedId: string | null) => {
            setSelectedRange(selectedId);
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
    }, [highlightRanges, selectedRange]);

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

            setHighlightRanges(prev => [...prev, newRange]);
        }
    };

    // Function to remove a highlight range by id
    const removeHighlightRange = (id: string) => {
        setHighlightRanges(prev => {
            const newRanges = prev.filter(range => range.id !== id);
            console.log('Removing range', id, 'New count:', newRanges.length);
            return newRanges;
        });
        // Clear selection if the removed range was selected
        if (selectedRange === id) {
            setSelectedRange(null);
        }
    };

    // Function to clear all highlight ranges
    const clearAllHighlights = () => {
        setHighlightRanges([]);
        setSelectedRange(null);
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
        if (selectedRange) {
            console.log('Removing selected range:', selectedRange);
            removeHighlightRange(selectedRange);
        } else {
            console.log('No range selected for removal');
        }
    };

    useEffect(() => {
        if (!editorRef.current) return;

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const code = update.state.doc.toString();
                console.log('Code changed:', code);
                // TODO: Emit or use the code
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
            doc: rawRequest,
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
        const doc = view.state.doc;
        if (doc.length > 10) { // Only if document has enough content
            const initialRanges: HighlightRange[] = [
                {
                    id: 'range-1',
                    from: 1,
                    to: Math.min(4, doc.length),
                    originalText: doc.sliceString(1, Math.min(4, doc.length)),
                    isActive: true
                },
                {
                    id: 'range-2',
                    from: Math.min(6, doc.length - 3),
                    to: Math.min(9, doc.length),
                    originalText: doc.sliceString(Math.min(6, doc.length - 3), Math.min(9, doc.length)),
                    isActive: true
                }
            ].filter(range => range.originalText.length > 0 && range.from < range.to);

            if (initialRanges.length > 0) {
                setHighlightRanges(initialRanges);
            }
        }

        return () => {
            view.destroy();
        };
    }, [rawRequest]); // Only recreate editor when rawRequest changes

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
                        Total: {highlightRanges.length}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                        Active: {highlightRanges.filter(r => r.isActive).length}
                    </Badge>
                    {selectedRange && (
                        <Badge variant="default" className="text-xs bg-yellow-500">
                            Selected: {highlightRanges.find(r => r.id === selectedRange)?.originalText || selectedRange}
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
                        title={selectedRange ? "Remove selected highlight" : "Select a highlight first"}
                        onClick={handleRemoveSelected}
                        disabled={!selectedRange}
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