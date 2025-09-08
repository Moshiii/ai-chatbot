import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { authenticatedRole, authUid, crudPolicy } from 'drizzle-orm/neon';

// A2A Task Status Enum
export const taskStatusEnum = [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
] as const;

export const user = pgTable(
  'user',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: varchar('email', { length: 64 }).notNull(),
    password: varchar('password', { length: 64 }),
    creditBalance: varchar('creditBalance', { length: 20 })
      .notNull()
      .$default(() => '0.00'),
    name: varchar('name', { length: 255 }),
    image: text('image'),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    stackUserId: text('stackUserId'),
  },
  (table) => [
    unique('user_email_idx').on(table.email),
    unique('user_stackUserId_idx').on(table.stackUserId),
  ],
);

export type User = InferSelectModel<typeof user>;

export const chat = pgTable(
  'chat',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    visibility: varchar('visibility', { enum: ['public', 'private'] })
      .notNull()
      .$default(() => 'private'),
    ownerId: text('ownerId').notNull(),
  },
  (table) => [
    index('chat_userId_idx').on(table.userId),
    index('chat_createdAt_idx').on(table.createdAt),
    index('chat_ownerId_idx').on(table.ownerId),
    crudPolicy({
      role: authenticatedRole,
      read: authUid(table.ownerId),
      modify: authUid(table.ownerId),
    }),
  ],
);

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable(
  'message',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    role: varchar('role').notNull(),
    parts: json('parts').notNull(),
    attachments: json('attachments').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => [
    index('message_chatId_idx').on(table.chatId),
    index('message_createdAt_idx').on(table.createdAt),
  ],
);

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  'vote',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: uuid('messageId')
      .notNull()
      .references(() => message.id),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    chatId: uuid('chatId'),
    value: text('value').notNull(),
    createdAt: timestamp('createdAt')
      .$defaultFn(() => new Date())
      .notNull(),
    ownerId: text('ownerId').notNull(),
  },
  (table) => [
    index('vote_messageId_idx').on(table.messageId),
    index('vote_userId_idx').on(table.userId),
    index('vote_ownerId_idx').on(table.ownerId),
    crudPolicy({
      role: authenticatedRole,
      read: authUid(table.ownerId),
      modify: authUid(table.ownerId),
    }),
  ],
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'document',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('kind', {
      enum: ['text', 'code', 'image', 'sheet', 'canvas'],
    })
      .notNull()
      .$default(() => 'text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    taskIds: jsonb('taskIds').$type<string[]>(), // Array of task IDs linked to this document
    ownerId: text('ownerId').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.id, table.createdAt],
    }),
    index('document_userId_idx').on(table.userId),
    index('document_kind_idx').on(table.kind),
    index('document_ownerId_idx').on(table.ownerId),
    crudPolicy({
      role: authenticatedRole,
      read: authUid(table.ownerId),
      modify: authUid(table.ownerId),
    }),
  ],
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'suggestion',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved')
      .notNull()
      .$default(() => false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
    ownerId: text('ownerId').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    index('suggestion_userId_idx').on(table.userId),
    index('suggestion_documentId_idx').on(table.documentId),
    index('suggestion_ownerId_idx').on(table.ownerId),
    crudPolicy({
      role: authenticatedRole,
      read: authUid(table.ownerId),
      modify: authUid(table.ownerId),
    }),
  ],
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'stream',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: uuid('chatId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    index('stream_chatId_idx').on(table.chatId),
  ],
);

export type Stream = InferSelectModel<typeof stream>;

// A2A Tasks Table
export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(), // Task ID from A2A Task.id
    contextId: text('contextId').notNull(),
    status: varchar('status', { enum: taskStatusEnum })
      .notNull()
      .$default(() => 'submitted'),
    statusMessage: text('statusMessage'),
    result: jsonb('result'),
    webhookToken: text('webhookToken').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index('task_contextId_idx').on(table.contextId),
    index('task_status_idx').on(table.status),
  ],
);

export type Task = InferSelectModel<typeof task>;

// Relations
export const userRelations = relations(user, ({ many }) => ({
  chats: many(chat),
  votes: many(vote),
  documents: many(document),
  suggestions: many(suggestion),
}));

export const chatRelations = relations(chat, ({ one, many }) => ({
  user: one(user, {
    fields: [chat.userId],
    references: [user.id],
  }),
  messages: many(message),
  streams: many(stream),
}));

export const messageRelations = relations(message, ({ one, many }) => ({
  chat: one(chat, {
    fields: [message.chatId],
    references: [chat.id],
  }),
  votes: many(vote),
}));

export const voteRelations = relations(vote, ({ one }) => ({
  message: one(message, {
    fields: [vote.messageId],
    references: [message.id],
  }),
  user: one(user, {
    fields: [vote.userId],
    references: [user.id],
  }),
}));

export const documentRelations = relations(document, ({ one, many }) => ({
  user: one(user, {
    fields: [document.userId],
    references: [user.id],
  }),
  suggestions: many(suggestion),
}));

export const suggestionRelations = relations(suggestion, ({ one }) => ({
  user: one(user, {
    fields: [suggestion.userId],
    references: [user.id],
  }),
  document: one(document, {
    fields: [suggestion.documentId, suggestion.documentCreatedAt],
    references: [document.id, document.createdAt],
  }),
}));

export const streamRelations = relations(stream, ({ one }) => ({
  chat: one(chat, {
    fields: [stream.chatId],
    references: [chat.id],
  }),
}));
