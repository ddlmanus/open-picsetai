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
