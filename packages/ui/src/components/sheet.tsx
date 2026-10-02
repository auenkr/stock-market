"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"
import { cn } from "@stock-market/ui/lib/utils"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetTitle = SheetPrimitive.Title
const SheetDescription = SheetPrimitive.Description

function SheetContent({ className, children, ...props }: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
    <SheetPrimitive.Content data-slot="sheet-content" className={cn("fixed inset-y-0 right-0 z-50 flex h-dvh w-3/4 flex-col gap-6 border-l bg-background p-6 text-foreground shadow-lg outline-none duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right sm:max-w-sm", className)} {...props}>
      {children}
      <SheetPrimitive.Close className="absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><XIcon className="size-5" /><span className="sr-only">Close navigation menu</span></SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription }
