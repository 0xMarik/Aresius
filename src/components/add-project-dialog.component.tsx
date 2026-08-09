import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { useAppDispatch } from "@/hooks/redux"
import { addProject } from "@/store/slices/projectSlice"
import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"

const AddProjectDialog = () => {
    interface AddProjectFormEvent extends React.FormEvent<HTMLFormElement> { }
    const dispatch = useAppDispatch()
    const [open, setOpen] = useState<boolean>(false)
    const handleSubmit = async (event: AddProjectFormEvent) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const name = (formData.get("name") ?? "") as string;
        const temporary = (formData.get("temporary") ?? false) as boolean;
        const result = await invoke<any>("create_project", { path: `C:\\Users\\msij\\Documents\\Aresius\\${name}.db`, name });
        console.log({ result })
        dispatch(addProject({
            createdAt: Date.now(),
            description: "",
            id: crypto.randomUUID(),
            name: name,
            temporary,
            updatedAt: Date.now()
        }))
        setOpen(false)
    }
    return (
        <Dialog open={open} onOpenChange={setOpen} >

            <DialogTrigger asChild>
                <Button variant="default" >
                    <Plus />Add new project
                </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add new Project</DialogTitle>
                        <DialogDescription>
                            Make changes to your profile here. Click save when you&apos;re
                            done.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4">
                        <div className="grid gap-3">

                            <Label htmlFor="project-name">Project name</Label>
                            <Input id="project-name" name="name" defaultValue="New project" />
                        </div>
                        <div className="flex items-center gap-3">
                            <Checkbox id="temporary" />
                            <Label htmlFor="temporary">Temporary</Label>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button type="submit"><Plus /> Add project</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog >
    )
}

export default AddProjectDialog
