/**
 * Context ID Management for A2A Protocol
 *
 * This module handles the mapping between chat sessions and A2A context IDs,
 * ensuring proper task association and session management.
 */

import { generateId } from 'ai';

/**
 * Generate a stable context ID for a chat session
 * Uses the chatId as contextId for simplicity and consistency
 */
export function generateContextId(chatId: string): string {
  // For now, use chatId directly as contextId
  // This ensures tasks are properly linked to their originating chat
  return chatId;
}

/**
 * Generate a unique webhook token for task authentication
 */
export function generateWebhookToken(): string {
  return generateId();
}

/**
 * Validate that a context ID corresponds to a valid chat session
 * This is a placeholder for future session validation logic
 */
export function validateContextId(contextId: string): boolean {
  // For now, just check that it's a non-empty string
  // In production, you might want to validate against active sessions
  return Boolean(contextId && contextId.trim().length > 0);
}

/**
 * Extract context ID from various sources (A2A message, chat session, etc.)
 */
export function extractContextId(
  chatId?: string,
  a2aContextId?: string,
): string {
  // Prefer A2A context ID if available, otherwise use chat ID
  return a2aContextId || (chatId ? generateContextId(chatId) : generateId());
}

/**
 * Context ID utilities for A2A integration
 */
export const contextUtils = {
  generateContextId,
  generateWebhookToken,
  validateContextId,
  extractContextId,
} as const;
