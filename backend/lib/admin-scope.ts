export async function resolveSessionMerchantId(
  user: { merchantId?: string | null } | Record<string, unknown>,
  _options?: { fallbackToDefault?: boolean }
) {
  return String((user as { merchantId?: string | null })?.merchantId || "").trim() || null
}
