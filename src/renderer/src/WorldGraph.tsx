import { useLayoutEffect } from 'react'
import { ReactFlow, useNodesState, type ReactFlowProps, type Node } from '@xyflow/react'

export function WorldGraph({ nodes: source, ...props }: ReactFlowProps & { nodes: Node[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(source)
  useLayoutEffect(() => {
    setNodes(previous => {
      const byId = new Map(previous.map(node => [node.id, node]))
      return source.map(node => {
        const existing = byId.get(node.id)
        return existing && existing.type === node.type ? { ...node, measured: existing.measured, selected: existing.selected } : node
      })
    })
  }, [source, setNodes])
  return <ReactFlow {...props} nodes={nodes} onNodesChange={onNodesChange} />
}
