import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import './replayer.style.css'
import { Button } from '@/components/ui/button'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'

type TaskResult = {
    id: string;
    message: string;
};

const MyCompo = () => {
    const [msg, setMsg] = useState("")
    const [results, setResults] = useState<TaskResult[]>([]);

    useEffect(() => {
        // Listen to event from Rust
        let unlisten: UnlistenFn | null = null;
        ; (
            async () => {
                unlisten = await listen<TaskResult>("greet-finished", (event) => {
                    setResults((prev) => [...prev, event.payload]);
                });
            }
        )();

        return () => {
            if (unlisten) {
                unlisten(); // Cleanup on unmount
            }
        };
    }, []);

    const handleClick = async () => {
        const msg = await invoke<string>("greet", { name: "soufiane" })
        setMsg(msg)
    }

    return (
        <div>
            {msg}
            {results.map((item, index) => (<div key={index}>{item.message}</div>))}
            <Button onClick={handleClick}>+</Button>
        </div>
    )
}

function Tweaker() {
    return (
        <ReactSplit
            direction={SplitDirection.Horizontal}
            initialSizes={[25, 75]} // 👈 Initial widths: 40% left, 60% right
            // minSizes={[20, 20]} // 👈 Optional: Prevent collapsing below 20%
            gutterClassName="custom-gutter-horizontal"
            draggerClassName="custom-dragger-horizontal"
            classes={["py-1", "py-1"]}
        >
            <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                Title Left
            </div>
            <div className='h-full flex flex-col gap-1'>
                <div className='h-16 bg-muted/50 aspect-video rounded-lg p-1'></div>
                <ReactSplit
                    gutterClassName="custom-gutter-horizontal"
                    draggerClassName="custom-dragger-horizontal"
                    direction={SplitDirection.Horizontal}>
                    <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                        Title Right
                    </div>
                    <div className="bg-muted/50 aspect-video rounded-lg p-1 w-full h-full">
                        <MyCompo />
                    </div>
                </ReactSplit>
            </div>

        </ReactSplit>
    )
}

export default Tweaker
