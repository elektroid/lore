import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Send, Pencil, Check, Sparkles, Maximize2, Minimize2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import MentionText from '@/components/MentionText'
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

/**
 * One turn of the conversation, editable in place.
 *
 * Editing an assistant turn is not cosmetic: the whole history is replayed to
 * the model on every turn, so rewriting a reply changes what it believes it
 * said — the fastest way to cut a thread of ideas that went the wrong way and
 * carry on from the half that worked.
 *
 * A plain textarea, deliberately: the brainstorm box is a machine-bound string
 * (it goes back to the model verbatim), so it stays consistent with the
 * composer below rather than becoming a MentionEditor.
 */
function MessageBubble({ msg, scenarioId }: { msg: BrainstormMessage; scenarioId: string }) {
  const [sceneAdded, setSceneAdded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const qc = useQueryClient()

  // Assistant turns are stored as a JSON envelope; what is edited is the prose
  // inside it, and the backend re-wraps it.
  const parsed = msg.role === 'assistant' ? parseAssistantContent(msg.content) : null
  const text = parsed ? parsed.message : msg.content
  // An optimistic user bubble has no row behind it yet.
  const saved = !msg.id.startsWith('opt-')

  const update = useMutation({
    mutationFn: (next: string) =>
      api.put<BrainstormMessage>(
        `/scenarios/${scenarioId}/brainstorm/threads/${msg.thread_id}/messages/${msg.id}`,
        { text: next },
      ),
    onSuccess: (result) => {
      qc.setQueryData(['brainstorm-messages', msg.thread_id], (old: BrainstormMessage[] = []) =>
        old.map(m => (m.id === result.id ? result : m)),
      )
      setEditing(false)
    },
  })

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === text) { setEditing(false); return }
    update.mutate(trimmed)
  }

  const editButton = saved && !editing && (
    <button
      onClick={() => { setDraft(text); setEditing(true) }}
      title="Modifier"
      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 mt-1.5 shrink-0 transition-opacity"
    >
      <Pencil className="h-3 w-3" />
    </button>
  )

  const editor = (
    <div className="w-full space-y-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') setEditing(false)
          // Enter inserts a newline — a reply is several paragraphs, not a line.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
        }}
        rows={Math.min(20, Math.max(3, draft.split('\n').length + 1))}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        {update.isError && (
          <p className="text-xs text-destructive mr-auto">{(update.error as Error).message}</p>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs ml-auto"
          onClick={() => setEditing(false)}
        >
          Annuler
        </Button>
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={update.isPending || !draft.trim()}
          onClick={commit}
        >
          {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  )

  if (msg.role === 'user') {
    return (
      <div className="group flex justify-end items-start gap-1">
        {editButton}
        {editing ? editor : (
          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
            {msg.content}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="group flex justify-start items-start gap-1">
      {editing ? editor : (
        <div className="max-w-[90%] space-y-1">
          {/* The model answers in markdown — bold, italics, `- ` bullets. Rendering
              it raw put the markers on screen, which the wide panel made obvious. */}
          <MentionText
            text={text}
            className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm leading-relaxed"
          />
          {parsed?.scene_suggestion && !sceneAdded && (
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
      )}
      {editButton}
    </div>
  )
}

// ── Panel width ────────────────────────────────────────────────────────────────

const WIDTH_KEY = 'lore.brainstorm.width'
const DEFAULT_WIDTH = 420
/** Below this the thread list stays stacked on top; above it, it becomes a column. */
const SIDEBAR_AT = 620
const MIN_WIDTH = 340
/** Leave a sliver of the synopsis visible so the drawer never reads as a new page. */
const EDGE_GAP = 64

function maxWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - EDGE_GAP)
}

/**
 * The drawer's width, dragged from its left edge and remembered per browser.
 *
 * "Maximized" is not a second stored width — it is the dragged width being
 * clamped to the window, so un-maximizing restores exactly what the user had
 * set rather than a hardcoded default.
 */
function usePanelWidth() {
  const [stored, setStored] = useState(() => {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= MIN_WIDTH ? n : DEFAULT_WIDTH
  })
  const [maximized, setMaximized] = useState(false)
  // Re-clamps on window resize: a width saved on a wide monitor must not push
  // the drawer off a narrow one.
  const [limit, setLimit] = useState(() => maxWidth())

  useEffect(() => {
    const onResize = () => setLimit(maxWidth())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const width = maximized ? limit : Math.min(stored, limit)

  const [dragging, setDragging] = useState(false)
  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    setMaximized(false)
    const move = (ev: PointerEvent) => {
      const next = Math.min(Math.max(window.innerWidth - ev.clientX, MIN_WIDTH), maxWidth())
      setStored(next)
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  // Only the settled width is persisted — writing on every pointermove would
  // hit localStorage a few hundred times per drag.
  useEffect(() => {
    if (!dragging) localStorage.setItem(WIDTH_KEY, String(stored))
  }, [dragging, stored])

  return {
    width,
    dragging,
    startDrag,
    maximized,
    toggleMaximized: () => setMaximized(m => !m),
    /** Wide enough to give the thread list its own column. */
    sidebar: width >= SIDEBAR_AT,
  }
}

// ── Main drawer ────────────────────────────────────────────────────────────────

export default function BrainstormDrawer({ scenarioId, onClose }: Props) {
  const qc = useQueryClient()
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { width, dragging, startDrag, maximized, toggleMaximized, sidebar } = usePanelWidth()

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

  const threadList = (
    <>
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
    </>
  )

  return (
    <div
      className="fixed right-0 top-0 h-full z-40 border-l bg-background shadow-xl flex"
      style={{ width }}
    >
      {/* Resize handle — the drawer's own left border, widened to a grabbable strip. */}
      <div
        onPointerDown={startDrag}
        onDoubleClick={toggleMaximized}
        title="Glissez pour redimensionner"
        className={`absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-col-resize z-10 transition-colors ${
          dragging ? 'bg-primary' : 'hover:bg-primary/40'
        }`}
      />
      {/* While dragging, the pointer must not select text or land on the iframe-like
          children it sweeps across. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}

      {/* Thread sidebar — only once the panel is wide enough to spare the column. */}
      {sidebar && (
        <div className="w-52 shrink-0 border-r flex flex-col">
          <div className="px-3 py-3 border-b shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conversations
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">{threadList}</div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Brainstorm</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMaximized}
            title={maximized ? 'Réduire' : 'Agrandir'}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button onClick={onClose} title="Fermer" className="text-muted-foreground hover:text-foreground p-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Thread list — stacked on top while narrow; the sidebar has it otherwise. */}
      {!sidebar && (
        <div className="border-b px-2 py-2 shrink-0 space-y-0.5 max-h-44 overflow-y-auto">
          {threadList}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* A bubble stretched across a maximized panel is unreadable, so the
            stream keeps a measure and centres itself instead of filling. */}
        <div className="mx-auto w-full max-w-3xl space-y-3">
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
      </div>

      {/* Input */}
      <div className="border-t px-3 py-3 shrink-0">
        <div className="mx-auto w-full max-w-3xl flex gap-2 items-end">
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
    </div>
  )
}
