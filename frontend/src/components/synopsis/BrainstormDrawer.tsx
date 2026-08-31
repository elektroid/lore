import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Send, Pencil, Check, Sparkles } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import type { BrainstormThread, BrainstormMessage } from '@/types/brainstorm'
import { parseAssistantContent } from '@/types/brainstorm'
import type { Scene } from '@/types/synopsis'

interface Props {
  scenarioId: string
  onClose: () => void
}

// ── Thread list item ───────────────────────────────────────────────────────────

function ThreadItem({
  thread,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  thread: BrainstormThread
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(thread.name)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== thread.name) onRename(trimmed)
    setEditing(false)
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-1.5 rounded px-2 py-1.5 cursor-pointer text-sm transition-colors ${
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 hover:text-accent-foreground text-muted-foreground'
      }`}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-transparent outline-none text-sm text-foreground"
        />
      ) : (
        <span className="flex-1 truncate">{thread.name}</span>
      )}
      {!editing && (
        <button
          onClick={e => { e.stopPropagation(); setDraft(thread.name); setEditing(true) }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {editing && (
        <button onClick={e => { e.stopPropagation(); commit() }} className="text-primary p-0.5">
          <Check className="h-3 w-3" />
        </button>
      )}
      {!editing && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Scene suggestion card ──────────────────────────────────────────────────────

function SceneSuggestionCard({
  suggestion,
  scenarioId,
  onCreated,
}: {
  suggestion: { title: string; description: string; outcome: string }
  scenarioId: string
  onCreated: () => void
}) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (sortOrder: number) =>
      api.post<Scene>(`/scenarios/${scenarioId}/synopsis/scenes`, {
        type: 'scene',
        status: 'idea',
        sort_order: sortOrder,
        title: suggestion.title,
        description: suggestion.description,
        outcome: suggestion.outcome,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenes', scenarioId] })
      onCreated()
    },
  })

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  return (
    <div className="mt-2 rounded border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="text-xs font-semibold text-primary">Scène proposée</p>
      </div>
      <p className="text-xs font-medium">{suggestion.title}</p>
      {suggestion.description && <p className="text-xs text-muted-foreground">{suggestion.description}</p>}
      {suggestion.outcome && <p className="text-xs text-muted-foreground italic">→ {suggestion.outcome}</p>}
      <Button
        size="sm"
        className="h-6 px-2 text-xs w-full"
        disabled={create.isPending}
        onClick={() => create.mutate(scenes.length)}
      >
        {create.isPending ? 'Création…' : 'Ajouter au scénario'}
      </Button>
      {create.isError && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, scenarioId }: { msg: BrainstormMessage; scenarioId: string }) {
  const [sceneAdded, setSceneAdded] = useState(false)

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm">
          {msg.content}
        </div>
      </div>
    )
  }

  const parsed = parseAssistantContent(msg.content)
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] space-y-1">
        <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {parsed.message}
        </div>
        {parsed.scene_suggestion && !sceneAdded && (
          <SceneSuggestionCard
            suggestion={parsed.scene_suggestion}
            scenarioId={scenarioId}
            onCreated={() => setSceneAdded(true)}
          />
        )}
        {sceneAdded && (
          <p className="text-xs text-muted-foreground px-1">✓ Scène ajoutée au scénario</p>
        )}
      </div>
    </div>
  )
}

// ── Main drawer ────────────────────────────────────────────────────────────────

export default function BrainstormDrawer({ scenarioId, onClose }: Props) {
  const qc = useQueryClient()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: threads = [] } = useQuery({
    queryKey: ['brainstorm-threads', scenarioId],
    queryFn: () => api.get<BrainstormThread[]>(`/scenarios/${scenarioId}/brainstorm/threads`),
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['brainstorm-messages', activeThreadId],
    queryFn: () => api.get<BrainstormMessage[]>(`/scenarios/${scenarioId}/brainstorm/threads/${activeThreadId}/messages`),
    enabled: !!activeThreadId,
  })

  // Auto-select first thread or create one
  useEffect(() => {
    if (threads.length > 0 && !activeThreadId) {
      setActiveThreadId(threads[0].id)
    }
  }, [threads, activeThreadId])

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const createThread = useMutation({
    mutationFn: () => api.post<BrainstormThread>(`/scenarios/${scenarioId}/brainstorm/threads`, {}),
    onSuccess: (thread) => {
      qc.invalidateQueries({ queryKey: ['brainstorm-threads', scenarioId] })
      setActiveThreadId(thread.id)
    },
  })

  const deleteThread = useMutation({
    mutationFn: (id: string) => api.delete(`/scenarios/${scenarioId}/brainstorm/threads/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['brainstorm-threads', scenarioId] })
      if (activeThreadId === id) setActiveThreadId(null)
    },
  })

  const renameThread = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.put<BrainstormThread>(`/scenarios/${scenarioId}/brainstorm/threads/${id}`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brainstorm-threads', scenarioId] }),
  })

  const sendMessage = useMutation({
    mutationFn: (text: string) =>
      api.post<{ thread: BrainstormThread; message: BrainstormMessage }>(
        `/scenarios/${scenarioId}/brainstorm/threads/${activeThreadId}/messages`,
        { text },
      ),
    onSuccess: ({ thread, message }) => {
      qc.setQueryData(['brainstorm-messages', activeThreadId], (old: BrainstormMessage[] = []) => [
        ...old.filter(m => m.id !== message.id),
        message,
      ])
      qc.setQueryData(['brainstorm-threads', scenarioId], (old: BrainstormThread[] = []) =>
        old.map(t => t.id === thread.id ? thread : t),
      )
    },
  })

  function handleSend() {
    const text = input.trim()
    if (!text || !activeThreadId || sendMessage.isPending) return
    // Optimistically add user message
    const optimistic: BrainstormMessage = {
      id: `opt-${Date.now()}`,
      thread_id: activeThreadId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    qc.setQueryData(['brainstorm-messages', activeThreadId], (old: BrainstormMessage[] = []) => [...old, optimistic])
    setInput('')
    sendMessage.mutate(text)
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] z-40 border-l bg-background shadow-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Brainstorm</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Thread list */}
      <div className="border-b px-2 py-2 shrink-0 space-y-0.5 max-h-44 overflow-y-auto">
        {threads.map(t => (
          <ThreadItem
            key={t.id}
            thread={t}
            active={t.id === activeThreadId}
            onSelect={() => setActiveThreadId(t.id)}
            onDelete={() => deleteThread.mutate(t.id)}
            onRename={name => renameThread.mutate({ id: t.id, name })}
          />
        ))}
        <button
          onClick={() => createThread.mutate()}
          disabled={createThread.isPending}
          className="w-full flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvelle conversation
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {!activeThreadId && (
          <p className="text-xs text-muted-foreground text-center mt-8">Créez ou sélectionnez une conversation.</p>
        )}
        {activeThreadId && messages.length === 0 && !sendMessage.isPending && (
          <p className="text-xs text-muted-foreground text-center mt-8">Commencez à brainstormer — décrivez le gist de votre histoire.</p>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} scenarioId={scenarioId} />
        ))}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm text-muted-foreground animate-pulse">
              Réflexion…
            </div>
          </div>
        )}
        {sendMessage.isError && (
          <p className="text-xs text-destructive text-center">{(sendMessage.error as Error).message}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t px-3 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
            }}
            placeholder={activeThreadId ? 'Écrivez votre idée… (Entrée pour envoyer)' : 'Sélectionnez une conversation'}
            disabled={!activeThreadId || sendMessage.isPending}
            rows={2}
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || !activeThreadId || sendMessage.isPending}
            className="h-9 w-9 p-0 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
