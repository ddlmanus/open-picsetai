import { Suspense } from "react"
import ProductDetailShell from "@/components/picset/product-detail-shell"
import StudioGenesisWorkspace from "@/app/studio-genesis/_components/studio-genesis-workspace"

export default function KnowledgeStudioPage() {
  return (
    <ProductDetailShell>
      <Suspense fallback={<div className="min-h-screen bg-[#f5f4f5]" />}>
        <StudioGenesisWorkspace variant="knowledge" />
      </Suspense>
    </ProductDetailShell>
  )
}
