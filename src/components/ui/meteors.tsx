"use client"

import React, { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

interface MeteorsProps {
  number?: number
  minDelay?: number
  maxDelay?: number
  minDuration?: number
  maxDuration?: number
  angle?: number
  className?: string
  /**
   * Extra classes appended to the meteor head. Defaults to `bg-zinc-500`
   * for the shadcn/magicui look; brand wrappers override with e.g.
   * `!bg-gold` to recolor without touching the source path.
   */
  headClassName?: string
  /** Extra classes appended to the meteor tail. Same override pattern. */
  tailClassName?: string
}

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
  headClassName = "bg-zinc-500",
  tailClassName = "from-zinc-500",
}: MeteorsProps) => {
  const [meteorStyles, setMeteorStyles] = useState<Array<React.CSSProperties>>(
    []
  )

  useEffect(() => {
    const styles = [...new Array(number)].map(() => ({
      "--angle": -angle + "deg",
      top: "-5%",
      left: `calc(0% + ${Math.floor(Math.random() * window.innerWidth)}px)`,
      animationDelay: Math.random() * (maxDelay - minDelay) + minDelay + "s",
      animationDuration:
        Math.floor(Math.random() * (maxDuration - minDuration) + minDuration) +
        "s",
    }))
    const frame = requestAnimationFrame(() => setMeteorStyles(styles))
    return () => cancelAnimationFrame(frame)
  }, [number, minDelay, maxDelay, minDuration, maxDuration, angle])

  return (
    <>
      {[...new Array(meteorStyles.length)].map((_, idx) => (
        <span
          key={idx}
          style={meteorStyles[idx]}
          className={cn(
            "animate-meteor pointer-events-none absolute size-0.5 rotate-(--angle) rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className,
            headClassName
          )}
        >
          {/* Meteor Tail */}
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 -z-10 h-px w-12.5 -translate-y-1/2 bg-linear-to-r from-zinc-500 to-transparent",
              tailClassName
            )}
          />
        </span>
      ))}
    </>
  )
}
