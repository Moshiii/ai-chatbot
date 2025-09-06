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
  serial,
  bigint,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
    creditBalance: varchar('credit_balance', { length: 20 })
      .notNull()
      .$default(() => '0.00'),
  },
  (table) => [unique('user_email_idx').on(table.email)],
);

export type User = InferSelectModel<typeof user>;

// NextAuth.js required tables
export const account = pgTable(
  'account',
  {
    id: serial('id'), // Remove .primaryKey() - will use composite primary key instead
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('provider_account_id', {
      length: 255,
    }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: bigint('expires_at', { mode: 'number' }),
    id_token: text('id_token'),
    scope: text('scope'),
    session_state: text('session_state'),
    token_type: text('token_type'),
  },
  (table) => [
    primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
    index('account_user_id_idx').on(table.userId),
  ],
);

export const session = pgTable(
  'session',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
    sessionToken: varchar('session_token', { length: 255 }).notNull(),
  },
  (table) => [
    unique('session_session_token_idx').on(table.sessionToken),
    index('session_user_id_idx').on(table.userId),
  ],
);

export const verification_token = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.identifier, table.token],
    }),
  ],
);

export const chat = pgTable(
  'chat',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('created_at').notNull(),
    title: text('title').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    visibility: varchar('visibility', { enum: ['public', 'private'] })
      .notNull()
      .$default(() => 'private'),
  },
  (table) => [
    index('chat_user_id_idx').on(table.userId),
    index('chat_created_at_idx').on(table.createdAt),
  ],
);

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable(
  'message',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chat.id),
    role: varchar('role').notNull(),
    parts: json('parts').notNull(),
    attachments: json('attachments').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('message_chat_id_idx').on(table.chatId),
    index('message_created_at_idx').on(table.createdAt),
  ],
);

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  'vote',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    chatId: uuid('chat_id'),
    value: text('value').notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index('vote_message_id_idx').on(table.messageId),
    index('vote_user_id_idx').on(table.userId),
  ],
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'document',
  {
    id: uuid('id')
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    createdAt: timestamp('created_at').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('kind', {
      enum: ['text', 'code', 'image', 'sheet', 'canvas'],
    })
      .notNull()
      .$default(() => 'text'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    taskIds: jsonb('task_ids').$type<string[]>(), // Array of task IDs linked to this document
  },
  (table) => [
    primaryKey({
      columns: [table.id, table.createdAt],
    }),
    index('document_user_id_idx').on(table.userId),
    index('document_kind_idx').on(table.kind),
  ],
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'suggestion',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    documentId: uuid('document_id').notNull(),
    documentCreatedAt: timestamp('document_created_at').notNull(),
    originalText: text('original_text').notNull(),
    suggestedText: text('suggested_text').notNull(),
    description: text('description'),
    isResolved: boolean('is_resolved')
      .notNull()
      .$default(() => false),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
    index('suggestion_user_id_idx').on(table.userId),
    index('suggestion_document_id_idx').on(table.documentId),
  ],
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'stream',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: uuid('chat_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
    index('stream_chat_id_idx').on(table.chatId),
  ],
);

export type Stream = InferSelectModel<typeof stream>;

// A2A Tasks Table
export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(), // Task ID from A2A Task.id
    contextId: text('context_id').notNull(),
    status: varchar('status', { enum: taskStatusEnum })
      .notNull()
      .$default(() => 'submitted'),
    statusMessage: text('status_message'),
    result: jsonb('result'),
    webhookToken: text('webhook_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index('task_context_id_idx').on(table.contextId),
    index('task_status_idx').on(table.status),
  ],
);

export type Task = InferSelectModel<typeof task>;

// Relations
export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  chats: many(chat),
  votes: many(vote),
  documents: many(document),
  suggestions: many(suggestion),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
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
