import { MousePointerClick, ArrowRight } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export function FuzzerParamEmptyState() {
    return (
        <EmptyState
            icon={MousePointerClick}
            title="No parameter selected"
            description="Highlight a value in the request, then mark it for fuzzing to configure its payload here."
            action={
                <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted/60 border border-border text-muted-foreground text-[10px] font-mono shadow-xs">
                    <span>Select text</span>
                    <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                    <span>Add to fuzzer</span>
                </div>
            }
        />
    );
}