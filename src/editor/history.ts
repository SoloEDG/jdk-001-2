import { computed, ref } from 'vue'
import type { CanvasSize, Frame, Layer, Pixel, PixelProject } from '../core/types'

/**
 * 一步操作需要恢复的选中位置。撤销/重做时除了还原内容，
 * 还要把帧和图层选中项放回操作发生时的状态。
 */
export interface SelectionState {
  activeFrameIndex: number
  activeLayerIndex: number
}

export interface PixelChange {
  index: number
  before: Pixel
  after: Pixel
}

export interface LayerPixelPatch {
  layerId: string
  changes: PixelChange[]
}

/**
 * 一条历史记录只保存单步改动及其反向操作，不保存整张画布快照。
 * undo/redo 接收当前项目并返回应用反向/正向改动后的新项目。
 */
export interface HistoryEntry {
  label: string
  undo: (project: PixelProject) => PixelProject
  redo: (project: PixelProject) => PixelProject
}

export function selectionOf(project: PixelProject): SelectionState {
  return {
    activeFrameIndex: project.activeFrameIndex,
    activeLayerIndex: project.activeLayerIndex,
  }
}

function withSelection(project: PixelProject, selection: SelectionState): PixelProject {
  return { ...project, ...selection }
}

function findFrame(project: PixelProject, frameId: string): Frame | null {
  return project.frames.find((frame) => frame.id === frameId) ?? null
}

function replaceFrameLayers(
  project: PixelProject,
  frameId: string,
  layers: Layer[],
): PixelProject {
  return {
    ...project,
    frames: project.frames.map((frame) => (frame.id === frameId ? { ...frame, layers } : frame)),
  }
}

function insertAt<T>(list: T[], index: number, value: T): T[] {
  const next = [...list]
  const at = Math.max(0, Math.min(index, next.length))
  next.splice(at, 0, value)
  return next
}

/** 对比操作前后的图层像素，只把真正变化的格子记进历史。 */
export function diffLayerPixels(before: Layer[], after: Layer[]): LayerPixelPatch[] {
  const patches: LayerPixelPatch[] = []

  for (const oldLayer of before) {
    const newLayer = after.find((layer) => layer.id === oldLayer.id)
    if (!newLayer || newLayer.pixels === oldLayer.pixels) continue

    const changes: PixelChange[] = []
    const length = Math.min(oldLayer.pixels.length, newLayer.pixels.length)
    for (let index = 0; index < length; index += 1) {
      const from = oldLayer.pixels[index] ?? null
      const to = newLayer.pixels[index] ?? null
      if (from !== to) changes.push({ index, before: from, after: to })
    }

    if (changes.length > 0) patches.push({ layerId: oldLayer.id, changes })
  }

  return patches
}

function applyPixelPatches(
  project: PixelProject,
  frameId: string,
  patches: LayerPixelPatch[],
  direction: 'undo' | 'redo',
): PixelProject {
  const frame = findFrame(project, frameId)
  if (!frame || patches.length === 0) return project

  let changed = false
  const layers = frame.layers.map((layer) => {
    const patch = patches.find((candidate) => candidate.layerId === layer.id)
    if (!patch) return layer

    const pixels = layer.pixels.slice()
    for (const change of patch.changes) {
      pixels[change.index] = direction === 'undo' ? change.before : change.after
    }
    changed = true
    return { ...layer, pixels }
  })

  return changed ? replaceFrameLayers(project, frameId, layers) : project
}

/** 画笔 / 橡皮 / 油漆桶 / 直线的单步像素改动。 */
export function createPixelEditEntry(
  frameId: string,
  patches: LayerPixelPatch[],
  before: SelectionState,
  after: SelectionState,
  label: string,
): HistoryEntry {
  return {
    label,
    undo(project) {
      return withSelection(applyPixelPatches(project, frameId, patches, 'undo'), before)
    },
    redo(project) {
      return withSelection(applyPixelPatches(project, frameId, patches, 'redo'), after)
    },
  }
}

export function createLayerAddEntry(args: {
  frameId: string
  layer: Layer
  index: number
  before: SelectionState
  after: SelectionState
}): HistoryEntry {
  const { frameId, layer, index, before, after } = args

  return {
    label: '新建图层',
    undo(project) {
      const frame = findFrame(project, frameId)
      if (!frame) return withSelection(project, before)
      const layers = frame.layers.filter((candidate) => candidate.id !== layer.id)
      return withSelection(replaceFrameLayers(project, frameId, layers), before)
    },
    redo(project) {
      const frame = findFrame(project, frameId)
      if (!frame || frame.layers.some((candidate) => candidate.id === layer.id)) {
        return withSelection(project, after)
      }
      const layers = insertAt(frame.layers, index, layer)
      return withSelection(replaceFrameLayers(project, frameId, layers), after)
    },
  }
}

