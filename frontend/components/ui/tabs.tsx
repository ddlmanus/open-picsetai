"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TabsContextValue = {
    value?: string
    onValueChange?: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue>({})

function Tabs({
    value,
    defaultValue,
    onValueChange,
    className,
    children,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
}) {
    const [internalValue, setInternalValue] = React.useState(defaultValue)
    const currentValue = value ?? internalValue
    const handleValueChange = React.useCallback((nextValue: string) => {
        setInternalValue(nextValue)
        onValueChange?.(nextValue)
    }, [onValueChange])

    return (
        <TabsContext.Provider value={{ value: currentValue, onValueChange: handleValueChange }}>
            <div className={className} {...props}>
                {children}
            </div>
        </TabsContext.Provider>
    )
}

const TabsList = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        role="tablist"
        className={cn(
            "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
            className
        )}
        {...props}
    />
))
TabsList.displayName = "TabsList"

const TabsTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, onClick, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    const active = context.value === value
    return (
        <button
            ref={ref}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? "active" : "inactive"}
            className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
                className
            )}
            onClick={(event) => {
                context.onValueChange?.(value)
                onClick?.(event)
            }}
            {...props}
        />
    )
})
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (context.value !== value) return null
    return (
        <div
            ref={ref}
            role="tabpanel"
            className={cn(
                "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                className
            )}
            {...props}
        >
            {children}
        </div>
    )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
