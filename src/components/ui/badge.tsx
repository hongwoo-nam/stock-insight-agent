import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "bg-black text-white": variant === "default",
          "bg-gray-100 text-gray-700": variant === "secondary",
          "bg-red-100 text-red-700": variant === "destructive",
          "border border-gray-200 text-gray-700": variant === "outline",
          "bg-green-100 text-green-700": variant === "success",
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
