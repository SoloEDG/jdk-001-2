<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import FramePanel from './components/FramePanel.vue'
import LayerPanel from './components/LayerPanel.vue'
import PixelCanvas from './components/PixelCanvas.vue'
import ProjectPanel from './components/ProjectPanel.vue'
import ToolBar from './components/ToolBar.vue'
import { useEditorStore } from './editor/useEditorStore'

const store = useEditorStore()

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function onKeydown(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (isTypingTarget(event.target)) return

  const key = event.key.toLowerCase()
  if (key === 'z') {
    event.preventDefault()
    if (event.shiftKey) store.redo()
    else store.undo()
  } else if (key === 'y') {
    event.preventDefault()
    store.redo()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app-shell">
    <ToolBar />
    <PixelCanvas />
    <aside class="right-rail">
      <ProjectPanel />
      <LayerPanel />
      <FramePanel />
    </aside>
  </div>
</template>
