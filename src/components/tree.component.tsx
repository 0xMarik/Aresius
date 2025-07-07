import React, { useState } from "react"
import { ChevronRight, ChevronDown, Folder, File } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppDispatch, useAppSelector } from "@/hooks/redux"
import { activeFuzzSession } from "@/store/slices/fuzzerSlice"

type TreeNode = {
    id: number
    label: string
    children?: TreeNode[]
}

interface TreeProps {
    data: TreeNode[]
    onSelect?: (node: TreeNode) => void
}

export const Tree: React.FC<TreeProps> = ({ data, onSelect }) => {
    return (
        <ul className="space-y-1 text-sm">
            {data.map((node) => (
                <TreeItem key={node.id} node={node} onSelect={onSelect} />
            ))}
        </ul>
    )
}

const TreeItem: React.FC<{
    node: TreeNode
    onSelect?: (node: TreeNode) => void
}> = ({ node, onSelect }) => {
    const { activeSessionIndex } = useAppSelector(state => state.fuzzerstate)


    const [expanded, setExpanded] = useState(false)
    const hasChildren = !!node.children?.length
    const isFolder = node.children !== undefined // Check if children property exists (even if empty)

    const dispatch = useAppDispatch()

    const chooseSession = ({ sessionIndex }: { sessionIndex: number }) => {
        dispatch(activeFuzzSession({ sessionIndex }))
    }

    const handleArrowClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (hasChildren) {
            setExpanded(prev => !prev)
        }
    }

    const handleItemClick = () => {
        // Set this node as active session
        chooseSession({ sessionIndex: node.id })
        onSelect?.(node)
    }

    return (
        <li>
            <div
                onClick={handleItemClick}
                className={cn(
                    "flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-muted transition-all duration-200 hover:scale-[1.02]",
                    isFolder && "font-medium"
                )}
            >
                {isFolder ? (
                    hasChildren ? (
                        <div
                            className="transition-transform duration-200 ease-in-out cursor-pointer"
                            onClick={handleArrowClick}
                        >
                            {expanded ? (
                                <ChevronDown size={16} className="animate-in fade-in duration-200" />
                            ) : (
                                <ChevronRight size={16} className="animate-in fade-in duration-200" />
                            )}
                        </div>
                    ) : (
                        <div className="w-4 h-4 flex items-center justify-center">
                            {/* Empty space for empty folders */}
                        </div>
                    )
                ) : (
                    <div className="w-4 h-4 flex items-center justify-center">
                        <File size={16} className="opacity-60" />
                    </div>
                )}

                {/* Show folder icon for all folders (empty or with children) */}
                {isFolder && (
                    <div className="transition-all duration-200">
                        <Folder
                            size={16}
                            className={cn(
                                "transition-colors duration-200 text-blue-500",
                                hasChildren && expanded && "text-blue-600"
                            )}
                        />
                    </div>
                )}

                <span className="transition-colors duration-200 hover:text-foreground">
                    {node.label}
                </span>
                {
                    activeSessionIndex === node.id && (<span className="ml-auto h-2 w-2 rounded-full bg-green-500" />)
                }
            </div>

            {hasChildren && (
                <div
                    className={cn(
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        expanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    )}
                >
                    <ul className="ml-6 space-y-1 pt-1">
                        {node.children!.map(child => (
                            <div
                                key={child.id}
                                className={cn(
                                    "transition-all duration-200",
                                    expanded ? "translate-x-0 opacity-100" : "translate-x-2 opacity-0"
                                )}
                                style={{
                                    transitionDelay: expanded ? `${node.children!.indexOf(child) * 50}ms` : '0ms'
                                }}
                            >
                                <TreeItem node={child} onSelect={onSelect} />
                            </div>
                        ))}
                    </ul>
                </div>
            )}
        </li>
    )
}