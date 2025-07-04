import ReactSplit, { SplitDirection } from '@devbookhq/splitter'
import './tweaker.style.css'

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
                        Title Right
                    </div>
                </ReactSplit>
            </div>

        </ReactSplit>
    )
}

export default Tweaker
