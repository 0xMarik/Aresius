
import High from "../High";
import { TabsDemo } from "../components/card-tab";

const Fuzzer = () => {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="grid auto-rows-min gap-4 md:grid-cols-2">
        <div className="bg-muted/50 aspect-video rounded-xl">
          <High />
        </div>
        <div className="bg-muted/50 aspect-video rounded-xl">
          <TabsDemo />
        </div>
      </div>
      <div className="bg-muted/50 min-h-[100vh] flex-1 rounded-xl md:min-h-min" />
    </div>
  )
}

export default Fuzzer
