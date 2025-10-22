import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import {
  ReplicationConfig,
  ReplicationRetryConfig,
  ServiceConfig,
} from './types/replication.types';

@Injectable({
  providedIn: 'root',
})
export class DatabaseConfigService {
  private readonly config: ServiceConfig;

  constructor() {
    this.config = this.createDefaultConfig();
  }

  private createDefaultConfig(): ServiceConfig {
    return {
      replication: {
        url: {
          http: environment.apiUrl,
          ws: environment.wsUrl,
        },
        batchSize: 5,
        retryTime: 60000,
        live: true,
        autoStart: true,
        waitForLeadership: true,
        headers: {
          // Add authorization headers here if needed
          // 'Authorization': 'Bearer YOUR_TOKEN',
        },
      },
      retry: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true,
      },
      logging: {
        level: environment.production ? 'error' : 'debug',
        enableConsole: !environment.production,
      },
      timeouts: {
        initialization: 30000, // 30 seconds
        replication: 60000, // 60 seconds
        checkpoint: 10000, // 10 seconds
      },
    };
  }

  /**
   * Get replication configuration
   */
  getReplicationConfig(): ReplicationConfig {
    return { ...this.config.replication };
  }

  /**
   * Get retry configuration
   */
  getRetryConfig(): ReplicationRetryConfig {
    return { ...this.config.retry };
  }

  /**
   * Get logging configuration
   */
  getLoggingConfig() {
    return { ...this.config.logging };
  }

  /**
   * Get timeout configuration
   */
  getTimeoutConfig() {
    return { ...this.config.timeouts };
  }

  /**
   * Get complete service configuration
   */
  getConfig(): ServiceConfig {
    return { ...this.config };
  }

  /**
   * Update replication configuration
   */
  updateReplicationConfig(updates: Partial<ReplicationConfig>): void {
    this.config.replication = { ...this.config.replication, ...updates };
  }

  /**
   * Update retry configuration
   */
  updateRetryConfig(updates: Partial<ReplicationRetryConfig>): void {
    this.config.retry = { ...this.config.retry, ...updates };
  }

  /**
   * Update logging configuration
   */
  updateLoggingConfig(updates: Partial<ServiceConfig['logging']>): void {
    this.config.logging = { ...this.config.logging, ...updates };
  }

  /**
   * Update timeout configuration
   */
  updateTimeoutConfig(updates: Partial<ServiceConfig['timeouts']>): void {
    this.config.timeouts = { ...this.config.timeouts, ...updates };
  }

  /**
   * Get configuration for a specific service
   */
  getServiceConfig(serviceName: string): Partial<ServiceConfig> {
    switch (serviceName) {
      case 'transaction-replication':
        return {
          replication: {
            ...this.config.replication,
            batchSize: 5, // Smaller batch for transactions
          },
          retry: this.config.retry,
          timeouts: this.config.timeouts,
        };
      case 'door-replication':
        return {
          replication: {
            ...this.config.replication,
            batchSize: 10, // Larger batch for doors
          },
          retry: this.config.retry,
          timeouts: this.config.timeouts,
        };
      case 'checkpoint':
        return {
          retry: {
            ...this.config.retry,
            maxRetries: 5, // More retries for checkpoint sync
          },
          timeouts: {
            ...this.config.timeouts,
            checkpoint: 5000, // Shorter timeout for checkpoint
          },
        };
      default:
        return this.config;
    }
  }

  /**
   * Validate configuration
   */
  validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate URLs
    if (!this.config.replication.url.http) {
      errors.push('HTTP URL is required for replication');
    }
    if (!this.config.replication.url.ws) {
      errors.push('WebSocket URL is required for replication');
    }

    // Validate batch size
    if (
      this.config.replication.batchSize < 1 ||
      this.config.replication.batchSize > 100
    ) {
      errors.push('Batch size must be between 1 and 100');
    }

    // Validate retry configuration
    if (this.config.retry.maxRetries < 0) {
      errors.push('Max retries cannot be negative');
    }
    if (this.config.retry.baseDelay < 0) {
      errors.push('Base delay cannot be negative');
    }
    if (this.config.retry.maxDelay < this.config.retry.baseDelay) {
      errors.push('Max delay must be greater than or equal to base delay');
    }

    // Validate timeouts
    Object.entries(this.config.timeouts).forEach(([key, value]) => {
      if (value < 1000) {
        errors.push(`Timeout for ${key} should be at least 1000ms`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    Object.assign(this.config, this.createDefaultConfig());
  }

  /**
   * Get environment-specific overrides
   */
  getEnvironmentOverrides(): Partial<ServiceConfig> {
    if (environment.production) {
      return {
        logging: {
          level: 'error',
          enableConsole: false,
        },
        replication: {
          ...this.config.replication,
          batchSize: 10, // Larger batches in production
        },
      };
    }

    return {
      logging: {
        level: 'debug',
        enableConsole: true,
      },
    };
  }
}
