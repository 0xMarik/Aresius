import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { HTTPQL_FIELDS, HTTPQL_PRESETS, OPERATOR_LABELS } from '@/lib/httpql/httpql';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sparkles, Code2, Plus, Filter } from 'lucide-react';

interface HttpqlCheatsheetModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelectQuery: (query: string) => void;
    presets?: { id: string; label: string; description: string; query: string; badge?: string }[];
}

export const HttpqlCheatsheetModal: React.FC<HttpqlCheatsheetModalProps> = ({
    open,
    onOpenChange,
    onSelectQuery,
    presets,
}) => {
    const displayPresets = presets && presets.length > 0 ? presets : HTTPQL_PRESETS;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col p-6">
                <DialogHeader className="pb-2 border-b">
                    <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                        <Code2 className="w-5 h-5 text-primary" />
                        HTTPQL Syntax Reference & Cheatsheet
                    </DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                        HTTP Query Language (HTTPQL) lets you filter and query captured HTTP traffic with precision.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-1 space-y-6 text-xs mt-3">
                    {/* Presets Section */}
                    <div>
                        <h3 className="font-semibold text-foreground flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            Popular Preset Filters
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {displayPresets.map((preset) => (
                                <div
                                    key={preset.id}
                                    className="p-2.5 rounded-md border border-border/70 bg-card/60 hover:bg-accent/40 transition-colors flex flex-col justify-between gap-1.5"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium text-foreground text-xs">{preset.label}</span>
                                        {preset.badge && (
                                            <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                                                {preset.badge}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">{preset.description}</p>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <code className="text-[10.5px] font-mono bg-muted/60 px-1.5 py-0.5 rounded text-primary truncate max-w-[200px]">
                                            {preset.query}
                                        </code>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 text-[11px] px-2 gap-1 text-primary hover:text-primary hover:bg-primary/10"
                                            onClick={() => {
                                                onSelectQuery(preset.query);
                                                onOpenChange(false);
                                            }}
                                        >
                                            <Plus className="w-3 h-3" />
                                            Use
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Operators Section */}
                    <div>
                        <h3 className="font-semibold text-foreground flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                            <Filter className="w-3.5 h-3.5 text-primary" />
                            Supported Operators & Modifiers
                        </h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {Object.entries(OPERATOR_LABELS).map(([op, info]) => (
                                <div
                                    key={op}
                                    className="p-2 rounded border border-border/50 bg-muted/20 text-xs flex flex-col"
                                >
                                    <span className="font-mono font-bold text-primary text-[11px]">{info.label}</span>
                                    <span className="text-muted-foreground text-[10.5px] mt-0.5">{info.desc}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Fields Reference */}
                    <div>
                        <h3 className="font-semibold text-foreground flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                            <Code2 className="w-3.5 h-3.5 text-emerald-500" />
                            Available Query Fields
                        </h3>
                        <div className="border border-border/60 rounded-md overflow-hidden">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-muted/70 text-muted-foreground text-[11px] uppercase border-b border-border/60">
                                    <tr>
                                        <th className="py-1.5 px-3 font-semibold">Field</th>
                                        <th className="py-1.5 px-3 font-semibold">Description</th>
                                        <th className="py-1.5 px-3 font-semibold">Example</th>
                                        <th className="py-1.5 px-2 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40 font-mono text-[11px]">
                                    {HTTPQL_FIELDS.map((f) => (
                                        <tr key={f.name} className="hover:bg-accent/30 transition-colors">
                                            <td className="py-1.5 px-3 font-bold text-primary whitespace-nowrap">
                                                {f.name}
                                                {f.aliases && (
                                                    <span className="ml-1 text-[10px] text-muted-foreground/70 font-normal">
                                                        ({f.aliases[0]})
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-1.5 px-3 font-sans text-muted-foreground text-[11px]">
                                                {f.description}
                                            </td>
                                            <td className="py-1.5 px-3 text-foreground/90 whitespace-nowrap">
                                                <code>{f.example}</code>
                                            </td>
                                            <td className="py-1.5 px-2 text-right">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1.5 text-[10px]"
                                                    onClick={() => {
                                                        onSelectQuery(f.example);
                                                        onOpenChange(false);
                                                    }}
                                                >
                                                    Insert
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Boolean Logic, Grouping, and Comments */}
                    <div className="p-3 bg-muted/30 border border-border/60 rounded-md text-xs space-y-1 text-muted-foreground">
                        <p className="font-semibold text-foreground">Boolean Expressions, Grouping & Comments:</p>
                        <p>
                            • Combine terms using <code className="text-primary font-mono font-bold">and</code>,{' '}
                            <code className="text-primary font-mono font-bold">or</code>, and{' '}
                            <code className="text-primary font-mono font-bold">not</code> (or <code className="text-primary font-mono">!</code>).
                        </p>
                        <p>
                            • Group sub-queries with parentheses, e.g.{' '}
                            <code className="text-primary font-mono bg-muted/60 px-1 py-0.5 rounded">
                                (req.method.eq:"POST" or req.method.eq:"PUT") and resp.code.gte:400
                            </code>
                        </p>
                        <p>
                            • Supports single-line comments (<code className="text-primary font-mono">// comment</code> or <code className="text-primary font-mono"># comment</code>) and multi-line comments (<code className="text-primary font-mono">/* comment */</code>).
                        </p>
                        <p>
                            • Free-text bare search terms like <code className="text-primary font-mono">"admin"</code> expand to match across raw request and raw response.
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default HttpqlCheatsheetModal;
