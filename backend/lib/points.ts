export async function checkAndDeductPoints(
  _userId: string,
  _modelId: string,
  _type: "image" | "video" | "3d",
  _options?: {
    merchantId?: string | null
    modelConfig?: { cost?: number } | null
    quantity?: number
    dryRun?: boolean
  }
) {
  return { ok: true }
}
