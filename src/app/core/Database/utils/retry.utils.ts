import { Observable, timer, throwError, of } from 'rxjs';
import { mergeMap, retryWhen, delay, take } from 'rxjs/operators';
import { logger } from './logging.utils';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  jitter: true,
};

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  
  if (config.jitter) {
    // Add random jitter (±25%)
    const jitterRange = cappedDelay * 0.25;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.max(0, cappedDelay + jitter);
  }
  
  return cappedDelay;
}

/**
 * Retry an operation with exponential backoff
 */
export function retryWithBackoff<T>(
  operation: () => Observable<T>,
  config: Partial<RetryConfig> = {},
  context: { service: string; operation: string }
): Observable<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let attempt = 0;

  return operation().pipe(
    retryWhen(errors =>
      errors.pipe(
        mergeMap((error) => {
          attempt++;
          
          if (attempt > retryConfig.maxAttempts) {
            logger.error(context, `Operation failed after ${attempt} attempts`, error);
            return throwError(() => new RetryError(
              `Operation failed after ${attempt} attempts`,
              attempt,
              error
            ));
          }

          const delayTime = calculateDelay(attempt, retryConfig);
          logger.warn(context, `Attempt ${attempt} failed, retrying in ${delayTime}ms`, error);
          
          return timer(delayTime);
        }),
        take(retryConfig.maxAttempts)
      )
    )
  );
}

/**
 * Retry an async operation with exponential backoff
 */
export async function retryAsync<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context: { service: string; operation: string }
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error;

  for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === retryConfig.maxAttempts) {
        logger.error(context, `Operation failed after ${attempt} attempts`, lastError);
        throw new RetryError(
          `Operation failed after ${attempt} attempts`,
          attempt,
          lastError
        );
      }

      const delayTime = calculateDelay(attempt, retryConfig);
      logger.warn(context, `Attempt ${attempt} failed, retrying in ${delayTime}ms`, lastError);
      
      await new Promise(resolve => setTimeout(resolve, delayTime));
    }
  }

  throw lastError!;
}

/**
 * Create a retry operator for RxJS streams
 */
export function createRetryOperator(config: Partial<RetryConfig> = {}) {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  
  return <T>(source: Observable<T>) => source.pipe(
    retryWhen(errors =>
      errors.pipe(
        mergeMap((error, index) => {
          const attempt = index + 1;
          
          if (attempt > retryConfig.maxAttempts) {
            return throwError(() => new RetryError(
              `Operation failed after ${attempt} attempts`,
              attempt,
              error
            ));
          }

          const delayTime = calculateDelay(attempt, retryConfig);
          return timer(delayTime);
        }),
        take(retryConfig.maxAttempts)
      )
    )
  );
}
