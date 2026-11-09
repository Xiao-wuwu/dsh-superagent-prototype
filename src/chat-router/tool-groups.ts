/** Panel-side tool groups, kept free of runtime dependencies so the client bundle does not pull in zod. */
export interface ChatToolGroup {
  id: string
  label: { zh: string; en: string }
  tools: readonly string[]
}

/** Offered by the panel when `preset: custom` is selected; dispatch tools are always kept and never listed here. */
export const CUSTOM_TOOL_GROUPS: readonly ChatToolGroup[] = [
  { id: 'read', label: { zh: '只读', en: 'Read only' }, tools: ['read', 'read_image', 'glob', 'grep', 'orchestrator_read'] },
  { id: 'command', label: { zh: '命令与作业', en: 'Shell and jobs' }, tools: ['bash', 'pwsh', 'job_output', 'job_list', 'job_kill'] },
  { id: 'write', label: { zh: '文件写入', en: 'File writes' }, tools: ['write', 'edit'] },
  { id: 'web', label: { zh: '网络', en: 'Web' }, tools: ['web_search', 'web_fetch'] },
  { id: 'delegation', label: { zh: '子代理', en: 'Subagents' }, tools: ['subagent', 'subagent_fork', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'] },
  { id: 'misc', label: { zh: '其他', en: 'Other' }, tools: ['skill', 'todo_write'] },
]
