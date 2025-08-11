'use client';

import type { ArtifactKind } from './artifact';

// Constants for artifact types
const ARTIFACT_TYPES = {
  CANVAS: 'canvas',
  IMAGE: 'image',
} as const;

export const DocumentSkeleton = ({
  artifactKind,
}: {
  artifactKind: ArtifactKind;
}) => {
  if (artifactKind === ARTIFACT_TYPES.IMAGE) {
    return (
      <div className="flex flex-col gap-4 w-full justify-center items-center h-[calc(100dvh-60px)]">
        <div className="animate-pulse rounded-lg bg-muted-foreground/20 size-96" />
      </div>
    );
  }
  
  if (artifactKind === ARTIFACT_TYPES.CANVAS) {
    return (
      <div className="flex flex-col gap-4 w-full h-full">
        <div className="animate-pulse rounded-lg h-8 bg-muted-foreground/20 w-1/3" />
        <div className="flex gap-4 h-full">
          {/* Task List */}
          <div className="animate-pulse rounded-lg bg-muted-foreground/20 w-80 h-64 border-2 border-blue-200" />
          {/* Agent Cards */}
          <div className="flex flex-col gap-4">
            <div className="animate-pulse rounded-lg bg-muted-foreground/20 w-72 h-32 border-2 border-green-200" />
            <div className="animate-pulse rounded-lg bg-muted-foreground/20 w-72 h-32 border-2 border-green-200" />
            <div className="animate-pulse rounded-lg bg-muted-foreground/20 w-72 h-32 border-2 border-green-200" />
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="animate-pulse rounded-lg h-12 bg-muted-foreground/20 w-1/2" />
      <div className="animate-pulse rounded-lg h-5 bg-muted-foreground/20 w-full" />
      <div className="animate-pulse rounded-lg h-5 bg-muted-foreground/20 w-full" />
      <div className="animate-pulse rounded-lg h-5 bg-muted-foreground/20 w-1/3" />
      <div className="animate-pulse rounded-lg h-5 bg-transparent w-52" />
      <div className="animate-pulse rounded-lg h-8 bg-muted-foreground/20 w-52" />
      <div className="animate-pulse rounded-lg h-5 bg-muted-foreground/20 w-2/3" />
    </div>
  );
};

export const InlineDocumentSkeleton = () => {
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-48" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-3/4" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-1/2" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-64" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-40" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-36" />
      <div className="animate-pulse rounded-lg h-4 bg-muted-foreground/20 w-64" />
    </div>
  );
};
