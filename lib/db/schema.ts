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
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';

// A2A Task Status Enum
export const taskStatusEnum = pgEnum('task_status', [
  'submitted',
  'working',
  'input-required',
  'completed',
  'canceled',
  'failed',
  'rejected',
  'auth-required',
  'unknown',
]);

export const user = pgTable('User', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  email: varchar('email', { length: 64 }).notNull(),
  password: varchar('password', { length: 64 }),
  creditBalance: varchar('creditBalance', { length: 20 })
    .notNull()
    .default('0.00'),
});

export type User = InferSelectModel<typeof user>;

// NextAuth.js required tables
export const accounts = pgTable(
  'accounts',
  {
    id: serial('id'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('providerAccountId', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: bigint('expires_at', { mode: 'number' }),
    id_token: text('id_token'),
    scope: text('scope'),
    session_state: text('session_state'),
    token_type: text('token_type'),
  },
  (table) => ({
    providerProviderAccountIdIdx: primaryKey({
      columns: [table.provider, table.providerAccountId],
    }),
  }),
);

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
  sessionToken: varchar('sessionToken', { length: 255 }).notNull().unique(),
});

export const verificationToken = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => ({
    identifierTokenIdx: primaryKey({
      columns: [table.identifier, table.token],
    }),
  }),
);

export const chat = pgTable('Chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable('Message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  parts: json('parts').notNull(),
  attachments: json('attachments').notNull(),
  createdAt: timestamp('createdAt').notNull(),
  data: jsonb('data'), // To store { artifactType: 'document', documentId: '...' } or similar
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable('Vote', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => message.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id),
  chatId: uuid('chatId'),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  'Document',
  {
    id: uuid('id').notNull().defaultRandom(),
    createdAt: timestamp('createdAt').notNull(),
    title: text('title').notNull(),
    content: text('content'),
    kind: varchar('text', {
      enum: ['text', 'code', 'image', 'sheet', 'canvas'],
    })
      .notNull()
      .default('text'),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    taskIds: jsonb('task_ids').$type<string[]>(), // Array of task IDs linked to this document
  },
  (table) => ({
    documentCompoundKey: primaryKey({
      columns: [table.id, table.createdAt],
    }),
  }),
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  'Suggestion',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    documentId: uuid('documentId').notNull(),
    documentCreatedAt: timestamp('documentCreatedAt').notNull(),
    originalText: text('originalText').notNull(),
    suggestedText: text('suggestedText').notNull(),
    description: text('description'),
    isResolved: boolean('isResolved').notNull().default(false),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    documentFk: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  }),
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  'Stream',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    chatId: uuid('chatId').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    chatFk: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  }),
);

export type Stream = InferSelectModel<typeof stream>;

// A2A Tasks Table
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(), // Task ID from A2A Task.id
  contextId: text('context_id').notNull(),
  status: taskStatusEnum('status').notNull().default('submitted'),
  statusMessage: text('status_message'),
  result: jsonb('result'),
  webhookToken: text('webhook_token').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Task = InferSelectModel<typeof tasks>;
