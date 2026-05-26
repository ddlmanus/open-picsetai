import type { ClothingStudioJobRecord } from "@/lib/clothing-studio"

export type ClothingStudioJobEvent =
  | {
      type: "job_update"
      jobId: string
      userId: string
      job: ClothingStudioJobRecord
    }
  | {
      type: "heartbeat"
      ts: string
    }

type Listener = (event: ClothingStudioJobEvent) => void

function getClothingStudioJobEventListeners() {
  const globalState = globalThis as typeof globalThis & {
    __clothingStudioJobEventListeners?: Set<Listener>
  }

  if (!globalState.__clothingStudioJobEventListeners) {
    globalState.__clothingStudioJobEventListeners = new Set()
  }

  return globalState.__clothingStudioJobEventListeners
}

export function subscribeClothingStudioJobEvents(listener: Listener) {
  const listeners = getClothingStudioJobEventListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitClothingStudioJobEvent(event: ClothingStudioJobEvent) {
  const listeners = getClothingStudioJobEventListeners()
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[clothing-studio-job-events] listener failed:", error)
    }
  }
}

export function emitClothingStudioJobUpdated(job: ClothingStudioJobRecord) {
  emitClothingStudioJobEvent({
    type: "job_update",
    jobId: job.id,
    userId: job.user_id,
    job,
  })
}
