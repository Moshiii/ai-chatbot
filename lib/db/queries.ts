import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  user,
  chat,
  document,
  suggestion,
  message,
  vote,
  stream,
  task,
} from './schema';
import type {
  User,
  Suggestion,
  DBMessage,
  Chat,
  Task,
  taskStatusEnum,
} from './schema';
import type { ArtifactKind } from '@/components/artifact';
import { generateUUID } from '../utils';
import { generateHashedPassword } from './utils';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!, {
  max: 10, // Maximum connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  max_lifetime: 60 * 30, // Close connections after 30 minutes
  connect_timeout: 10, // Connection timeout in seconds
  ssl: { rejectUnauthorized: false }, // Required for Neon
  prepare: false, // Disable prepared statements to avoid potential issues
});
const db = drizzle(client);

// Export db instance for NextAuth.js adapter
export { db };

export async function getUser(email: string): Promise<Array<User>> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get user by email',
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({
      email,
      password: hashedPassword,
      creditBalance: '0.00',
    });
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to create user');
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db
      .insert(user)
      .values({
        email,
        password,
        creditBalance: '0.00',
      })
      .returning({
        id: user.id,
        email: user.email,
        creditBalance: user.creditBalance,
      });
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create guest user',
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
  ownerId,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
  ownerId: string;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
      ownerId,
    });
  } catch (error) {
    console.error('Database error in saveChat:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id',
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    console.log(
      `[getChatsByUserId] Fetching chats for user ID: ${id}, limit: ${limit}`,
    );
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id),
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Array<Chat> = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${startingAfter} not found`,
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${endingBefore} not found`,
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    console.log(
      `[getChatsByUserId] Found ${filteredChats.length} chats for user ${id}, hasMore: ${hasMore}`,
    );
    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (error) {
    console.error(
      `[getChatsByUserId] Database error for user ID ${id}:`,
      error,
    );
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chats by user id',
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    console.log(`[getChatById] Fetching chat for ID: ${id}`);
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    console.log(`[getChatById] Found chat:`, selectedChat ? 'Yes' : 'No');
    return selectedChat;
  } catch (error) {
    console.error(`[getChatById] Database error for ID ${id}:`, error);
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

export async function saveMessages({
  messages,
}: {
  messages: Array<DBMessage>;
}) {
  try {
    return await db.insert(message).values(messages);
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id',
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
  userId,
  ownerId,
}: {
  chatId?: string;
  messageId: string;
  type: 'up' | 'down';
  userId: string;
  ownerId: string;
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId), eq(vote.userId, userId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ value: type, ...(ownerId && { ownerId }) })
        .where(and(eq(vote.messageId, messageId), eq(vote.userId, userId)));
    }
    return await db.insert(vote).values({
      messageId,
      value: type,
      userId,
      ownerId,
      ...(chatId && { chatId }),
    });
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to vote message');
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get votes by chat id',
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
  ownerId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  ownerId: string;
}) {
  try {
    // Check if document with this id already exists
    const existing = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .limit(1);

    if (existing.length > 0) {
      // Update existing document while preserving taskIds
      const existingDoc = existing[0];
      return await db
        .update(document)
        .set({
          title,
          content,
          kind,
          // Preserve existing taskIds to avoid losing pre-linked tasks
          taskIds: existingDoc.taskIds,
          // Update ownerId if provided
          ...(ownerId && { ownerId }),
        })
        .where(eq(document.id, id))
        .returning();
    } else {
      // Insert new document
      return await db
        .insert(document)
        .values({
          id,
          title,
          kind,
          content,
          userId,
          createdAt: new Date(),
          taskIds: [],
          ownerId,
        })
        .returning();
    }
  } catch (error) {
    console.error('Database error in saveDocument:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to save document');
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    console.log(`[getDocumentsById] Fetching documents for ID: ${id}`);
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    console.log(
      `[getDocumentsById] Found ${documents.length} documents for ID: ${id}`,
    );
    return documents;
  } catch (error) {
    console.error(`[getDocumentsById] Database error for ID ${id}:`, error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get documents by id',
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get document by id',
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp),
        ),
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete documents by id after timestamp',
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Array<Suggestion>;
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save suggestions',
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(and(eq(suggestion.documentId, documentId)));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get suggestions by document id',
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id',
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp)),
      );

    const messageIds = messagesToDelete.map((message) => message.id);

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds)),
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds)),
        );
    }
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp',
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id',
    );
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: { id: string; differenceInHours: number }) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000,
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, 'user'),
        ),
      )
      .execute();

    return stats?.count ?? 0;
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message count by user id',
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create stream id',
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get stream ids by chat id',
    );
  }
}

// Task-related query functions
export async function getTaskById({ id }: { id: string }): Promise<Task[]> {
  try {
    return await db.select().from(task).where(eq(task.id, id));
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to get task by id');
  }
}

export async function getTasksByContextId({
  contextId,
}: { contextId: string }): Promise<Task[]> {
  try {
    return await db
      .select()
      .from(task)
      .where(eq(task.contextId, contextId))
      .orderBy(desc(task.createdAt));
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get tasks by context id',
    );
  }
}

