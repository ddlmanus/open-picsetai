import type { CSSProperties } from "react"

export const PICSET_THEME_STYLE = {
  "--background": "300 4% 95.9%",
  "--foreground": "24 10% 13%",
  "--card": "0 0% 100%",
  "--card-foreground": "24 10% 13%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "24 10% 13%",
  "--primary": "240 6% 10%",
  "--primary-foreground": "0 0% 98%",
  "--secondary": "300 7% 93.7%",
  "--secondary-foreground": "24 10% 13%",
  "--muted": "300 7% 93.7%",
  "--muted-foreground": "240 4% 46%",
  "--accent": "300 7% 93.7%",
  "--accent-foreground": "24 10% 13%",
  "--border": "300 5% 88.4%",
  "--input": "300 5% 88.4%",
  "--ring": "240 6% 10%",
} as CSSProperties

export const PICSET_FONT_FAMILY = '"Inter","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'

export const PICSET_MAIN_CLASS = "w-full px-4 pb-12 sm:px-6"

export const PICSET_CONTAINER_CLASS = "mx-auto w-full max-w-6xl"

export const PICSET_SHELL_CONTAINER_CLASS = "mx-auto w-full max-w-7xl"

export const PICSET_GRID_CLASS = "grid grid-cols-1 gap-6 xl:grid-cols-[488px_1fr] xl:gap-10"

export const PICSET_PAGE_BACKGROUND_CLASS = "min-h-screen bg-[#f5f4f5]"

export const PICSET_CARD_CLASS =
  "rounded-[32px] border border-[#e2dee4] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.045)]"

export const PICSET_NAV_TRAY_CLASS =
  "items-center gap-1 rounded-2xl border border-[#e2dee4] bg-white/92 p-1 shadow-[0_2px_10px_rgba(15,23,42,0.04)] backdrop-blur-sm"

export const PICSET_NAV_LINK_CLASS =
  "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors"

export const PICSET_NAV_LINK_ACTIVE_CLASS = "bg-primary font-medium text-primary-foreground shadow-sm"

export const PICSET_NAV_LINK_INACTIVE_CLASS = "text-muted-foreground hover:bg-[#efedf1] hover:text-foreground"

export const PICSET_ICON_DISC_CLASS = "rounded-full bg-[#efedf1]"

export const PICSET_ICON_DISC_INTERACTIVE_CLASS = "rounded-full bg-[#efedf1] transition-colors hover:bg-[#e7e5eb]"

export const PICSET_UPLOAD_SURFACE_CLASS = "border-[#dfdbe4] hover:border-[#cdc8d7] hover:bg-[#faf9fb]"

export const PICSET_UPLOAD_ACTIVE_SURFACE_CLASS = "border-[#bdb8c5] bg-[#f1eff4]"

export const PICSET_THUMB_SURFACE_CLASS = "border-[#dfdbe4] bg-[#f3f1f5]"

export const PICSET_OVERLAY_ACTION_BUTTON_CLASS =
  "flex items-center justify-center rounded-full bg-white/90 text-[#5f5a67] shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-[#202029]"

export const PICSET_SEGMENTED_TRAY_CLASS = "rounded-xl bg-[#f4f4f5] p-1"

export const PICSET_SEGMENTED_TRIGGER_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all duration-200"

export const PICSET_SEGMENTED_TRIGGER_ACTIVE_CLASS = "bg-[#1f1f23] text-white shadow-sm"

export const PICSET_SEGMENTED_TRIGGER_INACTIVE_CLASS = "bg-transparent text-[#71717a] hover:bg-white hover:text-[#18181b]"

export const PICSET_FIELD_CLASS =
  "h-14 w-full appearance-none rounded-[18px] border border-[#e0dce4] bg-[#f8f7f9] px-4 py-3 pr-11 text-sm text-[#25242a] outline-none ring-offset-background transition focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

export const PICSET_TEXTAREA_CLASS =
  "w-full resize-none rounded-[18px] border border-[#e0dce4] bg-[#f8f7f9] px-4 py-4 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"

export const PICSET_SOFT_BUTTON_CLASS =
  "border border-[#e4e4e7] bg-white text-[#71717a] transition-all duration-200 hover:border-[#d4d4d8] hover:bg-[#fafafa] hover:text-[#18181b]"

export const PICSET_DIALOG_PANEL_CLASS = "border-0 bg-white p-0 shadow-[0_32px_110px_rgba(15,23,42,0.18)]"

export const PICSET_DIALOG_COMPACT_PANEL_CLASS = "border-0 bg-white p-0 shadow-[0_30px_100px_rgba(15,23,42,0.18)]"

export const PICSET_DIALOG_CANVAS_CLASS = "bg-[#f5f4f5]"
