import React, { useEffect, useRef, useState } from 'react';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { codeMirrorScrollTheme } from '@/components/codemirror-scroll.theme';
import { http } from '@/components/http-parser.component';
import DataTable, { BaseRow } from '@/components/Table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MethodBadge, { METHOD_COLORS } from '@/components/MethodBadge';
import { ColumnDef } from '@tanstack/react-table';
import { Play, Trash2, ArrowRight, Shield } from 'lucide-react';
import type { InterceptItem, InterceptItemType } from '@/store/slices/interceptorSlice';

interface TableItem extends BaseRow {
    id: number;
    originalId: string;
    host: string;
    methodOrStatus: string;
    isHttps: boolean;
    item: InterceptItem;
}

interface InterceptStackProps {
    itemType: InterceptItemType;
    items: InterceptItem[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onForward: (id: string, editedContent: string) => Promise<void>;
    onDrop: (id: string) => Promise<void>;
    onDropAll: () => Promise<void>;
    actionLoading?: boolean;
    emptyLabel: string;
    emptyHint: string;
}

const buildColumns = (): ColumnDef<TableItem, any>[] => [
    { accessorKey: 'host', header: 'Host' },
    {
        accessorKey: 'methodOrStatus',
        header: 'Method',
        cell: ({ row }) => {
            const val = row.original.methodOrStatus;
            const normalized = (val || '').trim().toUpperCase();
            if (METHOD_COLORS[normalized]) {
                return <MethodBadge method={normalized} />;
            }
            return <span className="font-mono text-xs">{val}</span>;
        },
    },
    {
        accessorKey: 'isHttps',
        header: 'TLS',
        cell: ({ row }) => (row.original.isHttps ? 'https' : 'http'),
    },
];

export const InterceptStack: React.FC<InterceptStackProps> = ({
    itemType,
    items,
    selectedId,
    onSelect,
    onForward,
    onDrop,
    onDropAll,
    actionLoading,
    emptyLabel,
    emptyHint,
}) => {
    const selectedItem = items.find((item) => item.id === selectedId) || null;

    const [editedContent, setEditedContent] = useState<string>('');
    const [validationError, setValidationError] = useState<string | null>(null);

    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    const editorViewRef = useRef<EditorView | null>(null);

    useEffect(() => {
        setEditedContent(selectedItem ? selectedItem.rawMessage : '');
        setValidationError(null);
    }, [selectedItem?.id, selectedItem?.rawMessage]);

    // Init/update CodeMirror. Init branch reads selectedItem.rawMessage
    // directly (not editedContent from closure) so the first paint can't go
    // stale if selection and the sync effect above ever race.
    useEffect(() => {
        if (!editorContainerRef.current) return;

        if (!editorViewRef.current) {
            const startState = EditorState.create({
                doc: selectedItem?.rawMessage ?? '',
                extensions: [
                    http(),
                    oneDark,
                    codeMirrorScrollTheme,
                    EditorView.lineWrapping,
                    EditorView.theme({
                        '&': { height: '100%', fontSize: '12px', backgroundColor: '#0d1117' },
                        '.cm-scroller': { overflow: 'auto' },
                        '.cm-content': { fontFamily: 'JetBrains Mono, Menlo, monospace' },
                    }),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            setEditedContent(update.state.doc.toString());
                            setValidationError(null);
                        }
                    }),
                ],
            });
            editorViewRef.current = new EditorView({
                state: startState,
                parent: editorContainerRef.current,
            });
        } else {
            const currentDoc = editorViewRef.current.state.doc.toString();
            const nextDoc = selectedItem?.rawMessage ?? '';
            if (currentDoc !== nextDoc) {
                editorViewRef.current.dispatch({
                    changes: { from: 0, to: currentDoc.length, insert: nextDoc },
                });
            }
        }
    }, [selectedItem?.id]);

    useEffect(() => {
        return () => {
            editorViewRef.current?.destroy();
            editorViewRef.current = null;
        };
    }, []);

    const handleForward = async (andSelectNext: boolean) => {
        if (!selectedItem) return;
        try {
            await onForward(selectedItem.id, editedContent);
            if (andSelectNext) {
                const remaining = items.filter((i) => i.id !== selectedItem.id);
                onSelect(remaining.length > 0 ? remaining[0].id : null);
            }
        } catch (err: any) {
            setValidationError(
                typeof err === 'string' ? err : err?.message || 'Validation error'
            );
        }
    };

    const columns = React.useMemo(buildColumns, []);

    const tableItems: TableItem[] = React.useMemo(() => {
        return items.map((item, idx) => ({
            id: parseInt(item.id, 10) || idx + 1,
            originalId: item.id,
            host: item.host,
            methodOrStatus: item.methodOrStatus,
            isHttps: item.isHttps,
            item,
        }));
    }, [items]);

    const handleSelectRequest = React.useCallback(
        (idNum: number | null) => {
            if (idNum === null) {
                onSelect(null);
                return;
            }
            const match = tableItems.find((t) => t.id === idNum);
            onSelect(match ? match.originalId : null);
        },
        [onSelect, tableItems]
    );

    return (
        <div className="flex flex-col h-full min-w-0 divide-y divide-border">
            {/* Row 1: list */}
            <div className="flex-1 min-h-0 flex flex-col">
                <div className="p-2 border-b bg-card/30 flex items-center justify-between shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {itemType === 'request' ? 'Requests' : 'Responses'} ({items.length})
                    </span>
                    {items.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                            onClick={onDropAll}
                            disabled={actionLoading}
                        >
                            <Trash2 className="w-3 h-3" />
                            Drop all
                        </Button>
                    )}
                </div>
                <div className="flex-1 min-h-0">
                    <DataTable
                        data={tableItems}
                        columns={columns}
                        setSelectedRequest={handleSelectRequest}
                        emptyLabel={emptyLabel}
                        emptyHint={emptyHint}
                        fillHeight
                    />
                </div>
            </div>

            {/* Row 2 + 3: metadata bar + content */}
            {selectedItem ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <div className="p-2 border-b bg-card/30 flex items-center justify-between shrink-0 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <Badge
                                variant="outline"
                                className={`text-[10px] uppercase font-mono px-1.5 py-0 shrink-0 ${itemType === 'request'
                                    ? 'border-cyan-500/50 text-cyan-400 bg-cyan-950/30'
                                    : 'border-purple-500/50 text-purple-400 bg-purple-950/30'
                                    }`}
                            >
                                {itemType === 'request' ? 'REQ' : 'RES'}
                            </Badge>
                            {itemType === 'request' && (
                                <MethodBadge method={selectedItem.methodOrStatus} />
                            )}
                            <span className="text-xs font-mono text-muted-foreground truncate">
                                {selectedItem.host} {itemType === 'response' ? `— ${selectedItem.methodOrStatus}` : ''}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                variant="default"
                                size="sm"
                                className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                                onClick={() => handleForward(false)}
                                disabled={actionLoading}
                            >
                                <Play className="w-3.5 h-3.5 fill-white" />
                                Forward
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="h-7 gap-1"
                                onClick={() => handleForward(true)}
                                disabled={actionLoading || items.length <= 1}
                            >
                                <ArrowRight className="w-3.5 h-3.5" />
                                Next
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 border-rose-500/50 text-rose-400 hover:bg-rose-950/30"
                                onClick={() => onDrop(selectedItem.id)}
                                disabled={actionLoading}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Drop
                            </Button>
                        </div>
                    </div>

                    {validationError && (
                        <div className="bg-rose-950/60 border-b border-rose-800 p-1.5 text-rose-200 text-[11px] font-mono">
                            {validationError}
                        </div>
                    )}

                    <div className="flex-1 min-h-0 relative">
                        <div ref={editorContainerRef} className="absolute inset-0" />
                    </div>
                </div>
            ) : (
                <div className="flex-[1.4] flex flex-col items-center justify-center text-muted-foreground gap-2 text-center px-4">
                    <Shield className="w-8 h-8 opacity-20" />
                    <p className="text-xs">No {itemType} selected</p>
                    <p className="text-[10px] opacity-70">
                        Select a {itemType} from the list above to view and edit it.
                    </p>
                </div>
            )}
        </div>
    );
};