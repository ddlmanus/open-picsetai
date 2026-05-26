import { Suspense } from "react"
import StudioGenesisHistoryPage from "./_components/studio-genesis-history-page"

export default function StudioGenesisHistoryRoute() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f5f4f5]" />}>
      <StudioGenesisHistoryPage />
    </Suspense>
  )
}
