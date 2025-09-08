import { codeDocumentHandler } from '@/artifacts/code/server';
import { imageDocumentHandler } from '@/artifacts/image/server';
import { sheetDocumentHandler } from '@/artifacts/sheet/server';
import { textDocumentHandler } from '@/artifacts/text/server';
import { canvasDocumentHandler } from '@/artifacts/canvas/server';
import type { ArtifactKind } from '@/components/artifact';
import type { Document } from '../db/schema';
import { saveDocument } from '../db/queries';
import type { AppSession } from '@/lib/types';
import type { UIMessageStreamWriter, UIMessage } from 'ai';
// Constants for artifact types
const ARTIFACT_TYPES = {
  TEXT: 'text',
  CODE: 'code',
  IMAGE: 'image',
  SHEET: 'sheet',
  CANVAS: 'canvas',
} as const;

export interface SaveDocumentProps {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}

export interface CreateDocumentCallbackProps {
  id: string;
  title: string;
  dataStream: UIMessageStreamWriter<UIMessage>;
  session: AppSession;
}

export interface UpdateDocumentCallbackProps {
  document: Document;
  description: string;
  dataStream: UIMessageStreamWriter<UIMessage>;
  session: AppSession;
}

export interface DocumentHandler<T = ArtifactKind> {
  kind: T;
  onCreateDocument: (args: CreateDocumentCallbackProps) => Promise<string>;
  onUpdateDocument: (args: UpdateDocumentCallbackProps) => Promise<string>;
}

export function createDocumentHandler<T extends ArtifactKind>(config: {
  kind: T;
  onCreateDocument: (params: CreateDocumentCallbackProps) => Promise<string>;
  onUpdateDocument: (params: UpdateDocumentCallbackProps) => Promise<string>;
}): DocumentHandler<T> {
  return {
    kind: config.kind,
    onCreateDocument: async (args: CreateDocumentCallbackProps) => {
      const draftContent = await config.onCreateDocument({
        id: args.id,
        title: args.title,
        dataStream: args.dataStream,
        session: args.session,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.id,
          title: args.title,
          content: draftContent,
          kind: config.kind,
          userId: args.session.user.id,
          ownerId: args.session.user.id, // Use user ID as owner ID for now
        });
      }

      console.log(
        `[Document Handler] 📤 Returning content to AI SDK: "${draftContent}"`,
      );
      return draftContent;
    },
    onUpdateDocument: async (args: UpdateDocumentCallbackProps) => {
      const draftContent = await config.onUpdateDocument({
        document: args.document,
        description: args.description,
        dataStream: args.dataStream,
        session: args.session,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.document.id,
          title: args.document.title,
          content: draftContent,
          kind: config.kind,
          userId: args.session.user.id,
          ownerId: args.session.user.id, // Use user ID as owner ID for now
        });
      }

      console.log(
        `[Document Handler] 📤 Returning updated content to AI SDK: "${draftContent}"`,
      );
      return draftContent;
    },
  };
}

/*
 * Use this array to define the document handlers for each artifact kind.
 */
export const documentHandlersByArtifactKind: Array<DocumentHandler> = [
  textDocumentHandler,
  codeDocumentHandler,
  imageDocumentHandler,
  sheetDocumentHandler,
  canvasDocumentHandler,
];

export const artifactKinds = [
  ARTIFACT_TYPES.TEXT,
  ARTIFACT_TYPES.CODE,
  ARTIFACT_TYPES.IMAGE,
  ARTIFACT_TYPES.SHEET,
  ARTIFACT_TYPES.CANVAS,
] as const;
