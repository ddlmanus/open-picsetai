import { mkdirSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

export type StudioGenesisHistoryItem = {
  id: string
  merchantId: string
  userId: string
  batchId: string
  planId: string
  index: number
  title: string
  description: string
  prompt: string
  imageUrl: string
  sourceImageUrl: string
  model: string
  provider: string
  aspectRatio: string
  imageSize: string
  targetLanguage: string
  requirements: string
  productImages: string[]
  createdAt: string
  updatedAt: string
}

export type StudioGenesisHistoryListResult = {
  list: StudioGenesisHistoryItem[]
  total: number
  page: number
  pageSize: number
}

type UserScope = {
  userId: string
  merchantId?: string | null
}

type CreateHistoryInput = {
  batchId?: string
  planId?: string
  index?: number
  title?: string
  description?: string
  prompt?: string
  imageUrl: string
  sourceImageUrl?: string
  model?: string
  provider?: string
  aspectRatio?: string
  imageSize?: string
  targetLanguage?: string
  requirements?: string
  productImages?: string[]
}

type UpdateHistoryInput = {
  title?: string
  description?: string
  prompt?: string
  imageUrl?: string
  sourceImageUrl?: string
  model?: string
  provider?: string
}

const dbPath = path.resolve(
  process.cwd(),
  process.env.STUDIO_GENESIS_SQLITE_PATH || "data/studio-genesis.sqlite"
)

let db: DatabaseSync | null = null

function getDb() {
  if (db) return db
  mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_genesis_history (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      batch_id TEXT NOT NULL DEFAULT '',
      plan_id TEXT NOT NULL DEFAULT '',
      image_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      description_text TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      source_image_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT '',
      aspect_ratio TEXT NOT NULL DEFAULT '',
      image_size TEXT NOT NULL DEFAULT '',
      target_language TEXT NOT NULL DEFAULT '',
      requirements TEXT NOT NULL DEFAULT '',
      product_images_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_genesis_history_user_updated_idx
      ON studio_genesis_history(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS studio_genesis_history_batch_idx
      ON studio_genesis_history(batch_id);
  `)
  return db
}

function normalizeUserScope(scope: UserScope) {
  const userId = String(scope.userId || "").trim()
  if (!userId) throw new Error("Missing userId")
  return {
    userId,
    merchantId: String(scope.merchantId || "").trim() || "default",
  }
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToHistoryItem(row: any): StudioGenesisHistoryItem {
  return {
    id: String(row.id || ""),
    merchantId: String(row.merchant_id || ""),
    userId: String(row.user_id || ""),
    batchId: String(row.batch_id || ""),
    planId: String(row.plan_id || ""),
    index: Math.max(0, Number(row.image_index || 0) || 0),
    title: String(row.title || ""),
    description: String(row.description_text || ""),
    prompt: String(row.prompt || ""),
    imageUrl: String(row.image_url || ""),
    sourceImageUrl: String(row.source_image_url || ""),
    model: String(row.model || ""),
    provider: String(row.provider || ""),
    aspectRatio: String(row.aspect_ratio || ""),
    imageSize: String(row.image_size || ""),
    targetLanguage: String(row.target_language || ""),
    requirements: String(row.requirements || ""),
    productImages: safeJsonParse<string[]>(row.product_images_json, []),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  }
}

function normalizeTitle(title: unknown, fallback?: unknown) {
  const value = String(title || "").trim() || String(fallback || "").trim() || "未命名作品"
  return value.slice(0, 1024)
}

export async function ensureStudioGenesisHistoryTable() {
  getDb()
}

export async function createStudioGenesisHistoryItem(
  scope: UserScope,
  input: CreateHistoryInput
): Promise<StudioGenesisHistoryItem> {
  const database = getDb()
  const normalizedScope = normalizeUserScope(scope)
  const id = randomUUID()
  const now = new Date().toISOString()
  database.prepare(`
    INSERT INTO studio_genesis_history (
      id, merchant_id, user_id, batch_id, plan_id, image_index, title,
      description_text, prompt, image_url, source_image_url, model, provider,
      aspect_ratio, image_size, target_language, requirements, product_images_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizedScope.merchantId,
    normalizedScope.userId,
    String(input.batchId || "").trim(),
    String(input.planId || "").trim(),
    Math.max(0, Number(input.index || 0) || 0),
    normalizeTitle(input.title, input.prompt),
    String(input.description || ""),
    String(input.prompt || ""),
    String(input.imageUrl || ""),
    String(input.sourceImageUrl || input.imageUrl || ""),
    String(input.model || ""),
    String(input.provider || ""),
    String(input.aspectRatio || ""),
    String(input.imageSize || ""),
    String(input.targetLanguage || ""),
    String(input.requirements || ""),
    JSON.stringify((input.productImages || []).map((item) => String(item || "").trim()).filter(Boolean)),
    now,
    now
  )
  const record = await getStudioGenesisHistoryItem(scope, id)
  if (!record) throw new Error("Failed to create studio genesis history item")
  return record
}

export async function listStudioGenesisHistoryItems(
  scope: UserScope,
  options?: { page?: number; pageSize?: number; keyword?: string }
): Promise<StudioGenesisHistoryListResult> {
  const database = getDb()
  const normalizedScope = normalizeUserScope(scope)
  const page = Math.max(1, Number(options?.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(options?.pageSize || 24)))
  const offset = (page - 1) * pageSize
  const keyword = String(options?.keyword || "").trim()

  const rows = keyword
    ? database.prepare(`
        SELECT * FROM studio_genesis_history
        WHERE user_id = ? AND (title LIKE ? OR prompt LIKE ?)
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(normalizedScope.userId, `%${keyword}%`, `%${keyword}%`, pageSize, offset)
    : database.prepare(`
        SELECT * FROM studio_genesis_history
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(normalizedScope.userId, pageSize, offset)

  const totalRow = keyword
    ? database.prepare(`
        SELECT COUNT(*) AS total FROM studio_genesis_history
        WHERE user_id = ? AND (title LIKE ? OR prompt LIKE ?)
      `).get(normalizedScope.userId, `%${keyword}%`, `%${keyword}%`) as any
    : database.prepare(`
        SELECT COUNT(*) AS total FROM studio_genesis_history
        WHERE user_id = ?
      `).get(normalizedScope.userId) as any

  return {
    list: rows.map((row) => rowToHistoryItem(row)),
    total: Number(totalRow?.total || 0),
    page,
    pageSize,
  }
}

export async function getStudioGenesisHistoryItem(
  scope: UserScope,
  recordId: string
): Promise<StudioGenesisHistoryItem | null> {
  const database = getDb()
  const normalizedScope = normalizeUserScope(scope)
  const row = database.prepare(`
    SELECT * FROM studio_genesis_history
    WHERE id = ? AND user_id = ?
    LIMIT 1
  `).get(String(recordId || "").trim(), normalizedScope.userId)
  return row ? rowToHistoryItem(row) : null
}

export async function updateStudioGenesisHistoryItem(
  scope: UserScope,
  recordId: string,
  input: UpdateHistoryInput
): Promise<StudioGenesisHistoryItem | null> {
  const existing = await getStudioGenesisHistoryItem(scope, recordId)
  if (!existing) return null
  const database = getDb()
  const normalizedScope = normalizeUserScope(scope)
  database.prepare(`
    UPDATE studio_genesis_history
    SET title = ?,
        description_text = ?,
        prompt = ?,
        image_url = ?,
        source_image_url = ?,
        model = ?,
        provider = ?,
        updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    normalizeTitle(input.title !== undefined ? input.title : existing.title, input.prompt !== undefined ? input.prompt : existing.prompt),
    input.description !== undefined ? String(input.description || "") : existing.description,
    input.prompt !== undefined ? String(input.prompt || "") : existing.prompt,
    input.imageUrl !== undefined ? String(input.imageUrl || "") : existing.imageUrl,
    input.sourceImageUrl !== undefined ? String(input.sourceImageUrl || "") : existing.sourceImageUrl,
    input.model !== undefined ? String(input.model || "") : existing.model,
    input.provider !== undefined ? String(input.provider || "") : existing.provider,
    new Date().toISOString(),
    String(recordId || "").trim(),
    normalizedScope.userId
  )
  return await getStudioGenesisHistoryItem(scope, recordId)
}

export async function deleteStudioGenesisHistoryItem(scope: UserScope, recordId: string): Promise<boolean> {
  const database = getDb()
  const normalizedScope = normalizeUserScope(scope)
  const result = database.prepare(`
    DELETE FROM studio_genesis_history WHERE id = ? AND user_id = ?
  `).run(String(recordId || "").trim(), normalizedScope.userId)
  return Number(result.changes || 0) > 0
}