export function createLayerDeleteEntry(args: {
  frameId: string
  layer: Layer
  index: number
  before: SelectionState
  after: SelectionState
}): HistoryEntry {
  const { frameId, layer, index, before, after } = args

  return {
    label: '删除图层',
    undo(project) {
      const frame = findFrame(project, frameId)
      if (!frame || frame.layers.some((candidate) => candidate.id === layer.id)) {
        return withSelection(project, before)
      }
      const layers = insertAt(frame.layers, index, layer)
      return withSelection(replaceFrameLayers(project, frameId, layers), before)
    },
    redo(project) {
      const frame = findFrame(project, frameId)
      if (!frame) return withSelection(project, after)
      const layers = frame.layers.filter((candidate) => candidate.id !== layer.id)
      return withSelection(replaceFrameLayers(project, frameId, layers), after)
    },
  }
}

export function createFrameAddEntry(args: {
  frame: Frame
  index: number
  before: SelectionState
  after: SelectionState
}): HistoryEntry {
  const { frame, index, before, after } = args

  return {
    label: '新建帧',
    undo(project) {
      const frames = project.frames.filter((candidate) => candidate.id !== frame.id)
      return withSelection({ ...project, frames }, before)
    },
    redo(project) {
      if (project.frames.some((candidate) => candidate.id === frame.id)) {
        return withSelection(project, after)
      }
      return withSelection({ ...project, frames: insertAt(project.frames, index, frame) }, after)
    },
  }
}

export function createFrameDeleteEntry(args: {
  frame: Frame
  index: number
  before: SelectionState
  after: SelectionState
}): HistoryEntry {
  const { frame, index, before, after } = args

  return {
    label: '删除帧',
    undo(project) {
      if (project.frames.some((candidate) => candidate.id === frame.id)) {
        return withSelection(project, before)
      }
      return withSelection({ ...project, frames: insertAt(project.frames, index, frame) }, before)
    },
    redo(project) {
      const frames = project.frames.filter((candidate) => candidate.id !== frame.id)
      return withSelection({ ...project, frames }, after)
    },
  }
}

/**
 * 改画布尺寸会裁掉或补出所有帧的像素，无法从新画布反推旧数据，
 * 因此这一步单独保存操作前后的帧数据；其余操作都只记单步差异。
 */
export function createResizeEntry(args: {
  beforeSize: CanvasSize
  beforeFrames: Frame[]
  afterSize: CanvasSize
  afterFrames: Frame[]
  before: SelectionState
  after: SelectionState
}): HistoryEntry {
  const { beforeSize, beforeFrames, afterSize, afterFrames, before, after } = args

  return {
    label: '改画布尺寸',
    undo(project) {
      return withSelection(
        { ...project, canvasSize: beforeSize, frames: beforeFrames },
        before,
      )
    },
    redo(project) {
      return withSelection(
        { ...project, canvasSize: afterSize, frames: afterFrames },
        after,
      )
    },
  }
}

export function createHistory(limit: number) {
  const undoStack: HistoryEntry[] = []
  const redoStack: HistoryEntry[] = []
  let projectId: string | null = null

  // 历史栈本身用普通数组（避免把帧、像素做深层响应式代理），
  // 用计数 ref 驱动按钮的可用状态。
  const undoCount = ref(0)
  const redoCount = ref(0)
  const canUndo = computed(() => undoCount.value > 0)
  const canRedo = computed(() => redoCount.value > 0)

  function syncCounts() {
    undoCount.value = undoStack.length
    redoCount.value = redoStack.length
  }

  function reset(id: string | null) {
    undoStack.length = 0
    redoStack.length = 0
    projectId = id
    syncCounts()
  }

  /** 历史按项目隔离；项目变了就先清空，避免两个项目的改动串在一起。 */
  function ensureProject(id: string) {
    if (projectId !== id) reset(id)
  }

  function record(entry: HistoryEntry) {
    undoStack.push(entry)
    if (undoStack.length > limit) undoStack.shift()
    redoStack.length = 0
    syncCounts()
  }

  function undo(project: PixelProject): PixelProject | null {
    const entry = undoStack.pop()
    if (!entry) return null
    redoStack.push(entry)
    syncCounts()
    return entry.undo(project)
  }

  function redo(project: PixelProject): PixelProject | null {
    const entry = redoStack.pop()
    if (!entry) return null
    undoStack.push(entry)
    syncCounts()
    return entry.redo(project)
  }

  function clear() {
    reset(null)
  }

  return { canUndo, canRedo, ensureProject, record, undo, redo, clear }
}
