import type { RefinementStudioJobRecord } from "@/lib/refinement-studio"

export type RefinementStudioJobEvent =
  | {
      type: "job_update"
      jobId: string
      userId: string
      job: RefinementStudioJobRecord
    }
  | {
      type: "heartbeat"
      ts: string
    }

type Listener = (event: RefinementStudioJobEvent) => void

function getRefinementStudioJobEventListeners() {
  const globalState = globalThis as typeof globalThis & {
    __refinementStudioJobEventListeners?: Set<Listener>
  }

  if (!globalState.__refinementStudioJobEventListeners) {
    globalState.__refinementStudioJobEventListeners = new Set()
  }

  return globalState.__refinementStudioJobEventListeners
}

export function subscribeRefinementStudioJobEvents(listener: Listener) {
  const listeners = getRefinementStudioJobEventListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitRefinementStudioJobEvent(event: RefinementStudioJobEvent) {
  const listeners = getRefinementStudioJobEventListeners()
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[refinement-studio-job-events] listener failed:", error)
    }
  }
}

export function emitRefinementStudioJobUpdated(job: RefinementStudioJobRecord) {
  emitRefinementStudioJobEvent({
    type: "job_update",
    jobId: job.id,
    userId: job.user_id,
    job,
  })
}
