"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import JSZip from "jszip"
import {
  Check,
  CircleCheck,
  Download,
  Eye,
  Loader2,
  PencilLine,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { buildStudioGenesisImageFilename } from "@/lib/studio-genesis"
import type { StudioGenesisHistoryItem, StudioGenesisHistoryListResult } from "@/lib/studio-genesis-history"
import { cn } from "@/lib/utils"
import { openImageInCanvas } from "@/lib/canvas/open-image-in-canvas"
import { fetchAndDownload, resolveImageDownloadUrl, triggerBrowserDownload } from "@/lib/url/download-url"
import { toImageProxyUrlWithParams } from "@/lib/url/image-proxy-policy"

const ACTION_BUTTON_CLASS =
  "flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md backdrop-blur-sm transition-colors hover:bg-white"

function HistorySkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="relative animate-pulse shadow-lg">
          <div className="overflow-hidden rounded-2xl bg-white" style={{ aspectRatio: "3 / 4" }}>
            <div className="h-full w-full bg-zinc-200/80" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function StudioGenesisHistoryPage() {
  const [records, setRecords] = useState<StudioGenesisHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [isMultiSelect, setIsMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [openingCanvasId, setOpeningCanvasId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPrompt, setEditingPrompt] = useState("")
  const [editError, setEditError] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [isBatchDownloading, setIsBatchDownloading] = useState(false)
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)

  const previewRecord = previewId ? records.find((item) => item.id === previewId) || null : null
  const editingRecord = editingId ? records.find((item) => item.id === editingId) || null : null
  const selectedItems = useMemo(
    () => records.filter((item) => selectedIds.includes(item.id)),
    [records, selectedIds]
  )

  const loadHistory = async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/studio-genesis/history?page=1&pageSize=120", { cache: "no-store" , credentials: "include"})
      const payload = (await response.json().catch(() => ({}))) as Partial<StudioGenesisHistoryListResult> & {
        error?: string
      }
      if (!response.ok) {
        throw new Error(payload.error || "加载生图历史失败")
      }
      setRecords(Array.isArray(payload.list) ? payload.list : [])
    } catch (fetchError: any) {
      setError(String(fetchError?.message || "加载生图历史失败"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => records.some((item) => item.id === id)))
  }, [records])

  const toggleSelect = (recordId: string) => {
    setSelectedIds((previous) =>
      previous.includes(recordId) ? previous.filter((id) => id !== recordId) : [...previous, recordId]
    )
  }

  const handleDownload = async (record: StudioGenesisHistoryItem) => {
    await fetchAndDownload(
      resolveImageDownloadUrl(record.imageUrl),
      buildStudioGenesisImageFilename(record.index, record.title)
    )
  }

  const handleBatchDownload = async () => {
    if (selectedItems.length === 0) return
    setError("")
    setIsBatchDownloading(true)
    try {
      if (selectedItems.length === 1) {
        await handleDownload(selectedItems[0])
        return
      }

      const zip = new JSZip()
      for (const record of selectedItems) {
        const response = await fetch(resolveImageDownloadUrl(record.imageUrl))
        if (!response.ok) {
          throw new Error(`下载素材失败：${record.title || "未命名作品"}`)
        }
        const blob = await response.blob()
        zip.file(buildStudioGenesisImageFilename(record.index, record.title), blob)
      }
      const blob = await zip.generateAsync({ type: "blob" })
      const objectUrl = URL.createObjectURL(blob)
      try {
        triggerBrowserDownload(objectUrl, `studio-genesis-history-${Date.now()}.zip`)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    } catch (downloadError: any) {
      setError(String(downloadError?.message || "批量下载失败"))
    } finally {
      setIsBatchDownloading(false)
    }
  }

  const handleDelete = async (recordId: string) => {
    if (!window.confirm("确定删除这条作品记录吗？")) return
    setError("")
    try {
      const response = await fetch(`/api/studio-genesis/history/${encodeURIComponent(recordId)}`, { method: "DELETE" , credentials: "include"})
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || "删除记录失败")
      }
      setRecords((previous) => previous.filter((item) => item.id !== recordId))
    } catch (deleteError: any) {
      setError(String(deleteError?.message || "删除记录失败"))
    }
  }

  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return
    if (!window.confirm(`确定删除已选中的 ${selectedItems.length} 条作品记录吗？`)) return
    setError("")
    setIsBatchDeleting(true)
    try {
      await Promise.all(
        selectedItems.map(async (record) => {
          const response = await fetch(`/api/studio-genesis/history/${encodeURIComponent(record.id)}`, {
            method: "DELETE",

            credentials: "include"
          })
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string }
            throw new Error(payload.error || "删除记录失败")
          }
        })
      )
      const removedIds = new Set(selectedItems.map((item) => item.id))
      setRecords((previous) => previous.filter((item) => !removedIds.has(item.id)))
      setSelectedIds([])
      setIsMultiSelect(false)
    } catch (deleteError: any) {
      setError(String(deleteError?.message || "批量删除失败"))
    } finally {
      setIsBatchDeleting(false)
    }
  }

  const openEditDialog = (record: StudioGenesisHistoryItem) => {
    if (!record.imageUrl || openingCanvasId === record.id) return

    setOpeningCanvasId(record.id)
    void (async () => {
      try {
        const baseTitle = String(record.title || record.description || "组图成图").trim() || "组图成图"
        await openImageInCanvas({
          imageUrl: record.imageUrl,
          projectTitle: `${baseTitle} · 画布编辑`,
          layerName: `${baseTitle} 第${record.index + 1}张`,
          thumbnail: record.imageUrl,
        })
      } catch (applyError: any) {
        setError(String(applyError?.message || "打开画布失败"))
      } finally {
        setOpeningCanvasId((current) => (current === record.id ? null : current))
      }
    })()
  }

  const handleApplyEdit = async () => {
    if (!editingRecord?.imageUrl) return
    setEditError("")
    setIsEditing(true)
    try {
      const editResponse = await fetch("/api/edit-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrls: [editingRecord.imageUrl],
          prompt: editingPrompt,
          model: editingRecord.model || undefined,
        }),

        credentials: "include"
      })
      const editPayload = (await editResponse.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!editResponse.ok || !editPayload.url) {
        throw new Error(editPayload.error || "编辑失败")
      }

      const updateResponse = await fetch(`/api/studio-genesis/history/${encodeURIComponent(editingRecord.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: editingPrompt,
          imageUrl: editPayload.url,
        }),

        credentials: "include"
      })
      const updatePayload = (await updateResponse.json().catch(() => ({}))) as {
        error?: string
        record?: StudioGenesisHistoryItem
      }
      if (!updateResponse.ok || !updatePayload.record) {
        throw new Error(updatePayload.error || "更新历史记录失败")
      }

      setRecords((previous) =>
        previous.map((item) => (item.id === updatePayload.record!.id ? updatePayload.record! : item))
      )
      setEditingId(null)
    } catch (applyError: any) {
      setEditError(String(applyError?.message || "编辑失败"))
    } finally {
      setIsEditing(false)
    }
  }

  return (
    <>
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">作品记录</h1>
            <p className="mt-1 text-sm text-zinc-500">查看和管理您的 AI 生成作品</p>
          </div>
          <div className="flex items-center gap-3">
            {isMultiSelect && selectedIds.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void handleBatchDownload()}
                  disabled={isBatchDownloading || isBatchDeleting}
                  className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-xs font-medium text-foreground transition-all duration-200 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]"
                >
                  {isBatchDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  下载所选
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchDelete()}
                  disabled={isBatchDeleting || isBatchDownloading}
                  className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-red-500 px-4 text-xs font-medium text-white transition-all duration-200 hover:bg-red-500/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]"
                >
                  {isBatchDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  删除所选
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setIsMultiSelect((previous) => !previous)
                setSelectedIds([])
              }}
              className={cn(
                "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-xs font-medium text-foreground transition-all duration-200 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]",
                "h-9 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                isMultiSelect && "border-primary bg-primary/5 text-primary"
              )}
            >
              <CircleCheck className="mr-2 h-4 w-4" />
              多选
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {loading ? <HistorySkeletonGrid /> : null}

        {!loading && records.length === 0 ? (
          <div className="rounded-3xl border border-border bg-white px-6 py-16 text-center shadow-sm">
            <p className="text-sm text-zinc-500">还没有生成作品，先去全品类组图生成几张吧。</p>
            <a
              href="/studio-genesis/workspace"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              去工作台开始生成
            </a>
          </div>
        ) : null}

        {!loading && records.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {records.map((record) => {
                const selected = selectedIds.includes(record.id)
                const isOpeningCanvas = openingCanvasId === record.id
                return (
                  <div key={record.id} className="relative shadow-lg transition-all duration-200 hover:shadow-2xl">
                    <div
                      className={cn(
                        "group relative overflow-hidden rounded-2xl",
                        selected && "ring-2 ring-primary ring-offset-2 ring-offset-[#f5f4f5]"
                      )}
                      style={{ aspectRatio: "3 / 4" }}
                      role={isMultiSelect ? "button" : undefined}
                      tabIndex={isMultiSelect ? 0 : -1}
                      onClick={() => {
                        if (isMultiSelect) toggleSelect(record.id)
                      }}
                      onKeyDown={(event) => {
                        if (!isMultiSelect) return
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          toggleSelect(record.id)
                        }
                      }}
                    >
                      <div className="relative h-full w-full overflow-hidden transition-transform duration-500 group-hover:scale-110">
                        <Image
                          src={toImageProxyUrlWithParams(record.imageUrl, { w: 900 })}
                          alt={record.prompt || record.title || "图片"}
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                          className="h-full w-full object-cover"
                        />
                      </div>

                      {isMultiSelect ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleSelect(record.id)
                          }}
                          className={cn(
                            "absolute left-3 top-3 z-30 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm transition-all",
                            selected
                              ? "border-primary bg-primary text-primary-foreground shadow-md"
                              : "border-white/70 bg-white/90 text-zinc-500 shadow-sm"
                          )}
                          aria-label={selected ? "取消选择" : "选择作品"}
                        >
                          {selected ? <Check className="h-4 w-4" /> : <span className="h-3.5 w-3.5 rounded-full border border-current" />}
                        </button>
                      ) : null}

                      <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setPreviewId(record.id)
                          }}
                          className={ACTION_BUTTON_CLASS}
                          title="查看"
                          aria-label="查看"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDownload(record)
                          }}
                          className={ACTION_BUTTON_CLASS}
                          title="下载"
                          aria-label="下载"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openEditDialog(record)
                          }}
                          disabled={isOpeningCanvas}
                          className={ACTION_BUTTON_CLASS}
                          title={isOpeningCanvas ? "正在打开画布" : "编辑"}
                          aria-label={isOpeningCanvas ? "正在打开画布" : "编辑"}
                        >
                          {isOpeningCanvas ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void handleDelete(record.id)
                          }}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/90 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-red-500"
                          title="删除"
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="py-12 text-center text-sm text-zinc-400">已经到底啦</div>
          </>
        ) : null}
      </main>

      <Dialog open={Boolean(previewRecord)} onOpenChange={(open) => (!open ? setPreviewId(null) : undefined)}>
        <DialogContent className="max-w-[1100px] rounded-[30px] border-0 bg-white p-0 shadow-[0_32px_110px_rgba(15,23,42,0.18)]">
          <div className="relative min-h-[320px] overflow-hidden rounded-[30px] bg-[#f5f4f5]">
            {previewRecord?.imageUrl ? (
              <Image
                src={toImageProxyUrlWithParams(previewRecord.imageUrl, { w: 1400 })}
                alt={previewRecord.title || "作品预览"}
                fill
                unoptimized
                sizes="90vw"
                className="object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => (!open ? setEditingId(null) : undefined)}>
        <DialogContent className="max-w-[1100px] rounded-[30px] border-0 bg-white p-0 shadow-[0_32px_110px_rgba(15,23,42,0.18)]">
          <div className="grid max-h-[85vh] gap-0 overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
            <div className="relative min-h-[320px] bg-[#f5f4f5]">
              {editingRecord?.imageUrl ? (
                <Image
                  src={toImageProxyUrlWithParams(editingRecord.imageUrl, { w: 1200 })}
                  alt={editingRecord.title || "待编辑作品"}
                  fill
                  unoptimized
                  sizes="50vw"
                  className="object-contain"
                />
              ) : null}
            </div>
            <div className="flex flex-col px-7 py-7">
              <DialogHeader className="text-left">
                <DialogTitle className="text-[24px] tracking-[-0.03em] text-foreground">编辑当前成图</DialogTitle>
                <DialogDescription className="mt-2 text-[14px] leading-7 text-muted-foreground">
                  对当前历史作品继续精修，适合做背景优化、道具替换、材质微调和整体氛围强化。
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 flex-1">
                <label className="mb-2 block text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  编辑提示
                </label>
                <textarea
                  value={editingPrompt}
                  onChange={(event) => setEditingPrompt(event.target.value)}
                  className="min-h-[260px] w-full rounded-[24px] border border-[#e0dce4] bg-[#fbfafc] px-4 py-4 text-[14px] leading-7 text-foreground outline-none transition focus:border-[#c9c5d1]"
                  placeholder="例如：把背景改成更纯净的高级灰台面，强化瓶身折射高光，让画面质感更奢华。"
                />
                {editError ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {editError}
                  </div>
                ) : null}
              </div>
              <DialogFooter className="mt-6 flex-row gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingId(null)}
                  className="h-11 flex-1 rounded-full border-border bg-white text-foreground"
                >
                  关闭
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleApplyEdit()}
                  disabled={isEditing || !editingPrompt.trim()}
                  className="h-11 flex-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isEditing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PencilLine className="mr-2 h-4 w-4" />}
                  应用编辑
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
