'use client';

import { useEffect, useRef } from 'react';
import { artifactDefinitions } from './artifact';
import { initialArtifactData, useArtifact } from '@/hooks/use-artifact';
import { useDataStream } from './data-stream-provider';

// No longer needed - canvas auto-switch was removed

export function DataStreamHandler() {
  const { dataStream } = useDataStream();

  const { artifact, setArtifact, setMetadata } = useArtifact();
  const lastProcessedIndex = useRef(-1);

  useEffect(() => {
    if (!dataStream?.length) return;

    const newDeltas = dataStream.slice(lastProcessedIndex.current + 1);
    lastProcessedIndex.current = dataStream.length - 1;

    newDeltas.forEach((delta) => {
      const artifactDefinition = artifactDefinitions.find(
        (artifactDefinition) => artifactDefinition.kind === artifact.kind,
      );

      if (artifactDefinition?.onStreamPart) {
        try {
          // Type assertion to handle the union type
          artifactDefinition.onStreamPart({
            streamPart: delta as any,
            setArtifact,
            setMetadata,
          });
        } catch (error) {
          console.error('Error processing stream part:', error);
        }
      }

      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: 'streaming' };
        }

        switch (delta.type) {
          case 'data-id':
            console.log('Setting artifact documentId:', delta.data);
            return {
              ...draftArtifact,
              documentId: delta.data,
              status: 'streaming',
            };

          case 'data-title':
            console.log('Setting artifact title:', delta.data);
            return {
              ...draftArtifact,
              title: delta.data,
              status: 'streaming',
            };

          case 'data-kind':
            console.log('Setting artifact kind:', delta.data);
            return {
              ...draftArtifact,
              kind: delta.data,
              status: 'streaming',
              // Auto-open canvas to ensure it receives streaming events
              // Otherwise jobs streamed while canvas is closed will be lost
              isVisible:
                delta.data === 'canvas' ? true : draftArtifact.isVisible,
            };

          case 'data-clear':
            console.log('Clearing artifact content');
            return {
              ...draftArtifact,
              content: '',
              status: 'streaming',
            };

          case 'data-finish':
            console.log('Finishing artifact creation');
            return {
              ...draftArtifact,
              status: 'idle',
            };

          default:
            return draftArtifact;
        }
      });
    });
  }, [dataStream, setArtifact, setMetadata, artifact]);

  return null;
}
