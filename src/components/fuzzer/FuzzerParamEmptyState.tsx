import { MousePointerClick, ArrowRight } from 'lucide-react';

export function FuzzerParamEmptyState() {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-[#E2DED3] bg-[#FAF8F2] px-8 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[#F6EEDD] ring-4 ring-[#FAF8F2]">
                <MousePointerClick className="size-5 text-[#8A6A2E]" strokeWidth={1.75} />
            </div>

            <div className="space-y-1.5">
                <p className="text-[13px] font-semibold text-[#1B211E]">No parameter selected</p>
                <p className="max-w-[240px] text-[12px] leading-relaxed text-[#9A9A90]">
                    Highlight a value in the request, then mark it for fuzzing to configure its payload here.
                </p>
            </div>

            <div className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-[#EDEAE0]">
                <span className="font-mono text-[10px] font-medium text-[#5C6360]">Select text</span>
                <ArrowRight className="size-3 text-[#C9C4B4]" />
                <span className="font-mono text-[10px] font-medium text-[#5C6360]">Add to fuzzer</span>
            </div>
        </div>
    );
}