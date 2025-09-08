import { tool } from 'ai';
import type { UIMessageStreamWriter, UIMessage } from 'ai';
import { z } from 'zod';
import type { AppSession } from '@/lib/types';
import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from '@/lib/artifacts/server';
import { generateDocumentIds } from '@/lib/id-management';

interface CreateDocumentProps {
  session: AppSession;
  dataStream: UIMessageStreamWriter<UIMessage>;
}

export const createDocument = ({ session, dataStream }: CreateDocumentProps) =>
  tool({
    description:
      'Create a document for a writing or content creation activities. This tool will call other functions that will generate the contents of the document based on the title and kind.',
    inputSchema: z.object({
      title: z.string(),
      kind: z.enum(artifactKinds),
    }),
    execute: async ({ title, kind }) => {
      const ids = generateDocumentIds(title, kind);

      dataStream.write({
        type: 'data-kind',
        data: kind,
        transient: true,
      });

      dataStream.write({
        type: 'data-id',
        data: ids.document.databaseId,
        transient: true,
      });

      dataStream.write({
        type: 'data-title',
        data: title,
        transient: true,
      });

      dataStream.write({
        type: 'data-clear',
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (documentHandlerByArtifactKind) =>
          documentHandlerByArtifactKind.kind === kind,
      );

      if (!documentHandler) {
        throw new Error(`No document handler found for kind: ${kind}`);
      }

      await documentHandler.onCreateDocument({
        id: ids.document.databaseId,
        title,
        dataStream,
        session,
      });

      dataStream.write({ type: 'data-finish', data: null, transient: true });

      return {
        id: ids.document.databaseId,
        title,
        kind,
        referenceId: ids.document.referenceId,
        content: 'A document was created and is now visible to the user.',
      };
    },
  });