export async function createTask({
  id,
  contextId,
  status,
  statusMessage,
  result,
  webhookToken,
}: {
  id: string;
  contextId: string;
  status?: (typeof taskStatusEnum)[number];
  statusMessage?: string;
  result?: any;
  webhookToken: string;
}) {
  try {
    return await db
      .insert(task)
      .values({
        id,
        contextId,
        status: status || 'submitted',
        statusMessage,
        result,
        webhookToken,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to create task');
  }
}

export async function updateTask({
  id,
  status,
  statusMessage,
  result,
}: {
  id: string;
  status?: (typeof taskStatusEnum)[number];
  statusMessage?: string;
  result?: any;
}) {
  try {
    return await db
      .update(task)
      .set({
        status,
        statusMessage,
        result,
        updatedAt: new Date(),
      })
      .where(eq(task.id, id))
      .returning();
  } catch (error) {
    throw new ChatSDKError('bad_request:database', 'Failed to update task');
  }
}

export async function updateDocumentTaskIds({
  documentId,
  taskIds,
}: {
  documentId: string;
  taskIds: string[];
}) {
  try {
    return await db
      .update(document)
      .set({
        taskIds,
      })
      .where(eq(document.id, documentId))
      .returning();
  } catch (error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update document task ids',
    );
  }
}

/**
 * Safely find or create a user by email for OAuth providers
 * Handles race conditions and database constraint violations
 * Now supports Stack Auth integration
 */
export async function findOrCreateOAuthUser(
  email: string,
  stackUserId?: string,
): Promise<User> {
  try {
    // First, try to find existing user by stackUserId if provided
    if (stackUserId) {
      const existingByStackId = await db
        .select()
        .from(user)
        .where(eq(user.stackUserId, stackUserId));

      if (existingByStackId.length > 0) {
        console.log(
          `Found existing user for Stack ID ${stackUserId} with app ID ${existingByStackId[0].id}`,
        );
        return existingByStackId[0];
      }
    }

    // Try to find existing user by email
    const existingUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, email));

    if (existingUsers.length > 0) {
      // If we have a stackUserId, update the existing user record to link it
      if (stackUserId) {
        const [updatedUser] = await db
          .update(user)
          .set({ stackUserId })
          .where(eq(user.email, email))
          .returning();

        if (updatedUser) {
          console.log(
            `Updated existing user ${updatedUser.id} with Stack ID ${stackUserId}`,
          );
          return updatedUser;
        }
      }

      console.log(
        `Found existing user for email ${email} with ID ${existingUsers[0].id}`,
      );
      return existingUsers[0];
    }

    console.log(`No existing user found for email ${email}, creating new user`);

    // User doesn't exist, try to create one
    // Use onConflictDoNothing to handle race conditions
    const [newUser] = await db
      .insert(user)
      .values({
        email,
        creditBalance: '0.00',
        stackUserId,
      })
      .onConflictDoNothing()
      .returning();

    // If the insert was successful, return the new user
    if (newUser) {
      console.log(
        `Successfully created new user for email ${email} with ID ${newUser.id}`,
      );
      return newUser;
    }

    // If we get here, it means there was a race condition
    // and another process created the user. Try to find it again.
    console.log(
      `Insert failed (likely race condition), retrying lookup for email ${email}`,
    );
    const retryUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, email));

    if (retryUsers.length > 0) {
      console.log(
        `Found user after retry for email ${email} with ID ${retryUsers[0].id}`,
      );
      return retryUsers[0];
    }

    // If we still can't find the user, something went wrong
    console.error(
      `Failed to find or create user for email ${email} after all attempts`,
    );
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create or find user after retry',
    );
  } catch (error) {
    console.error('Error in findOrCreateOAuthUser:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to find or create OAuth user',
    );
  }
}

/**
 * Upgrade a guest user to a regular user by linking their email
 * This handles the case where a guest user authenticates with GitHub
 * If the guest user doesn't exist, it will create a new user with the email
 */
export async function upgradeGuestToRegularUser(
  guestUserId: string,
  email: string,
): Promise<User | null> {
  try {
    // First, check if there's already a regular user with this email
    const existingRegularUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, email));

    if (existingRegularUsers.length > 0) {
      // There's already a regular user with this email
      console.log(
        `Found existing user with email ${email}, returning existing user`,
      );
      return existingRegularUsers[0];
    }

    // Try to find the guest user
    const guestUsers = await db
      .select()
      .from(user)
      .where(eq(user.id, guestUserId));

    if (guestUsers.length > 0) {
      const guestUser = guestUsers[0];

      // Check if guest user already has an email (shouldn't happen for guest users)
      if (
        guestUser.email &&
        guestUser.email !== email &&
        !guestUser.email.startsWith('guest-')
      ) {
        throw new ChatSDKError(
          'bad_request:database',
          'Guest user already has a different email',
        );
      }

      // If guest user already has the correct email, just return it
      if (guestUser.email === email) {
        return guestUser;
      }

      // Update the guest user with the email
      const [updatedUser] = await db
        .update(user)
        .set({
          email,
        })
        .where(eq(user.id, guestUserId))
        .returning();

      if (updatedUser) {
        console.log(
          `Successfully upgraded guest user ${guestUserId} to email ${email}`,
        );
        return updatedUser;
      }
    }

    // If we get here, either the guest user doesn't exist or the update failed
    // Create a new user with the email instead
    console.log(
      `Guest user ${guestUserId} not found or update failed, creating new user with email ${email}`,
    );

    const [newUser] = await db
      .insert(user)
      .values({
        email,
        creditBalance: '0.00',
      })
      .onConflictDoNothing()
      .returning();

    if (newUser) {
      console.log(`Created new user with email ${email} and ID ${newUser.id}`);
      return newUser;
    }

    // If insert failed due to conflict, try to find the user again
    const retryUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, email));
    if (retryUsers.length > 0) {
      console.log(`Found user after retry for email ${email}`);
      return retryUsers[0];
    }

    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create or find user after upgrade attempt',
    );
  } catch (error) {
    console.error('Error in upgradeGuestToRegularUser:', error);
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to upgrade guest user to regular user',
    );
  }
}
