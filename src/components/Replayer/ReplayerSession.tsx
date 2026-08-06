import React, { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useAppDispatch } from '@/hooks/redux'
import { addCollection, addSessionToCollection, selectColSess } from '@/store/slices/replayerSlice'
import { RsTree, TreeNode } from 'rstree-ui';
import { ChevronDownIcon, Plus, Folder, File } from 'lucide-react';
import { ButtonGroup } from '@/components/ui/button-group';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ReplayerCollection } from '@/types/replayer.type'

const ReplayerSession = ({ collections }: { collections: ReplayerCollection[] }) => {
    const dispatch = useAppDispatch()

    const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('')


    const data: TreeNode<unknown>[] = collections.map((collection, colIndex) => ({
        id: `${colIndex}`,
        label: `Collection ${colIndex + 1}`,
        icon: <Folder size={16} />,
        children: collection.sessions.map((session, sessIndex) => ({
            id: `${colIndex}-${sessIndex}`,
            label: `Session ${sessIndex + 1} - ${session.url}`,
            icon: <File size={16} />
        }))
    }))


    const handleSelection = (value: string[]) => {
        if (value !== undefined && value.length === 1 && value[0].includes("-")) {
            const newValue = value[0]?.split("-") || [];
            dispatch(selectColSess({ collectionIndex: Number(newValue[0]), sessionIndex: Number(newValue[1]) }));
        }
        setSelectedIds(value)
    }
    return (
        <div className='h-full'>
            <ButtonGroup className="my-2 mx-auto">
                <Button className=' w-full' onClick={
                    () => dispatch(addSessionToCollection({ collectionIndex: Number((selectedIds[0] ?? "0-0").split('-')[0]) }))}><Plus /> New Session</Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="default" className="pl-2!">
                            <ChevronDownIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => dispatch(addCollection())}>
                            <Plus />
                            New Collection
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </ButtonGroup>
            <div className="rounded-lg p-1 w-full h-full ">
                <Input value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                />
                <RsTree
                    searchTerm={searchTerm}
                    className="!h-full bg-transparent border-none"
                    data={data}
                    treeLineClassName="!border-border/40"
                    treeNodeClassName="
    !bg-transparent
    !text-muted-foreground
    hover:!bg-accent/50 hover:!text-foreground
    aria-selected:!bg-accent aria-selected:!text-accent-foreground
    rounded-sm text-[13px] font-mono transition-colors
  "
                    selectedIds={selectedIds}
                    onSelect={handleSelection}
                    showIcons={true}
                    virtualizeEnabled={true}
                />
            </div>
        </div>
    )
}

export default ReplayerSession
