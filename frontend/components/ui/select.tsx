"use client"

import * as React from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const SelectContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
} | null>(null)

const Select = ({
  children,
  value,
  onValueChange,
  defaultValue,
}: {
  children: React.ReactNode
  value?: string
  onValueChange?: (value: string) => void
  defaultValue?: string
}) => {
  const [open, setOpen] = React.useState(false)
  const [val, setVal] = React.useState(value || defaultValue || "")

  React.useEffect(() => {
    if (value !== undefined) setVal(value)
  }, [value])

  const handleValueChange = (newValue: string) => {
    setVal(newValue)
    onValueChange?.(newValue)
    setOpen(false)
  }

  return (
    <SelectContext.Provider value={{ value: val, onValueChange: handleValueChange, open, setOpen }}>
      <div className="relative inline-block w-full text-left">{children}</div>
    </SelectContext.Provider>
  )
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => context?.setOpen(!context.open)}
        className={cn(
          "flex h-8 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1 text-[12px] leading-4 ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement> & { placeholder?: string }>(
  ({ className, children, placeholder, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    return (
      <span ref={ref} className={cn("block truncate", className)} {...props}>
        {children || context?.value || placeholder}
      </span>
    )
  }
)
SelectValue.displayName = "SelectValue"

const SelectContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { position?: "popper" | "item-aligned" }>(
  ({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    const contentRef = React.useRef<HTMLDivElement | null>(null)
    const [canScrollDown, setCanScrollDown] = React.useState(false)
    const isOpen = Boolean(context?.open)

    const setRefs = (node: HTMLDivElement | null) => {
      contentRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    }

    const updateScrollState = () => {
      const node = contentRef.current
      if (!node) return
      setCanScrollDown(node.scrollHeight - node.scrollTop - node.clientHeight > 8)
    }

    React.useEffect(() => {
      if (!isOpen) return
      const frame = window.requestAnimationFrame(updateScrollState)
      const handleResize = () => updateScrollState()
      window.addEventListener("resize", handleResize)
      return () => {
        window.cancelAnimationFrame(frame)
        window.removeEventListener("resize", handleResize)
      }
    }, [children, isOpen])

    if (!isOpen) return null

    return (
      <div
        ref={setRefs}
        className={cn(
          "absolute z-50 w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-[12px] text-slate-950 shadow-md",
          "mt-1 min-w-[10rem] animate-in fade-in-80 zoom-in-95",
          className
        )}
        {...props}
      >
        <div className="relative">
          <div
            ref={contentRef}
            className="max-h-[240px] overflow-y-auto p-0.5 pr-1 custom-scrollbar"
            onScroll={updateScrollState}
          >
            {children}
          </div>
          {canScrollDown ? (
            <button
              type="button"
              aria-label="向下滚动查看更多选项"
              onClick={() => {
                const node = contentRef.current
                if (!node) return
                node.scrollBy({ top: 120, behavior: "smooth" })
              }}
              className="absolute bottom-1 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-white/95 text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:text-slate-900"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    )
  }
)
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string }>(
  ({ className, children, value, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    const isSelected = context?.value === value

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex min-h-7 w-full cursor-default select-none items-center rounded-lg py-1 pl-7 pr-2 text-[12px] leading-4 outline-none hover:bg-slate-100 hover:text-slate-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className
        )}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          context?.onValueChange(value)
        }}
        {...props}
      >
        {isSelected ? (
          <span className="absolute left-2 flex h-3 w-3 items-center justify-center">
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <span className="truncate">{children}</span>
      </div>
    )
  }
)
SelectItem.displayName = "SelectItem"

const SelectGroup = React.Fragment
const SelectLabel = React.Fragment
const SelectSeparator = () => <div className="-mx-1 my-1 h-px bg-slate-100" />
const SelectScrollUpButton = React.Fragment
const SelectScrollDownButton = React.Fragment

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
