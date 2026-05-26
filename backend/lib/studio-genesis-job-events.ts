import type { StudioGenesisJobRecord } from "@/lib/studio-genesis"

export type StudioGenesisJobEvent =
  | {
      type: "job_update"
      jobId: string
      userId: string
      job: StudioGenesisJobRecord
    }
  | {
      type: "heartbeat"
      ts: string
    }

type Listener = (event: StudioGenesisJobEvent) => void

function getStudioGenesisJobEventListeners() {
  const globalState = globalThis as typeof globalThis & {
    __studioGenesisJobEventListeners?: Set<Listener>
  }

  if (!globalState.__studioGenesisJobEventListeners) {
    globalState.__studioGenesisJobEventListeners = new Set()
  }

  return globalState.__studioGenesisJobEventListeners
}

export function subscribeStudioGenesisJobEvents(listener: Listener) {
  const listeners = getStudioGenesisJobEventListeners()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitStudioGenesisJobEvent(event: StudioGenesisJobEvent) {
  const listeners = getStudioGenesisJobEventListeners()
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[studio-genesis-job-events] listener failed:", error)
    }
  }
}

export function emitStudioGenesisJobUpdated(job: StudioGenesisJobRecord) {
  emitStudioGenesisJobEvent({
    type: "job_update",
    jobId: job.id,
    userId: job.user_id,
    job,
  })
}
