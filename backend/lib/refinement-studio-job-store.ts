import { emitRefinementStudioJobUpdated } from "@/lib/refinement-studio-job-events"
import type { RefinementStudioJobRecord } from "@/lib/refinement-studio"

const globalForRefinementStudioJobs = globalThis as typeof globalThis & {
  __refinementStudioJobs?: Map<string, RefinementStudioJobRecord>
}

const jobs = globalForRefinementStudioJobs.__refinementStudioJobs || new Map<string, RefinementStudioJobRecord>()

if (!globalForRefinementStudioJobs.__refinementStudioJobs) {
  globalForRefinementStudioJobs.__refinementStudioJobs = jobs
}

export async function ensureRefinementStudioJobTable() {
  return
}

export async function insertRefinementStudioJob(job: RefinementStudioJobRecord) {
  jobs.set(job.id, job)
  emitRefinementStudioJobUpdated(job)
  return job
}

export async function updateRefinementStudioJob<T extends RefinementStudioJobRecord["type"]>(
  jobId: string,
  updater: (
    current: Extract<RefinementStudioJobRecord, { type: T }>
  ) => Extract<RefinementStudioJobRecord, { type: T }>
) {
  const current = jobs.get(String(jobId || "").trim())
  if (!current) return null
  const next = updater(current as Extract<RefinementStudioJobRecord, { type: T }>)
  jobs.set(next.id, next)
  emitRefinementStudioJobUpdated(next)
  return next
}

export async function getRefinementStudioJobForUser(jobId: string, userId: string) {
  const job = jobs.get(String(jobId || "").trim())
  if (!job) return null
  if (String(job.user_id || "").trim() !== String(userId || "").trim()) return null
  return job
}
