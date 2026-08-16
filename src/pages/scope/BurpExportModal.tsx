import { useState, useMemo } from 'react';
import { exportToBurpScope } from '@/utils/burpScopeParser';
import type { Scope } from '@/store/slices/scopeSlice';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Download,
    Copy,
    Check,
    FileJson,
    ShieldCheck,
    ShieldX,
} from 'lucide-react';

interface BurpExportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    scope: Scope | null;
}

export function BurpExportModal({
    open,
    onOpenChange,
    scope,
}: BurpExportModalProps) {
    const [copied, setCopied] = useState<boolean>(false);

    const exportedJsonString = useMemo(() => {
        if (!scope) return '';
        const burpExport = exportToBurpScope(scope);
        return JSON.stringify(burpExport, null, 2);
    }, [scope]);

    const handleCopyExport = async () => {
        if (!exportedJsonString) return;
        try {
            await navigator.clipboard.writeText(exportedJsonString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // clipboard fallback
        }
    };

    const handleDownloadExport = () => {
        if (!exportedJsonString || !scope) return;
        const blob = new Blob([exportedJsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeName = scope.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        a.href = url;
        a.download = `${safeName}-burp-scope.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (!scope) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden border-border/80 shadow-2xl bg-card">
                {/* Header */}
                <DialogHeader className="px-6 py-4 border-b border-border/50 bg-muted/20 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-md bg-primary/10 text-primary border border-primary/20">
                                <FileJson className="w-5 h-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                                    Export Scope: <span className="text-primary">{scope.name}</span>
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                                    Standard Burp Suite Advanced Mode (Regex) configuration.
                                </DialogDescription>
                            </div>
                        </div>
                        <Badge variant="outline" className="text-[11px] px-2 py-0.5 bg-primary/10 text-primary border-primary/30 shrink-0">
                            Advanced Mode (Regex)
                        </Badge>
                    </div>
                </DialogHeader>

                {/* Content */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-6 gap-3">
                    {/* Scope Statistics */}
                    <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {scope.allow.length} Include Rules
                        </Badge>
                        <Badge variant="outline" className="text-xs gap-1 px-2 py-0.5 bg-rose-500/10 text-rose-400 border-rose-500/30">
                            <ShieldX className="w-3.5 h-3.5" />
                            {scope.deny.length} Exclude Rules
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                            Wildcards automatically converted to regular expressions.
                        </span>
                    </div>

                    {/* JSON Preview Box */}
                    <div className="flex-1 min-h-[260px] relative flex flex-col border border-border/60 rounded-lg overflow-hidden bg-muted/20">
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/40 text-[11px] text-muted-foreground shrink-0">
                            <span className="font-mono">{scope.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}-burp-scope.json</span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleCopyExport}
                                className="h-5 px-2 text-[10px] gap-1 hover:bg-muted/80"
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3 h-3" />
                                        Copy JSON
                                    </>
                                )}
                            </Button>
                        </div>
                        <pre className="flex-1 p-3 font-mono text-[11px] overflow-auto text-foreground/90 leading-relaxed select-all">
                            {exportedJsonString}
                        </pre>
                    </div>
                </div>

                {/* Footer Actions */}
                <DialogFooter className="border-t border-border/40 px-6 py-3 flex items-center justify-between shrink-0 bg-muted/10">
                    <span className="text-[11px] text-muted-foreground">
                        Ready to import directly into Burp Suite Target &gt; Scope.
                    </span>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                            className="h-7 text-xs"
                        >
                            Close
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleDownloadExport}
                            className="h-7 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Download .json
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
