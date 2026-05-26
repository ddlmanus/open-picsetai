export type LocalUserScope = {
  userId: string
  merchantId: string | null
}

export async function getLocalUserScope(): Promise<LocalUserScope> {
  return {
    userId: String(process.env.STUDIO_GENESIS_DEV_USER_ID || "local-user").trim(),
    merchantId: String(process.env.STUDIO_GENESIS_DEV_MERCHANT_ID || "default").trim() || "default",
  }
}
