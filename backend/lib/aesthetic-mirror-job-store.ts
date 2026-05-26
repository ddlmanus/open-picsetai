import type { AestheticMirrorJobRecord } from "@/lib/aesthetic-mirror"

const globalForAestheticMirrorJobs = globalThis as typeof globalThis & {
  __aestheticMirrorJobs?: Map<string, AestheticMirrorJobRecord>
}

const jobs = globalForAestheticMirrorJobs.__aestheticMirrorJobs || new Map<string, AestheticMirrorJobRecord>()

if (!globalForAestheticMirrorJobs.__aestheticMirrorJobs) {
  globalForAestheticMirrorJobs.__aestheticMirrorJobs = jobs
}

export async function ensureAestheticMirrorJobTable() {
  return
}

export async function insertAestheticMirrorJob(job: AestheticMirrorJobRecord) {
  jobs.set(job.id, job)
  return job
}

export async function updateAestheticMirrorJob(
  jobId: string,
  updater: (current: AestheticMirrorJobRecord) => AestheticMirrorJobRecord
) {
  const current = jobs.get(String(jobId || "").trim())
  if (!current) return null
  const next = updater(current)
  jobs.set(next.id, next)
  return next
}

export async function getAestheticMirrorJobForUser(jobId: string, userId: string) {
  const job = jobs.get(String(jobId || "").trim())
  if (!job) return null
  if (String(job.user_id || "").trim() !== String(userId || "").trim()) return null
  return job
}
