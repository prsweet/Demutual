import React from "react";
import { BucketCard, type BucketCardProps } from "./BucketCard";

interface BucketGridProps {
  buckets: BucketCardProps[];
  emptyLabel?: string;
}

export function BucketGrid({ buckets, emptyLabel }: BucketGridProps) {
  if (buckets.length === 0) {
    return (
      <div className="p-8 flex justify-center">
        <div
          className="max-w-md w-full rounded-[1rem] p-8 text-center bg-[#f8f9f7]
          shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.05),0_12px_24px_-4px_rgba(0,0,0,0.05)]"
        >
          <p className="text-[15px] font-medium text-[#6b7280] tracking-tight">
            {emptyLabel ?? "No buckets yet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 p-8">
      {buckets.map((bucket) => (
        <BucketCard key={bucket.id} {...bucket} />
      ))}
    </div>
  );
}
