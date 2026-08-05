import { useEffect, useMemo, useRef } from 'react'
import {
  Excalidraw,
  restore,
  serializeAsJSON,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { Button } from '@/components/ui/button'

// A whiteboard is play state — a battle map only means something for the
// evening it was drawn in — so it lives on the session's projection exactly
// like an image or a text card, never on authored material. See
// docs/play-table.md and docs/adr/0001-runs-separate-story-from-play.md.
//
// This module pulls in the full Excalidraw bundle (~1.5MB) and must only ever
// be reached through a lazy import — see the `React.lazy` call sites in
// ProjectionPanel and TablePage.

const EMPTY_SCENE = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const SAVE_DEBOUNCE_MS = 800

function parseScene(raw: string) {
  if (!raw) return null
  try {
    return restore(JSON.parse(raw), null, null)
  } catch {
    return null
  }
}

/**
 * The GM's editable canvas. Local edits never leave the browser until either
 * the GM hits "Projeter" or the board is already live, in which case further
 * strokes autosave and broadcast — the same trade a GM makes swapping images,
 * extended to something that changes continuously.
 */
export function WhiteboardEditor({
  scene, live, onProject, pending,
}: {
  scene: string
  live: boolean
  onProject: (sceneJson: string) => void
  pending?: boolean
}) {
  // Read once — Excalidraw owns the canvas after mount, re-feeding initialData
  // on every render would fight the user's cursor.
  const initial = useMemo(() => parseScene(scene), []) // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef(scene || EMPTY_SCENE)
  const liveRef = useRef(live)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    liveRef.current = live
    // Going off-live cancels any autosave still in flight — a stray onChange
    // (Excalidraw's own resize observer fires one when this tab is hidden via
    // CSS, even with no strokes drawn) must not land a broadcast after the GM
    // has already moved the projection on to something else.
    if (!live && saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
  }, [live])
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  return (
    <div className="space-y-2">
      <div className="h-[440px] rounded-md border overflow-hidden">
        <Excalidraw
          initialData={{
            elements: initial?.elements ?? [],
            appState: initial?.appState ?? {},
            files: initial?.files ?? {},
            scrollToContent: true,
          }}
          theme="light"
          onChange={(elements, appState, files) => {
            const json = serializeAsJSON([...elements], appState, files, 'local')
            latest.current = json
            if (!liveRef.current) return
            if (saveTimer.current) clearTimeout(saveTimer.current)
            // Re-check liveness when the timer actually fires, not just at
            // schedule time — see the cancellation note above.
            saveTimer.current = setTimeout(() => {
              if (liveRef.current) onProject(latest.current)
            }, SAVE_DEBOUNCE_MS)
          }}
        />
      </div>
      <Button
        size="sm"
        className="h-8 w-full text-xs"
        disabled={pending}
        onClick={() => onProject(latest.current)}
      >
        {live ? 'Tableau projeté — mettre à jour' : 'Projeter le tableau'}
      </Button>
    </div>
  )
}

/**
 * The table's read-only render of the same scene. Driven entirely by the
 * `scene` prop — a fresh SSE frame calls `updateScene` rather than remounting,
 * so the players' view pans and draws exactly as the GM's does.
 */
export function WhiteboardStage({ scene }: { scene: string }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const mountedScene = useRef(scene)
  const initial = useMemo(() => parseScene(scene), []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scene === mountedScene.current) return
    mountedScene.current = scene
    const parsed = parseScene(scene)
    if (!apiRef.current || !parsed) return
    apiRef.current.updateScene({
      elements: parsed.elements,
      // Only the visually-relevant fields — the incoming appState is the GM's
      // own (editable, viewModeEnabled: false); applying it wholesale would
      // kick the read-only stage back into edit mode and reveal the toolbar.
      appState: {
        viewBackgroundColor: parsed.appState.viewBackgroundColor,
        scrollX: parsed.appState.scrollX,
        scrollY: parsed.appState.scrollY,
        zoom: parsed.appState.zoom,
        viewModeEnabled: true,
        zenModeEnabled: true,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    const files = Object.values(parsed.files)
    if (files.length > 0) apiRef.current.addFiles(files)
  }, [scene])

  return (
    <div className="absolute inset-0 pointer-events-none">
      <Excalidraw
        excalidrawAPI={api => { apiRef.current = api }}
        initialData={{
          elements: initial?.elements ?? [],
          appState: { ...(initial?.appState ?? {}), viewModeEnabled: true, zenModeEnabled: true },
          files: initial?.files ?? {},
          scrollToContent: true,
        }}
        viewModeEnabled
        zenModeEnabled
        theme="dark"
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  )
}
