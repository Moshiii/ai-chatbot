-- Add chatId column to Document table to link documents to chat sessions
ALTER TABLE "Document" ADD COLUMN "chatId" uuid;

-- Add foreign key constraint
ALTER TABLE "Document" ADD CONSTRAINT "Document_chatId_fkey" 
  FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE;

-- Create index for better query performance
CREATE INDEX "Document_chatId_idx" ON "Document"("chatId");

-- Create unique constraint to ensure only one canvas per chat
CREATE UNIQUE INDEX "Document_chatId_canvas_unique" 
  ON "Document"("chatId", "kind") 
  WHERE "kind" = 'canvas';