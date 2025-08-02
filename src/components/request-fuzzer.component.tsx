import React, { useEffect, useRef, useState } from 'react'
import RequestEditor from './request-editor/request-editor.component'
import { EditorView } from 'codemirror';
import { Button } from './ui/button';
import { Minus, Plus } from 'lucide-react';

interface FuzzParameter {
    id: string;
    placeholder: string;
    values: string[];
    currentIndex: number;
}

const RequestFuzzer = () => {
    const viewRef = useRef<EditorView | null>(null);
    const editorRef = useRef<any>(null);

    const [fuzzValues, setFuzzValues] = useState<string>('www\n123'); // this is the list

    const [textSelected, setSelectedText] = React.useState<string>('');
    const [fuzzParameters, setFuzzParameters] = useState<FuzzParameter[]>([]);

    useEffect(() => { console.log({ textSelected }) }, [textSelected]);

    const handleFuzzModalAdd = (): void => {
        const values = textSelected.split('\n').map(v => v.trim()).filter(v => v);
        if (values.length === 0) return;

        const placeholder = `{{FUZZ_${fuzzParameters.length + 1}}}`;
        const newParam: FuzzParameter = {
            id: Date.now().toString(),
            placeholder,
            values,
            currentIndex: 0
        };

        // Replace selected text with placeholder in editor
        // if (editorRef.current?.replaceSelectedText) {
        //     editorRef.current.replaceSelectedText(placeholder);
        // }

        setFuzzParameters(prev => [...prev, newParam]);
    };

    return (
        <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-max">
            <div className="flex items-center justify-between bg-muted/50 aspect-video rounded-lg p-1 w-full h-12">
                <h1>Request</h1>
                <div className='flex gap-1'>
                    <Button className='h-[2rem]'>Clear</Button>
                    <Button onClick={handleFuzzModalAdd} size="icon" className="size-8"><Minus /></Button>
                    <Button size="icon" className="size-8"><Plus /></Button>
                </div>
            </div>
            <RequestEditor
                viewRef={viewRef}
                onTextSelect={setSelectedText}
                editorRef={editorRef}
            />
            {/* <div className="mt-4 flex gap-2">
                <button
                    onClick={sendRequests}
                    disabled={isLoading}
                    className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
                >
                    {isLoading ? 'Sending...' : 'Send Request(s)'}
                </button>

                {isLoading && (
                    <button
                        onClick={cancelRequests}
                        className="px-4 py-2 bg-red-500 text-white rounded"
                    >
                        Cancel All
                    </button>
                )}
            </div> */}
        </div>
    )
}

export default RequestFuzzer
