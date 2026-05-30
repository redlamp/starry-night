"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ className, ...props }: DialogPrimitive.Trigger.Props) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      className={cn(className)}
      {...props}
    />
  )
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
        "data-open:animate-in data-closed:animate-out",
        "data-open:fade-in-0 data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-popup"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4",
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="dialog-content"
      className={cn(
        "relative flex flex-col rounded-lg border border-zinc-700 bg-[#0b1020] shadow-2xl",
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function DialogClose({ className, ...props }: DialogPrimitive.Close.Props) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      className={cn(
        "absolute right-3 top-3 z-10 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-mono text-xs text-zinc-400", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogContent,
  DialogClose,
  DialogTitle,
}
