import { Suspense } from "react"
import ProductDetailShell from "@/components/picset/product-detail-shell"
import ClothingStudioWorkspace from "./_components/clothing-studio-workspace"

export default function ClothingStudioPage() {
  return (
    <ProductDetailShell>
      <Suspense
        fallback={
          <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,248,240,0.92),_rgba(248,243,235,0.98)_40%,_rgba(242,239,234,1)_100%)]" />
        }
      >
        <ClothingStudioWorkspace />
      </Suspense>
    </ProductDetailShell>
  )
}
