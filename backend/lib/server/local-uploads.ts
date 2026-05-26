export async function persistImageDataUrlToLocalUploads(params: {
  dataUrl: string
  preferredDir?: string
  filenameHint?: string
  maxBytes?: number
}) {
  return { url: params.dataUrl }
}
