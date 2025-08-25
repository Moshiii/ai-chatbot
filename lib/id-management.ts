/**
 * Centralized ID Management System
 *
 * Provides consistent, type-safe ID generation for all entities in the application.
 * Ensures proper UUID format for database entities while supporting human-readable
 * identifiers for task coordination and referencing.
 */

import { generateUUID } from './utils';

// Type definitions for different ID contexts
export type EntityType =
  | 'chat'
  | 'message'
  | 'document'
  | 'task'
  | 'agent'
  | 'stream'
  | 'user'
  | 'suggestion';

export interface IDConfiguration {
  /** Always generate a proper UUID for database storage */
  databaseId: string;
  /** Optional human-readable ID for referencing/coordination */
  referenceId?: string;
  /** Entity type for logging and debugging */
  entityType: EntityType;
  /** Optional metadata for enhanced debugging */
  metadata?: Record<string, any>;
}

/**
 * Central ID Manager class for consistent ID generation and management
 */
export class IDManager {
  private static instance: IDManager;
  private idRegistry = new Map<string, IDConfiguration>();

  private constructor() {}

  static getInstance(): IDManager {
    if (!IDManager.instance) {
      IDManager.instance = new IDManager();
    }
    return IDManager.instance;
  }

  /**
   * Generate a new ID configuration for an entity
   */
  generateFor(
    entityType: EntityType,
    options?: {
      referenceId?: string;
      metadata?: Record<string, any>;
    },
  ): IDConfiguration {
    const databaseId = generateUUID();
    const config: IDConfiguration = {
      databaseId,
      referenceId: options?.referenceId,
      entityType,
      metadata: options?.metadata,
    };

    // Register the ID for tracking
    this.idRegistry.set(databaseId, config);

    console.log(`[IDManager] Generated ${entityType} ID:`, {
      databaseId,
      referenceId: options?.referenceId,
      metadata: options?.metadata,
    });

    return config;
  }

  /**
   * Get ID configuration by database ID
   */
  getConfig(databaseId: string): IDConfiguration | undefined {
    return this.idRegistry.get(databaseId);
  }

  /**
   * Find ID by reference ID across all entities
   */
  findByReference(
    referenceId: string,
    entityType?: EntityType,
  ): IDConfiguration | undefined {
    for (const [, config] of this.idRegistry) {
      if (config.referenceId === referenceId) {
        if (!entityType || config.entityType === entityType) {
          return config;
        }
      }
    }
    return undefined;
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;

    for (const [databaseId, config] of this.idRegistry) {
      const createdAt = config.metadata?.createdAt;
      if (createdAt && createdAt < cutoff) {
        this.idRegistry.delete(databaseId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[IDManager] Cleaned up ${cleaned} old ID entries`);
    }
  }

  /**
   * Get registry statistics for debugging
   */
  getStats(): { total: number; byType: Record<EntityType, number> } {
    const byType = {} as Record<EntityType, number>;
    let total = 0;

    for (const [, config] of this.idRegistry) {
      total++;
      byType[config.entityType] = (byType[config.entityType] || 0) + 1;
    }

    return { total, byType };
  }
}

/**
 * Convenience functions for common ID generation patterns
 */

/** Generate chat-related IDs */
export function generateChatIds(chatTitle?: string) {
  const idManager = IDManager.getInstance();

  return {
    chat: idManager.generateFor('chat', {
      referenceId: chatTitle ? createSlug(chatTitle) : undefined,
      metadata: { createdAt: Date.now(), title: chatTitle },
    }),

    generateMessageId: () =>
      idManager.generateFor('message', {
        metadata: { createdAt: Date.now() },
      }),

    generateStreamId: () =>
      idManager.generateFor('stream', {
        metadata: { createdAt: Date.now() },
      }),
  };
}

/** Generate document-related IDs */
export function generateDocumentIds(title: string, kind: string) {
  const idManager = IDManager.getInstance();

  return {
    document: idManager.generateFor('document', {
      referenceId: createSlug(title),
      metadata: { createdAt: Date.now(), title, kind },
    }),

    generateSuggestionId: () =>
      idManager.generateFor('suggestion', {
        metadata: { createdAt: Date.now() },
      }),
  };
}

/** Generate task-related IDs */
export function generateTaskIds(title: string, taskReferenceId?: string) {
  const idManager = IDManager.getInstance();

  const documentConfig = idManager.generateFor('document', {
    referenceId: createSlug(title),
    metadata: { createdAt: Date.now(), title, kind: 'canvas' },
  });

  const taskConfig = idManager.generateFor('task', {
    referenceId: taskReferenceId || createSlug(title),
    metadata: {
      createdAt: Date.now(),
      title,
      documentId: documentConfig.databaseId,
    },
  });

  return {
    document: documentConfig,
    task: taskConfig,

    generateAgentId: (agentName: string) =>
      idManager.generateFor('agent', {
        referenceId: createSlug(agentName),
        metadata: {
          createdAt: Date.now(),
          name: agentName,
          taskId: taskConfig.databaseId,
        },
      }),
  };
}

/** Generate user-related IDs */
export function generateUserIds(email?: string) {
  const idManager = IDManager.getInstance();

  return idManager.generateFor('user', {
    referenceId: email ? createSlug(email) : undefined,
    metadata: { createdAt: Date.now(), email },
  });
}

/**
 * Utility functions
 */

/** Create a URL-friendly slug from a string */
function createSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/** Check if a string is a valid UUID format */
export function isValidUUID(id: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/** Validate that an ID is appropriate for database use */
export function validateDatabaseId(id: string, context?: string): void {
  if (!isValidUUID(id)) {
    throw new Error(
      `Invalid database ID format${context ? ` for ${context}` : ''}: ${id}. Expected UUID format.`,
    );
  }
}

/**
 * Legacy compatibility helpers
 */

/** Ensure backward compatibility with existing UUID generation */
export function ensureValidDatabaseId(
  id?: string,
  entityType?: EntityType,
): string {
  if (!id || !isValidUUID(id)) {
    const idManager = IDManager.getInstance();
    const config = idManager.generateFor(entityType || 'document');
    console.warn(
      `[IDManager] Generated new UUID for invalid ID: ${id} -> ${config.databaseId}`,
    );
    return config.databaseId;
  }
  return id;
}

/** Extract meaningful reference from ID or generate slug */
export function extractReference(input: string): string {
  if (isValidUUID(input)) {
    // If it's a UUID, try to find the reference ID
    const idManager = IDManager.getInstance();
    const config = idManager.getConfig(input);
    return config?.referenceId || createSlug(input.substring(0, 8));
  }
  // If it's already a reference ID, return it
  return createSlug(input);
}

// Initialize cleanup interval in non-test environments
if (typeof window === 'undefined' && process.env.NODE_ENV !== 'test') {
  setInterval(
    () => {
      IDManager.getInstance().cleanup();
    },
    60 * 60 * 1000,
  ); // Cleanup every hour
}
