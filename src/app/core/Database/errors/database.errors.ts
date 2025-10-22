/**
 * Custom error classes for database operations
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class DatabaseNotReadyError extends DatabaseError {
  constructor(operation: string, context?: Record<string, any>) {
    super('Database is not initialized or ready', operation, context);
    this.name = 'DatabaseNotReadyError';
  }
}

export class ReplicationError extends DatabaseError {
  constructor(
    message: string,
    operation: string,
    public readonly replicationId: string,
    public readonly retryable: boolean = true,
    context?: Record<string, any>
  ) {
    super(message, operation, context);
    this.name = 'ReplicationError';
  }
}

export class CheckpointError extends DatabaseError {
  constructor(
    message: string,
    operation: string,
    public readonly checkpoint?: any,
    context?: Record<string, any>
  ) {
    super(message, operation, context);
    this.name = 'CheckpointError';
  }
}

export class SchemaValidationError extends DatabaseError {
  constructor(
    message: string,
    operation: string,
    public readonly schema: string,
    public readonly document: any,
    context?: Record<string, any>
  ) {
    super(message, operation, context);
    this.name = 'SchemaValidationError';
  }
}

export class ConnectionError extends DatabaseError {
  constructor(
    message: string,
    operation: string,
    public readonly endpoint: string,
    public readonly retryable: boolean = true,
    context?: Record<string, any>
  ) {
    super(message, operation, context);
    this.name = 'ConnectionError';
  }
}

/**
 * Error factory for creating typed errors
 */
export class DatabaseErrorFactory {
  static notReady(operation: string, context?: Record<string, any>): DatabaseNotReadyError {
    return new DatabaseNotReadyError(operation, context);
  }

  static replication(
    message: string,
    operation: string,
    replicationId: string,
    retryable: boolean = true,
    context?: Record<string, any>
  ): ReplicationError {
    return new ReplicationError(message, operation, replicationId, retryable, context);
  }

  static checkpoint(
    message: string,
    operation: string,
    checkpoint?: any,
    context?: Record<string, any>
  ): CheckpointError {
    return new CheckpointError(message, operation, checkpoint, context);
  }

  static schemaValidation(
    message: string,
    operation: string,
    schema: string,
    document: any,
    context?: Record<string, any>
  ): SchemaValidationError {
    return new SchemaValidationError(message, operation, schema, document, context);
  }

  static connection(
    message: string,
    operation: string,
    endpoint: string,
    retryable: boolean = true,
    context?: Record<string, any>
  ): ConnectionError {
    return new ConnectionError(message, operation, endpoint, retryable, context);
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  if (error instanceof ReplicationError) {
    return error.retryable;
  }
  
  if (error instanceof ConnectionError) {
    return error.retryable;
  }
  
  // Network errors are generally retryable
  if (error.name === 'NetworkError' || error.message.includes('network')) {
    return true;
  }
  
  // Timeout errors are retryable
  if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
    return true;
  }
  
  return false;
}

/**
 * Get error context for logging
 */
export function getErrorContext(error: Error): Record<string, any> {
  if (error instanceof DatabaseError) {
    return {
      name: error.name,
      operation: error.operation,
      context: error.context,
      ...(error instanceof ReplicationError && { replicationId: error.replicationId }),
      ...(error instanceof CheckpointError && { checkpoint: error.checkpoint }),
      ...(error instanceof SchemaValidationError && { schema: error.schema }),
      ...(error instanceof ConnectionError && { endpoint: error.endpoint }),
    };
  }
  
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}
